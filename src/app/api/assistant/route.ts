// ADDED (AI Assistant · Slice 1 polish v3, user feedback): streaming endpoint so
// the reply appears line-by-line as it's generated (not after the full turn), and
// the user can stop early. Server Actions don't stream token-by-token, so the live
// chat uses this SSE route; the non-streaming sendAssistantMessage action stays as
// a fallback + the headless smoke path. Auth is enforced by Clerk middleware
// (proxy.ts protects /api/*) + the auth() check here; reads/writes are userId-scoped.
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import {
  runAssistantTurnStreaming,
  assistantHistoryContent,
  type AssistantHistoryMessage,
} from "@/lib/assistant/engine";
import type { Proposal } from "@/lib/assistant/types";
import type { Prisma } from "@/generated/prisma/client";

// Prisma needs the Node runtime (not edge); always dynamic (per-user, streamed).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  let body: { sessionId?: number | null; message?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const message = String(body.message ?? "").trim().slice(0, 2000);
  if (!message) return new Response("Empty message", { status: 400 });

  // Resolve (and own-check) the session, creating one on first message — same
  // logic as sendAssistantMessage so both paths behave identically.
  let sessionId = typeof body.sessionId === "number" ? body.sessionId : null;
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
        // Fold in past cards' outcomes so the model knows what was cancelled/confirmed.
        content: m.role === "assistant" ? assistantHistoryContent(m.content, m.data) : m.content,
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

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
          return true;
        } catch {
          // Client disconnected — stop trying to write.
          closed = true;
          return false;
        }
      };

      // Tell the client its (possibly new) session id up front.
      send({ type: "session", sessionId: sid });

      let full = "";
      const toolsUsed: string[] = [];
      const proposals: Proposal[] = [];
      try {
        for await (const ev of runAssistantTurnStreaming(userId, history, message, {
          signal: req.signal,
        })) {
          if (ev.type === "text") {
            full += ev.text;
            if (!send({ type: "text", text: ev.text })) break;
          } else if (ev.type === "tool") {
            toolsUsed.push(ev.name);
            send({ type: "tool", name: ev.name });
          } else if (ev.type === "proposal") {
            // A WRITE proposal — the chat renders a confirm card; nothing is saved
            // until the user taps Confirm (→ executeAssistantAction). Collected so we
            // persist it (outcome=pending) → the card + its status survive a reload.
            proposals.push(ev.proposal);
            send({ type: "proposal", proposal: ev.proposal });
          } else if (ev.type === "error") {
            send({ type: "error" });
          }
        }
      } catch {
        send({ type: "error" });
      }

      // Persist the turn (user msg always; assistant msg if any text OR a proposal
      // landed, so a card isn't lost on reload even if the reply text was empty).
      // Best-effort. `data` carries this turn's proposals with a pending outcome.
      try {
        const reply = full.trim();
        const assistantData: Prisma.InputJsonValue | undefined =
          proposals.length > 0
            ? ({ proposals: proposals.map((p) => ({ ...p, outcome: "pending" })) } as unknown as Prisma.InputJsonValue)
            : undefined;
        await prisma.$transaction([
          prisma.chatMessage.create({ data: { sessionId: sid, role: "user", content: message } }),
          ...(reply || proposals.length > 0
            ? [
                prisma.chatMessage.create({
                  data: {
                    sessionId: sid,
                    role: "assistant",
                    content: reply,
                    ...(assistantData !== undefined && { data: assistantData }),
                  },
                }),
              ]
            : []),
          prisma.chatSession.update({ where: { id: sid }, data: { updatedAt: new Date() } }),
        ]);
      } catch {
        /* persistence hiccup — the live reply already reached the user */
      }

      send({ type: "done", toolsUsed });
      if (!closed) controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
