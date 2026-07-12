"use server";

// ADDED (Phase 8): server actions — the only way the client mutates data.
// Every action re-checks auth() (Server Actions are reachable by direct POST, so we
// never trust the client) and scopes writes to the signed-in user. After a write we
// revalidatePath the dashboard routes; client handlers also call the ExpensesProvider's
// refresh() (which re-fetches the viewed month via fetchMonthData) so the UI updates.
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import {
  toUiExpense,
  suggestFixedMetaLocal,
  suggestExpenseMetaLocal,
  normalizeTags,
} from "@/lib/expense-utils";
import {
  getMonthDashboardData,
  getYearSummary,
  getFixedExpenses,
  resyncFixedExpense,
  getClosedMonthKeys,
} from "@/lib/queries";
import type { CategoryKey, Currency } from "@/types";

const VALID_CATEGORIES: CategoryKey[] = [
  "food",
  "shop",
  "ent",
  "trans",
  "health",
  "bills",
  "other",
];

const DASHBOARD_ROUTES = [
  "/dashboard",
  "/ledger",
  "/calendar",
  "/income",
  "/voice",
];

function revalidateDashboard() {
  for (const path of DASHBOARD_ROUTES) revalidatePath(path);
}

async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

/** ADDED (Module 5): defense-in-depth — every expense mutation re-checks this,
 *  even though the UI already disables the relevant buttons for a closed month. */
async function assertMonthOpen(userId: string, year: number, month: number) {
  const closed = await prisma.monthClose.findUnique({
    where: { userId_year_month: { userId, year, month } },
  });
  if (closed) {
    throw new Error(
      "This month is closed. Reopen it on the Ledger page to make changes.",
    );
  }
}

export interface ExpenseInput {
  amount: number;
  category: CategoryKey;
  currency: Currency;
  note: string;
  tags?: string[]; // ADDED (Tags module): normalized + capped server-side
  fixed?: boolean;
  /** Defaults to now; callers may pass a specific timestamp. */
  spentAt?: string; // ISO string (Date isn't serializable across the boundary)
  // Voice metadata — only when source = "voice"
  source?: "manual" | "voice";
  transcript?: string;
  lang?: string;
  voiceStatus?: "confirmed" | "edited" | "reparsed";
}

export async function createExpense(input: ExpenseInput, overrideClosed = false) {
  const userId = await requireUserId();

  const spentAt = input.spentAt ? new Date(input.spentAt) : new Date();
  // CHANGED (AI Assistant · Phase A follow-up): callers may opt into writing into
  // a closed month (e.g. voice-logging a historical expense the user explicitly
  // chose to "add to the closed month"). The month stays closed; the row lands as
  // a frozen entry — same override contract as the recurring-rule edits.
  if (!overrideClosed) {
    await assertMonthOpen(userId, spentAt.getFullYear(), spentAt.getMonth() + 1);
  }

  const row = await prisma.expense.create({
    data: {
      userId,
      spentAt,
      category: input.category,
      amount: input.amount,
      currency: input.currency,
      note: input.note,
      tags: normalizeTags(input.tags ?? []),
      fixed: input.fixed ?? false,
      source: input.source ?? "manual",
      transcript: input.transcript ?? null,
      lang: input.lang ?? null,
      voiceStatus: input.source === "voice" ? input.voiceStatus ?? "confirmed" : null,
    },
  });

  revalidateDashboard();
  return toUiExpense(row);
}

export async function updateExpense(
  id: number,
  input: Partial<ExpenseInput>,
  overrideClosed = false,
) {
  const userId = await requireUserId();

  // Ownership check — never let a user edit a row that isn't theirs.
  const owned = await prisma.expense.findFirst({ where: { id, userId } });
  if (!owned) throw new Error("Expense not found");

  // The row's current month must be open; if the edit also moves it to a
  // different month, that month must be open too. CHANGED (Phase B): callers may
  // opt into editing a row in a closed month (voice "edit anyway") — same override
  // contract as createExpense; the month stays closed, the row just changes.
  if (!overrideClosed) {
    await assertMonthOpen(userId, owned.spentAt.getFullYear(), owned.spentAt.getMonth() + 1);
    if (input.spentAt !== undefined) {
      const newDate = new Date(input.spentAt);
      await assertMonthOpen(userId, newDate.getFullYear(), newDate.getMonth() + 1);
    }
  }

  const row = await prisma.expense.update({
    where: { id },
    data: {
      ...(input.amount !== undefined && { amount: input.amount }),
      ...(input.category !== undefined && { category: input.category }),
      ...(input.currency !== undefined && { currency: input.currency }),
      ...(input.note !== undefined && { note: input.note }),
      ...(input.tags !== undefined && { tags: normalizeTags(input.tags) }),
      ...(input.fixed !== undefined && { fixed: input.fixed }),
      ...(input.spentAt !== undefined && { spentAt: new Date(input.spentAt) }),
      ...(input.transcript !== undefined && { transcript: input.transcript }),
      ...(input.lang !== undefined && { lang: input.lang }),
      ...(input.voiceStatus !== undefined && { voiceStatus: input.voiceStatus }),
    },
  });

  revalidateDashboard();
  return toUiExpense(row);
}

export async function deleteExpense(id: number) {
  const userId = await requireUserId();
  const owned = await prisma.expense.findFirst({ where: { id, userId } });
  if (!owned) return;
  await assertMonthOpen(userId, owned.spentAt.getFullYear(), owned.spentAt.getMonth() + 1);
  await prisma.expense.delete({ where: { id } });
  revalidateDashboard();
}

/**
 * ADDED (Tags module): the user's distinct past tags, most-used first — powers the
 * "persistent" suggestion chips in the add/edit modal so tags carry across entries.
 * Scans the most recent entries (bounded) and aggregates in JS.
 */
export async function fetchTagSuggestions(): Promise<string[]> {
  const userId = await requireUserId();
  const rows = await prisma.expense.findMany({
    where: { userId, NOT: { tags: { isEmpty: true } } },
    select: { tags: true },
    orderBy: { spentAt: "desc" },
    take: 400,
  });
  const freq = new Map<string, number>();
  for (const r of rows) for (const t of r.tags) freq.set(t, (freq.get(t) ?? 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 24)
    .map(([t]) => t);
}

/**
 * ADDED (AI Suggest module): from a short expense note, suggest a best-fit category
 * and up to 3 tags via Claude Haiku. Powers the ManualAddModal "AI suggests" card
 * (Apply fills category + merges tags). Falls back to {other, []} when the key is
 * unset / note empty / anything fails, so the card simply won't show a suggestion.
 * SECURITY: only the note text is ever sent — no amount, date, or other expenses.
 * Note: the note may contain names; this is the user's own data, sent solely to
 * power the feature they enabled. Tags are normalized to match the tag system.
 */
export async function suggestExpenseMeta(
  note: string,
): Promise<{ category: CategoryKey; tags: string[] }> {
  // Local keyword suggester — the always-available fallback. Real AI (below)
  // upgrades this whenever the Claude call succeeds; if the key is unset, out of
  // credit, or errors, the user still gets useful category + tag suggestions.
  const fallback = suggestExpenseMetaLocal(note);
  const trimmed = note.trim().slice(0, 120);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || trimmed.length < 3) return fallback;

  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 120,
      system:
        `You categorize a personal expense from its short note and suggest up to 3 tags. ` +
        `Valid categories: ${VALID_CATEGORIES.join(", ")}. ` +
        `Reply with ONLY a compact JSON object, no prose: {"category":"<one category>","tags":["tag1","tag2"]}. ` +
        `Tags must be short, lowercase, no '#', no spaces (use hyphens), and specific to the note ` +
        `(e.g. merchant, people, occasion). Pick the single closest category.`,
      messages: [{ role: "user", content: trimmed }],
    });
    const text = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("");
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    const parsed = JSON.parse(match[0]) as { category?: unknown; tags?: unknown };
    const category = VALID_CATEGORIES.includes(parsed.category as CategoryKey)
      ? (parsed.category as CategoryKey)
      : fallback.category;
    const tags = Array.isArray(parsed.tags)
      ? normalizeTags(parsed.tags.map((t) => String(t))).slice(0, 3)
      : [];
    return { category, tags };
  } catch {
    return fallback;
  }
}

// ─────────────────────────────────────────────────────────────
// ADDED (Voice AI module): real speech-to-text + Claude parsing. The client
// records audio (MediaRecorder — works on Chrome/Edge/Firefox + iOS Safari) and
// posts the blob here. We transcribe with OpenAI (Claude has no STT), then parse
// the transcript into a structured expense with Claude Haiku. Local heuristics
// are the fallback if either provider is unavailable, so the flow degrades
// gracefully. SECURITY: only the audio + its transcript are sent to the STT /
// parse providers — no amounts, dates, or other rows.
// ─────────────────────────────────────────────────────────────

// ADDED (AI Assistant · Phase A): the mic is now an intent router. Claude
// classifies the utterance into an action; the app routes each to the right
// confirm card. Phase A wires CREATE end-to-end (with historical dates); EDIT
// and RECURRING are classified so the UI can acknowledge them (wired in B/C).
export type VoiceIntent = "create" | "edit" | "recurring";

// ADDED (Phase B): an edit-by-voice result. `target` is the existing expense the
// user referred to (matched from a candidate list); `changes` is only the fields
// they asked to change → the UI shows a before→after diff before applying.
export interface VoiceEditTarget {
  id: number;
  spentAt: string; // ISO
  cat: CategoryKey;
  amt: number;
  currency: Currency;
  note: string;
  tags: string[];
}
export interface VoiceEditChanges {
  amount?: number;
  category?: CategoryKey;
  currency?: Currency;
  note?: string;
}

export interface VoiceParseResult {
  ok: boolean;
  transcript: string;
  lang: string;
  intent: VoiceIntent; // ADDED (Phase A): the classified action
  parsed:
    | {
        category: CategoryKey;
        amount: number;
        currency: Currency;
        note: string;
        tags: string[];
        // ADDED (Phase A): resolved expense date as an ISO string, or null = "now".
        // "yesterday" / "on July 2" / "two days ago" → a concrete past date.
        spentAt: string | null;
      }
    | null;
  // ADDED (Phase B): populated only for intent === "edit". null = no confident match.
  edit: { target: VoiceEditTarget; changes: VoiceEditChanges } | null;
  error?: "no-key" | "no-audio" | "stt-failed" | "empty" | "parse-failed";
}

/**
 * ADDED (Phase B): resolve an "edit" utterance against the user's recent expenses.
 * Sends a compact candidate list (id/date/cat/amount/note — the user's own data,
 * powering the feature they invoked; no account numbers or other sensitive fields)
 * + the transcript to claude-sonnet-5, which returns the matching id + the changed
 * fields. Returns null if nothing is available or no candidate clearly matches.
 */
async function resolveVoiceEdit(
  userId: string,
  transcript: string,
  now: Date,
  apiKey: string,
): Promise<{ target: VoiceEditTarget; changes: VoiceEditChanges } | null> {
  const rows = await prisma.expense.findMany({
    where: { userId },
    orderBy: { spentAt: "desc" },
    take: 60,
    select: {
      id: true,
      spentAt: true,
      category: true,
      amount: true,
      currency: true,
      note: true,
      tags: true,
    },
  });
  if (rows.length === 0) return null;

  const p = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const candidates = rows.map((r) => ({
    id: r.id,
    date: fmt(r.spentAt),
    cat: r.category,
    amt: Number(r.amount), // Prisma Decimal → number (also for clean JSON)
    cur: r.currency,
    note: r.note,
  }));
  const todayStr = fmt(now);
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });

  let matchId: number | null = null;
  const changes: VoiceEditChanges = {};
  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 220,
      thinking: { type: "disabled" },
      system:
        `You edit ONE existing expense. Today is ${weekday}, ${todayStr}. The user names an expense ` +
        `(by item / merchant / date / amount) and what to change about it. Match the SINGLE best ` +
        `candidate from the list, and extract ONLY the field(s) they asked to change. The speaker may ` +
        `mix English, Mandarin, Malay, and Singlish. Valid categories: ${VALID_CATEGORIES.join(", ")}. ` +
        `Reply with ONLY compact JSON, no prose: ` +
        `{"id": <candidate id or null>, "changes": {"amount"?:<number>,"category"?:"<one>","currency"?:"SGD|MYR|CNY|USD","note"?:"<string>"}}. ` +
        `id = the matching candidate's id, or null if none clearly matches. ` +
        `changes = only the fields the user asked to change (e.g. "change my fried chicken to 15" → {"amount":15}). ` +
        `Omit unchanged fields entirely; never invent a change.`,
      messages: [
        {
          role: "user",
          content: `Recent expenses (JSON):\n${JSON.stringify(candidates)}\n\nUser said: "${transcript}"`,
        },
      ],
    });
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as { id?: unknown; changes?: Record<string, unknown> };
    matchId = typeof parsed.id === "number" ? parsed.id : null;
    const c = parsed.changes ?? {};
    const amt = Number(c.amount);
    if (Number.isFinite(amt) && amt > 0) changes.amount = amt;
    if (VALID_CATEGORIES.includes(c.category as CategoryKey)) changes.category = c.category as CategoryKey;
    if ((["SGD", "MYR", "CNY", "USD"] as const).includes(c.currency as Currency)) changes.currency = c.currency as Currency;
    if (typeof c.note === "string" && c.note.trim()) changes.note = c.note.trim().slice(0, 120);
  } catch {
    return null;
  }

  if (matchId === null) return null;
  const row = rows.find((r) => r.id === matchId);
  if (!row) return null;

  return {
    target: {
      id: row.id,
      spentAt: row.spentAt.toISOString(),
      cat: row.category as CategoryKey,
      amt: Number(row.amount), // Prisma Decimal → number
      currency: row.currency,
      note: row.note,
      tags: row.tags ?? [],
    },
    changes,
  };
}

/** Offline heuristic parse of a transcript — the fallback when Claude is unavailable. */
function parseVoiceLocal(transcript: string): NonNullable<VoiceParseResult["parsed"]> & { lang: string } {
  const meta = suggestExpenseMetaLocal(transcript);
  const numMatch = transcript.replace(/,/g, "").match(/\d+(?:\.\d{1,2})?/);
  const amount = numMatch ? parseFloat(numMatch[0]) : 0;
  const l = transcript.toLowerCase();
  let currency: Currency = "SGD";
  if (/\b(rm|ringgit)\b/.test(l)) currency = "MYR";
  else if (/\b(us ?dollars?|usd)\b/.test(l)) currency = "USD";
  else if (/(yuan|rmb|人民币|元)/.test(l)) currency = "CNY";
  const hasCJK = /[一-鿿]/.test(transcript);
  const hasLatin = /[a-z]/i.test(transcript);
  const lang = hasCJK && hasLatin ? "zh+en" : hasCJK ? "zh" : "en";
  // Offline heuristics can't resolve relative dates → spentAt stays null (= now).
  return { category: meta.category, amount, currency, note: transcript.slice(0, 120), tags: meta.tags, lang, spentAt: null };
}

/**
 * ADDED (Phase A): turn a resolved YYYY-MM-DD into an ISO timestamp for createExpense.
 * Combines the past date with the current wall-clock time so the row lands mid-day
 * (avoids the midnight TZ edge). Future dates are rejected → null (= now), matching
 * the manual-add rule that expenses can't be in the future.
 */
function resolveSpentAt(dateStr: unknown, now: Date): string | null {
  if (typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds());
  if (Number.isNaN(dt.getTime()) || dt.getTime() > now.getTime()) return null;
  // Same calendar day as today → treat as "now" (null) so it uses the live timestamp.
  if (dt.toDateString() === now.toDateString()) return null;
  return dt.toISOString();
}

export async function transcribeExpense(formData: FormData): Promise<VoiceParseResult> {
  const userId = await requireUserId();
  const base: VoiceParseResult = { ok: false, transcript: "", lang: "en", intent: "create", parsed: null, edit: null };

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return { ...base, error: "no-key" };

  const audio = formData.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return { ...base, error: "no-audio" };

  // 1) Speech → text (OpenAI; raw fetch keeps us SDK-free per AGENTS.md).
  let transcript = "";
  try {
    const stt = new FormData();
    stt.append("file", audio, (audio as File).name || "voice.webm");
    // gpt-4o-transcribe (over -mini) for best accuracy on accents + mixed input.
    stt.append("model", "gpt-4o-transcribe");
    // CHANGED (Voice AI · multilingual): a prompt that primes code-switching.
    // Without it Whisper collapses a mixed sentence into one language (e.g.
    // "15 ringgit" → "15 林吉特"). This keeps English/Malay words in Latin script.
    stt.append(
      "prompt",
      "The speaker mixes English, Mandarin Chinese, and Malay (Singapore/Malaysia). " +
        "Transcribe faithfully, keeping English and Malay words in Latin script " +
        "(e.g. food court, mee goreng, nasi lemak, wanton mee, kopi, Grab, ringgit, girlfriend).",
    );
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: stt,
    });
    if (!r.ok) return { ...base, error: "stt-failed" };
    const j = (await r.json()) as { text?: string };
    transcript = (j.text ?? "").trim();
  } catch {
    return { ...base, error: "stt-failed" };
  }
  if (!transcript) return { ...base, error: "empty" };

  // 2) Transcript → intent + structured expense. The "assistant brain" runs on
  //    claude-sonnet-5 (harder reasoning than Haiku — needed for reliable intent
  //    classification + relative-date math). Local heuristics remain the fallback
  //    on any failure, so the flow always degrades gracefully to a CREATE.
  const local = parseVoiceLocal(transcript);
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return { ok: true, transcript, lang: local.lang, intent: "create", parsed: local, edit: null };
  }

  // Today's date, in server-local time, so Claude can resolve "yesterday",
  // "last Monday", "on July 2" to a concrete date. (Dev server = SGT; the same
  // TZ caveat as the manual date picker applies in a UTC prod host.)
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const todayStr = `${yyyy}-${mm}-${dd}`;
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });

  try {
    const client = new Anthropic({ apiKey: anthropicKey });
    const msg = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 320,
      // Simple extraction — no thinking needed; keep the voice round-trip fast.
      thinking: { type: "disabled" },
      system:
        `You are a personal-finance voice assistant. Today is ${weekday}, ${todayStr}. ` +
        `The speaker may freely mix English, Mandarin, Malay, Manglish, and Singlish in one sentence — ` +
        `understand the mixed input naturally. Context is Singapore/Malaysia; default currency SGD.\n\n` +
        `First CLASSIFY the utterance into one intent:\n` +
        `- "create": logging a new expense they just made (e.g. "spent 12 on lunch", "bought a bag for 50 dollars on July 2").\n` +
        `- "edit": changing or correcting an existing expense (e.g. "change my July-7 fried chicken to 15", "update yesterday's coffee to 6").\n` +
        `- "recurring": setting up a repeating/monthly expense (e.g. "rent 1300 dollars every month from May", "I pay 15 monthly for Netflix").\n\n` +
        `Then, for a "create" intent, extract the expense fields. ` +
        `Valid categories: ${VALID_CATEGORIES.join(", ")}.\n` +
        `Reply with ONLY compact JSON, no prose:\n` +
        `{"intent":"create|edit|recurring","category":"<one>","amount":<number>,"currency":"SGD|MYR|CNY|USD",` +
        `"note":"<short clean note or empty>","tags":["t1","t2"],"date":"<YYYY-MM-DD or empty>","lang":"<en|zh|zh+en|ms|Singlish>"}\n` +
        `- amount: the numeric price (convert spoken numbers e.g. "twenty eight" → 28).\n` +
        `- currency: default SGD; ringgit/RM → MYR; US dollars/USD → USD; yuan/rmb/人民币/元 → CNY.\n` +
        `- note: concise, no filler (e.g. "Grab to airport"); empty string if nothing meaningful.\n` +
        `- tags: up to 3, short, lowercase, no '#', no spaces (use hyphens), relevant (merchant/person/occasion).\n` +
        `- date: if the speaker says WHEN the expense happened, resolve it to an absolute YYYY-MM-DD using today's date above. ` +
        `If no date is mentioned, use "". NEVER return a future date — if it resolves after today, use "".\n` +
        `For "edit" or "recurring" intents, still return the JSON but the other fields may be approximate.`,
      messages: [{ role: "user", content: transcript }],
    });
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { ok: true, transcript, lang: local.lang, intent: "create", parsed: local, edit: null };
    const p = JSON.parse(match[0]) as {
      intent?: unknown; category?: unknown; amount?: unknown; currency?: unknown;
      note?: unknown; tags?: unknown; date?: unknown; lang?: unknown;
    };

    const intent: VoiceIntent = (["create", "edit", "recurring"] as const).includes(p.intent as VoiceIntent)
      ? (p.intent as VoiceIntent)
      : "create";
    const lang = typeof p.lang === "string" && p.lang.trim() ? p.lang.trim().slice(0, 12) : local.lang;

    // EDIT (Phase B): resolve the target expense + changes from a candidate list.
    // RECURRING (Phase C) is still just classified — no payload yet.
    if (intent !== "create") {
      const edit = intent === "edit" ? await resolveVoiceEdit(userId, transcript, now, anthropicKey) : null;
      return { ok: true, transcript, lang, intent, parsed: null, edit };
    }

    const category = VALID_CATEGORIES.includes(p.category as CategoryKey)
      ? (p.category as CategoryKey)
      : local.category;
    const amountNum = Number(p.amount);
    const amount = Number.isFinite(amountNum) && amountNum > 0 ? amountNum : local.amount;
    const currency = (["SGD", "MYR", "CNY", "USD"] as const).includes(p.currency as Currency)
      ? (p.currency as Currency)
      : "SGD";
    const note = typeof p.note === "string" ? p.note.trim().slice(0, 120) : local.note;
    const tags = Array.isArray(p.tags) ? normalizeTags(p.tags.map((t) => String(t))).slice(0, 3) : [];
    const spentAt = resolveSpentAt(p.date, now);
    return { ok: true, transcript, lang, intent: "create", parsed: { category, amount, currency, note, tags, spentAt }, edit: null };
  } catch {
    return { ok: true, transcript, lang: local.lang, intent: "create", parsed: local, edit: null };
  }
}

export interface BonusInput {
  year: number;
  month: number;
  amount: number;
  label: string;
}

export async function addBonus(input: BonusInput) {
  const userId = await requireUserId();
  await prisma.bonus.create({
    data: {
      userId,
      year: input.year,
      month: input.month,
      amount: input.amount,
      label: input.label,
    },
  });
  revalidateDashboard();
}

/** ADDED (Slice 2d): edit a bonus by id (ownership-checked) — the Income-page
 *  BonusesCard gained edit/delete affordances, and the assistant's update_bonus
 *  tool routes here. Only the passed fields change. */
export async function updateBonus(id: number, input: Partial<BonusInput>) {
  const userId = await requireUserId();
  const owned = await prisma.bonus.findFirst({ where: { id, userId } });
  if (!owned) throw new Error("Bonus not found");
  await prisma.bonus.update({
    where: { id },
    data: {
      ...(input.year !== undefined && { year: input.year }),
      ...(input.month !== undefined && { month: input.month }),
      ...(input.amount !== undefined && { amount: input.amount }),
      ...(input.label !== undefined && { label: input.label }),
    },
  });
  revalidateDashboard();
}

/** ADDED (Slice 2d): remove a bonus (ownership-checked). */
export async function deleteBonus(id: number) {
  const userId = await requireUserId();
  await prisma.bonus.deleteMany({ where: { id, userId } });
  revalidateDashboard();
}

export interface IncomeSettingsInput {
  monthlySalary?: number;
  savingsGoal?: number;
  saved?: number;
  monthlyBudget?: number;
  grossSalary?: number;
  deductions?: number;
  payDay?: number;
  payFrequency?: string;
}

export async function updateIncomeSettings(input: IncomeSettingsInput) {
  const userId = await requireUserId();
  await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.monthlySalary !== undefined && {
        monthlySalary: input.monthlySalary,
      }),
      ...(input.savingsGoal !== undefined && { savingsGoal: input.savingsGoal }),
      ...(input.saved !== undefined && { saved: input.saved }),
      ...(input.monthlyBudget !== undefined && {
        monthlyBudget: input.monthlyBudget,
      }),
      ...(input.grossSalary !== undefined && { grossSalary: input.grossSalary }),
      ...(input.deductions !== undefined && { deductions: input.deductions }),
      ...(input.payDay !== undefined && { payDay: input.payDay }),
      ...(input.payFrequency !== undefined && {
        payFrequency: input.payFrequency,
      }),
    },
  });
  revalidateDashboard();
}

/**
 * Read-only fetch of a given month's dashboard data — used by the client to
 * browse past months without a full navigation. Auth is enforced inside
 * getMonthDashboardData via getOrCreateUser.
 */
export async function fetchMonthData(year: number, month: number) {
  await requireUserId();
  return getMonthDashboardData(year, month);
}

// ─────────────────────────────────────────────────────────────
// ADDED (Module 5): monthly account closing (hard lock). Closing a month
// blocks add/edit/delete of expenses (manual or voice) dated in it, enforced
// by assertMonthOpen above. Scope is expenses only — income stays editable.
// ─────────────────────────────────────────────────────────────

/** All months this user has hard-closed (for client-side edit warnings). */
export async function fetchClosedMonths(): Promise<{ year: number; month: number }[]> {
  const userId = await requireUserId();
  const rows = await prisma.monthClose.findMany({
    where: { userId },
    select: { year: true, month: true },
  });
  return rows;
}

export async function closeMonth(year: number, month: number) {
  const userId = await requireUserId();
  await prisma.monthClose.upsert({
    where: { userId_year_month: { userId, year, month } },
    update: {},
    create: { userId, year, month },
  });
  revalidateDashboard();
}

export async function reopenMonth(year: number, month: number) {
  const userId = await requireUserId();
  await prisma.monthClose.deleteMany({ where: { userId, year, month } });
  revalidateDashboard();
}

// ─────────────────────────────────────────────────────────────
// ADDED (Phase 9): time-aware salary periods + the year rollup the Income page
// reads. A "period" = this salary, effective from this month onward.
// ─────────────────────────────────────────────────────────────

/** Read-only year rollup for the Income page (salary timeline + spend + goal). */
export async function fetchYearSummary(year: number) {
  await requireUserId();
  return getYearSummary(year);
}

export interface SalaryPeriodInput {
  effectiveYear: number;
  effectiveMonth: number; // 1–12
  monthlySalary: number;
  grossSalary?: number;
  deductions?: number;
  label?: string;
}

/** Add (or overwrite) the salary effective from a given month — one per month. */
export async function addSalaryPeriod(input: SalaryPeriodInput) {
  const userId = await requireUserId();
  const month = Math.min(12, Math.max(1, Math.round(input.effectiveMonth)));
  await prisma.salaryPeriod.upsert({
    where: {
      userId_effectiveYear_effectiveMonth: {
        userId,
        effectiveYear: input.effectiveYear,
        effectiveMonth: month,
      },
    },
    update: {
      monthlySalary: input.monthlySalary,
      grossSalary: input.grossSalary ?? 0,
      deductions: input.deductions ?? 0,
      label: input.label ?? null,
    },
    create: {
      userId,
      effectiveYear: input.effectiveYear,
      effectiveMonth: month,
      monthlySalary: input.monthlySalary,
      grossSalary: input.grossSalary ?? 0,
      deductions: input.deductions ?? 0,
      label: input.label ?? null,
    },
  });
  revalidateDashboard();
}

/** Edit an existing salary period by id (ownership-checked). */
export async function updateSalaryPeriod(
  id: number,
  input: Partial<SalaryPeriodInput>,
) {
  const userId = await requireUserId();
  const owned = await prisma.salaryPeriod.findFirst({ where: { id, userId } });
  if (!owned) throw new Error("Salary period not found");
  await prisma.salaryPeriod.update({
    where: { id },
    data: {
      ...(input.effectiveYear !== undefined && {
        effectiveYear: input.effectiveYear,
      }),
      ...(input.effectiveMonth !== undefined && {
        effectiveMonth: Math.min(12, Math.max(1, Math.round(input.effectiveMonth))),
      }),
      ...(input.monthlySalary !== undefined && {
        monthlySalary: input.monthlySalary,
      }),
      ...(input.grossSalary !== undefined && { grossSalary: input.grossSalary }),
      ...(input.deductions !== undefined && { deductions: input.deductions }),
      ...(input.label !== undefined && { label: input.label }),
    },
  });
  revalidateDashboard();
}

/** Remove a salary period (ownership-checked). */
export async function deleteSalaryPeriod(id: number) {
  const userId = await requireUserId();
  await prisma.salaryPeriod.deleteMany({ where: { id, userId } });
  revalidateDashboard();
}

// ─────────────────────────────────────────────────────────────
// ADDED (Phase 9): custom recurring income sources (freelance, dividends…).
// Each contributes monthlyAmount to every month on/after its effective date.
// ─────────────────────────────────────────────────────────────

export interface IncomeSourceInput {
  label: string;
  emoji?: string;
  monthlyAmount: number;
  effectiveYear: number;
  effectiveMonth: number; // 1–12
  /** Interval end for recurring streams; null = ongoing. */
  endYear?: number | null;
  endMonth?: number | null;
  recurring?: boolean;
  active?: boolean;
}

const clampMonth = (m: number) => Math.min(12, Math.max(1, Math.round(m)));

export async function addIncomeSource(input: IncomeSourceInput) {
  const userId = await requireUserId();
  await prisma.incomeSource.create({
    data: {
      userId,
      label: input.label.trim() || "Income",
      emoji: input.emoji || "💰",
      monthlyAmount: input.monthlyAmount,
      effectiveYear: input.effectiveYear,
      effectiveMonth: clampMonth(input.effectiveMonth),
      endYear: input.endYear ?? null,
      endMonth: input.endMonth != null ? clampMonth(input.endMonth) : null,
      recurring: input.recurring ?? true,
      active: input.active ?? true,
    },
  });
  revalidateDashboard();
}

/** Edit an income source by id (ownership-checked). */
export async function updateIncomeSource(
  id: number,
  input: Partial<IncomeSourceInput>,
) {
  const userId = await requireUserId();
  const owned = await prisma.incomeSource.findFirst({ where: { id, userId } });
  if (!owned) throw new Error("Income source not found");
  await prisma.incomeSource.update({
    where: { id },
    data: {
      ...(input.label !== undefined && { label: input.label.trim() || "Income" }),
      ...(input.emoji !== undefined && { emoji: input.emoji || "💰" }),
      ...(input.monthlyAmount !== undefined && {
        monthlyAmount: input.monthlyAmount,
      }),
      ...(input.effectiveYear !== undefined && {
        effectiveYear: input.effectiveYear,
      }),
      ...(input.effectiveMonth !== undefined && {
        effectiveMonth: clampMonth(input.effectiveMonth),
      }),
      // null clears the end (reopen → ongoing); a value sets/moves it.
      ...(input.endYear !== undefined && { endYear: input.endYear }),
      ...(input.endMonth !== undefined && {
        endMonth: input.endMonth != null ? clampMonth(input.endMonth) : null,
      }),
      ...(input.recurring !== undefined && { recurring: input.recurring }),
      ...(input.active !== undefined && { active: input.active }),
    },
  });
  revalidateDashboard();
}

/** Remove an income source (ownership-checked). */
export async function deleteIncomeSource(id: number) {
  const userId = await requireUserId();
  await prisma.incomeSource.deleteMany({ where: { id, userId } });
  revalidateDashboard();
}

// ─────────────────────────────────────────────────────────────
// ADDED (Module 4): fixed/recurring expenses.
// ─────────────────────────────────────────────────────────────

/** Read the user's fixed-expense definitions (client fetch after mutations). */
export async function fetchFixedExpenses() {
  await requireUserId();
  return getFixedExpenses();
}

/**
 * Suggest an emoji + best-fit category for a fixed-expense label via Claude Haiku,
 * falling back to the local keyword map when the key is unset, the label is empty,
 * or anything goes wrong. SECURITY: only the label text is ever sent to the model —
 * never amounts, dates, or any other PII.
 */
export async function suggestFixedMeta(
  label: string,
): Promise<{ emoji: string; category: CategoryKey }> {
  const fallback = suggestFixedMetaLocal(label);
  const trimmed = label.trim().slice(0, 60);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !trimmed) return fallback;

  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 80,
      system:
        `You tag a personal recurring-expense label with one emoji and one spending category. ` +
        `Valid categories: ${VALID_CATEGORIES.join(", ")}. ` +
        `Reply with ONLY a compact JSON object, no prose: {"emoji":"<one emoji>","category":"<one category>"}. ` +
        `Pick the single most fitting emoji and the closest category.`,
      messages: [{ role: "user", content: trimmed }],
    });
    const text = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("");
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    const parsed = JSON.parse(match[0]) as { emoji?: unknown; category?: unknown };
    const category = VALID_CATEGORIES.includes(parsed.category as CategoryKey)
      ? (parsed.category as CategoryKey)
      : fallback.category;
    const emoji =
      typeof parsed.emoji === "string" && parsed.emoji.trim()
        ? parsed.emoji.trim().slice(0, 8)
        : fallback.emoji;
    return { emoji, category };
  } catch {
    return fallback;
  }
}

export interface FixedExpenseInput {
  label: string;
  note?: string | null;
  emoji?: string;
  category?: CategoryKey;
  amount: number;
  currency?: Currency;
  dueDay?: number; // 1–31
  startYear: number;
  startMonth: number; // 1–12
  endYear?: number | null;
  endMonth?: number | null;
  active?: boolean;
}

const clampDay = (d: number) => Math.min(31, Math.max(1, Math.round(d)));

export async function addFixedExpense(input: FixedExpenseInput, overrideClosed = false) {
  const userId = await requireUserId();
  // Fill emoji/category from the local suggester when the client didn't set them.
  const fallback = suggestFixedMetaLocal(input.label);
  const created = await prisma.fixedExpense.create({
    data: {
      userId,
      label: input.label.trim() || "Fixed expense",
      note: input.note?.trim() || null,
      emoji: input.emoji || fallback.emoji,
      category: input.category ?? fallback.category,
      amount: input.amount,
      currency: input.currency ?? "SGD",
      dueDay: clampDay(input.dueDay ?? 1),
      startYear: input.startYear,
      startMonth: clampMonth(input.startMonth),
      endYear: input.endYear ?? null,
      endMonth: input.endMonth != null ? clampMonth(input.endMonth) : null,
      active: input.active ?? true,
    },
  });
  // Materialize its due entries right away (from start to today). CHANGED (Slice 2c
  // fix): when overrideClosed, also generate into hard-closed months in range (the
  // user opted in on the create card's closed-month guard); default keeps them frozen.
  await resyncFixedExpense(created.id, overrideClosed);
  revalidateDashboard();
}

export async function updateFixedExpense(
  id: number,
  input: Partial<FixedExpenseInput>,
  // CHANGED (Module 5.1 · override): when true, the redefine also rewrites any
  // closed months the rule spans (user opted in via the closed-month guard).
  overrideClosed = false,
) {
  const userId = await requireUserId();
  const owned = await prisma.fixedExpense.findFirst({ where: { id, userId } });
  if (!owned) throw new Error("Fixed expense not found");
  await prisma.fixedExpense.update({
    where: { id },
    data: {
      ...(input.label !== undefined && { label: input.label.trim() || "Fixed expense" }),
      ...(input.note !== undefined && { note: input.note?.trim() || null }),
      ...(input.emoji !== undefined && { emoji: input.emoji || "📌" }),
      ...(input.category !== undefined && { category: input.category }),
      ...(input.amount !== undefined && { amount: input.amount }),
      ...(input.currency !== undefined && { currency: input.currency }),
      ...(input.dueDay !== undefined && { dueDay: clampDay(input.dueDay) }),
      ...(input.startYear !== undefined && { startYear: input.startYear }),
      ...(input.startMonth !== undefined && { startMonth: clampMonth(input.startMonth) }),
      ...(input.endYear !== undefined && { endYear: input.endYear }),
      ...(input.endMonth !== undefined && {
        endMonth: input.endMonth != null ? clampMonth(input.endMonth) : null,
      }),
      ...(input.active !== undefined && { active: input.active }),
    },
  });

  // Editing = redefine: fully re-materialize the whole [start, today] range at the
  // new values, so a changed start month / amount / label is reflected across every
  // affected month (ledger, calendar, dashboard, income). To change the rate from a
  // point in time while KEEPING past months, use changeFixedAmount instead.
  await resyncFixedExpense(id, overrideClosed);

  revalidateDashboard();
}

/** Remove a fixed-expense definition AND its auto-generated Expense rows, so the
 *  recurring entries disappear from the ledger/calendar/dashboard when the rule is
 *  deleted (they were system-generated, not hand-entered).
 *  CHANGED (Module 5.1): rows in CLOSED months are kept — a closed month's books
 *  never change. Deleting the rule detaches them (fixedSourceId → null via the
 *  relation's onDelete: SetNull), so they live on as plain frozen entries. */
export async function deleteFixedExpense(id: number, overrideClosed = false) {
  const userId = await requireUserId();
  const owned = await prisma.fixedExpense.findFirst({ where: { id, userId } });
  if (!owned) return;

  // CHANGED (Module 5.1 · override): by default a closed month's generated row is
  // KEPT (detached) when the rule is deleted — a closed month's books never change.
  // When the user explicitly opts in (overrideClosed), delete those rows too.
  const closedKeys = overrideClosed
    ? new Set<string>()
    : await getClosedMonthKeys(userId);
  const rows = await prisma.expense.findMany({
    where: { userId, fixedSourceId: id },
    select: { id: true, spentAt: true },
  });
  const deletableIds = rows
    .filter((r) => !closedKeys.has(`${r.spentAt.getFullYear()}-${r.spentAt.getMonth() + 1}`))
    .map((r) => r.id);

  await prisma.$transaction([
    ...(deletableIds.length > 0
      ? [prisma.expense.deleteMany({ where: { id: { in: deletableIds } } })]
      : []),
    prisma.fixedExpense.delete({ where: { id } }),
  ]);
  revalidateDashboard();
}

/**
 * Guided "amount changed from month X" for a fixed expense (e.g. rent went up).
 * Caps the current definition at the month before the change and starts a fresh
 * one (same label/emoji/category/due-day) at the new amount from the change month
 * — so past months keep their old figure and there's no double-count. Any rows
 * already generated on/after the change month are removed so the new segment can
 * re-materialize them at the new amount.
 */
export async function changeFixedAmount(
  id: number,
  input: { fromYear: number; fromMonth: number; newAmount: number },
  // CHANGED (Module 5.1 · override): when true, closed months from the change
  // point forward are also rewritten to the new amount (user opted in).
  overrideClosed = false,
) {
  const userId = await requireUserId();
  const src = await prisma.fixedExpense.findFirst({ where: { id, userId } });
  if (!src) throw new Error("Fixed expense not found");

  const fromMonth = clampMonth(input.fromMonth);
  const fromYear = input.fromYear;
  const prevMonth = fromMonth === 1 ? 12 : fromMonth - 1;
  const prevYear = fromMonth === 1 ? fromYear - 1 : fromYear;

  // If the old definition had an end on/after the change, the new segment inherits it.
  const cmp = (aY: number, aM: number, bY: number, bM: number) => (aY !== bY ? aY - bY : aM - bM);
  const carryEnd =
    src.endYear != null && src.endMonth != null && cmp(src.endYear, src.endMonth, fromYear, fromMonth) >= 0;

  const fromStart = new Date(fromYear, fromMonth - 1, 1);

  // ADDED (Module 5): a closed month's row is frozen — never delete it even
  // though it falls on/after the change point (it just keeps its old amount;
  // the new segment's generation already skips closed months on its own).
  // (Module 5.1) …unless the user chose to override — then rewrite them too.
  const closedKeys = overrideClosed
    ? new Set<string>()
    : await getClosedMonthKeys(userId);
  const candidates = await prisma.expense.findMany({
    where: { userId, fixedSourceId: id, spentAt: { gte: fromStart } },
    select: { id: true, spentAt: true },
  });
  const deletableIds = candidates
    .filter((r) => !closedKeys.has(`${r.spentAt.getFullYear()}-${r.spentAt.getMonth() + 1}`))
    .map((r) => r.id);

  // Build the ops in order so we can pick the created segment's id back out.
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  if (deletableIds.length > 0) {
    // Remove any generated rows at/after the change month (old-amount rows,
    // excluding closed months unless overriding) — the new segment regenerates them.
    ops.push(prisma.expense.deleteMany({ where: { id: { in: deletableIds } } }));
  }
  // Cap the old definition at the month before the change.
  ops.push(
    prisma.fixedExpense.update({
      where: { id },
      data: { endYear: prevYear, endMonth: prevMonth },
    }),
  );
  const createIdx = ops.length;
  // New ongoing (or end-inheriting) segment at the new amount.
  ops.push(
    prisma.fixedExpense.create({
      data: {
        userId,
        label: src.label,
        note: src.note,
        emoji: src.emoji,
        category: src.category,
        amount: input.newAmount,
        currency: src.currency,
        dueDay: src.dueDay,
        startYear: fromYear,
        startMonth: fromMonth,
        endYear: carryEnd ? src.endYear : null,
        endMonth: carryEnd ? src.endMonth : null,
        active: true,
      },
    }),
  );

  const results = await prisma.$transaction(ops);
  // CHANGED (Module 5.1): materialize the new segment right away (was left to the
  // lazy dashboard-layout sync) so the new amount shows immediately after refresh()
  // — and, when overriding, so the closed months actually get regenerated.
  const newSeg = results[createIdx] as { id: number };
  await resyncFixedExpense(newSeg.id, overrideClosed);
  revalidateDashboard();
}

/**
 * Guided "amount changed from month X" — models a raise/cut without erasing
 * history or double-counting. Caps the existing recurring stream at the month
 * BEFORE the change, then creates a fresh ongoing stream (same label/emoji) at
 * the new amount from the change month. Both writes + one revalidate.
 */
export async function changeIncomeSourceAmount(
  id: number,
  input: { fromYear: number; fromMonth: number; newAmount: number },
) {
  const userId = await requireUserId();
  const src = await prisma.incomeSource.findFirst({ where: { id, userId } });
  if (!src) throw new Error("Income source not found");

  const fromMonth = clampMonth(input.fromMonth);
  const fromYear = input.fromYear;
  // The month just before the change (handles Jan → Dec of prior year).
  const prevMonth = fromMonth === 1 ? 12 : fromMonth - 1;
  const prevYear = fromMonth === 1 ? fromYear - 1 : fromYear;

  await prisma.$transaction([
    prisma.incomeSource.update({
      where: { id },
      data: { endYear: prevYear, endMonth: prevMonth },
    }),
    prisma.incomeSource.create({
      data: {
        userId,
        label: src.label,
        emoji: src.emoji,
        monthlyAmount: input.newAmount,
        effectiveYear: fromYear,
        effectiveMonth: fromMonth,
        endYear: null,
        endMonth: null,
        recurring: true,
        active: true,
      },
    }),
  ]);
  revalidateDashboard();
}
