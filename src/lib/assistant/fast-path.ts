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

// Digits across scripts (multilingual round): ASCII/fullwidth + Arabic-Indic ٠-٩ +
// Extended Arabic-Indic ۰-۹ + Devanagari ०-९ + Thai ๐-๙ + Chinese numerals. Without
// these, an Arabic user's "غداء ١٥ أمس" never even entered the fast path.
const HAS_NUMBER_RE = /[0-9０-９٠-٩۰-۹०-९๐-๙]|[一二两三四五六七八九十百千万]/;

// Always full-agent territory — deep analysis, projections, searches over history,
// recurring/income/months, referential requests. A hit here skips the classifier
// entirely (the message was escalating anyway; don't pay the toll).
const SKIP_RE = new RegExp(
  [
    // analysis / projections / comparisons
    "为什么", "什么时候", "多久", "分析", "比较", "对比", "统计", "平均", "预算", "目标", "存到", "存款", "建议",
    "why", "how long", "analy[sz]", "compare", "average", "project", "breakdown", "summar", "budget",
    "\\bgoal\\b", "suggest", "recommend", "advice", "\\btrend", "overspen",
    // Genuine ambiguity that needs REAL conversation context to resolve (need the
    // full agent). NOTE (2026-07-14): "之前/上次/previous/last time" were REMOVED —
    // "修改之前买的吹风机" is now a perfectly good edit_search job for Haiku. Read-only
    // search words ("搜索/查一下/find/list/biggest"…) were ALSO removed — those are now
    // the search_query intent's job (see SEARCH_Q_RE below, which explicitly PERMITS
    // them into the classifier instead of this list blocking them). "哪一笔/哪笔" stays
    // here: "which one did I mean" typically references EARLIER conversation turns
    // this stateless fast-path can't see — genuinely needs the full agent's history.
    "哪一笔", "哪笔",
    // recurring / income / months — always the full agent's territory
    "recurring", "subscription", "订阅", "每个月", "每月", "月租", "房租", "租金", "\\brent\\b",
    "salary", "工资", "薪水", "bonus", "奖金", "income", "收入",
    "reopen", "重新打开", "关账", "close .{0,12}month",
  ].join("|"),
  "i",
);

// (TOTAL_Q_RE / SEARCH_Q_RE removed 2026-07-17 — the gate is default-classifier now,
// so total/search questions no longer need an explicit permit list to get in.)

// Amend/delete phrasing about the just-logged expense — only meaningful when the
// session actually HAS a last-logged expense to point at.
const AMEND_RE = new RegExp(
  [
    "改成", "改到", "改为", "修改", "改一下", "换成", "删掉", "删除", "不对", "错了", "记错",
    "\\bchange\\b", "\\bupdate\\b", "\\bedit\\b", "\\bfix\\b", "\\bwrong\\b", "\\bdelete\\b",
    "\\bremove\\b", "\\bundo\\b", "\\bcancel\\b", "取消",
    // Multilingual amend/delete verbs (multilingual sweep, 2026-07-14): without these,
    // "tukar jadi 15"-style amends-with-number in EVERY non-CN/EN language passed
    // looksLikeSimpleLog and mini raised a wrong CREATE card. This list covers the
    // tested top languages (Layer 1); the mini prompt's "not a log → empty array"
    // self-screen (Layer 2) covers the long tail. False hits only cost the Haiku toll
    // (escalation is the safe direction) — Haiku classified all 16/16 world amends.
    // NOTE: \b only works next to ASCII word chars — accented/CJK starts use plain
    // substrings deliberately.
    "\\btukar", "\\bubah\\b", "\\bpadam", "\\bhapus", "\\bbuang\\b", "\\bganti\\b", "\\bbatal",
    "\\bbetulkan", "\\bsalah\\b", // Malay/Indonesian
    "c[aá]mbi", "\\bborra", "\\belimina", "corrige", // Spanish (+corrige covers French)
    "änder", "lösch", "korrigier", // German
    "\\bsupprim", "\\bmodifi", // French
    "muda para", "\\bmudar\\b", "\\bmude\\b", "\\bapag", "\\bexclui", // Portuguese
    "変更", "直して", "修正", "削除", "消して", "取り消", // Japanese
    "바꿔", "수정", "삭제", "지워", // Korean
    "เปลี่ยน", "แก้ไข", "ลบ", // Thai
    "đổi thành", "\\bsửa", "xóa", "xoá", // Vietnamese
    "غير", "غيّر", "احذف", "امسح", "عدل", "عدّل", // Arabic
    "измени", "поменя", "удали", "исправ", // Russian
    "மாற்று", "நீக்கு", "திருத்து", // Tamil (SG official language)
    "बदल", "हटा", "मिटा", "ठीक कर", "कर दो", "बना दो", // Hindi
  ].join("|"),
  "i",
);

/** Zero-cost routing decision: should this message be shown to the classifier at
 *  all? Exported for the smoke test. false = straight to the full agent.
 *
 *  CHANGED (2026-07-17, user direction): DEFAULT-CLASSIFIER, no longer default-deny.
 *  Only SKIP_RE (analysis/projections/recurring/income — near-certain Sonnet work)
 *  still skips the toll. EVERYTHING else goes through Haiku first, because the
 *  classifier now handles the cheap-reply cases the old deny-path silently sent to
 *  Sonnet: off-topic chatter ("今天天气怎么样"), unsupported-feature asks ("导出
 *  Excel"), investment questions, and missing-detail clarifies ("log something for
 *  lunch"). Worst case a genuine Sonnet message pays one extra ~$0.003 Haiku call; every
 *  intercepted small-talk message SAVES a 1-4¢ Sonnet turn — the user's explicit
 *  trade ("很害怕 user 一直问废话…跑 sonnet 很浪费"). */
export function fastPathGate(message: string): boolean {
  return !SKIP_RE.test(message);
}

// ── arch-B gate: is this a SIMPLE log (one or several) for the cheap mini tier? ──
// The mini model owns the slice it's proven clean on. This gate escalates — sends the
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
    // Multilingual question/referential words (Layer 1 for the tested top languages;
    // the mini self-screen covers the rest). Over-escalation is the safe direction.
    "berapa", "kenapa", "mengapa", "\\btadi\\b", // Malay/Indonesian ("tadi" = just now, referential)
    "combien", "pourquoi", // French
    "cu[aá]nto", "por qué", // Spanish
    "\\bquanto", "\\bquanta", "por que", "porqu[eê]", // Portuguese
  ].join("|"),
  "i",
);

/** Deterministic decision: is `message` a plausible simple expense log (one or
 *  several) that the mini model can safely extract? Exported for the smoke test.
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
    "If an amount is missing → use intent='other' with `clarify` asking for it, NOT 'log' with a " +
    "guessed/missing amount.\n" +
    "• amend_last — correct the LAST-LOGGED expense (shown in context) ONLY when the message refers to " +
    "it WITHOUT naming a specific item/merchant/date to locate a row: 'make it 15', '改成15块', 'wrong, " +
    "it was lunch not shopping', 'add tag work'. Extract just the fields being CHANGED into `amend`. " +
    "⚠️ If the message names a specific item, merchant, or date to identify WHICH expense — EVEN IF it " +
    "could be the last one (e.g. '把7月14号的下午茶改成100' when the last log was '套套') — do NOT use " +
    "amend_last; use edit_search. No last-logged context → edit_search or other. If they clearly want to " +
    "change the last-logged expense but DON'T say what the new value should be ('it's wrong', 'fix it') " +
    "→ use intent='other' with `clarify` asking what it should be instead, NOT amend_last with an empty " +
    "`amend`.\n" +
    "• edit_search — EDIT an EXISTING expense the user pinpoints by DESCRIPTION (item/merchant + date " +
    "and/or category), not the just-logged one: '把7月14号的下午茶改成100', 'change the Netflix charge " +
    "to 19', '7月13号的手表改成80'. Put the locating criteria in `search` (keyword/date/category) and " +
    "the new values in `amend`. This is the RIGHT intent for 'modify the <thing> on <date>'. If they " +
    "name WHICH expense but not the new value → other + clarify instead (same rule as amend_last).\n" +
    "• delete_last — delete/undo the LAST-LOGGED expense, same 'no locating description' rule as " +
    "amend_last. If they name a specific item/date to find → delete_search.\n" +
    "• delete_search — DELETE an EXISTING expense pinpointed by description: '删除7月13号的手表', " +
    "'remove the Netflix charge', 'delete my taxi on the 5th'. Put the locating criteria in `search`.\n" +
    "• total_query — a simple 'how much did I spend' question: total spend, optionally ONE category, " +
    "for today / this week / this month / last month ONLY. Anything else (other periods, comparisons, " +
    "why-questions, per-day averages, budgets) → other.\n" +
    "• search_query — a READ-ONLY request to LIST/FIND expenses matching criteria, or to find the SINGLE " +
    "biggest/smallest one in a period or on a day: '查一下我这个月买的鞋子', 'find my Netflix charges', " +
    "'七月十三号最贵的一笔是什么', '这个月最便宜的一笔'. Put criteria in `search`: keyword/category + " +
    "EITHER `date` (a specific day) OR `period` (today/this_week/this_month/last_month) — never both. " +
    "`sort`='amount_desc' for biggest/most-expensive, 'amount_asc' for smallest/cheapest, omit for a plain " +
    "list (newest-first). `limit`=1 for a single biggest/smallest question, omit for a general list. Only " +
    "for sorting/filtering — if the user ALSO wants to change/delete something → edit_search/delete_search " +
    "instead; if it needs REASONING beyond sort/filter (why/compare/average/trend/budget), or a date RANGE " +
    "you can't express as one period, → other.\n" +
    "• out_of_scope — the ENTIRE message is something Honey deliberately doesn't do, in any language:\n" +
    "  (a) unsupported_feature — an app feature that doesn't exist yet: exporting files/Excel/CSV, " +
    "connecting banks or cards, receipts/photos, reminders/notifications, bill-splitting, sharing, " +
    "changing app settings;\n" +
    "  (b) investment — stock picks, crypto, 'what should I invest in';\n" +
    "  (c) off_topic — no finance angle at all: weather, news, homework, poems, coding, translations, " +
    "general chit-chat.\n" +
    "  Fill `oos` with the type and a short warm reply in the user's OWN language. ⚠️ Only when the WHOLE " +
    "message is out of scope — if ANY part is a real expense/income request, use that intent (or other).\n" +
    "• other — EVERYTHING else: analysis, projections, recurring rules, income, months, questions needing " +
    "history/reasoning, multi-intent messages (e.g. a log PLUS a question), a target spanning an arbitrary " +
    "RANGE of days, or ANY doubt. When in doubt, always choose other.",
  input_schema: {
    type: "object",
    properties: {
      intent: {
        type: "string",
        enum: ["log", "amend_last", "edit_search", "delete_last", "delete_search", "total_query", "search_query", "out_of_scope", "other"],
        description: "The single intent of this message. Choose 'other' on any doubt.",
      },
      lang: {
        type: "string",
        enum: ["en", "zh", "other"],
        description:
          "The language of the user's message: 'en' = English, 'zh' = Chinese, 'other' = ANY other " +
          "language (Malay, Japanese, Korean, French, Thai, Tamil, Arabic, …). Judge from THIS message's " +
          "actual words, not the script alone (e.g. Japanese uses some Chinese characters but is 'other', " +
          "not 'zh'). Always set this.",
      },
      oos: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["unsupported_feature", "investment", "off_topic"],
            description: "Which kind of out-of-scope this is.",
          },
          reply: {
            type: "string",
            description:
              "A short, warm, honest reply in the user's OWN language/script: say Honey can't do that, " +
              "then offer the CLOSEST thing you CAN do (log/edit/search expenses, totals). For off_topic " +
              "you may add ONE light friendly sentence before steering back. NEVER pretend the feature " +
              "exists, never give investment advice, never mention any email address (the system appends " +
              "the feedback contact itself). No dashes (— or ——); use commas and full stops.",
          },
        },
        required: ["type", "reply"],
        additionalProperties: false,
        description: "intent=out_of_scope: the decline/steer-back reply.",
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
        description: "intent=amend_last OR edit_search: ONLY the fields the user wants changed (the NEW values).",
      },
      search: {
        type: "object",
        properties: {
          keyword: {
            type: "string",
            description:
              "The item / merchant / note word that identifies the ONE expense to act on, e.g. " +
              "'下午茶', '手表', 'Netflix', 'taxi'. Copy the user's own word; do NOT translate it.",
          },
          category: {
            type: "string",
            enum: [...WRITABLE_CATEGORIES, "family"],
            description: "Category filter, only if the user named one.",
          },
          date: {
            type: "string",
            description:
              "The specific day YYYY-MM-DD the expense is on, if the message names one (resolve " +
              "yesterday/N-days-ago/day-of-month against today; omit for a weekday reference — use " +
              "lastWeekday). Omit entirely if no day is given.",
          },
          lastWeekday: {
            type: "integer",
            description: "Weekday 0=Sun..6=Sat if the day is a WEEKDAY reference; the system computes the date.",
          },
          period: {
            type: "string",
            enum: ["today", "this_week", "this_month", "last_month"],
            description:
              "intent=search_query ONLY: a period instead of a specific date (e.g. 'this month's " +
              "biggest'). Never set together with date/lastWeekday.",
          },
          sort: {
            type: "string",
            enum: ["date_desc", "amount_desc", "amount_asc"],
            description:
              "intent=search_query ONLY: 'amount_desc' for biggest/most-expensive, 'amount_asc' for " +
              "smallest/cheapest, omit for a plain list (defaults newest-first).",
          },
          limit: {
            type: "integer",
            description:
              "intent=search_query ONLY: how many results to return. Use 1 for a single biggest/smallest " +
              "question. Omit for a general list (defaults to 5, capped at 10).",
          },
        },
        additionalProperties: false,
        description: "intent=edit_search/delete_search/search_query: criteria to locate expense(s).",
      },
      clarify: {
        type: "string",
        description:
          "Whatever you write here is shown to the user AS YOUR ENTIRE REPLY, verbatim. It must be ONLY a " +
          "direct, natural question to the user — NEVER a description of your own routing logic. Never " +
          "write things like 'this has two requests bundled', 'I only see this message not our earlier " +
          "conversation', 'I need to let the full assistant handle this' — that is internal reasoning, not " +
          "something to say to the user, and leaking it looks broken.\n" +
          "⚠️ CHECK FOR MULTI-INTENT FIRST, before considering this field: if the message bundles a " +
          "SECOND distinct request (another action, or a question) alongside the part that's missing a " +
          "detail — e.g. 'log lunch 12 today, and how much have I spent on food this month?' — DO NOT " +
          "SET clarify AT ALL (omit the field entirely from your tool call). Do not explain why; just " +
          "leave it out and choose intent='other'. Silently escalating (with no clarify) lets the full " +
          "assistant handle both parts in one turn — your job here ends the moment you recognize this.\n" +
          "⚠️ ALSO check for a REFERENCE to something said EARLIER in this conversation ('like we just " +
          "discussed', 'the same as before', 'as I mentioned', 'that one from earlier'): you only see " +
          "THIS one message, not the conversation history. DO NOT SET clarify AT ALL here either (omit " +
          "the field) — just choose intent='other' and stop; do not tell the user you can't see the " +
          "history. The full assistant, which DOES have the conversation history, will look it up.\n" +
          "Otherwise (single request, single domain, one small gap): use ONLY together with intent='other', " +
          "and ONLY when the ENTIRE message is CLEARLY about adding, editing, deleting, or searching an " +
          "expense (the right domain for you) but is missing ONE piece of information you'd need to act " +
          "confidently — e.g. a bare amount with no idea what it was for, or 'change it' with no new " +
          "value. Write ONE short, warm question in the user's OWN language/script asking for THAT missing " +
          "piece specifically — never claim anything was done, never guess the missing detail, never " +
          "narrate your own reasoning. Omit this field entirely for anything needing capability you don't " +
          "have (analysis, projections, recurring rules, income, months) or a genuinely unclear request " +
          "type — those escalate silently too. When unsure, omit the field.",
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
    `assistant — your ONLY job is to spot the simpler cases (log / amend-last / edit-search / ` +
    `delete-last / delete-search / simple total / read-only search) and extract them, or bail out (intent ` +
    `'other') so the full assistant, which has the whole conversation, handles it instead. Bias toward ` +
    `'other' on any doubt, ambiguity, missing detail, or a second request bundled in — a wrongly-accepted ` +
    `case here risks silently mis-handling the user's money, which is unacceptable. But 'other' does NOT ` +
    `always mean a silent hand-off: if the ONLY thing missing is one small clarifying detail (see ` +
    `'clarify' below), ask for it yourself — don't make the user wait for the full assistant just to be ` +
    `asked a simple question. Never invent a detail (amount, category, note, date) the user didn't ` +
    `actually say.\n` +
    `DATE RESOLUTION — resolve against today above: '昨天/yesterday' = today−1; '前天' = today−2; ` +
    `'N天前/N days ago' = today−N; '上个月N号/the Nth of last month' = day N of the previous month; ` +
    `put these in the 'date' field as YYYY-MM-DD. But for a WEEKDAY reference ('上个星期五/上礼拜三/` +
    `last Friday'), do NOT compute the date yourself — set the 'lastWeekday' field to the weekday ` +
    `(0=Sunday..6=Saturday) and leave 'date' empty; the system computes the exact day. A month/day ` +
    `without a year is always the CURRENT year.`
  );
}

// ── deterministic reply templates ────────────────────────────
// Warm, friendly tone (user request 2026-07-14) — these are FALLBACKS for the Haiku
// paths + the rare null-mini-reply; the mini tier's own `reply` is already in-language
// and warm. Kept honest: the card is PENDING the user's tap, never "saved/done".

// CHANGED (2026-07-18, user feedback): the CN/EN reply templates picked their
// language via `isCJK` = "has a CJK ideograph". But Japanese KANJI are CJK ideographs
// too, so a Japanese message was wrongly given a Chinese reply. `isChineseMsg`
// excludes Japanese (kana) and Korean (hangul) — Chinese uses the 中文 template, and
// everything NOT Chinese uses the English template (or, better, keeps the model's own
// in-language reply, which is what actually makes non-CN/EN feel native).
const HAS_KANA_RE = /[぀-ゟ゠-ヿ]/;
const HAS_HANGUL_RE = /[가-힣]/;
const isChineseMsg = (s: string) =>
  /[一-鿿]/.test(s) && !HAS_KANA_RE.test(s) && !HAS_HANGUL_RE.test(s);

function fallbackLogReply(userMessage: string, count: number): string {
  if (isChineseMsg(userMessage))
    return count > 1 ? `帮你准备好 ${count} 张卡片啦，麻烦逐张确认一下哦～` : "帮你准备好卡片啦，检查一下再点确认就好～";
  return count > 1
    ? `I've popped ${count} cards below for you — have a quick look and confirm each one 🙂`
    : "I've popped a card below for you — have a quick look and confirm 🙂";
}

function futureDateReply(userMessage: string): string {
  return isChineseMsg(userMessage)
    ? "这个日期还没到哦～ Honey 只能记到今天为止的消费。到那天再记就好，或者如果是每个月固定的，我可以帮你设一个 recurring 😊"
    : "Oops, that date's still in the future 🙂 Honey only records spending up to today — log it on the day, or I can set up a recurring rule if it repeats monthly.";
}

function amendReply(userMessage: string, replaced: boolean): string {
  if (isChineseMsg(userMessage))
    return replaced
      ? "帮你另外准备了一张更正后的卡片啦（旧的那张不用管它，确认这张新的就好）～"
      : "帮你准备好更新卡片啦，改动前后都写在上面了，确认一下就好～";
  return replaced
    ? "I've prepared a fresh corrected card for you — just ignore the earlier one and confirm this new one 🙂"
    : "I've prepared an update card for you (before → after shown) — confirm whenever you're ready 🙂";
}

function deleteReply(userMessage: string): string {
  return isChineseMsg(userMessage)
    ? "删除卡片帮你准备好啦，点了确认才会真的删掉,别担心～"
    : "I've prepared a delete card for you — nothing's removed until you confirm 🙂";
}

function pendingDeleteReply(userMessage: string): string {
  return isChineseMsg(userMessage)
    ? "那笔其实还没保存哦～ 卡片还等着你确认呢,直接按卡片上的 Cancel 就好,不用特地删除～"
    : "That one was never actually saved 🙂 its card is still waiting for you — just tap Cancel on the card, nothing to delete.";
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

  if (isChineseMsg(userMessage)) {
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

// ── edit_search / delete_search: locate ONE existing row by description ───────
// The cheap tier for "把7月14号的下午茶改成100" / "删除7月13号的手表" — the class of
// edit/delete that used to force the full Sonnet agent (find_expenses → update/delete,
// ~5s). The classifier extracts SEARCH CRITERIA only; we resolve the row deterministically
// here (no model guessing which row). SAFETY: we act ONLY on an UNAMBIGUOUS single match —
// 0 matches (incl. a keyword that can't match a cross-language stored note like 巴士 vs
// "bus") or 2+ matches, OR a recurring-generated row (editing one month is usually wrong),
// all fall through to the full agent, which can search harder, ask which one, or steer to
// edit_recurring. A criteria-less search returns [] so we never touch the whole ledger.

interface SearchTarget {
  id: number;
  note: string | null;
  amount: number;
  currency: string;
  category: string;
  date: string; // YYYY-MM-DD — shown in candidate lists so the user can tell rows apart
  recurring: boolean;
}

async function resolveSearchTargets(
  userId: string,
  raw: Record<string, unknown>,
  now: Date,
): Promise<SearchTarget[]> {
  const date = resolveItemDate(raw, now); // handles date + lastWeekday, same as logs
  const catRaw = typeof raw.category === "string" ? raw.category : "";
  const cat = ([...WRITABLE_CATEGORIES, "family"] as string[]).includes(catRaw) ? catRaw : "";
  const kw = typeof raw.keyword === "string" ? raw.keyword.trim() : "";
  // Require at least one narrowing criterion — never match the entire ledger.
  if (!date && !cat && !kw) return [];

  const buildWhere = (withDate: boolean): Record<string, unknown> => {
    const where: Record<string, unknown> = { userId };
    if (withDate && date) {
      const from = new Date(`${date}T00:00:00`);
      const to = new Date(`${date}T23:59:59.999`);
      if (!Number.isNaN(from.getTime())) where.spentAt = { gte: from, lte: to };
    }
    if (cat) where.category = cat;
    if (kw) where.OR = [{ note: { contains: kw, mode: "insensitive" } }, { tags: { has: kw.toLowerCase() } }];
    return where;
  };
  const run = (where: Record<string, unknown>) =>
    prisma.expense.findMany({
      where,
      orderBy: { spentAt: "desc" },
      take: 6, // >1 means we escalate anyway; a small cap is enough to detect "many"
      select: { id: true, note: true, amount: true, currency: true, category: true, spentAt: true, fixed: true, fixedSourceId: true },
    });

  let rows = await run(buildWhere(true));
  // WRONG-DATE-RIGHT-ITEM relaxation (user request): if a keyword+date search finds
  // nothing, the user likely misremembered the date — retry with the KEYWORD but WITHOUT
  // the date. The keyword is the strong identifier and the confirm card shows the actual
  // date, so the user verifies ("found the Jul 5 one — is that it?"). We never drop the
  // keyword itself (that could silently hit an unrelated row). Still 0/many → escalate.
  if (rows.length === 0 && date && kw) rows = await run(buildWhere(false));

  return rows.map((r) => ({
    id: r.id,
    note: r.note,
    amount: Number(r.amount),
    currency: r.currency,
    category: r.category,
    date: fmtYmd(r.spentAt),
    recurring: r.fixed || r.fixedSourceId != null,
  }));
}

// ── search_query: read-only list/find/biggest-smallest, zero-write ────────────
// Same criteria object as edit/delete_search, PLUS period/sort/limit. Reuses
// resolveSearchTargets's query shape but WITHOUT the "≤1 match" restriction (a list
// is expected to return several rows) and adds sort+limit. Deterministic template
// reply — no second AI call to narrate results (same "the AI extracts, code answers"
// pattern as total_query).

interface SearchQueryResult {
  rows: SearchTarget[]; // may contain ONE extra row past `limit` — the truncation probe
  sort: string;
  limit: number; // the CLAMPED limit actually used — callers must reuse this, not re-derive it
}

async function resolveSearchQuery(
  userId: string,
  raw: Record<string, unknown>,
  now: Date,
): Promise<SearchQueryResult> {
  const catRaw = typeof raw.category === "string" ? raw.category : "";
  const cat = ([...WRITABLE_CATEGORIES, "family"] as string[]).includes(catRaw) ? catRaw : "";
  const kw = typeof raw.keyword === "string" ? raw.keyword.trim() : "";
  const period = typeof raw.period === "string" ? periodRange(raw.period, now) : null;
  const date = period ? null : resolveItemDate(raw, now); // period and a specific date are mutually exclusive

  const where: Record<string, unknown> = { userId };
  if (period) where.spentAt = { gte: period.from, lte: period.to };
  else if (date) {
    const from = new Date(`${date}T00:00:00`);
    const to = new Date(`${date}T23:59:59.999`);
    if (!Number.isNaN(from.getTime())) where.spentAt = { gte: from, lte: to };
  }
  if (cat) where.category = cat;
  if (kw) where.OR = [{ note: { contains: kw, mode: "insensitive" } }, { tags: { has: kw.toLowerCase() } }];

  const sort = raw.sort === "amount_desc" || raw.sort === "amount_asc" ? raw.sort : "date_desc";
  const limitRaw = typeof raw.limit === "number" ? Math.round(raw.limit) : 5;
  const limit = Math.min(10, Math.max(1, limitRaw));
  const orderBy =
    sort === "amount_desc"
      ? ({ amount: "desc" } as const)
      : sort === "amount_asc"
        ? ({ amount: "asc" } as const)
        : ({ spentAt: "desc" } as const);

  // Fetch one extra row to detect truncation (`hasMore`) without a second count query.
  const rows = await prisma.expense.findMany({
    where,
    orderBy,
    take: limit + 1,
    select: { id: true, note: true, amount: true, currency: true, category: true, spentAt: true, fixed: true, fixedSourceId: true },
  });
  return {
    rows: rows.map((r) => ({
      id: r.id,
      note: r.note,
      amount: Number(r.amount),
      currency: r.currency,
      category: r.category,
      date: fmtYmd(r.spentAt),
      recurring: r.fixed || r.fixedSourceId != null,
    })),
    sort,
    limit,
  };
}

/** Bilingual reply for search_query — a single biggest/smallest item (limit=1 with an
 *  amount sort) gets the "Your biggest expense was X" phrasing; otherwise a bulleted
 *  list. `rows` may contain ONE extra row past `limit` (the truncation-detection probe
 *  from resolveSearchQuery) — sliced here, never shown, only used to flag "and more". */
function searchQueryReply(userMessage: string, rows: SearchTarget[], sort: string, limit: number): string {
  const cjk = isChineseMsg(userMessage);
  const catLabel = (c: string) => CATEGORY_LABELS[c]?.[cjk ? "zh" : "en"] ?? c;
  const money = (r: SearchTarget) => `${CURRENCY_SYMBOL[r.currency] ?? ""}${r.amount.toFixed(2)}`;
  const hasMore = rows.length > limit;
  const shown = hasMore ? rows.slice(0, limit) : rows;

  if (shown.length === 0) {
    return cjk ? "没有找到符合条件的消费记录。" : "No matching expenses found.";
  }
  if (limit === 1 && (sort === "amount_desc" || sort === "amount_asc")) {
    const r = shown[0];
    const label = sort === "amount_desc" ? (cjk ? "最贵的一笔" : "biggest expense") : cjk ? "最便宜的一笔" : "smallest expense";
    return cjk
      ? `${r.date} ${label}是 ${money(r)} 的「${r.note || catLabel(r.category)}」（${catLabel(r.category)}）。`
      : `Your ${label} on ${r.date} was ${money(r)} · ${r.note || catLabel(r.category)} (${catLabel(r.category)}).`;
  }
  const lines = shown.map((r) => `- ${r.date} · ${money(r)} · ${catLabel(r.category)}${r.note ? ` · ${r.note}` : ""}`);
  const header = cjk
    ? `找到 ${shown.length}${hasMore ? "+" : ""} 笔符合条件的消费：`
    : `Found ${shown.length}${hasMore ? "+" : ""} matching expense${shown.length > 1 ? "s" : ""}:`;
  const more = hasMore ? (cjk ? "\n（还有更多，可以说得更具体一点缩小范围哦～）" : "\n(there are more — try narrowing your question for the full list)") : "";
  return `${header}\n${lines.join("\n")}${more}`;
}

/** Bilingual "which one did you mean?" reply for a 2+-match edit_search/delete_search —
 *  built from the SAME candidate rows we already fetched, so this costs zero extra AI. */
function ambiguousCandidatesReply(userMessage: string, targets: SearchTarget[], action: "edit" | "delete"): string {
  const cjk = isChineseMsg(userMessage);
  const catLabel = (c: string) => CATEGORY_LABELS[c]?.[cjk ? "zh" : "en"] ?? c;
  const money = (r: SearchTarget) => `${CURRENCY_SYMBOL[r.currency] ?? ""}${r.amount.toFixed(2)}`;
  const lines = targets.map((r) => `- ${r.date} · ${money(r)} · ${catLabel(r.category)}${r.note ? ` · ${r.note}` : ""}`);
  if (cjk) {
    const verb = action === "edit" ? "改" : "删";
    return `找到好几笔符合的消费，不确定你要${verb}哪一笔哦～ 麻烦说清楚一点（比如金额或更完整的名字）：\n${lines.join("\n")}`;
  }
  const verb = action === "edit" ? "edit" : "delete";
  return `I found a few matching expenses — not sure which one you mean to ${verb}. Could you be a bit more specific (amount or a fuller name)?\n${lines.join("\n")}`;
}

// Deterministic backstop (2026-07-17): the prompt asks the model to OMIT `clarify`
// for multi-intent/referential messages, but real-API testing caught it instead
// narrating its own routing logic AS the clarify text ("this has two requests
// bundled…", "I only see this message, not our earlier conversation…") — the exact
// "internal reasoning leaks into user-visible text" failure class this codebase has
// hit before (e.g. the card-outcome-annotation leak in engine.ts). Same fix
// philosophy: the prompt reduces it, this regex is the actual guarantee. A hit here
// means DON'T trust the model's clarify — fall through to a true silent escalate.
const META_LEAK_RE =
  /\bfull assistant\b|\bearlier conversation\b|\bour conversation\b|\btwo requests\b|\bbundled\b|\bI only see this message\b|\bmy own\b.{0,20}\blogic\b|完整助手|之前的对话|我们的对话|两个请求|捆绑/i;

/** Generic bilingual clarify fallback — used when the model's own `clarify` text comes
 *  back in the wrong language (same CJK-mismatch guard philosophy as the mini reply). */
function genericClarifyReply(userMessage: string): string {
  return isChineseMsg(userMessage)
    ? "不好意思，我没太明白～ 可以再说清楚一点吗？"
    : "Sorry, I didn't quite catch that. Could you tell me a bit more?";
}

// ── out_of_scope replies (2026-07-17) ────────────────────────
// The 三件套 declines now answered by HAIKU instead of Sonnet (user: small-talk spam
// must not burn Sonnet money for what is just a friendly no). engine.ts keeps its
// OUT OF SCOPE section as the backstop for whatever still reaches the full agent.

/** Plain-text email — the chat renderer auto-links it as mailto (user request). */
const FEEDBACK_EMAIL = "jeremypoh0205@gmail.com";

/** Bilingual fallbacks when the model's own oos reply fails the language guard. */
function oosFallbackReply(type: string, userMessage: string): string {
  const cjk = isChineseMsg(userMessage);
  if (type === "investment") {
    return cjk
      ? "投资建议这个我帮不上忙哦,Honey 专注帮你管好消费、收入和储蓄。想看看你的储蓄进度吗?"
      : "Investment advice is outside what I do. Honey focuses on your spending, income and savings. Want a look at your savings progress instead?";
  }
  if (type === "unsupported_feature") {
    return cjk
      ? "这个功能 Honey 暂时还没有哦。不过记账、修改、查询这些我都能马上帮你做!"
      : "Honey doesn't have that feature yet. I can still log, edit and search your expenses for you anytime though!";
  }
  return cjk
    ? "这个我就帮不上啦,我是 Honey 的记账助手。想记一笔,或者看看最近的花销吗?"
    : "That one's outside my lane, I'm Honey's expense assistant. Want to log something, or check your recent spending?";
}

// ── the router ───────────────────────────────────────────────

export interface FastPathResult {
  reply: string;
  /** Confirm cards to render (0 = a text-only reply, e.g. future-date decline). */
  proposals: Proposal[];
  /** For the UI's tool chips — mirrors what the full agent would have reported. */
  toolsUsed: string[];
  /** Which text-only mechanism produced this (observability + smoke labeling only —
   *  the UI ignores it). Set for clarify / out_of_scope replies. */
  handled?: "clarify" | "out_of_scope";
}

const mintId = (now: Date) => `fp_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// ── arch-B mini tier: cheap extract-only model for simple expense logs ────

// gpt-5.4-mini (multilingual round, 2026-07-14) — swapped from gpt-4o-mini after
// scripts/multilingual-sweep.ts: 4o-mini failed real MS/ID cases (mapped Malay
// "isnin" to Sunday, contaminated tags with Chinese "makan外", hallucinated MYR on
// an Indonesian log) while 5.4-mini scored 16/16 across MS/ID/FR/PT/CN/EN. Measured
// ~$0.00075/call — ~6.5x 4o-mini but still ~4.4x cheaper than the Haiku classifier;
// the absolute delta (~$0.40/mo for a HEAVY logger) buys correct any-language
// extraction. gpt-5.4-nano REJECTED: pricier than 4o-mini ($0.20/$1.25 per MTok)
// AND failed even the English control case.
const MINI_MODEL = "gpt-5.4-mini";

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
  return isChineseMsg(userMessage)
    ? `哇，这条有点多啦～我一次最多帮你记 ${MAX_LOG_ITEMS} 笔。先存好这些，或者分两次发给我好吗？😊`
    : `That's a lot at once — I can prepare up to ${MAX_LOG_ITEMS} in one go. Could you split it into a couple of messages?`;
}

// Extract-only prompt — NO self-triage (round 4a showed mini's self-escalation is
// jumpy, especially in Chinese). The deterministic gate + post-check do the routing;
// mini only does what it's proven good at: pull the fields out of the message. The
// note-vs-tags wording is load-bearing — without it mini jams the meal type (晚餐/
// 午餐) into note and drops the real item + the requested tag (real user bug, fixed
// and verified in scripts/mini-extract-tune.ts, 6/6).
// Exported for scripts/multilingual-sweep.ts (tests the REAL prompt, no copy-drift).
export function miniExtractPrompt(now: Date): string {
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
    `ONLY log NEW spending stated in THIS message. If the message is instead EDITING/correcting/` +
    `deleting/cancelling an earlier expense ("change it to 15", "tukar jadi 15", "15に変更して"), ` +
    `asking a question, or anything other than logging new spending — in ANY language — return an ` +
    `EMPTY expenses array. Do not guess.\n` +
    `Also set reply: ONE short sentence telling them you've prepared the card(s) for them to review ` +
    `and confirm — NEVER say anything is already saved/recorded. reply MUST be written in the language ` +
    `and script of the USER'S OWN message — an English message gets an English reply, a Tamil message a ` +
    `Tamil reply. Do NOT reply in Chinese unless the user themselves wrote Chinese (the Chinese phrases ` +
    `in these instructions are currency examples, not the user's language). No long dashes (—— or —); ` +
    `use commas. If expenses is empty, set reply to null.\n` +
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

// Exported for scripts/multilingual-sweep.ts (tests the REAL schema, no copy-drift).
// `reply` (multilingual round): a one-line confirmation in the USER'S language —
// replaces the hardcoded CN/EN fallbackLogReply for every other language. `expenses`
// empty = the model's own "this isn't a new-expense log" signal (Layer 2 of the
// misroute defense) — the <1-item post-check turns it into a classifier fall-through.
export const MINI_TOOL_PARAMS = {
  type: "object",
  properties: {
    expenses: { type: "array", items: MINI_ITEM_SCHEMA },
    reply: {
      type: ["string", "null"],
      description:
        "One short sentence in the SAME language/script as the user's message saying the card(s) " +
        "are prepared for review — never claim anything is saved. null if expenses is empty.",
    },
  },
  required: ["expenses", "reply"],
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
  let modelReply: string | null = null;
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
    const parsed = (args ? JSON.parse(args) : {}) as { expenses?: unknown; reply?: unknown };
    items = Array.isArray(parsed.expenses) ? (parsed.expenses as Record<string, unknown>[]) : [];
    modelReply = typeof parsed.reply === "string" && parsed.reply.trim() ? parsed.reply.trim() : null;
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
  // Deterministic reply-language guard (same philosophy as the chat's nav-label
  // guardrail: the prompt asks, the code guarantees). The sweep showed the model
  // sometimes answers in Chinese for non-Chinese messages (prompt contamination) —
  // on a CJK mismatch in either direction, prefer the bilingual template over a
  // wrong-language sentence.
  const replyLangOk = modelReply !== null && isChineseMsg(modelReply) === isChineseMsg(userMessage);
  return {
    reply: replyLangOk && modelReply ? modelReply : fallbackLogReply(userMessage, proposals.length),
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
  if (!fastPathGate(userMessage)) return null;

  // CHEAPEST TIER (arch B): one or several simple new expense logs → the mini model
  // (extract-only), ~4x cheaper than the classifier.
  //
  // ROUTING (2026-07-14, user's design): a clean new log goes to mini REGARDLESS of
  // whether a card is still pending. The old code skipped mini whenever a card was
  // pending — the theory being a follow-up might be amending that card — but that
  // sent every "add this, add that" to the pricier Haiku tier just because the user
  // hadn't tapped Confirm yet (the user's real complaint: batch-logging all hit Haiku).
  // The correct signal is AMEND INTENT, not pending-card existence: `looksLikeSimpleLog`
  // already returns false for any amend/delete/question/referential phrasing (in 12+
  // languages), so a genuine "change it to 15" never reaches mini anyway — it drops to
  // the context-aware classifier. A bare value with no change-word ("100块") reads as a
  // NEW log by the user's own rule ("没说改就是新增"), and mini's own self-screen +
  // the confirm card are the backstops. Any miss (gate/no-key/error/bad-count/dup)
  // falls through to the classifier.
  if (looksLikeSimpleLog(userMessage)) {
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

    // ── edit_search: locate ONE existing expense by description, then update ──
    if (intent === "edit_search") {
      const changes = { ...((input.amend ?? {}) as Record<string, unknown>) };
      if (Object.keys(changes).length === 0) return null; // no new value stated → full agent
      if ("lastWeekday" in changes) {
        const resolved = resolveItemDate(changes, now);
        delete changes.lastWeekday;
        if (resolved) changes.date = resolved;
      }
      const targets = await resolveSearchTargets(userId, (input.search ?? {}) as Record<string, unknown>, now);
      // 0 matches → the full agent can search harder (fuzzier keyword, broader query).
      if (targets.length === 0) return null;
      // 2+ matches → ask which one CHEAPLY from the candidates we already have (no
      // extra AI call, no Sonnet) instead of escalating just to have Sonnet ask the
      // same question with its own tools.
      if (targets.length > 1) {
        return { reply: ambiguousCandidatesReply(userMessage, targets, "edit"), proposals: [], toolsUsed: ["find_expenses"] };
      }
      // Exactly 1 match, but recurring-generated → full agent (steers to edit_recurring).
      if (targets[0].recurring) return null;
      const result = await proposeUpdateExpense(userId, { id: targets[0].id, ...changes });
      if ("error" in result) return null;
      return {
        reply: amendReply(userMessage, false),
        proposals: [{ ...result.proposal, id: mintId(now) }],
        toolsUsed: ["find_expenses", "update_expense"],
      };
    }

    // ── delete_search: locate ONE existing expense by description, then delete ──
    if (intent === "delete_search") {
      const targets = await resolveSearchTargets(userId, (input.search ?? {}) as Record<string, unknown>, now);
      if (targets.length === 0) return null;
      if (targets.length > 1) {
        return { reply: ambiguousCandidatesReply(userMessage, targets, "delete"), proposals: [], toolsUsed: ["find_expenses"] };
      }
      if (targets[0].recurring) return null;
      const result = await proposeDeleteExpense(userId, { id: targets[0].id });
      if ("error" in result) return null;
      return {
        reply: deleteReply(userMessage),
        proposals: [{ ...result.proposal, id: mintId(now) }],
        toolsUsed: ["find_expenses", "delete_expense"],
      };
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

    // total_query / search_query are answered by a DETERMINISTIC bilingual (CN/EN)
    // TEMPLATE — zero AI narration, but only two languages. For ANY other language
    // (Malay, Japanese, French, Thai…), a hardcoded template can't follow the user's
    // language, so we ESCALATE to the full Sonnet agent, which computes the numbers
    // AND phrases the answer natively in that language (this is the fix for "French
    // question → English answer" / "Japanese → Chinese"). Detected from the
    // classifier's own `lang` field (reliable), so we don't hardcode per-language
    // templates — CN/EN stay cheap, everything else gets a correct-language answer.
    const isOtherLang = input.lang === "other";

    // ── total_query: deterministic aggregate + template (CN/EN only) ──
    if (intent === "total_query") {
      if (isOtherLang) return null; // non-CN/EN → Sonnet answers in the user's language
      const t = (input.total ?? {}) as Record<string, unknown>;
      if (typeof t.category !== "string" || typeof t.period !== "string") return null;
      const reply = await answerSimpleTotal(userId, userMessage, t.category, t.period, now);
      if (!reply) return null;
      return { reply, proposals: [], toolsUsed: ["analyze_spending"] };
    }

    // ── search_query: read-only list/find/biggest-smallest — zero-write, templated (CN/EN only) ──
    if (intent === "search_query") {
      if (isOtherLang) return null; // non-CN/EN → Sonnet
      const s = (input.search ?? {}) as Record<string, unknown>;
      const { rows, sort, limit } = await resolveSearchQuery(userId, s, now);
      return { reply: searchQueryReply(userMessage, rows, sort, limit), proposals: [], toolsUsed: ["find_expenses"] };
    }

    // ── out_of_scope: unsupported feature / investment advice / off-topic chatter —
    // answered by HAIKU directly (2026-07-17). This used to fall to Sonnet via
    // engine.ts's OUT OF SCOPE section (which stays as the backstop for whatever the
    // classifier still marks 'other'): the user's worry was small-talk spam burning
    // 1-4¢ Sonnet turns for what is just a friendly decline. Language guard as
    // always; the feedback email is appended by CODE (never model-written) and the
    // chat renderer turns it into a mailto link.
    if (intent === "out_of_scope") {
      const o = (input.oos ?? {}) as Record<string, unknown>;
      const type = typeof o.type === "string" ? o.type : "off_topic";
      const model = typeof o.reply === "string" && o.reply.trim() ? o.reply.trim() : null;
      const langOk = model !== null && isChineseMsg(model) === isChineseMsg(userMessage);
      let reply = langOk && model ? model : oosFallbackReply(type, userMessage);
      if (type === "unsupported_feature") {
        reply += isChineseMsg(userMessage)
          ? `\n\n📮 如果这个功能对你很重要,欢迎写信到 ${FEEDBACK_EMAIL} 告诉我们,会认真考虑的!`
          : `\n\n📮 If this feature matters to you, drop a note to ${FEEDBACK_EMAIL} and we'll seriously consider it!`;
      }
      return { reply, proposals: [], toolsUsed: [], handled: "out_of_scope" };
    }

    // ── other: usually a silent escalate, but a `clarify` question means the
    // classifier judged this is squarely our domain (log/edit/delete/search) minus
    // ONE missing detail — answer it directly instead of paying for a Sonnet turn
    // just to ask the same question. Same CJK-mismatch guard as the mini reply: a
    // clarify string in the wrong language falls back to a generic bilingual ask
    // rather than trusting possibly-contaminated model text.
    if (typeof input.clarify === "string" && input.clarify.trim()) {
      const clarify = input.clarify.trim();
      // Meta-leak backstop takes priority over the language guard — a leaked
      // explanation is never safe to show, in any language.
      if (META_LEAK_RE.test(clarify)) return null; // true escalate — let Sonnet handle it
      const reply = isChineseMsg(clarify) === isChineseMsg(userMessage) ? clarify : genericClarifyReply(userMessage);
      return { reply, proposals: [], toolsUsed: [], handled: "clarify" };
    }

    return null; // intent 'other' with no clarify (or anything malformed) → full agent
  } catch {
    return null;
  } finally {
    if (usage) await logAiUsage(userId, "assistant_fast_path", FAST_PATH_MODEL, usage).catch(() => {});
  }
}
