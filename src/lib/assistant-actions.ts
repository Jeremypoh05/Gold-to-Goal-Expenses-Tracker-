"use server";

// ADDED (AI Assistant · Slice 1): server actions for the assistant chat. Auth +
// persistence live HERE; the engine itself (lib/assistant/engine.ts) is kept
// framework-free so it can also be driven headlessly. Every action re-checks
// auth() and scopes reads/writes to the signed-in user.
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { runAssistantTurn, type AssistantHistoryMessage } from "@/lib/assistant/engine";

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
  updatedAt: string; // ISO
}

export interface SendAssistantMessageResult {
  ok: boolean;
  sessionId: number;
  reply: string;
  toolsUsed: string[];
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
    return { ok: false, sessionId: input.sessionId ?? 0, reply: "", toolsUsed: [], error: "empty" };
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
    ...(result.error && { error: result.error }),
  };
}

/** Recent chat sessions, newest first — powers the history list. */
export async function fetchAssistantSessions(): Promise<AssistantSessionSummary[]> {
  const userId = await requireUserId();
  const rows = await prisma.chatSession.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: { id: true, title: true, updatedAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title ?? "Chat",
    updatedAt: r.updatedAt.toISOString(),
  }));
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
