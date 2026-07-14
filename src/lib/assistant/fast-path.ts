// ADDED (cost optimization — the "fast-path router"): a cheap, single-shot
// classify-and-extract call in front of the full ~20-tool conversational agent.
// One small CACHED prompt, no tool loop, no history — the reason the old pre-agent
// voice flow was 5-20x cheaper — used as a narrow pre-filter, never a replacement.
//
// V3 — expanded from create-only to the four things a real user actually does most,
// all of which are safely decidable from ONE message (+ at most the last-logged
// expense as context):
//   • log         — 1-3 brand-new, fully-stated expenses in one utterance
//   • amend_last  — "改成15块 / wrong, it's 15" about the expense JUST logged
//   • delete_last — "删掉刚才那个 / delete that" about the expense JUST logged
//   • total_query — "这个月(食物)花了多少" → answered DETERMINISTICALLY (Prisma
//                   aggregate + bilingual template; zero extra AI)
// Anything else — searches, edits of older rows, analysis, projections, recurring,
// income, months, multi-intent, ambiguity — escalates to the full agent unchanged.
//
// Money-safety invariants (unchanged from v1): every write still goes through the
// SAME proposal builders the full agent uses (validation + closed-month + duplicate
// checks identical), every card is confirm-gated, and the classifier is biased to
// escalate on any doubt — a false escalation costs cents, a false accept is not
// acceptable and the confirm card is the last line of defense.
//
// Cost levers:
//   1. fastPathGate — zero-cost deterministic routing; obvious full-agent territory
//      (analysis/recurring/income/searches) never even pays the classifier toll.
//   2. The classifier's prompt+tool prefix is CACHED (cache_control, ~1.5K tokens,
//      shared across ALL users) — warm calls read it at 0.1x.
//   3. total_query replies are templated — no second AI call to narrate numbers.
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { proposeCreateExpense, proposeUpdateExpense, proposeDeleteExpense } from "./tools";
import type { Proposal, ChatMessageData, ExpenseFields } from "./types";
import { WRITABLE_CATEGORIES } from "./types";
import type { CategoryKey } from "@/types";
import { logAiUsage } from "@/lib/ai-usage";

// Haiku 4.5, deliberately with the SHORT prompt (NOT padded). Measured
// (scripts/classifier-model-cost.ts): short-Haiku is a FLAT ~$0.0028/call (its cache
// never activates below the 4096-token floor), which beats short-Sonnet's expensive
// cold-write (~$0.0074) by 44-61% for cold-start-dominated real usage — the opposite
// of PADDED-Haiku, whose 3x prompt inflates the cold cost. Sonnet only wins for very
// frequent (warm-dominated) users, which real usage here is not. Accuracy parity with
// Sonnet on the classify task was confirmed in round 1 and re-verified via fast-path-smoke.
const FAST_PATH_MODEL = "claude-haiku-4-5-20251001";

// ── last-logged-expense context (deterministic, from the session's own rows) ──

/** What the router knows about the most recent create-expense card in this session —
 *  enough for the classifier to judge "is the user talking about THAT?" and for us
 *  to resolve the real DB row afterwards. */
export interface LastExpenseContext {
  fields: ExpenseFields;
  /** The card's persisted outcome when the message arrived. */
  outcome: "pending" | "confirmed" | "cancelled";
}

/** Extract the most recent create_expense proposal (and its outcome) from a
 *  session's persisted messages — newest first. Shared by both send paths. */
export function extractLastCreate(
  messages: { role: string; data: unknown }[],
): LastExpenseContext | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const d = m.data as ChatMessageData | null;
    if (!d?.proposals?.length) continue;
    for (let j = d.proposals.length - 1; j >= 0; j--) {
      const p = d.proposals[j];
      if (p.kind === "create_expense" && p.create) {
        return { fields: p.create, outcome: p.outcome ?? "pending" };
      }
    }
  }
  return null;
}

// ── deterministic pre-gate (zero API cost) ───────────────────

const HAS_NUMBER_RE = /[0-9０-９]|[一二两三四五六七八九十百千万]/;

// Always full-agent territory — deep analysis, projections, searches over history,
// recurring/income/months, referential requests. A hit here skips the classifier
// entirely (the message was escalating anyway; don't pay the toll).
const SKIP_RE = new RegExp(
  [
    // analysis / projections / comparisons
    "为什么", "什么时候", "多久", "分析", "比较", "对比", "统计", "平均", "预算", "目标", "存到", "存款", "建议",
    "why", "how long", "analy[sz]", "compare", "average", "project", "breakdown", "summar", "budget",
    "\\bgoal\\b", "suggest", "recommend", "advice", "\\btrend", "overspen",
    // searching / referencing history (needs real context)
    "搜索", "查一下", "查查", "帮我查", "看看", "找一下", "找找", "寻找", "上次", "之前", "哪一笔", "哪笔",
    "\\bsearch\\b", "\\bfind\\b", "\\blist\\b", "show me", "last time", "previous", "biggest", "largest",
    "最大", "最贵", "最多",
    // recurring / income / months — always the full agent's territory
    "recurring", "subscription", "订阅", "每个月", "每月", "月租", "房租", "租金", "\\brent\\b",
    "salary", "工资", "薪水", "bonus", "奖金", "income", "收入",
    "reopen", "重新打开", "关账", "close .{0,12}month",
  ].join("|"),
  "i",
);

// Simple spend-total questions — cheap to answer deterministically.
const TOTAL_Q_RE = new RegExp(
  ["多少", "几多", "总共", "一共", "how much", "how many", "total", "spent"].join("|"),
  "i",
);

// Amend/delete phrasing about the just-logged expense — only meaningful when the
// session actually HAS a last-logged expense to point at.
const AMEND_RE = new RegExp(
  [
    "改成", "改到", "改为", "修改", "改一下", "换成", "删掉", "删除", "不对", "错了", "记错",
    "\\bchange\\b", "\\bupdate\\b", "\\bedit\\b", "\\bfix\\b", "\\bwrong\\b", "\\bdelete\\b",
    "\\bremove\\b", "\\bundo\\b", "\\bcancel\\b", "取消",
  ].join("|"),
  "i",
);

/** Zero-cost routing decision: should this message be shown to the classifier at
 *  all? Exported for the smoke test. false = straight to the full agent. */
export function fastPathGate(message: string, hasLastExpense: boolean): boolean {
  if (SKIP_RE.test(message)) return false;
  if (HAS_NUMBER_RE.test(message)) return true; // a possible log / amend-with-value
  if (TOTAL_Q_RE.test(message)) return true; // a possible simple total question
  if (hasLastExpense && AMEND_RE.test(message)) return true; // "delete that" etc.
  return false;
}

// ── arch-B gate: is this a SIMPLE log (one or several) for the cheap mini tier? ──
// gpt-4o-mini owns the slice it's proven clean on. This gate escalates — sends the
// message to the Haiku classifier instead — only on things reliably pattern-matched
// AND outside mini's safe zone: edits/deletes and any question/referential phrasing.
// WEEKDAY dates are NO LONGER gated out: mini's only weakness was weekday ARITHMETIC,
// which we removed — mini just sets `lastWeekday` (identifying the weekday, which it's
// good at) and resolveItemDate() computes the exact date in code. Multi-item is NOT
// gated here either — the item-count + duplication post-checks in tryMiniSimpleLog
// handle it. Biased toward escalation — a false "simple" is the only unsafe direction,
// and the confirm card is still the last line of defense.

// A question or a request that leans on earlier context — not a self-contained log.
const QUESTION_OR_REFERENTIAL_RE = new RegExp(
  [
    "多少", "几多", "为什么", "怎么", "how much", "how many", "how long", "\\bwhy\\b", "？", "\\?",
    "刚才", "那笔", "上一笔", "上笔", "\\bthat one\\b", "\\bthe previous\\b",
  ].join("|"),
  "i",
);

/** Deterministic decision: is `message` a plausible simple expense log (one or
 *  several) that gpt-4o-mini can safely extract? Exported for the smoke test.
 *  Requires an amount and no edit/question/referential phrasing. Weekday dates are
 *  fine now — mini flags them via `lastWeekday` and code resolves the date. */
export function looksLikeSimpleLog(message: string): boolean {
  if (!HAS_NUMBER_RE.test(message)) return false; // no amount → not a clean log
  if (AMEND_RE.test(message)) return false; // edit/delete of a row → classifier
  if (QUESTION_OR_REFERENTIAL_RE.test(message)) return false; // question/referential
  return true;
}

// ── deterministic weekday-date resolution ────────────────────
// LLMs are unreliable at weekday ARITHMETIC (round 3/4: "上个星期五" landed on the
// wrong calendar day). So the model only IDENTIFIES a weekday reference (sets
// lastWeekday = 0..6 for Sun..Sat — language it's good at) and WE compute the exact
// date here with Date math (100% correct). Everything else (yesterday, N-days-ago,
// day-of-month, explicit dates) the model already resolves reliably.

const fmtYmd = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Most recent occurrence of `weekday` (0=Sun..6=Sat) STRICTLY before today —
 *  1-7 days ago (7 when today IS that weekday). Deterministic; never lands on the
 *  wrong weekday the way LLM arithmetic can. */
function computeLastWeekday(now: Date, weekday: number): string {
  const d = new Date(now);
  const diff = ((d.getDay() + 7 - weekday) % 7) || 7;
  d.setDate(d.getDate() - diff);
  return fmtYmd(d);
}

/** Resolve an extracted item's spend date. A model-set `lastWeekday` (0-6) is
 *  computed HERE (never trust the model's weekday math); otherwise the model's
 *  YYYY-MM-DD `date` string is used (reliable for absolute / yesterday / N-days-ago
 *  / day-of-month). undefined → today. */
function resolveItemDate(raw: Record<string, unknown>, now: Date): string | undefined {
  const wd = raw.lastWeekday;
  if (typeof wd === "number" && Number.isInteger(wd) && wd >= 0 && wd <= 6) {
    return computeLastWeekday(now, wd);
  }
  return typeof raw.date === "string" ? raw.date : undefined;
}

// ── the classifier ───────────────────────────────────────────

const EXPENSE_ITEM_SCHEMA = {
  type: "object",
  properties: {
    amount: { type: "number", description: "The amount spent (positive)." },
    category: {
      type: "string",
      enum: WRITABLE_CATEGORIES,
      description: "Best-fit category. Hotels/accommodation/travel lodging → 'other' (not trans/bills).",
    },
    currency: {
      type: "string",
      enum: ["SGD", "MYR", "CNY", "USD"],
      description:
        "Currency; default SGD. Word map: 新币/坡币/新加坡元 → SGD; 令吉/马币/ringgit/RM → MYR; " +
        "人民币/RMB → CNY. The user is in Singapore/Malaysia: bare 块/元 with no country word just " +
        "means dollars — keep the default SGD, do NOT infer CNY from 块.",
    },
    note: {
      type: "string",
      description:
        "Short description of WHAT was bought/eaten — the item, dish, or merchant ('麦当劳', '鸡排', " +
        "'chicken rice at Maxwell'). NOT the meal type (晚餐/午餐/breakfast) or the category word; a " +
        "specific item/merchant always wins over the meal type.",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description:
        "ONLY labels the user EXPLICITLY asks to tag (signalled by 标签/tag/tags/'tag it'). " +
        "'标签帮我加晚餐' → ['晚餐']; 'tag it work' → ['work']. A meal type the user asks to TAG goes " +
        "here, not in note. Empty if no tag was requested.",
    },
    date: {
      type: "string",
      description:
        "YYYY-MM-DD if a specific date was mentioned (resolve relative dates like 'yesterday'/'3 days " +
        "ago'/'the 15th of last month' against today's date). Omit for today. A month/day given WITHOUT " +
        "a year always resolves to the CURRENT year — never assume a past year, even if that makes the " +
        "date land in the future (the system rejects future dates itself). Do NOT put a WEEKDAY " +
        "reference here — use lastWeekday for that.",
    },
    lastWeekday: {
      type: "integer",
      description:
        "Set ONLY when the date is a WEEKDAY reference relative to today ('上个星期五'/'上礼拜三'/'last " +
        "Friday'): the weekday as an integer 0=Sunday..6=Saturday. Leave `date` empty in that case — " +
        "the system computes the exact date itself (do NOT try to compute it). Omit this for any other " +
        "kind of date.",
    },
  },
  required: ["amount", "category"],
  additionalProperties: false,
} as const;

export const ROUTE_TOOL: Anthropic.Tool = {
  name: "route",
  description:
    "Classify this ONE user message into exactly one intent, extracting details ONLY from this " +
    "message (plus the LAST-LOGGED expense context if provided). Intents:\n" +
    "• log — the message purely logs one or more brand-new expenses and states each one's amount + what it " +
    "was. A discourse-marker opener ('OK', 'also', 'another one:', '再来一个', '还有') followed by " +
    "COMPLETE details is still a log. A FUTURE-dated log is STILL intent 'log' — extract it normally " +
    "(the system itself declines future dates with a proper explanation; do not route it to 'other'). " +
    "If any expense is missing its amount or is ambiguous → other.\n" +
    "• amend_last — the message corrects the LAST-LOGGED expense shown in the context ('改成15块', " +
    "'wrong, it was 15', 'make it lunch category', 'add tag work'). ONLY when the message plainly " +
    "refers to that same expense (no other identifying description that mismatches it). Extract just " +
    "the fields being CHANGED. If there is no last-logged context, or they describe a DIFFERENT " +
    "expense ('my coffee from Tuesday') → other.\n" +
    "• delete_last — the message asks to delete/undo the LAST-LOGGED expense in the context. Same " +
    "matching rule as amend_last.\n" +
    "• total_query — a simple 'how much did I spend' question: total spend, optionally ONE category, " +
    "for today / this week / this month / last month ONLY. Anything else (other periods, comparisons, " +
    "why-questions, biggest-expense, per-day averages, budgets) → other.\n" +
    "• other — EVERYTHING else: searches, edits of older expenses, analysis, projections, recurring " +
    "rules, income, months, questions needing history, multi-intent messages (e.g. a log PLUS a " +
    "question), or ANY doubt. When in doubt, always choose other.",
  input_schema: {
    type: "object",
    properties: {
      intent: {
        type: "string",
        enum: ["log", "amend_last", "delete_last", "total_query", "other"],
        description: "The single intent of this message. Choose 'other' on any doubt.",
      },
      expenses: {
        type: "array",
        items: EXPENSE_ITEM_SCHEMA,
        description: "intent=log: the expenses to create (one or several), each complete on its own.",
      },
      amend: {
        type: "object",
        properties: {
          amount: { type: "number", description: "New amount, only if changed." },
          category: { type: "string", enum: WRITABLE_CATEGORIES, description: "New category, only if changed." },
          currency: { type: "string", enum: ["SGD", "MYR", "CNY", "USD"], description: "New currency, only if changed." },
          note: { type: "string", description: "New note, only if changed." },
          tags: { type: "array", items: { type: "string" }, description: "REPLACES all tags — include existing ones to keep, only if the user changed tags." },
          date: { type: "string", description: "New date YYYY-MM-DD, only if changed (not for weekday references — use lastWeekday)." },
          lastWeekday: { type: "integer", description: "New date as a WEEKDAY reference (0=Sun..6=Sat); the system computes the exact date. Only if the user changed the date to a weekday." },
        },
        additionalProperties: false,
        description: "intent=amend_last: ONLY the fields the user wants changed.",
      },
      total: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: [...WRITABLE_CATEGORIES, "family", "all"],
            description: "One category, or 'all' for overall spend.",
          },
          period: {
            type: "string",
            enum: ["today", "this_week", "this_month", "last_month"],
            description: "The period asked about. Any other period → intent 'other'.",
          },
        },
        required: ["category", "period"],
        additionalProperties: false,
        description: "intent=total_query: what to total.",
      },
      reply: {
        type: "string",
        description:
          "intent=log only: a short one-line reply in the SAME language/script as the user's message, " +
          "telling them you've prepared the card(s) to review (never claim anything is already saved).",
      },
    },
    required: ["intent"],
    additionalProperties: false,
  },
};

export function routeSystemPrompt(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  return (
    `Today is ${weekday}, ${today}. You are a fast, narrow pre-filter in front of a full financial ` +
    `assistant — your ONLY job is to spot the simplest cases (log / amend-last / delete-last / simple ` +
    `total) and extract them, or bail out (intent 'other') so the full assistant, which has the whole ` +
    `conversation, handles it instead. Bias heavily toward 'other' on any doubt, ambiguity, missing ` +
    `detail, or a second request bundled in — a wrongly-accepted case here risks silently mis-handling ` +
    `the user's money, which is unacceptable. Never invent a detail (amount, category, note, date) the ` +
    `user didn't actually say.\n` +
    `DATE RESOLUTION — resolve against today above: '昨天/yesterday' = today−1; '前天' = today−2; ` +
    `'N天前/N days ago' = today−N; '上个月N号/the Nth of last month' = day N of the previous month; ` +
    `put these in the 'date' field as YYYY-MM-DD. But for a WEEKDAY reference ('上个星期五/上礼拜三/` +
    `last Friday'), do NOT compute the date yourself — set the 'lastWeekday' field to the weekday ` +
    `(0=Sunday..6=Saturday) and leave 'date' empty; the system computes the exact day. A month/day ` +
    `without a year is always the CURRENT year.`
  );
}

// ── deterministic reply templates ────────────────────────────

const isCJK = (s: string) => (s.match(/[一-鿿]/g) ?? []).length > 0;

function fallbackLogReply(userMessage: string, count: number): string {
  if (isCJK(userMessage)) return count > 1 ? `我准备了 ${count} 张卡片，请逐张确认。` : "我帮你准备了一张卡片，请检查后确认。";
  return count > 1
    ? `I've prepared ${count} cards below — please review each one.`
    : "I've prepared a card below — please review and confirm.";
}

function futureDateReply(userMessage: string): string {
  return isCJK(userMessage)
    ? "这个日期还没到哦 — Honey 只能记录到今天为止的消费。到那天再记，或者如果是每月固定的，可以设一个 recurring。"
    : "That date hasn't happened yet — Honey only records spending up to today. Log it on the day, or set up a recurring rule if it repeats monthly.";
}

function amendReply(userMessage: string, replaced: boolean): string {
  if (isCJK(userMessage))
    return replaced
      ? "我准备了一张更正后的卡片（旧的那张不用理，别按它的确认就行），请确认新的这张。"
      : "我准备了一张更新卡片（改动前后都写在上面），请确认。";
  return replaced
    ? "I've prepared a corrected card — just ignore the earlier one and confirm this one instead."
    : "I've prepared an update card (before → after shown) — please confirm.";
}

function deleteReply(userMessage: string): string {
  return isCJK(userMessage)
    ? "我准备了删除卡片，请确认后才会真的删掉。"
    : "I've prepared a delete card — nothing is removed until you confirm.";
}

function pendingDeleteReply(userMessage: string): string {
  return isCJK(userMessage)
    ? "那笔还没保存 — 卡片还等着你确认，直接按卡片上的 Cancel 就可以了，不用删除。"
    : "That one was never saved — its card is still waiting for you, so just tap Cancel on the card. Nothing to delete.";
}

const CATEGORY_LABELS: Record<string, { en: string; zh: string }> = {
  food: { en: "food", zh: "食物" },
  shop: { en: "shopping", zh: "购物" },
  ent: { en: "entertainment", zh: "娱乐" },
  trans: { en: "transport", zh: "交通" },
  health: { en: "health", zh: "健康" },
  bills: { en: "bills", zh: "账单" },
  family: { en: "family", zh: "家用" },
  other: { en: "other", zh: "其他" },
};

const CURRENCY_SYMBOL: Record<string, string> = { SGD: "S$", MYR: "RM", CNY: "¥", USD: "$" };

// ── deterministic total query (zero AI) ──────────────────────

function periodRange(period: string, now: Date): { from: Date; to: Date; en: string; zh: string } | null {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  switch (period) {
    case "today":
      return { from: new Date(y, m, d), to: new Date(y, m, d, 23, 59, 59, 999), en: "today", zh: "今天" };
    case "this_week": {
      // Week starts Monday (SG/MY convention).
      const dow = (now.getDay() + 6) % 7; // Mon=0 … Sun=6
      return {
        from: new Date(y, m, d - dow),
        to: new Date(y, m, d, 23, 59, 59, 999),
        en: "this week",
        zh: "这周",
      };
    }
    case "this_month":
      return { from: new Date(y, m, 1), to: new Date(y, m + 1, 0, 23, 59, 59, 999), en: "this month", zh: "这个月" };
    case "last_month":
      return { from: new Date(y, m - 1, 1), to: new Date(y, m, 0, 23, 59, 59, 999), en: "last month", zh: "上个月" };
    default:
      return null;
  }
}

/** Answer a simple total with ONE Prisma aggregate + a bilingual template — the
 *  numbers come from the same table the agent's analyze_spending reads; only the
 *  narration differs (template instead of a second AI call). */
async function answerSimpleTotal(
  userId: string,
  userMessage: string,
  category: string,
  period: string,
  now: Date,
): Promise<string | null> {
  const range = periodRange(period, now);
  if (!range) return null;
  const cat = category !== "all" && CATEGORY_LABELS[category] ? (category as CategoryKey) : null;

  const [agg, user] = await Promise.all([
    prisma.expense.aggregate({
      _count: true,
      _sum: { amount: true },
      where: {
        userId,
        spentAt: { gte: range.from, lte: range.to },
        ...(cat && { category: cat }),
      },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { currency: true } }),
  ]);

  const total = Number(agg._sum.amount ?? 0);
  const count = agg._count;
  const sym = CURRENCY_SYMBOL[user?.currency ?? "SGD"] ?? "S$";
  const amount = `${sym}${total.toFixed(2)}`;

  if (isCJK(userMessage)) {
    const catLabel = cat ? `在${CATEGORY_LABELS[cat].zh}上` : "";
    return count === 0
      ? `${range.zh}${catLabel}还没有记录任何消费。`
      : `${range.zh}${catLabel}一共花了 ${amount}（${count} 笔）。`;
  }
  const catLabel = cat ? ` on ${CATEGORY_LABELS[cat].en}` : "";
  return count === 0
    ? `No spending recorded${catLabel} ${range.en} yet.`
    : `You've spent ${amount}${catLabel} ${range.en} (${count} ${count === 1 ? "entry" : "entries"}).`;
}

// ── amend/delete-last row resolution (deterministic) ─────────

/** Find the REAL DB row for the last-logged expense: exact match on the proposal's
 *  own amount + spentAt timestamp (createExpense wrote those exact values). Newest
 *  first, so even duplicate logs resolve to the latest one. Null = not found
 *  (deleted/edited meanwhile, or the card was never confirmed). */
async function resolveLastExpenseRow(userId: string, f: ExpenseFields): Promise<number | null> {
  if (!f.spentAt) return null;
  const row = await prisma.expense.findFirst({
    where: { userId, amount: f.amount, spentAt: new Date(f.spentAt) },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return row?.id ?? null;
}

// ── the router ───────────────────────────────────────────────

export interface FastPathResult {
  reply: string;
  /** Confirm cards to render (0 = a text-only reply, e.g. future-date decline). */
  proposals: Proposal[];
  /** For the UI's tool chips — mirrors what the full agent would have reported. */
  toolsUsed: string[];
}

const mintId = (now: Date) => `fp_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// ── arch-B mini tier: gpt-4o-mini extract-only for simple single-item logs ────

const MINI_MODEL = "gpt-4o-mini";

// Max expenses either the mini tier OR the classifier may log from ONE message.
// Generous — a user can dump a whole day's spends at once — but bounded so a garbled
// or paste-bomb message can't spawn a runaway stack of cards / a surprise bill. Real
// users never approach it; it's a safety fuse, not a UX limit. Kept the SAME for both
// tiers so a mixed message (some simple + one weekday item) that escalates to the
// classifier still gets all its cards on the cheap Haiku tier, not the full agent.
// Over the cap → a CLEAR "please split" message (NOT a silent jump to the expensive
// agent) — predictable + safe beats silent magic.
const MAX_LOG_ITEMS = 20;

/** Friendly bilingual "that's too many at once" reply — shown instead of silently
 *  escalating a 20+-item message to the full agent. */
function tooManyLogsReply(userMessage: string): string {
  return isCJK(userMessage)
    ? `哇，这条有点多啦～我一次最多帮你记 ${MAX_LOG_ITEMS} 笔。先存好这些，或者分两次发给我好吗？😊`
    : `That's a lot at once — I can prepare up to ${MAX_LOG_ITEMS} in one go. Could you split it into a couple of messages?`;
}

// Extract-only prompt — NO self-triage (round 4a showed mini's self-escalation is
// jumpy, especially in Chinese). The deterministic gate + post-check do the routing;
// mini only does what it's proven good at: pull the fields out of the message. The
// note-vs-tags wording is load-bearing — without it mini jams the meal type (晚餐/
// 午餐) into note and drops the real item + the requested tag (real user bug, fixed
// and verified in scripts/mini-extract-tune.ts, 6/6).
function miniExtractPrompt(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  return (
    `Today is ${weekday}, ${today}. Extract EVERY expense the user is logging into the expenses ` +
    `array — there may be one or several (log each distinct one the user states). For EACH expense:\n` +
    `- amount: the number spent.\n` +
    `- category ∈ ${WRITABLE_CATEGORIES.join("/")} (hotels/lodging → other).\n` +
    `- currency: SGD by default; 令吉/马币/ringgit/RM → MYR; 人民币/RMB → CNY; a bare 块/元/dollars ` +
    `with no country word means SGD (never infer CNY from 块).\n` +
    `- note: a SHORT description of WHAT was bought or eaten — the item, dish, or merchant ` +
    `(e.g. "麦当劳", "鸡排", "chicken rice", "Grab ride"). Do NOT use the meal type (晚餐/午餐/breakfast) ` +
    `or the category word as the note; a specific item/merchant always wins. Only fall back to the ` +
    `meal type if that is genuinely the only thing named.\n` +
    `- tags: ONLY labels the user EXPLICITLY asks to tag — signalled by 标签/tag/tags/tag一下/加个标签/` +
    `"tag it". e.g. "标签帮我加晚餐" → ["晚餐"]; "tag it work" → ["work"]; "tag 电脑器材" → ["电脑器材"]. ` +
    `A meal type the user asks to put as a TAG goes here, NOT in note. If no tag is requested, use [].\n` +
    `- date: YYYY-MM-DD for a NON-weekday date — resolve "yesterday"/"N days ago"/"the Nth of last ` +
    `month" against today above; a month/day with no year = CURRENT year; null for today.\n` +
    `- lastWeekday: set ONLY for a WEEKDAY reference ("上个星期五"/"上礼拜三"/"last Friday") — the weekday ` +
    `as an integer 0=Sunday..6=Saturday, and leave date null. Do NOT compute the weekday's date ` +
    `yourself; we compute it. For every non-weekday date, leave lastWeekday null.\n` +
    `Never invent a detail the user didn't say.`
  );
}

// OpenAI strict mode requires every property in `required`; a nullable type is how a
// field stays effectively optional.
const MINI_ITEM_SCHEMA = {
  type: "object",
  properties: {
    amount: { type: ["number", "null"] },
    category: { type: ["string", "null"], enum: [...WRITABLE_CATEGORIES, null] },
    currency: { type: ["string", "null"], enum: ["SGD", "MYR", "CNY", "USD", null] },
    note: { type: ["string", "null"] },
    tags: { type: ["array", "null"], items: { type: "string" } },
    date: { type: ["string", "null"] },
    lastWeekday: { type: ["integer", "null"] },
  },
  required: ["amount", "category", "currency", "note", "tags", "date", "lastWeekday"],
  additionalProperties: false,
} as const;

const MINI_TOOL_PARAMS = {
  type: "object",
  properties: { expenses: { type: "array", items: MINI_ITEM_SCHEMA } },
  required: ["expenses"],
  additionalProperties: false,
} as const;

/**
 * Try the cheap mini tier for one or several simple new expense logs. Returns a
 * handled result, or null to fall through to the Haiku/Sonnet classifier unchanged.
 * Safety rests on deterministic guards, NOT on mini's judgment:
 *   • the caller only reaches here when `looksLikeSimpleLog` passed (no edit /
 *     question / referential phrasing) AND there is no pending card to be amending;
 *   • mini's output is trusted ONLY if it is 1..MAX_LOG_ITEMS each with a valid amount, and
 *     the LAST item is not an exact copy of an earlier one (the CN/Singlish
 *     duplication bug's signature) — anything else → null, so odd/duplicated output
 *     lands on the classifier, which is correct on multi-item across all test rounds.
 * Every failure mode (no key, network/parse error, bad count, dup, validation error)
 * is a silent fall-through — mini can never break logging.
 */
async function tryMiniSimpleLog(
  userId: string,
  userMessage: string,
  now: Date,
): Promise<FastPathResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  let items: Record<string, unknown>[];
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MINI_MODEL,
        messages: [
          { role: "system", content: miniExtractPrompt(now) },
          { role: "user", content: userMessage },
        ],
        tools: [
          {
            type: "function",
            function: { name: "log_expenses", description: "Extract every expense stated.", parameters: MINI_TOOL_PARAMS, strict: true },
          },
        ],
        tool_choice: { type: "function", function: { name: "log_expenses" } },
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    const parsed = (args ? JSON.parse(args) : {}) as { expenses?: unknown };
    items = Array.isArray(parsed.expenses) ? (parsed.expenses as Record<string, unknown>[]) : [];
    // Best-effort usage logging (mini is priced differently — an OpenAI id lands in
    // the `model` column, tagged as the mini feature).
    void logAiUsage(userId, "assistant_fast_path_mini", MINI_MODEL, {
      input_tokens: json.usage?.prompt_tokens ?? 0,
      output_tokens: json.usage?.completion_tokens ?? 0,
    }).catch(() => {});
  } catch {
    return null;
  }

  // POST-CHECK: need ≥1 item. Over the cap → a clear "please split" message (NOT a
  // silent jump to the pricey agent). Empty/garbled → fall through to the classifier.
  if (items.length < 1) return null;
  if (items.length > MAX_LOG_ITEMS) {
    return { reply: tooManyLogsReply(userMessage), proposals: [], toolsUsed: [] };
  }
  for (const it of items) {
    if (typeof it.amount !== "number" || it.amount <= 0) return null;
  }
  // Duplication guard — the CN/Singlish duplication bug (round 3) copies the LAST
  // item. A genuine repeat is rare and the classifier handles it correctly, so on any
  // exact dup we escalate rather than risk a phantom double-log.
  const dupKey = (it: Record<string, unknown>) =>
    `${it.amount}|${it.note ?? ""}|${it.date ?? ""}|${it.category ?? ""}`;
  const lastKey = dupKey(items[items.length - 1]);
  for (let i = 0; i < items.length - 1; i++) {
    if (dupKey(items[i]) === lastKey) return null;
  }

  const proposals: Proposal[] = [];
  for (const it of items) {
    const result = await proposeCreateExpense(
      userId,
      {
        amount: it.amount,
        category: typeof it.category === "string" ? it.category : undefined,
        currency: typeof it.currency === "string" ? it.currency : undefined,
        note: typeof it.note === "string" ? it.note : undefined,
        tags: Array.isArray(it.tags) ? it.tags : undefined,
        date: resolveItemDate(it, now),
      },
      now,
    );
    if ("error" in result) {
      // A single future-dated log gets the canned bilingual decline the classifier
      // path uses; a future date mixed into a multi-log (or any other validation
      // problem) escalates so the agent can explain.
      if (items.length === 1 && result.error.includes("future")) {
        return { reply: futureDateReply(userMessage), proposals: [], toolsUsed: [] };
      }
      return null;
    }
    proposals.push({ ...result.proposal, id: mintId(now) });
  }
  return {
    reply: fallbackLogReply(userMessage, proposals.length),
    proposals,
    toolsUsed: proposals.map(() => "create_expense"),
  };
}

/**
 * Try to handle `userMessage` cheaply. Returns null (escalate to the full agent,
 * unchanged) whenever the gate or classifier declines, the call errors, or the
 * extracted values don't hold up under the SAME validation the full agent's tools
 * use. `lastExpense` = the session's most recent create card (context for
 * amend/delete-last); null on a fresh session.
 */
export async function tryFastPath(
  userId: string,
  userMessage: string,
  now: Date,
  lastExpense: LastExpenseContext | null,
): Promise<FastPathResult | null> {
  if (!fastPathGate(userMessage, lastExpense != null)) return null;

  // CHEAPEST TIER (arch B): one or several simple new expense logs → gpt-4o-mini extract-only,
  // ~20x cheaper than the classifier. Skipped while a card is still PENDING the
  // user's tap, because a follow-up ("make it 15") could be amending THAT card — a
  // call the context-aware classifier should make, not the context-free mini path.
  // Any miss (gate fail, no key, error, bad count, dup, bad fields) falls through.
  const pendingCard = lastExpense?.outcome === "pending";
  if (!pendingCard && looksLikeSimpleLog(userMessage)) {
    const mini = await tryMiniSimpleLog(userId, userMessage, now);
    if (mini) return mini;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const client = new Anthropic({ apiKey });
  let usage: Anthropic.Usage | null = null;
  try {
    // Context rides in a SECOND system block so the big first block stays cached.
    const system: Anthropic.TextBlockParam[] = [
      { type: "text", text: routeSystemPrompt(now), cache_control: { type: "ephemeral" } },
    ];
    if (lastExpense) {
      const f = lastExpense.fields;
      system.push({
        type: "text",
        text:
          `LAST-LOGGED expense in this chat (for amend_last/delete_last matching): ` +
          `${CURRENCY_SYMBOL[f.currency] ?? ""}${f.amount.toFixed(2)} · ${f.category}` +
          `${f.note ? ` · ${f.note}` : ""}${f.spentAt ? ` · ${f.spentAt.slice(0, 10)}` : ""}` +
          `${f.tags.length ? ` · tags: ${f.tags.join(",")}` : ""} (card status: ${lastExpense.outcome}).`,
      });
    }

    const response = await client.messages.create({
      model: FAST_PATH_MODEL,
      max_tokens: 500,
      thinking: { type: "disabled" },
      system,
      tools: [ROUTE_TOOL],
      tool_choice: { type: "tool", name: "route" },
      messages: [{ role: "user", content: userMessage }],
    });
    usage = response.usage;

    const block = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const input = (block?.input ?? {}) as Record<string, unknown>;
    const intent = input.intent;

    // ── log: brand-new expenses (1..MAX_LOG_ITEMS) ──
    if (intent === "log") {
      const items = Array.isArray(input.expenses) ? input.expenses : [];
      if (items.length < 1) return null;
      // Over the cap → clear "please split" message, not a silent jump to the agent.
      if (items.length > MAX_LOG_ITEMS) {
        return { reply: tooManyLogsReply(userMessage), proposals: [], toolsUsed: [] };
      }
      const proposals: Proposal[] = [];
      for (const raw of items) {
        const item = (raw ?? {}) as Record<string, unknown>;
        const result = await proposeCreateExpense(
          userId,
          {
            amount: item.amount,
            category: item.category,
            currency: item.currency,
            note: item.note,
            tags: item.tags,
            date: resolveItemDate(item, now), // weekday refs computed in code, never by the model
          },
          now,
        );
        if ("error" in result) {
          // A single future-dated log gets the canned decline; any other problem
          // (or a future date mixed into a multi-log) → the full agent explains.
          if (items.length === 1 && result.error.includes("future")) {
            return { reply: futureDateReply(userMessage), proposals: [], toolsUsed: [] };
          }
          return null;
        }
        proposals.push({ ...result.proposal, id: mintId(now) });
      }
      const reply =
        typeof input.reply === "string" && input.reply.trim()
          ? input.reply.trim()
          : fallbackLogReply(userMessage, proposals.length);
      return { reply, proposals, toolsUsed: proposals.map(() => "create_expense") };
    }

    // ── amend_last: correct the just-logged expense ──
    if (intent === "amend_last" && lastExpense) {
      const changes = (input.amend ?? {}) as Record<string, unknown>;
      if (Object.keys(changes).length === 0) return null;
      // A weekday-reference date change is computed in code, then folded into `date`
      // (proposeUpdateExpense knows `date`, not `lastWeekday`).
      if ("lastWeekday" in changes) {
        const resolved = resolveItemDate(changes, now);
        delete changes.lastWeekday;
        if (resolved) changes.date = resolved;
      }
      // The row-existence check decides confirmed-vs-pending deterministically
      // (also kills the outcome-write race): row found → a real edit; not found →
      // the card was never confirmed, so propose a corrected CREATE instead.
      const rowId = await resolveLastExpenseRow(userId, lastExpense.fields);
      if (rowId != null) {
        const result = await proposeUpdateExpense(userId, { id: rowId, ...changes });
        if ("error" in result) return null;
        return {
          reply: amendReply(userMessage, false),
          proposals: [{ ...result.proposal, id: mintId(now) }],
          toolsUsed: ["update_expense"],
        };
      }
      if (lastExpense.outcome !== "confirmed") {
        const f = lastExpense.fields;
        const merged = {
          amount: changes.amount ?? f.amount,
          category: changes.category ?? f.category,
          currency: changes.currency ?? f.currency,
          note: changes.note ?? (f.note || undefined),
          tags: changes.tags ?? (f.tags.length ? f.tags : undefined),
          date: changes.date ?? (f.spentAt ? f.spentAt.slice(0, 10) : undefined),
        };
        const result = await proposeCreateExpense(userId, merged, now);
        if ("error" in result) return null;
        return {
          reply: amendReply(userMessage, true),
          proposals: [{ ...result.proposal, id: mintId(now) }],
          toolsUsed: ["create_expense"],
        };
      }
      return null; // confirmed but row vanished (edited/deleted elsewhere) → full agent
    }

    // ── delete_last: remove the just-logged expense ──
    if (intent === "delete_last" && lastExpense) {
      const rowId = await resolveLastExpenseRow(userId, lastExpense.fields);
      if (rowId == null) {
        // Nothing was ever saved — point them at the card's own Cancel, free of charge.
        if (lastExpense.outcome !== "confirmed") {
          return { reply: pendingDeleteReply(userMessage), proposals: [], toolsUsed: [] };
        }
        return null;
      }
      const result = await proposeDeleteExpense(userId, { id: rowId });
      if ("error" in result) return null;
      return {
        reply: deleteReply(userMessage),
        proposals: [{ ...result.proposal, id: mintId(now) }],
        toolsUsed: ["delete_expense"],
      };
    }

    // ── total_query: deterministic aggregate + template ──
    if (intent === "total_query") {
      const t = (input.total ?? {}) as Record<string, unknown>;
      if (typeof t.category !== "string" || typeof t.period !== "string") return null;
      const reply = await answerSimpleTotal(userId, userMessage, t.category, t.period, now);
      if (!reply) return null;
      return { reply, proposals: [], toolsUsed: ["analyze_spending"] };
    }

    return null; // intent 'other' (or anything malformed) → full agent
  } catch {
    return null;
  } finally {
    if (usage) await logAiUsage(userId, "assistant_fast_path", FAST_PATH_MODEL, usage).catch(() => {});
  }
}
