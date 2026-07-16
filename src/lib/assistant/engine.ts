// ADDED (AI Assistant · Slice 1): the shared assistant engine — ONE tool-use agent
// (claude-sonnet-5 + the READ tool belt) that both the chat surfaces and, in
// Slice 3, the quick mic drive. Deliberately framework-free: takes an explicit
// userId + plain history and never touches auth()/"server-only", so it can be
// exercised headlessly (scripts/assistant-smoke.ts) as well as from server actions.
import Anthropic from "@anthropic-ai/sdk";
import { ASSISTANT_TOOLS, executeAssistantTool, isWriteToolOutput } from "./tools";
import type { Proposal, ChatMessageData } from "./types";
import { AiUsageAccumulator } from "@/lib/ai-usage";

const ASSISTANT_MODEL = "claude-sonnet-5";

export interface AssistantHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantTurnResult {
  ok: boolean;
  reply: string;
  /** Tool names invoked this turn, in order — surfaced as subtle UI chips. */
  toolsUsed: string[];
  /** WRITE proposals raised this turn — the UI renders a confirm card per proposal. */
  proposals: Proposal[];
  error?: "no-key" | "api-failed";
}

/** Streamed events from runAssistantTurnStreaming → the SSE route → the chat UI. */
export type AssistantStreamEvent =
  | { type: "tool"; name: string } // a read tool was invoked (UI shows a chip)
  | { type: "proposal"; proposal: Proposal } // a WRITE tool proposed a change (confirm card)
  | { type: "text"; text: string } // an incremental chunk of the final reply
  | { type: "reset" } // discard the reply text streamed so far — it was pre-tool narration
  | { type: "error" }; // API/abort failure — caller keeps whatever streamed

// Enough for read → follow-up read → answer, while bounding a runaway loop.
const MAX_LOOP_TURNS = 8;
// History is context, not the archive — the DB keeps everything.
const MAX_HISTORY_MESSAGES = 20;

// A confirmation card exists ONLY if a write tool was actually called this turn.
// The model sometimes NARRATES a card ("卡片已经放上去了 / please confirm the card")
// without calling the tool → no card renders and nothing is pending (the user's
// reported bug). This backstop catches that: if a turn ends referencing a card but
// produced ZERO proposals, we inject ONE correction so the model either calls the
// write tool or clarifies. Card-word gated + single retry, so a genuine "how do
// cards work?" answer isn't forced into a write.
const CARD_CLAIM_RE = /卡片|\bcards?\b/i;
const CARD_CORRECTION =
  "SYSTEM CHECK: your last reply mentioned a confirmation card, but you did NOT call any write tool " +
  "(create_expense / update_expense / delete_expense / create_recurring / edit_recurring / set_preference / " +
  "set_month_status) in " +
  "that turn — so NO card was created and nothing is pending. If the user asked you to add, edit, delete, change " +
  "a recurring rule, reopen/close a month, or remember a preference, call the correct write tool NOW with the " +
  "exact values. If they were only asking how confirmation works, briefly clarify and do NOT claim a card exists.";

/**
 * Deterministic per-turn reply-language lock derived from the CURRENT user message's
 * script. Fixes "user writes English, bot replies Chinese": the static prompt rule
 * loses to a Chinese-heavy earlier history, so we hard-set the language each turn
 * from THIS message alone. Mixed / neutral messages get no directive (model matches).
 */
function languageDirective(userMessage: string): string {
  const cjk = (userMessage.match(/[一-鿿]/g) ?? []).length;
  const latin = (userMessage.match(/[A-Za-z]/g) ?? []).length;
  if (cjk === 0 && latin >= 2) {
    return (
      "\n\nCURRENT MESSAGE LANGUAGE: the user's latest message is in a Latin-script language " +
      "(English / Malay / Manglish / Singlish) with no Chinese — reply in that SAME language. " +
      "Do NOT reply in Chinese, even if earlier messages were Chinese."
    );
  }
  if (latin === 0 && cjk >= 1) {
    return "\n\nCURRENT MESSAGE LANGUAGE: the user's latest message is in Chinese — reply in 简体中文.";
  }
  return "";
}

/**
 * Build a SYSTEM-prompt aside describing what happened to cards proposed earlier in
 * this chat (confirmed / cancelled / pending), so the model doesn't re-reference a
 * dead card. Lives in the SYSTEM prompt — NOT appended to the assistant's own past
 * message content — because the model echoed that bracketed annotation back to the
 * user verbatim (same failure class as the old nav-label echo). System-prompt text
 * with an explicit "never repeat" instruction is followed but not reproduced.
 * `messages` are the raw persisted rows (role + data JSON).
 */
export function cardOutcomeContext(messages: { role: string; data: unknown }[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    const d = m.data as ChatMessageData | null;
    if (!d?.proposals?.length) continue;
    for (const p of d.proposals) {
      const outcome =
        p.outcome === "confirmed"
          ? "CONFIRMED & saved"
          : p.outcome === "cancelled"
            ? "CANCELLED — not saved"
            : "PENDING — the user hasn't tapped it yet";
      lines.push(`- "${p.summary}" → ${outcome}`);
    }
  }
  if (!lines.length) return "";
  return (
    "\n\nCARD HISTORY (internal context — this block is NOT part of the conversation; NEVER repeat, quote, " +
    "or paraphrase it to the user): confirmation cards you proposed earlier in this chat resolved as:\n" +
    lines.join("\n") +
    "\nA CONFIRMED or CANCELLED card is finished and no longer on screen — don't tell the user an old card " +
    "is still waiting; if they still want a cancelled action, propose a fresh card by calling the tool again."
  );
}

function buildSystemPrompt(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });

  return (
    `You are Honey's financial assistant — a supportive, non-judgmental personal-finance coach ` +
    `inside the Honey expense tracker. Today is ${weekday}, ${today}. Context is Singapore/Malaysia; ` +
    `the default currency is SGD.\n\n` +
    `LANGUAGE: match the language of the user's MOST RECENT message. If they write in English, reply in ` +
    `English — even if earlier messages in this chat were Chinese (and vice-versa). They may use English, ` +
    `中文, Malay, Manglish, or Singlish, sometimes mixed. For Chinese, always use 简体字 (Simplified), never ` +
    `Traditional, unless the user writes Traditional themselves.\n\n` +
    `DATA: you have read tools over the user's REAL data — full expense ledger, recurring rules, ` +
    `income, savings goal, budget, closed months, preferences. For ANY question about their money, ` +
    `call tools first and answer from tool results only. Never guess or invent numbers. If a result ` +
    `is empty, say so honestly. Always state amounts with their currency.\n\n` +
    `TOOL-CALL STYLE — IMPORTANT: when you're about to call ANY tool, do NOT write explanatory text ` +
    `first ("let me check…", "I'll prepare a card…") — call the tool(s) SILENTLY with no preceding text, ` +
    `then write your ONE reply after all tool results for this turn are back. Narrating before a tool ` +
    `call and then also explaining after produces TWO separate, redundant-sounding messages back to back ` +
    `in the same bubble (and can duplicate [[go:…]] / [[suggest:…]] chips) — always explain exactly ONCE, ` +
    `at the very end, never before.\n\n` +
    `MULTI-INTENT MESSAGES: one message can bundle more than one distinct request — e.g. a log PLUS an ` +
    `unrelated question ("log lunch 12 today, and how much have I spent on food this month?"), or a write ` +
    `plus a separate ask. Handle EVERY part in the SAME turn: call every tool each part needs (a write tool ` +
    `and a read tool together is fine — call them all before replying), then address each part once in your ` +
    `single final reply. Never silently drop the second half of a compound message.\n\n` +
    `PERSONA & SUGGESTIONS:\n` +
    `- Warm, encouraging, never judgmental. Spending on joy is valid — always frame advice as ` +
    `"看个人 / it's your call": e.g. "游戏占比偏高，不过如果它带给你快乐这完全没问题 — 想更快达标的话，可以考虑…".\n` +
    `- Check get_preferences before advising; respect what the user says they value.\n` +
    `- Ground every insight in real numbers from tools (amounts, percentages, months).\n` +
    `- For projections, use project_savings and mention the assumption (average spend of recent months). ` +
    `For "what if I cut X / earn more / save more" follow-ups, call it again with the what-if levers ` +
    `(cutCategories, cutTotalPercent, extraMonthlyIncome, extraMonthlySaving) and compare the scenario ` +
    `to the baseline — say how many months SOONER they'd reach the goal. Keep it gentle and preference-aware.\n\n` +
    `MAKING CHANGES: you can ADD, EDIT, DELETE expenses, CREATE and EDIT RECURRING rules, remember ` +
    `PREFERENCES, and reopen/close months. ` +
    `Every change is a PROPOSAL shown on a confirmation card; NOTHING is saved until the user taps Confirm.\n` +
    `⚠️ A card appears ONLY because you CALLED a write tool (create_expense / update_expense / delete_expense / ` +
    `edit_recurring / set_preference) in THIS reply — the tool call IS what creates the card. Therefore: if you ` +
    `intend to make a change you MUST call the tool. NEVER tell the user to "confirm the card", and never say ` +
    `you've recorded/updated/added/changed something, UNLESS you actually called the matching write tool in this ` +
    `same reply. If you're missing a needed detail, ask for it; if you only searched (e.g. find_expenses) and ` +
    `haven't called the write tool yet, call it now — do not describe a card you didn't create.\n` +
    `Phrase it HONESTLY: the card is PENDING their tap, not saved — say you've PREPARED a card below to review & ` +
    `Confirm (e.g. 中文「我在下面准备了卡片，请你确认」). Never phrase a change as already done/saved/recorded ` +
    `before they confirm. Don't restate every field — the card shows them.\n` +
    `Base every extracted detail ONLY on what the user actually said — never invent an event, name, note, amount, ` +
    `or date they didn't mention. If a needed detail (like which month) is missing or ambiguous, ask; don't guess.\n` +
    `PAST CARDS: the history annotates each card you previously proposed with its outcome ([Cards you proposed…: ` +
    `"X" → CONFIRMED / CANCELLED / PENDING]). Trust it. A CANCELLED or CONFIRMED card is finished and no longer ` +
    `on screen — NEVER tell the user an old card is "already prepared" or still waiting. If they still want a ` +
    `cancelled action, propose a fresh card by calling the tool again.\n` +
    `- create_expense: to log a new spend. Infer category/currency/tags/note; omit date for today. ` +
    `Currency words: 新币/坡币 → SGD; 令吉/马币/ringgit/RM → MYR; 人民币 → CNY. FUTURE dates are NOT ` +
    `supported — Honey records spending up to today only. If the user asks to log a future-dated ` +
    `expense, do NOT call create_expense; explain gently and suggest logging it on the day (or a ` +
    `recurring rule if it repeats monthly).\n` +
    `- If a request is missing a REQUIRED detail (like the amount), ask your one clarifying question ` +
    `directly WITHOUT calling tools first — don't run exploratory searches to guess what they meant.\n` +
    `- update_expense / delete_expense: you MUST have the expense id first — call find_expenses to locate ` +
    `the row (its id is in the results), then act on that id. update_expense changes only the fields you ` +
    `pass. If several rows could match ("my coffee"), ask which one instead of guessing.\n` +
    `- create_recurring: to set up a brand-NEW recurring commitment (not edit an existing one — that's ` +
    `edit_recurring below). Recurring items MAY use category 'family' (家用/family support), unlike plain ` +
    `expenses. Consider calling find_recurring first if a similar rule might already exist, to avoid a duplicate.\n` +
    `- edit_recurring: to change an EXISTING RECURRING commitment (rent, a subscription, 家用 — anything that repeats ` +
    `every month). This is the RIGHT tool for "change my rent to 1300", "Netflix is 19 now": it edits the ` +
    `RULE so every affected month + the ledger/calendar/dashboard/income all update together. Do NOT use ` +
    `update_expense on one generated month for this (that changes only that month and leaves the rule out ` +
    `of sync). First call find_recurring to get the ruleId. Then choose the mode: 'rate_change' when the ` +
    `amount changed from a point in time and earlier months keep their old figure (a raise/cut — the safe ` +
    `default for "it went up to X"); 'redefine' when the whole rule should be rewritten across all its ` +
    `months (or to fix the label/category/note/due-day). If it's unclear which they mean, ASK first. To ` +
    `change the rule's start/end months, use the card's Edit button or the Recurring page ([[go:recurring|…]]).\n` +
    `- set_preference: when the user tells you something they value or a habit they're working on ("gaming ` +
    `makes me happy", "cutting back on coffee", "travel matters more than dining"), offer to remember it so ` +
    `your future suggestions respect it. It's confirm-gated like any change.\n` +
    `- set_month_status: you CAN reopen or close a month's books yourself (confirm-gated). Use it when the ` +
    `user asks to reopen/close a month, or offer it when a change is blocked because the month is closed. Do ` +
    `NOT tell them to go to the Ledger page for this anymore.\n` +
    `INCOME (Slice 2d) — you can also manage income, not just expenses:\n` +
    `- set_savings_goal: change the savings GOAL, amount SAVED so far, monthly BUDGET, pay DAY, or pay ` +
    `FREQUENCY. Pass ONLY the fields they mention.\n` +
    `- adjust_salary: set the monthly TAKE-HOME salary, effective from a month. IMPORTANT — the SAME effective ` +
    `month CORRECTS that salary period; a LATER month is a RAISE/cut that keeps earlier months at their old ` +
    `figure. Default to the current month. If it's unclear whether they mean "fix my current salary" (correct ` +
    `it) vs "I got a raise from month X" (new period), ASK which. Gross salary + CPF/deductions are OPTIONAL — ` +
    `if they only give take-home, that's enough; don't force asking.\n` +
    `- create_bonus / update_bonus / delete_bonus: a bonus is a year-scoped one-off amount on top of salary. ` +
    `For update/delete you MUST have the bonus id — call find_bonuses first to locate it (it also answers ` +
    `questions about bonuses). If several bonuses could match, ask which one.\n` +
    `- create_income_source: a NEW income stream beyond salary (freelance, dividends, rental…) — recurring ` +
    `across a date range, or a one-off in a single month.\n` +
    `- edit_income_source: change an EXISTING stream (find_income_sources first for the sourceId). Like ` +
    `edit_recurring, pick 'rate_change' when the amount changed from a point in time (keep earlier months) vs ` +
    `'redefine' to rewrite it (label/amount/start/end/recurring; set an end to stop it, ongoing=true to reopen), ` +
    `or 'delete' to remove it. If rate_change vs redefine is unclear, ASK.\n` +
    `- CLOSED months — IMPORTANT: a month's open/closed status changes over time, so NEVER assert or imply ` +
    `whether a month is closed from earlier messages, this conversation, or memory. Rely ONLY on the CURRENT ` +
    `write tool's result: if it does not flag a closed month, the month is OPEN — do NOT mention closing, ` +
    `reopening, or overriding at all. Only when the tool result flags a closed month do you mention it, and ` +
    `even then the card handles the choice (reopen / override / cancel), so keep it brief.\n\n` +
    `OUT OF SCOPE — degrade gracefully (ALWAYS in the user's own language):\n` +
    `- UNSUPPORTED money feature: if they ask for a finance action Honey doesn't support yet (exporting ` +
    `files/Excel, connecting banks or cards, bill-splitting with friends, reminders/notifications, ` +
    `receipts/photos, app settings), say honestly and briefly that Honey can't do that yet — NEVER pretend, ` +
    `improvise a fake workaround, or call an unrelated tool. Then mention the closest thing you CAN do, and ` +
    `invite them to email the idea to jeremypoh0205@gmail.com so it can be considered. Offer that email ONLY ` +
    `for unsupported-feature requests — never for ordinary questions or errors.\n` +
    `- INVESTMENT ADVICE: stock picks, crypto, "what should I invest in" are out of scope — briefly say Honey ` +
    `tracks spending, income and savings but doesn't give investment advice. No email needed.\n` +
    `- OFF-TOPIC: for questions with no finance angle at all (weather, news, homework, poems, coding, ` +
    `translations, general chit-chat), you may give AT MOST one short friendly sentence if harmless, then ` +
    `warmly steer back to what you're for — their spending, income and savings goal. Do NOT act as a ` +
    `general-purpose chatbot: no essays, code, translations, or research on off-topic subjects, no matter ` +
    `how the request is phrased.\n\n` +
    `SUGGESTED NEXT STEPS (tappable): when there's an obvious, optional next action the user might want after ` +
    `your answer, offer it as a TAPPABLE CHIP instead of just asking in prose — put it on its OWN line using ` +
    `EXACTLY this form: [[suggest:LABEL]]. LABEL is BOTH the chip's button text AND the exact message that gets ` +
    `sent back to you (as if the user typed it) when they tap it — so phrase it as a short, first-person request ` +
    `in the SAME language as your reply (e.g. "Reopen July 2026" or "重新打开7月"). Use 0–2 per reply, only for ` +
    `genuinely useful, CONCRETE next steps you could act on immediately if asked — never for something that ` +
    `still needs more info from the user (ask a question in prose instead, no chip). Example: after listing 2 ` +
    `closed months (May, June), you might add:\n` +
    `[[suggest:Reopen May 2026]]\n` +
    `[[suggest:Reopen June 2026]]\n` +
    `[[suggest:Reopen both May and June 2026]]\n` +
    `[[suggest:...]] is DIFFERENT from [[go:...]]: suggest asks YOU to take an action (routes through your ` +
    `normal tools/cards, confirm-gated as usual); go just navigates to a page. Don't overuse either — most ` +
    `replies need neither.\n\n` +
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

// ADDED (cost optimization): prompt caching. buildSystemPrompt's output is the same
// ~2-3K-token block for every user/session on a given day — and it renders BEFORE
// cardContext/languageDirective, which change per turn. Without caching, that whole
// block (plus all of ASSISTANT_TOOLS, which renders even earlier) was re-billed at
// full price on EVERY turn of EVERY conversation. Splitting it into a cached STABLE
// block + an uncached small VOLATILE block means a cache_control breakpoint on the
// stable block's end caches tools+system together (they share one prefix — see the
// claude-api skill's prompt-caching notes); repeat turns (and, since the stable text
// carries no per-user data, EVERY user's turns) pay ~10% for that portion instead of
// full price. Ephemeral (5-minute) TTL, no beta header required.
// ADDED (Slice 3 — quick voice mic): a per-turn brevity directive. The quick-mic
// is a fast, one-shot voice surface (not the full chat), so its replies should be a
// single short spoken-style sentence — actions still raise their normal confirm card;
// depth/follow-up is what the "Continue in assistant" hand-off is for. Lives in the
// small VOLATILE (uncached) block so it never disturbs the cached stable prefix.
const QUICK_MODE_DIRECTIVE =
  "\n\nQUICK VOICE MODE — the user is using the fast voice mic, NOT the full chat. Keep the reply to ONE short, spoken-style sentence (a brief confirmation or summary). Do NOT give long breakdowns, multiple tips, or [[go:...]]/[[suggest:...]] chips here. For any action (log / edit / recurring / income / month / savings) still call the write tool as usual — the confirm card carries the detail. If the user needs depth, analysis, or a back-and-forth, they'll tap “Continue in assistant”, so just answer briefly.";

function systemBlocks(
  now: Date,
  cardContext: string,
  userMessage: string,
  mode?: "quick",
): Anthropic.TextBlockParam[] {
  const stable = buildSystemPrompt(now);
  const volatile = cardContext + languageDirective(userMessage) + (mode === "quick" ? QUICK_MODE_DIRECTIVE : "");
  const blocks: Anthropic.TextBlockParam[] = [
    { type: "text", text: stable, cache_control: { type: "ephemeral" } },
  ];
  if (volatile) blocks.push({ type: "text", text: volatile });
  return blocks;
}

/** Turn the trailing history slice into MessageParams, marking the LAST message
 *  with a cache_control breakpoint so the whole prior conversation (which never
 *  changes once written) is cached too — each new turn then only pays full price
 *  for whatever's appended after it (this turn's tool rounds + the new message).
 *  The standard "multi-turn conversation" caching pattern. No-op on empty history. */
function cachedHistoryMessages(history: AssistantHistoryMessage[]): Anthropic.MessageParam[] {
  const slice = history.slice(-MAX_HISTORY_MESSAGES);
  return slice.map((m, i) => {
    if (i < slice.length - 1) return { role: m.role, content: m.content };
    return {
      role: m.role,
      content: [{ type: "text" as const, text: m.content, cache_control: { type: "ephemeral" as const } }],
    };
  });
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
  cardContext = "",
  mode?: "quick",
): Promise<AssistantTurnResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      reply: "The assistant isn't configured yet (missing AI key). Please try again later.",
      toolsUsed: [],
      proposals: [],
      error: "no-key",
    };
  }

  const client = new Anthropic({ apiKey });
  const system = systemBlocks(now, cardContext, userMessage, mode);

  const messages: Anthropic.MessageParam[] = [
    ...cachedHistoryMessages(history),
    { role: "user" as const, content: userMessage },
  ];

  const toolsUsed: string[] = [];
  const proposals: Proposal[] = [];
  let cardNudged = false;
  const usage = new AiUsageAccumulator();

  try {
    for (let turn = 0; turn < MAX_LOOP_TURNS; turn++) {
      const response = await client.messages.create({
        model: ASSISTANT_MODEL,
        max_tokens: 1600,
        // Interactive chat — keep round-trips snappy; the tools do the heavy math.
        thinking: { type: "disabled" },
        system,
        tools: ASSISTANT_TOOLS,
        messages,
      });
      usage.add(response.usage);

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
              // WRITE tool → collect the proposal (keyed by this block's id) and feed
              // the model the short pending-confirmation note, not the whole proposal.
              if (isWriteToolOutput(result)) {
                proposals.push({ ...result.proposal, id: block.id });
                return { type: "tool_result" as const, tool_use_id: block.id, content: result.modelResult };
              }
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
      if (reply) {
        // Phantom-card backstop: the model claimed a card but never called a write
        // tool this whole turn — force it to call the tool (or clarify) once.
        if (!cardNudged && proposals.length === 0 && CARD_CLAIM_RE.test(reply)) {
          cardNudged = true;
          messages.push({ role: "user", content: CARD_CORRECTION });
          continue;
        }
        return { ok: true, reply, toolsUsed, proposals };
      }
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
      proposals,
    };
  } catch {
    return {
      ok: false,
      reply: "Something went wrong reaching the assistant. Please try again in a moment.",
      toolsUsed,
      proposals,
      error: "api-failed",
    };
  } finally {
    // Best-effort — one row per user-visible turn, accumulated across every loop
    // iteration's API call, so a tool-heavy turn logs as ONE usage entry per action.
    await usage.flush(userId, "assistant_chat", ASSISTANT_MODEL).catch(() => {});
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
  opts: { now?: Date; signal?: AbortSignal; cardContext?: string } = {},
): AsyncGenerator<AssistantStreamEvent> {
  const now = opts.now ?? new Date();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    yield { type: "text", text: "The assistant isn't configured yet (missing AI key)." };
    return;
  }

  const client = new Anthropic({ apiKey });
  const system = systemBlocks(now, opts.cardContext ?? "", userMessage);
  const messages: Anthropic.MessageParam[] = [
    ...cachedHistoryMessages(history),
    { role: "user" as const, content: userMessage },
  ];

  let producedText = false;
  let fullText = ""; // accumulated reply text — used by the phantom-card backstop
  let proposalCount = 0; // write proposals raised this whole turn
  let cardNudged = false;
  // Buffer write proposals and emit them only AFTER the final answer text, so the
  // confirm cards always render below a COMPLETE reply (user: "先 answer 再出卡片"),
  // never mid-sentence when the tool runs.
  const pendingProposals: Proposal[] = [];
  const usage = new AiUsageAccumulator();

  try {
    for (let turn = 0; turn < MAX_LOOP_TURNS; turn++) {
      // Text produced in THIS iteration only. If the iteration turns out to call a
      // tool, that text was pre-tool narration ("let me check…") — we tell the
      // client to discard it (a `reset`), so it can't stack with the final answer
      // into one doubled bubble (+ duplicate [[go:]]/[[suggest:]] chips). This is
      // the deterministic guarantee; the "call tools silently" prompt rule just
      // reduces how often there's anything to discard.
      let iterProducedText = false;

      const stream = client.messages.stream(
        {
          model: ASSISTANT_MODEL,
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
          iterProducedText = true;
          fullText += event.delta.text;
          yield { type: "text", text: event.delta.text };
        }
      }

      const msg = await stream.finalMessage();
      usage.add(msg.usage);
      messages.push({ role: "assistant", content: msg.content });

      if (msg.stop_reason === "tool_use") {
        // This iteration's text was pre-tool narration — discard it client-side and
        // from the backstop accumulator, so only the FINAL answer's text survives.
        if (iterProducedText) {
          yield { type: "reset" };
          fullText = "";
          producedText = false;
        }
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
              // WRITE tool → hand the model the short pending note; the proposal
              // itself is surfaced to the UI out-of-band (collected below).
              if (isWriteToolOutput(result)) {
                return {
                  block,
                  proposal: { ...result.proposal, id: block.id } as Proposal,
                  toolResult: { type: "tool_result" as const, tool_use_id: block.id, content: result.modelResult },
                };
              }
              let json = JSON.stringify(result);
              if (json.length > 16000) {
                json = json.slice(0, 16000) + '… (truncated — narrow the query for full detail)"}';
              }
              return {
                block,
                proposal: null,
                toolResult: { type: "tool_result" as const, tool_use_id: block.id, content: json },
              };
            } catch (e) {
              return {
                block,
                proposal: null,
                toolResult: {
                  type: "tool_result" as const,
                  tool_use_id: block.id,
                  content: `Tool failed: ${e instanceof Error ? e.message : "unknown error"}`,
                  is_error: true,
                },
              };
            }
          }),
        );
        // Collect proposals — emitted AFTER the final answer (see pendingProposals).
        for (const r of results) {
          if (r.proposal) {
            proposalCount += 1;
            pendingProposals.push(r.proposal);
          }
        }
        messages.push({ role: "user", content: results.map((r) => r.toolResult) });
        continue;
      }

      // Phantom-card backstop: the model claimed a card but never called a write
      // tool this whole turn — force it to call the tool (or clarify) once. The
      // retry's text appends after what already streamed; kept minimal by the
      // correction note. Far better than leaving the user with a card that isn't there.
      if (!cardNudged && proposalCount === 0 && CARD_CLAIM_RE.test(fullText)) {
        cardNudged = true;
        messages.push({ role: "user", content: CARD_CORRECTION });
        continue;
      }

      // end_turn / max_tokens — final text already streamed above.
      if (!producedText) {
        yield {
          type: "text",
          text: "I looked but couldn't find anything to answer that — could you rephrase?",
        };
      }
      // Answer complete → now surface the confirm cards below it.
      for (const p of pendingProposals) yield { type: "proposal", proposal: p };
      return;
    }

    yield {
      type: "text",
      text: "I dug through quite a lot there and ran out of room — could you ask that in a slightly narrower way?",
    };
    for (const p of pendingProposals) yield { type: "proposal", proposal: p };
  } catch {
    // API error, or the client stopped (signal aborted). Whatever streamed so
    // far is kept; just signal the end so the caller can finalize/persist.
    yield { type: "error" };
  } finally {
    await usage.flush(userId, "assistant_chat", ASSISTANT_MODEL).catch(() => {});
  }
}
