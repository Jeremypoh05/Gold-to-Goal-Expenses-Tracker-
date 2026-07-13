"use server";

// ADDED (AI Assistant · Slice 1): server actions for the assistant chat. Auth +
// persistence live HERE; the engine itself (lib/assistant/engine.ts) is kept
// framework-free so it can also be driven headlessly. Every action re-checks
// auth() and scopes reads/writes to the signed-in user.
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import {
  runAssistantTurn,
  cardOutcomeContext,
  type AssistantHistoryMessage,
} from "@/lib/assistant/engine";
import {
  createExpense,
  updateExpense,
  deleteExpense,
  changeFixedAmount,
  updateFixedExpense,
  addFixedExpense,
  reopenMonth,
  closeMonth,
  updateIncomeSettings,
  addSalaryPeriod,
  addBonus,
  updateBonus,
  deleteBonus,
  addIncomeSource,
  updateIncomeSource,
  deleteIncomeSource,
  changeIncomeSourceAmount,
} from "@/lib/actions";
import { ALL_CATEGORIES } from "@/lib/assistant/tools";
import {
  WRITABLE_CATEGORIES,
  type AssistantActionInput,
  type AssistantActionResult,
  type ExpenseFields,
  type Proposal,
  type ChatMessageData,
  type ProposalOutcome,
  type RecurringCreateFields,
  type SavingsSettingsFields,
  type SalaryFields,
  type BonusFields,
  type IncomeSourceFields,
} from "@/lib/assistant/types";
import type { Currency } from "@/types";
import type { Prisma } from "@/generated/prisma/client";

async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

export interface AssistantChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string; // ISO
  /** Persisted WRITE proposals + their outcomes (Slice 2b-part-2) — lets the
   *  confirm cards + a permanent action status re-render after a reload. */
  data?: ChatMessageData | null;
}

export interface AssistantSessionSummary {
  id: number;
  title: string;
  pinned: boolean;
  updatedAt: string; // ISO
}

export interface SendAssistantMessageResult {
  ok: boolean;
  sessionId: number;
  reply: string;
  toolsUsed: string[];
  proposals: Proposal[];
  error?: string;
}

/**
 * One chat turn: persists the user message, runs the tool-use engine with the
 * session's recent history, persists the reply. sessionId null = start a new
 * session (titled from the first message).
 */
export async function sendAssistantMessage(input: {
  sessionId: number | null;
  message: string;
  /** 'quick' = the fast voice mic → brief, one-sentence reply (Slice 3). */
  mode?: "quick";
}): Promise<SendAssistantMessageResult> {
  const userId = await requireUserId();
  const message = input.message.trim().slice(0, 2000);
  if (!message) {
    return { ok: false, sessionId: input.sessionId ?? 0, reply: "", toolsUsed: [], proposals: [], error: "empty" };
  }

  // Resolve (and own-check) the session, creating one on first message.
  let sessionId = input.sessionId;
  let history: AssistantHistoryMessage[] = [];
  // Past cards' outcomes go in the SYSTEM prompt, not the message content (see route.ts).
  let cardContext = "";
  if (sessionId != null) {
    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
      include: { messages: { orderBy: { createdAt: "asc" }, take: 40 } },
    });
    if (!session) sessionId = null;
    else {
      history = session.messages.map((m) => ({
        role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: m.content,
      }));
      cardContext = cardOutcomeContext(session.messages);
    }
  }
  if (sessionId == null) {
    const created = await prisma.chatSession.create({
      data: { userId, title: message.slice(0, 60) },
    });
    sessionId = created.id;
  }
  const sid: number = sessionId;

  const result = await runAssistantTurn(userId, history, message, new Date(), cardContext, input.mode);

  // Persist the turn (user msg first, then reply) and bump the session's
  // updatedAt so it sorts to the top of the history list. `data` carries any
  // WRITE proposals (outcome=pending) so their cards survive a reload.
  const assistantData: Prisma.InputJsonValue | undefined =
    result.proposals.length > 0
      ? ({ proposals: result.proposals.map((p) => ({ ...p, outcome: "pending" })) } as unknown as Prisma.InputJsonValue)
      : undefined;
  await prisma.$transaction([
    prisma.chatMessage.create({
      data: { sessionId: sid, role: "user", content: message },
    }),
    prisma.chatMessage.create({
      data: {
        sessionId: sid,
        role: "assistant",
        content: result.reply,
        ...(assistantData !== undefined && { data: assistantData }),
      },
    }),
    prisma.chatSession.update({ where: { id: sid }, data: { updatedAt: new Date() } }),
  ]);

  return {
    ok: result.ok,
    sessionId: sid,
    reply: result.reply,
    toolsUsed: result.toolsUsed,
    proposals: result.proposals,
    ...(result.error && { error: result.error }),
  };
}

// ── WRITE execution (Slice 2) ────────────────────────────────
// The confirm cards call this on tap. The proposal built by the write tools is NOT
// trusted blindly — every path routes through createExpense/updateExpense/
// deleteExpense, which re-check auth() AND ownership by userId, so a tampered id or
// field can't touch another user's data. `fields` carries the FINAL values (either
// the AI's proposal or the user's manual edits in the VoiceEntryEditor).

const CURRENCY_SYMBOL: Record<string, string> = { SGD: "S$", MYR: "RM", CNY: "¥", USD: "$" };
const fmtMoney = (amount: number, currency: string) =>
  `${CURRENCY_SYMBOL[currency] ?? ""}${amount.toFixed(2)}`;

/** Validate + coerce client-supplied fields (defense-in-depth over the tool schema). */
function sanitizeFields(f: ExpenseFields): ExpenseFields | null {
  const amount = Number(f.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (!WRITABLE_CATEGORIES.includes(f.category)) return null;
  const currency: Currency = (["SGD", "MYR", "CNY", "USD"] as Currency[]).includes(f.currency)
    ? f.currency
    : "SGD";
  return {
    amount,
    currency,
    category: f.category,
    note: typeof f.note === "string" ? f.note.slice(0, 500) : "",
    tags: Array.isArray(f.tags) ? f.tags.slice(0, 20).map(String) : [],
    spentAt: typeof f.spentAt === "string" && f.spentAt ? f.spentAt : null,
  };
}

/** Defense-in-depth validation for a create_recurring proposal's fields — mirrors
 *  sanitizeFields's spirit (amount>0, category/currency in-range, sane clamps). */
function sanitizeRecurringCreate(f: RecurringCreateFields): RecurringCreateFields | null {
  const amount = Number(f.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (!ALL_CATEGORIES.includes(f.category)) return null;
  const currency: Currency = (["SGD", "MYR", "CNY", "USD"] as Currency[]).includes(f.currency)
    ? f.currency
    : "SGD";
  const label = f.label.trim().slice(0, 40) || "Fixed expense";
  return {
    label,
    note: typeof f.note === "string" ? f.note.slice(0, 120) : "",
    category: f.category,
    currency,
    amount,
    dueDay: Math.min(31, Math.max(1, Math.round(Number(f.dueDay) || 1))),
    startYear: f.startYear,
    startMonth: f.startMonth,
    endYear: f.endYear ?? null,
    endMonth: f.endMonth ?? null,
  };
}

/** Defense-in-depth for a set_savings_goal change — coerce each present field to a
 *  valid non-negative number (or clamped day / non-empty frequency); null if empty. */
function sanitizeSavings(c: SavingsSettingsFields): SavingsSettingsFields | null {
  const out: SavingsSettingsFields = {};
  if (c.savingsGoal !== undefined) {
    const n = Number(c.savingsGoal);
    if (!Number.isFinite(n) || n < 0) return null;
    out.savingsGoal = n;
  }
  if (c.saved !== undefined) {
    const n = Number(c.saved);
    if (!Number.isFinite(n) || n < 0) return null;
    out.saved = n;
  }
  if (c.monthlyBudget !== undefined) {
    const n = Number(c.monthlyBudget);
    if (!Number.isFinite(n) || n < 0) return null;
    out.monthlyBudget = n;
  }
  if (c.payDay !== undefined) {
    const n = Math.round(Number(c.payDay));
    if (!Number.isFinite(n) || n < 1 || n > 31) return null;
    out.payDay = n;
  }
  if (c.payFrequency !== undefined) {
    const s = String(c.payFrequency).trim().slice(0, 24);
    if (!s) return null;
    out.payFrequency = s;
  }
  return Object.keys(out).length ? out : null;
}

/** Defense-in-depth for an adjust_salary write. */
function sanitizeSalary(f: SalaryFields): SalaryFields | null {
  const amount = Number(f.monthlySalary);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const year = Math.round(Number(f.effectiveYear));
  const month = Math.round(Number(f.effectiveMonth));
  if (!Number.isFinite(year) || month < 1 || month > 12) return null;
  const gross = f.grossSalary == null ? null : Number(f.grossSalary);
  const deductions = f.deductions == null ? null : Number(f.deductions);
  if (gross != null && (!Number.isFinite(gross) || gross < 0)) return null;
  if (deductions != null && (!Number.isFinite(deductions) || deductions < 0)) return null;
  return {
    effectiveYear: year,
    effectiveMonth: month,
    monthlySalary: amount,
    grossSalary: gross,
    deductions,
    label: typeof f.label === "string" ? f.label.slice(0, 40) : "",
  };
}

/** Defense-in-depth for a bonus create/update write. */
function sanitizeBonus(f: BonusFields): BonusFields | null {
  const amount = Number(f.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const year = Math.round(Number(f.year));
  const month = Math.round(Number(f.month));
  if (!Number.isFinite(year) || month < 1 || month > 12) return null;
  return {
    year,
    month,
    amount,
    label: typeof f.label === "string" && f.label.trim() ? f.label.trim().slice(0, 40) : "Bonus",
  };
}

/** Defense-in-depth for a create_income_source write. */
function sanitizeIncomeSource(f: IncomeSourceFields): IncomeSourceFields | null {
  const amount = Number(f.monthlyAmount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const ey = Math.round(Number(f.effectiveYear));
  const em = Math.round(Number(f.effectiveMonth));
  if (!Number.isFinite(ey) || em < 1 || em > 12) return null;
  const recurring = f.recurring !== false;
  const endYear = recurring && f.endYear != null ? Math.round(Number(f.endYear)) : null;
  const endMonth = recurring && f.endMonth != null ? Math.min(12, Math.max(1, Math.round(Number(f.endMonth)))) : null;
  return {
    label: (typeof f.label === "string" ? f.label.trim() : "").slice(0, 40) || "Income",
    emoji: typeof f.emoji === "string" && f.emoji.trim() ? f.emoji.trim().slice(0, 8) : "💰",
    monthlyAmount: amount,
    effectiveYear: ey,
    effectiveMonth: em,
    endYear,
    endMonth,
    recurring,
    currency: f.currency,
  };
}

export async function executeAssistantAction(
  action: AssistantActionInput,
  // ADDED (Slice 3 — quick voice mic): when a create comes from the mic, tag the
  // expense source='voice' so it keeps the ledger "voice" badge + shows in the
  // recent-voice-log panel (the provenance the old single-shot mic set). Chat/typed
  // creates stay 'manual'. Only create_expense carries a source column.
  origin?: "voice" | "chat",
): Promise<AssistantActionResult> {
  const userId = await requireUserId();
  try {
    if (action.kind === "create_expense") {
      const f = sanitizeFields(action.fields);
      if (!f) return { ok: false, error: "Those values didn't look right — try editing manually." };
      await createExpense(
        {
          amount: f.amount,
          category: f.category,
          currency: f.currency,
          note: f.note,
          tags: f.tags,
          ...(f.spentAt && { spentAt: f.spentAt }),
          source: origin === "voice" ? "voice" : "manual",
        },
        action.overrideClosed ?? false,
      );
      return { ok: true, summary: `Added ${fmtMoney(f.amount, f.currency)} · ${f.category}` };
    }

    if (action.kind === "update_expense") {
      const f = sanitizeFields(action.fields);
      if (!f) return { ok: false, error: "Those values didn't look right — try editing manually." };
      await updateExpense(
        action.expenseId,
        {
          amount: f.amount,
          category: f.category,
          currency: f.currency,
          note: f.note,
          tags: f.tags,
          ...(f.spentAt && { spentAt: f.spentAt }),
        },
        action.overrideClosed ?? false,
      );
      return { ok: true, summary: `Updated to ${fmtMoney(f.amount, f.currency)} · ${f.category}` };
    }

    if (action.kind === "delete_expense") {
      // deleteExpense refuses closed months on its own.
      await deleteExpense(action.expenseId);
      return { ok: true, summary: "Deleted" };
    }

    // ── recurring-rule edit (Slice 2b) ─────────────────────────
    // Routes to the SAME machinery the Recurring page uses, so the change
    // propagates to every affected month + ledger/calendar/dashboard/income.
    // The client already ran the closed-month guard and passes overrideClosed.
    if (action.kind === "edit_recurring") {
      if (action.mode === "rate_change") {
        await changeFixedAmount(
          action.ruleId,
          { fromYear: action.fromYear, fromMonth: action.fromMonth, newAmount: action.newAmount },
          action.overrideClosed ?? false,
        );
        return { ok: true, summary: "Recurring commitment updated" };
      }
      // redefine — updateFixedExpense re-materializes the whole range at new values.
      const c = action.changes;
      await updateFixedExpense(
        action.ruleId,
        {
          ...(c.label !== undefined && { label: c.label }),
          ...(c.note !== undefined && { note: c.note }),
          ...(c.category !== undefined && { category: c.category }),
          ...(c.currency !== undefined && { currency: c.currency }),
          ...(c.amount !== undefined && { amount: c.amount }),
          ...(c.dueDay !== undefined && { dueDay: c.dueDay }),
        },
        action.overrideClosed ?? false,
      );
      return { ok: true, summary: "Recurring rule updated" };
    }

    // ── create a brand-new recurring rule (Slice 2c) ───────────
    if (action.kind === "create_recurring") {
      const f = sanitizeRecurringCreate(action.fields);
      if (!f) return { ok: false, error: "Those values didn't look right — try editing manually." };
      await addFixedExpense(
        {
          label: f.label,
          note: f.note || undefined,
          category: f.category,
          amount: f.amount,
          currency: f.currency,
          dueDay: f.dueDay,
          startYear: f.startYear,
          startMonth: f.startMonth,
          endYear: f.endYear,
          endMonth: f.endMonth,
        },
        action.overrideClosed ?? false,
      );
      return { ok: true, summary: `Recurring "${f.label}" set up · ${fmtMoney(f.amount, f.currency)}/mo` };
    }

    // ── reopen / close a month (Slice 2b fix batch) ────────────
    if (action.kind === "set_month_status") {
      if (action.action === "reopen") await reopenMonth(action.year, action.month);
      else await closeMonth(action.year, action.month);
      return { ok: true, summary: action.action === "reopen" ? "Month reopened" : "Month closed" };
    }

    // ── income management (Slice 2d) ───────────────────────────
    // Route to the SAME server actions the Income page uses (updateIncomeSettings /
    // addSalaryPeriod / addBonus / updateBonus / deleteBonus), each re-checking auth +
    // ownership, so the whole year rollup + dashboard move together.
    if (action.kind === "set_savings_goal") {
      const c = sanitizeSavings(action.changes);
      if (!c) return { ok: false, error: "Those values didn't look right — try editing manually." };
      await updateIncomeSettings(c);
      return { ok: true, summary: "Settings updated" };
    }

    if (action.kind === "adjust_salary") {
      const f = sanitizeSalary(action.fields);
      if (!f) return { ok: false, error: "Those values didn't look right — try editing manually." };
      await addSalaryPeriod({
        effectiveYear: f.effectiveYear,
        effectiveMonth: f.effectiveMonth,
        monthlySalary: f.monthlySalary,
        ...(f.grossSalary != null && { grossSalary: f.grossSalary }),
        ...(f.deductions != null && { deductions: f.deductions }),
        ...(f.label && { label: f.label }),
      });
      return { ok: true, summary: "Salary updated" };
    }

    if (action.kind === "create_bonus") {
      const f = sanitizeBonus(action.fields);
      if (!f) return { ok: false, error: "Those values didn't look right — try editing manually." };
      await addBonus({ year: f.year, month: f.month, amount: f.amount, label: f.label });
      return { ok: true, summary: "Bonus added" };
    }

    if (action.kind === "update_bonus") {
      const f = sanitizeBonus(action.fields);
      if (!f) return { ok: false, error: "Those values didn't look right — try editing manually." };
      await updateBonus(action.bonusId, { year: f.year, month: f.month, amount: f.amount, label: f.label });
      return { ok: true, summary: "Bonus updated" };
    }

    if (action.kind === "delete_bonus") {
      await deleteBonus(action.bonusId);
      return { ok: true, summary: "Bonus deleted" };
    }

    // ── remember a preference (Slice 2b) ───────────────────────
    // set_preference — upsert the lightweight key/value the agent reads back via
    // get_preferences to keep suggestions preference-aware.
    if (action.kind === "set_preference") {
      const key = action.key.trim().toLowerCase().slice(0, 40);
      const value = action.value.trim().slice(0, 300);
      if (!key || !value) return { ok: false, error: "Nothing to remember there." };
      await prisma.userPreference.upsert({
        where: { userId_key: { userId, key } },
        update: { value },
        create: { userId, key, value },
      });
      return { ok: true, summary: `Noted — I'll remember "${key}"` };
    }

    // ── income sources (Slice 2d) ──────────────────────────────
    // Route to the Income page's own machinery: addIncomeSource / changeIncomeSourceAmount
    // (rate change, keeps history) / updateIncomeSource (redefine) / deleteIncomeSource.
    if (action.kind === "create_income_source") {
      const f = sanitizeIncomeSource(action.fields);
      if (!f) return { ok: false, error: "Those values didn't look right — try editing manually." };
      await addIncomeSource({
        label: f.label,
        emoji: f.emoji,
        monthlyAmount: f.monthlyAmount,
        effectiveYear: f.effectiveYear,
        effectiveMonth: f.effectiveMonth,
        endYear: f.endYear,
        endMonth: f.endMonth,
        recurring: f.recurring,
      });
      return { ok: true, summary: `Income "${f.label}" added` };
    }

    if (action.kind === "edit_income_source") {
      if (action.mode === "delete") {
        await deleteIncomeSource(action.sourceId);
        return { ok: true, summary: "Income source deleted" };
      }
      if (action.mode === "rate_change") {
        await changeIncomeSourceAmount(action.sourceId, {
          fromYear: action.fromYear,
          fromMonth: action.fromMonth,
          newAmount: action.newAmount,
        });
        return { ok: true, summary: "Income amount updated" };
      }
      // redefine — pass only the fields present (endYear may be null = clear/reopen).
      const c = action.changes;
      await updateIncomeSource(action.sourceId, {
        ...(c.label !== undefined && { label: c.label }),
        ...(c.emoji !== undefined && { emoji: c.emoji }),
        ...(c.monthlyAmount !== undefined && { monthlyAmount: c.monthlyAmount }),
        ...(c.effectiveYear !== undefined && { effectiveYear: c.effectiveYear }),
        ...(c.effectiveMonth !== undefined && { effectiveMonth: c.effectiveMonth }),
        ...("endYear" in c && { endYear: c.endYear }),
        ...("endMonth" in c && { endMonth: c.endMonth }),
        ...(c.recurring !== undefined && { recurring: c.recurring }),
        // Clearing the end (reopen) should also un-pause the stream.
        ...(c.endYear === null && { active: true }),
      });
      return { ok: true, summary: "Income source updated" };
    }

    return { ok: false, error: "That action isn't supported yet." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong saving that." };
  }
}

/** Recent chat sessions — pinned first, then newest. Powers the history list. */
export async function fetchAssistantSessions(): Promise<AssistantSessionSummary[]> {
  const userId = await requireUserId();
  const rows = await prisma.chatSession.findMany({
    where: { userId },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: 50,
    select: { id: true, title: true, pinned: true, updatedAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title ?? "Chat",
    pinned: r.pinned,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/** ADDED (Slice 1 polish): rename a chat (ownership-checked). */
export async function renameAssistantSession(sessionId: number, title: string): Promise<void> {
  const userId = await requireUserId();
  const clean = title.trim().slice(0, 60);
  if (!clean) return;
  await prisma.chatSession.updateMany({ where: { id: sessionId, userId }, data: { title: clean } });
}

/** ADDED (Slice 1 polish): pin/unpin a chat so it sticks to the top of History. */
export async function setAssistantSessionPinned(sessionId: number, pinned: boolean): Promise<void> {
  const userId = await requireUserId();
  await prisma.chatSession.updateMany({ where: { id: sessionId, userId }, data: { pinned } });
}

/** Full message history of one session (ownership-checked). */
export async function fetchAssistantMessages(sessionId: number): Promise<AssistantChatMessage[]> {
  const userId = await requireUserId();
  const session = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!session) return [];
  return session.messages.map((m) => ({
    id: m.id,
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
    createdAt: m.createdAt.toISOString(),
    // Persisted proposals + outcomes (Slice 2b-part-2) so cards + status restore.
    data: (m.data as ChatMessageData | null) ?? null,
  }));
}

/**
 * Record what happened to a WRITE proposal after the user resolved its card —
 * confirmed & applied, or cancelled/dismissed. Persisted onto the owning chat
 * message's `data` so the outcome (a permanent "you did X here" status) survives
 * reloads and navigation. Matched by the proposal id (the tool_use block id, unique
 * within the session). Ownership-checked; best-effort (never throws to the caller).
 */
export async function recordProposalOutcome(
  sessionId: number,
  proposalId: string,
  outcome: ProposalOutcome,
  resultSummary?: string,
): Promise<void> {
  const userId = await requireUserId();
  const session = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId },
    select: { id: true },
  });
  if (!session) return;

  // Scan this session's assistant messages for the one holding this proposal.
  const messages = await prisma.chatMessage.findMany({
    where: { sessionId, role: "assistant" },
    select: { id: true, data: true },
    orderBy: { createdAt: "desc" },
  });
  for (const m of messages) {
    const d = m.data as ChatMessageData | null;
    const idx = d?.proposals?.findIndex((p) => p.id === proposalId);
    if (d?.proposals && idx != null && idx >= 0) {
      d.proposals[idx] = {
        ...d.proposals[idx],
        outcome,
        ...(resultSummary && { resultSummary }),
        resolvedAt: new Date().toISOString(),
      };
      await prisma.chatMessage.update({
        where: { id: m.id },
        data: { data: d as unknown as Prisma.InputJsonValue },
      });
      return;
    }
  }
}

/** Delete a chat session and its messages (ownership-checked). */
export async function deleteAssistantSession(sessionId: number): Promise<void> {
  const userId = await requireUserId();
  await prisma.chatSession.deleteMany({ where: { id: sessionId, userId } });
}

/**
 * STT-only transcription for the chat mic: audio → text goes into the input box
 * (the user reviews/edits before sending — unlike the quick mic's one-shot flow).
 * Same OpenAI endpoint + code-switch prompt as transcribeExpense.
 */
export async function transcribeChatAudio(
  formData: FormData,
): Promise<{ ok: boolean; text: string; error?: "no-key" | "no-audio" | "stt-failed" | "empty" }> {
  await requireUserId();

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return { ok: false, text: "", error: "no-key" };
  const audio = formData.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return { ok: false, text: "", error: "no-audio" };

  try {
    const stt = new FormData();
    stt.append("file", audio, (audio as File).name || "voice.webm");
    stt.append("model", "gpt-4o-transcribe");
    stt.append(
      "prompt",
      "The speaker mixes English, Mandarin Chinese, and Malay (Singapore/Malaysia). " +
        "Transcribe faithfully, keeping English and Malay words in Latin script.",
    );
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: stt,
    });
    if (!r.ok) return { ok: false, text: "", error: "stt-failed" };
    const j = (await r.json()) as { text?: string };
    const text = (j.text ?? "").trim();
    if (!text) return { ok: false, text: "", error: "empty" };
    return { ok: true, text };
  } catch {
    return { ok: false, text: "", error: "stt-failed" };
  }
}
