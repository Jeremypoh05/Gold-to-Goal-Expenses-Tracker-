// ADDED (AI Assistant · Slice 1): the shared assistant engine — ONE tool-use agent
// (claude-sonnet-5 + the READ tool belt) that both the chat surfaces and, in
// Slice 3, the quick mic drive. Deliberately framework-free: takes an explicit
// userId + plain history and never touches auth()/"server-only", so it can be
// exercised headlessly (scripts/assistant-smoke.ts) as well as from server actions.
import Anthropic from "@anthropic-ai/sdk";
import { ASSISTANT_TOOLS, executeAssistantTool } from "./tools";

export interface AssistantHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantTurnResult {
  ok: boolean;
  reply: string;
  /** Tool names invoked this turn, in order — surfaced as subtle UI chips. */
  toolsUsed: string[];
  error?: "no-key" | "api-failed";
}

/** Streamed events from runAssistantTurnStreaming → the SSE route → the chat UI. */
export type AssistantStreamEvent =
  | { type: "tool"; name: string } // a read tool was invoked (UI shows a chip)
  | { type: "text"; text: string } // an incremental chunk of the final reply
  | { type: "error" }; // API/abort failure — caller keeps whatever streamed

// Enough for read → follow-up read → answer, while bounding a runaway loop.
const MAX_LOOP_TURNS = 8;
// History is context, not the archive — the DB keeps everything.
const MAX_HISTORY_MESSAGES = 20;

function buildSystemPrompt(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });

  return (
    `You are Honey's financial assistant — a supportive, non-judgmental personal-finance coach ` +
    `inside the Honey expense tracker. Today is ${weekday}, ${today}. Context is Singapore/Malaysia; ` +
    `the default currency is SGD.\n\n` +
    `LANGUAGE: the user may write in English, 中文, Malay, Manglish, or Singlish — often mixed. ` +
    `Reply in the same language (or mix) they used. For Chinese, always use 简体字 (Simplified), ` +
    `never Traditional, unless the user writes Traditional themselves.\n\n` +
    `DATA: you have read tools over the user's REAL data — full expense ledger, recurring rules, ` +
    `income, savings goal, budget, closed months, preferences. For ANY question about their money, ` +
    `call tools first and answer from tool results only. Never guess or invent numbers. If a result ` +
    `is empty, say so honestly. Always state amounts with their currency.\n\n` +
    `PERSONA & SUGGESTIONS:\n` +
    `- Warm, encouraging, never judgmental. Spending on joy is valid — always frame advice as ` +
    `"看个人 / it's your call": e.g. "游戏占比偏高，不过如果它带给你快乐这完全没问题 — 想更快达标的话，可以考虑…".\n` +
    `- Check get_preferences before advising; respect what the user says they value.\n` +
    `- Ground every insight in real numbers from tools (amounts, percentages, months).\n` +
    `- For projections, use project_savings and mention the assumption (average spend of recent months).\n\n` +
    `SCOPE (this version): you are READ-ONLY. You cannot add, edit, or delete anything yet. If asked ` +
    `to change data, kindly explain that editing from chat is coming soon — for now the mic button or ` +
    `the + button handles adding/editing, and recurring rules live on the Recurring page.\n\n` +
    `NAVIGATION LINKS: when your answer points at something the user can open in the app, add a link ` +
    `so they can jump straight there. Put links on their OWN line at the END of the reply, using ` +
    `EXACTLY this form (one per line): [[go:TARGET|label]]. Valid TARGET values ONLY:\n` +
    `- dashboard — the home overview\n` +
    `- ledger — the full expense list\n` +
    `- calendar — the month calendar of spending\n` +
    `- income — salary, other income, savings goal & bonuses\n` +
    `- recurring — the recurring/fixed monthly commitments (rent, subscriptions…)\n` +
    `Write the label in ONE language only — the SAME language as the rest of your reply. Replying in English ` +
    `→ an English label (e.g. [[go:income|Open income page]]); replying in Chinese → a Chinese label. Never ` +
    `combine two languages or add a translation inside one label, and never use a slash to separate languages. ` +
    `The label must accurately name the destination it links to. Add a link only when it genuinely helps the ` +
    `user act on the answer — skip it for a plain factual reply, and never invent a TARGET outside the list above.\n\n` +
    `STYLE: concise and conversational. Short paragraphs; use simple "-" bullet lists for breakdowns; ` +
    `use **bold** for key figures. No headers or tables. If the question is ambiguous (e.g. which ` +
    `"coffee" or which month), ask one short clarifying question instead of guessing.`
  );
}

/**
 * Run one assistant turn: user message + prior history → tool-use loop → reply.
 * The loop: Claude decides which read tools to call → we execute against Prisma
 * (scoped to userId) → results go back → repeat until Claude answers in text.
 */
export async function runAssistantTurn(
  userId: string,
  history: AssistantHistoryMessage[],
  userMessage: string,
  now: Date = new Date(),
): Promise<AssistantTurnResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      reply: "The assistant isn't configured yet (missing AI key). Please try again later.",
      toolsUsed: [],
      error: "no-key",
    };
  }

  const client = new Anthropic({ apiKey });
  const system = buildSystemPrompt(now);

  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-MAX_HISTORY_MESSAGES).map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: userMessage },
  ];

  const toolsUsed: string[] = [];

  try {
    for (let turn = 0; turn < MAX_LOOP_TURNS; turn++) {
      const response = await client.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 1600,
        // Interactive chat — keep round-trips snappy; the tools do the heavy math.
        thinking: { type: "disabled" },
        system,
        tools: ASSISTANT_TOOLS,
        messages,
      });

      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason === "tool_use") {
        const toolBlocks = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
        );
        // Execute all requested tools concurrently; return ALL results in ONE
        // user message (required for parallel tool use). A failed tool becomes
        // an is_error result so the model can recover instead of the turn dying.
        const results = await Promise.all(
          toolBlocks.map(async (block) => {
            toolsUsed.push(block.name);
            try {
              const result = await executeAssistantTool(
                userId,
                block.name,
                (block.input ?? {}) as Record<string, unknown>,
                now,
              );
              let json = JSON.stringify(result);
              if (json.length > 16000) {
                json = json.slice(0, 16000) + '… (truncated — narrow the query for full detail)"}';
              }
              return { type: "tool_result" as const, tool_use_id: block.id, content: json };
            } catch (e) {
              return {
                type: "tool_result" as const,
                tool_use_id: block.id,
                content: `Tool failed: ${e instanceof Error ? e.message : "unknown error"}`,
                is_error: true,
              };
            }
          }),
        );
        messages.push({ role: "user", content: results });
        continue;
      }

      // Final answer (end_turn / max_tokens) — collect the text blocks.
      const reply = response.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .trim();
      if (reply) return { ok: true, reply, toolsUsed };
      // No text (rare) — nudge the loop to produce a final answer.
      messages.push({
        role: "user",
        content: "(Please answer the question in text for the user now.)",
      });
    }

    return {
      ok: true,
      reply:
        "I dug through quite a lot there and ran out of room — could you ask that in a slightly narrower way?",
      toolsUsed,
    };
  } catch {
    return {
      ok: false,
      reply: "Something went wrong reaching the assistant. Please try again in a moment.",
      toolsUsed,
      error: "api-failed",
    };
  }
}

/**
 * Streaming variant of runAssistantTurn: same tool-use loop, but yields the
 * final reply as it's generated (token by token) plus a `tool` event whenever a
 * read tool runs. The SSE route (app/api/assistant) forwards these to the chat,
 * so the user sees the answer appear live and can stop early. `signal` (from the
 * request) aborts the upstream Anthropic call when the client disconnects/stops.
 */
export async function* runAssistantTurnStreaming(
  userId: string,
  history: AssistantHistoryMessage[],
  userMessage: string,
  opts: { now?: Date; signal?: AbortSignal } = {},
): AsyncGenerator<AssistantStreamEvent> {
  const now = opts.now ?? new Date();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    yield { type: "text", text: "The assistant isn't configured yet (missing AI key)." };
    return;
  }

  const client = new Anthropic({ apiKey });
  const system = buildSystemPrompt(now);
  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-MAX_HISTORY_MESSAGES).map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: userMessage },
  ];

  let producedText = false;

  try {
    for (let turn = 0; turn < MAX_LOOP_TURNS; turn++) {
      const stream = client.messages.stream(
        {
          model: "claude-sonnet-5",
          max_tokens: 1600,
          thinking: { type: "disabled" },
          system,
          tools: ASSISTANT_TOOLS,
          messages,
        },
        { signal: opts.signal },
      );

      // Emit text deltas live as the model writes them.
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          producedText = true;
          yield { type: "text", text: event.delta.text };
        }
      }

      const msg = await stream.finalMessage();
      messages.push({ role: "assistant", content: msg.content });

      if (msg.stop_reason === "tool_use") {
        const toolBlocks = msg.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
        );
        // Announce each tool (UI chip), then execute all concurrently.
        for (const b of toolBlocks) yield { type: "tool", name: b.name };
        const results = await Promise.all(
          toolBlocks.map(async (block) => {
            try {
              const result = await executeAssistantTool(
                userId,
                block.name,
                (block.input ?? {}) as Record<string, unknown>,
                now,
              );
              let json = JSON.stringify(result);
              if (json.length > 16000) {
                json = json.slice(0, 16000) + '… (truncated — narrow the query for full detail)"}';
              }
              return { type: "tool_result" as const, tool_use_id: block.id, content: json };
            } catch (e) {
              return {
                type: "tool_result" as const,
                tool_use_id: block.id,
                content: `Tool failed: ${e instanceof Error ? e.message : "unknown error"}`,
                is_error: true,
              };
            }
          }),
        );
        messages.push({ role: "user", content: results });
        continue;
      }

      // end_turn / max_tokens — final text already streamed above.
      if (!producedText) {
        yield {
          type: "text",
          text: "I looked but couldn't find anything to answer that — could you rephrase?",
        };
      }
      return;
    }

    yield {
      type: "text",
      text: "I dug through quite a lot there and ran out of room — could you ask that in a slightly narrower way?",
    };
  } catch {
    // API error, or the client stopped (signal aborted). Whatever streamed so
    // far is kept; just signal the end so the caller can finalize/persist.
    yield { type: "error" };
  }
}
