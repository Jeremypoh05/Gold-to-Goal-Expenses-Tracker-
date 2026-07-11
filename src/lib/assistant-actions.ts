"use server";

// ADDED (AI Assistant · Slice 1): server actions for the assistant chat. Auth +
// persistence live HERE; the engine itself (lib/assistant/engine.ts) is kept
// framework-free so it can also be driven headlessly. Every action re-checks
// auth() and scopes reads/writes to the signed-in user.
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { runAssistantTurn, type AssistantHistoryMessage } from "@/lib/assistant/engine";
import { createExpense, updateExpense, deleteExpense } from "@/lib/actions";
import {
  WRITABLE_CATEGORIES,
  type AssistantActionInput,
  type AssistantActionResult,
  type ExpenseFields,
  type Proposal,
} from "@/lib/assistant/types";
import type { Currency } from "@/types";

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
}): Promise<SendAssistantMessageResult> {
  const userId = await requireUserId();
  const message = input.message.trim().slice(0, 2000);
  if (!message) {
    return { ok: false, sessionId: input.sessionId ?? 0, reply: "", toolsUsed: [], proposals: [], error: "empty" };
  }

  // Resolve (and own-check) the session, creating one on first message.
  let sessionId = input.sessionId;
  let history: AssistantHistoryMessage[] = [];
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
    }
  }
  if (sessionId == null) {
    const created = await prisma.chatSession.create({
      data: { userId, title: message.slice(0, 60) },
    });
    sessionId = created.id;
  }
  const sid: number = sessionId;

  const result = await runAssistantTurn(userId, history, message);

  // Persist the turn (user msg first, then reply) and bump the session's
  // updatedAt so it sorts to the top of the history list.
  await prisma.$transaction([
    prisma.chatMessage.create({
      data: { sessionId: sid, role: "user", content: message },
    }),
    prisma.chatMessage.create({
      data: { sessionId: sid, role: "assistant", content: result.reply },
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

export async function executeAssistantAction(
  action: AssistantActionInput,
): Promise<AssistantActionResult> {
  await requireUserId();
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
          source: "manual",
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

    // delete_expense — deleteExpense refuses closed months on its own.
    await deleteExpense(action.expenseId);
    return { ok: true, summary: "Deleted" };
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
  }));
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
