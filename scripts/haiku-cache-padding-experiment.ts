// ADDED (cost optimization — Haiku cache-floor experiment, NOT wired into
// production): the 3-way comparison found Haiku 4.5 matches Sonnet 5's accuracy
// on this classify task, but never got cheaper — every single call showed
// cacheR:0 cacheW:0, because Anthropic's minimum cacheable prefix is MODEL-TIERED
// (Opus 4.5+/4.6/4.7/4.8 AND Haiku 4.5 = 4096 tokens; Sonnet 5 empirically caches
// well under that). Our classify prompt (~1800 tokens) permanently sits below
// Haiku's floor — its cache can never activate at that size, no matter how often
// it's called.
//
// This experiment tests the user's own idea: pad the prompt with genuinely useful
// content (expanded worked examples + category/currency glossaries — not filler)
// to clear 4096 tokens, and measure REAL warm-vs-cold economics against Sonnet's
// real numbers from the 3-way run. Answers: "if we unlock Haiku's cache, does it
// actually end up cheaper for this tier (edit/delete/search-by-search)?"
//
//   npx tsx scripts/haiku-cache-padding-experiment.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import type Anthropic from "@anthropic-ai/sdk";

const WRITABLE_CATEGORIES = ["food", "shop", "ent", "trans", "health", "bills", "other"];
const CURRENCIES = ["SGD", "MYR", "CNY", "USD"];

// Same task schema as model-compare-classify.ts's edit_search/delete_search/search_query
// slice — the tier the user wants to move to Haiku.
// FULL 8-intent schema (matches model-compare-classify.ts exactly) — unifying
// the whole fast-path tier onto one padded-Haiku classifier, not just
// edit/delete/search, so the 21-case accuracy battery can be re-run verbatim.
const ROUTE_PARAMETERS = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: ["log", "amend_last", "delete_last", "edit_search", "delete_search", "search_query", "total_query", "other"],
      description:
        "log: 1-3 brand-new self-contained expenses. amend_last/delete_last: refers to the " +
        "LAST-LOGGED expense given as context. edit_search/delete_search: refers to some OTHER " +
        "past expense described by keyword/category/date, WITH an intent to change/remove it — " +
        "extract ONLY the search criteria. search_query: a READ-ONLY list/find/count request, no " +
        "edit or delete intent. total_query: a simple spend TOTAL for today/this_week/this_month/" +
        "last_month, optionally one category — use search_query instead for a LIST or a period/" +
        "filter that doesn't fit those four buckets. other: anything else. When in doubt, 'other'.",
    },
    expenses: {
      type: "array",
      description: "intent=log: each expense, complete on its own.",
      items: {
        type: "object",
        properties: {
          amount: { type: "number" },
          category: { type: "string", enum: WRITABLE_CATEGORIES },
          currency: { type: "string", enum: CURRENCIES },
          note: { type: "string" },
          date: { type: "string", description: "YYYY-MM-DD, resolved against today. Omit for today." },
        },
        required: ["amount", "category"],
      },
    },
    amend: {
      type: "object",
      description: "intent=amend_last or edit_search: ONLY the fields being changed.",
      properties: {
        amount: { type: "number" },
        category: { type: "string", enum: WRITABLE_CATEGORIES },
        currency: { type: "string", enum: CURRENCIES },
        note: { type: "string" },
        date: { type: "string" },
      },
    },
    search: {
      type: "object",
      description: "Identifying/filter details actually given — omit anything not mentioned.",
      properties: {
        keyword: { type: "string" },
        category: { type: "string", enum: [...WRITABLE_CATEGORIES, "family"] },
        dateFrom: { type: "string" },
        dateTo: { type: "string" },
        minAmount: { type: "number" },
        maxAmount: { type: "number" },
      },
    },
    total: {
      type: "object",
      description: "intent=total_query.",
      properties: {
        category: { type: "string", enum: [...WRITABLE_CATEGORIES, "all"] },
        period: { type: "string", enum: ["today", "this_week", "this_month", "last_month"] },
      },
    },
  },
  required: ["intent"],
  additionalProperties: false,
} as const;

// ── the padded prompt: genuinely useful content, not junk filler ──
// Real production value if this tier ever moves to Haiku: explicit glossaries +
// worked examples are a legitimate way to help a smaller model, independent of
// the token-floor motivation. Measured length printed at runtime — adjust the
// worked-example count here (not with junk text) if it lands short of 4096.

const CATEGORY_GLOSSARY = `
CATEGORY GLOSSARY — map these example terms to the correct category. This list is
illustrative, not exhaustive; use judgment for terms not listed.
- food: 吃饭/午餐/晚餐/早餐/宵夜/咖啡/奶茶/鸡饭/云吞面/火锅/烧烤/hawker/kopitiam/restaurant/cafe/
  lunch/dinner/breakfast/supper/coffee/bubble tea/fried rice/noodles/makan/nasi lemak/roti.
- shop: 购物/网购/买/衣服/鞋子/手表/手机/电器/化妆品/日用品/shopee/lazada/taobao/shopping/
  clothes/shoes/watch/phone/electronics/cosmetics/groceries-as-goods/toiletries/gadget.
- ent: 娱乐/电影/游戏/KTV/演唱会/门票/movie/game/concert/karaoke/streaming subscription/netflix.
- trans: 交通/巴士/地铁/德士/打车/停车/油钱/bus/mrt/train/taxi/grab/uber/parking/petrol/toll.
- health: 医药/看医生/药物/健身房/保健品/doctor/clinic/pharmacy/medicine/gym/supplement.
- bills: 水电费/网费/电话费/房租/utilities/wifi/phone bill/rent/insurance/subscription-bill.
- family: 家用/给父母/家庭开支 (recurring rules only — plain expense create/edit never uses this).
- other: anything that doesn't clearly fit above — don't force a fit.

CURRENCY GLOSSARY:
- SGD: 新币/坡币/新加坡元/S$ (the app's default when no country word is given).
- MYR: 令吉/马币/ringgit/RM.
- CNY: 人民币/RMB/¥ (only when the user explicitly signals mainland China, e.g. "人民币" or "RMB" —
  bare 块/元 in a Singapore/Malaysia context defaults to SGD, never assume CNY from 块 alone).
- USD: US$/美元/dollars (when explicitly US-denominated).
`;

const WORKED_EXAMPLES = `
WORKED EXAMPLES (study the reasoning, not just the output):

Example 1 — edit_search, Chinese, unique keyword.
User: "把手表那笔改成60块"
Reasoning: "手表" (watch) is a specific, identifying keyword for a PAST expense — not the
last-logged one (no such context given here), so this is edit_search, not amend_last. "改成60块"
means the amount changes to 60. No category/date/currency mentioned — omit them.
Output: {intent:"edit_search", search:{keyword:"手表"}, amend:{amount:60}}

Example 2 — delete_search, Chinese, date + category (deliberately NO keyword — over-narrowing
with an invented keyword is a common mistake).
User: "帮我删除7月13日的吃饭记录"
Reasoning: "吃饭" here describes a CATEGORY (food/dining), not a literal note keyword — extracting
it as a keyword would search for the literal characters "吃饭" in the note field and likely miss
real rows whose notes are things like "午餐" or "hawker centre" that never literally contain "吃饭".
The correct extraction is category="food" + the date, with NO keyword field at all.
Output: {intent:"delete_search", search:{category:"food", dateFrom:"2026-07-13", dateTo:"2026-07-13"}}

Example 3 — edit_search, English, unique keyword, no category guess.
User: "change the ShopeeFood fan purchase to 90"
Reasoning: "ShopeeFood fan purchase" is a distinctive keyword combination. Do NOT guess a category
(e.g. "shop" or "other") unless the user's words map cleanly to the glossary above with confidence —
an incorrect category can silently exclude the real match from the deterministic search that runs
afterward. When in doubt, extract the keyword ONLY and leave category out.
Output: {intent:"edit_search", search:{keyword:"ShopeeFood"}, amend:{amount:90}}

Example 4 — search_query, English, amount filter, no category guess.
User: "find my July expenses that are 100 dollars or more"
Reasoning: This is a read-only "find/list" request — no edit or delete intent — so intent is
search_query. The user gave a date range (all of July) and a lower amount bound (100). They did
NOT mention any category — inventing one (e.g. defaulting to "other") would wrongly exclude real
matches in food/shop/trans/etc. Leave category out entirely.
Output: {intent:"search_query", search:{dateFrom:"2026-07-01", dateTo:"2026-07-31", minAmount:100}}

Example 5 — search_query, Chinese, single date + category, no keyword invented.
User: "帮我找到7月1日的购物消费记录"
Reasoning: "购物" maps to category="shop" via the glossary above. The date is a single day, so
dateFrom and dateTo are both "2026-07-01". No specific merchant/note keyword was given — do not
invent one just to narrow the query further; a plain category+date filter is exactly what was asked.
Output: {intent:"search_query", search:{category:"shop", dateFrom:"2026-07-01", dateTo:"2026-07-01"}}

Example 6 — other, too vague to search safely.
User: "帮我找一下我的消费记录"
Reasoning: no keyword, no category, no date, no amount — there is nothing to narrow the search by.
Returning an empty-criteria search_query would effectively mean "list everything", which is not
what a narrow pre-filter should decide on its own — escalate to the full assistant instead, which
can ask a clarifying question with real conversation context.
Output: {intent:"other"}

Example 7 — delete_search, Chinese, genuinely ambiguous by design (the search itself is correct;
resolving WHICH row it means is the deterministic system's job afterward, never yours).
User: "删掉7月13号坐巴士的那笔"
Reasoning: category="trans" fits "坐巴士" (took the bus). The literal stored note is very likely
the English word "bus", not the Chinese characters "巴士" — extracting "巴士" as a keyword risks
ZERO matches against an English-language note. When the user describes something in one language
but the app's data is commonly logged in a mix of languages, prefer the BROADER filter (category +
date, no keyword) over a literal-translation keyword that may not appear in the stored text at all.
Output: {intent:"delete_search", search:{category:"trans", dateFrom:"2026-07-13", dateTo:"2026-07-13"}}

Example 8 — edit_search vs amend_last disambiguation (the single most important distinction).
Context given: "LAST-LOGGED expense: S$550.00 · other · 酒店费用 · 2026-06-25."
User: "把手表那笔改成60块"
Reasoning: even though a LAST-LOGGED context exists, the user's words ("手表" / watch) describe a
DIFFERENT expense than the one in that context (a hotel bill). Do not default to amend_last just
because a last-logged context is present — check whether the user's description actually matches
it. Here it clearly doesn't, so this is edit_search, exactly as in Example 1.
Output: {intent:"edit_search", search:{keyword:"手表"}, amend:{amount:60}}

Example 9 — delete_search, English, no plausible match expected (this is a NORMAL, expected
outcome, not an error — the deterministic search downstream will simply report zero results).
User: "delete last week's grab ride"
Reasoning: "grab" is a specific, identifying keyword; "last week" resolves to a concrete date
range relative to today. Extract exactly what was said even if you suspect there may be no match —
it is not your job to pre-judge whether the search will succeed, only to extract faithfully.
Output: {intent:"delete_search", search:{keyword:"grab", dateFrom:"<start of last week>", dateTo:"<end of last week>"}}

Example 10 — search_query, mixed English/Chinese code-switching, keyword only.
User: "help me find my 火锅 spending"
Reasoning: "火锅" (hotpot) is a food-related term but functions here as a specific KEYWORD the user
is asking about (their hotpot spending specifically), not a request to filter by the whole "food"
category generally. When a specific dish/merchant/item name is given, prefer it as a keyword over
generalizing to its parent category — a keyword search is more precise and matches user intent.
Output: {intent:"search_query", search:{keyword:"火锅"}}

Example 11 — edit_search, ambiguous phrasing that should still resolve confidently.
User: "the coffee I bought yesterday was actually 6 dollars not 5"
Reasoning: "the coffee I bought yesterday" is a specific keyword ("coffee") plus a specific
relative date ("yesterday", resolved against today). The correction target amount is 6. This is
NOT amend_last unless a last-logged context is given AND it matches "coffee yesterday" — treat it
as edit_search by default when no such context is present in this call.
Output: {intent:"edit_search", search:{keyword:"coffee", dateFrom:"<yesterday>", dateTo:"<yesterday>"}, amend:{amount:6}}

Example 12 — search_query, category with an implied but unstated date (default to no date bound).
User: "how much have I spent on transport in total?"
Reasoning: "in total" with no month/date mentioned means an ALL-TIME query — do not invent a
"this month" default. Extract category="trans" with no dateFrom/dateTo at all; the deterministic
system aggregates across all time when no date bound is given.
Output: {intent:"search_query", search:{category:"trans"}}
`;

const FAQ = `
FAQ — EDGE CASES (each answer reflects a real decision this classifier must make correctly):

Q: The user gives an approximate amount ("about 50 bucks", "差不多80块") for an edit/delete search.
A: Extract the number as given (50, 80) — "about"/"差不多" is conversational hedging, not a range;
   don't turn it into a minAmount/maxAmount pair unless the user explicitly gives two bounds.

Q: The message mentions TWO different amounts, e.g. "change the 50 dollar coffee to 45".
A: The identifying detail (what to search for) is 50 + "coffee"; the CHANGE is to 45. Put 50 in the
   search context only if the schema supports amount-based search identification — for this
   classifier's schema, prefer the keyword ("coffee") as the primary identifier and 45 as amend.amount.

Q: User says "cash" or "on my card" or names a specific bank/card.
A: These describe PAYMENT METHOD, which this app does not track as a field. Ignore silently — do
   not invent a note or tag for it, and do not let it affect category/keyword extraction.

Q: The message has an obvious typo or voice-transcription artifact (e.g. "chnage the covfee expense").
A: Interpret charitably using context — "chnage"→change, "covfee"→coffee — extraction still applies
   normally. Only escalate to 'other' if the garbling makes the actual request genuinely ambiguous,
   not merely because of a spelling slip you can confidently resolve.

Q: The user references a REFUND or getting money back ("我的手表钱退回来了" / "got a refund for the watch").
A: This is describing something that happened to a PAST expense (effectively wanting it removed or
   corrected) — treat as delete_search or edit_search based on what action they actually want,
   extracting "手表"/"watch" as the keyword either way. Do not treat "refund" itself as a category.

Q: A search/filter request spans MULTIPLE categories at once ("food or transport spending in July").
A: The schema only supports ONE category per call. If multiple are explicitly given, this is beyond
   what a single extraction can express cleanly — escalate to 'other' rather than picking just one
   and silently dropping the rest.

Q: The user asks about a RECURRING/FIXED expense specifically ("my rent", "Netflix subscription").
A: Recurring-rule management is out of scope for this classifier entirely (a separate part of the
   system handles it) — always escalate to 'other' for anything about rent, subscriptions, or other
   recurring/fixed commitments, even if phrased like a simple search or edit.

Q: The message is a question ABOUT the app or these categories themselves, not about actual spending
   ("what counts as 'other' category?").
A: Not a search/edit/delete at all — escalate to 'other'.

Q: User gives a relative date that's ambiguous without more context ("recently", "the other day").
A: These are too vague to convert into a reliable date range — if a keyword or category is still
   given, you may still extract those alone (omitting date), but if the ENTIRE identifying detail is
   just a vague time reference with nothing else, escalate to 'other' instead of guessing a range.

Q: Amount given in words rather than digits ("五十块", "fifty dollars").
A: Convert to the numeric value normally (50) — word-form amounts are extracted the same as digit
   amounts, no special handling needed.

Q: The user explicitly says they're not sure which expense they mean ("大概是上周的某一笔").
A: This is the user themselves signaling uncertainty — do not try to resolve it by guessing a narrow
   filter; either extract only what little IS certain (if any) or escalate to 'other' if nothing
   reliable can be extracted at all.
`;

const DESIGN_RATIONALE = `
WHY THIS DESIGN (context, not instructions — read for understanding): this classifier is
deliberately narrow by design. The full financial assistant it sits in front of has access to the
complete conversation history, a proper search tool that returns candidate rows with IDs, and can
ask the user a clarifying question when something is genuinely unclear. You have none of those —
you see exactly one message (plus, sometimes, a short note about the last-logged expense) and must
either handle it with high confidence or step aside. This is why every instruction above leans so
hard on "when in doubt, escalate" — a wrong guess here has no safety net until the confirm card
stage, whereas an escalation to the full assistant costs a little more but is never unsafe. Money
actions specifically (edit_search's amend, and any implied delete) are ALWAYS shown to the user as
a confirm card before anything is actually saved or removed — so even a correct extraction from you
is never itself the final word; but a systematically wrong SEARCH (wrong row resolved, wrong
category silently excluding real matches) can still produce a confusing or unhelpful card, which is
why extraction accuracy still matters even though the money-safety net exists downstream.
`;

const COMMON_MISTAKES = `
COMMON MISTAKES TO AVOID (each of these has caused a real wrong answer before):
1. Defaulting to amend_last just because the phrasing looks like a correction ("改成X"/"change it
   to X") — always check whether the description actually matches the last-logged context; if it
   names a DIFFERENT expense, it's edit_search/delete_search instead.
2. Inventing a category the user never stated, "just in case" — an incorrect category SILENTLY
   excludes real rows from the deterministic search that runs on your output. Leave category out
   if genuinely unsure, don't guess "other" as a filler default.
3. Translating a Chinese/Malay description into a literal keyword when the underlying data is
   commonly stored in English (or vice versa) — prefer category+date over a keyword that may not
   match the stored text at all.
4. Treating a Chinese CATEGORY word (吃饭, 购物, 交通…) as if it were a literal note keyword —
   these almost always mean "extract this as category", not "search the note text for these exact
   characters".
5. Guessing a specific row when a request is ambiguous — you only ever extract SEARCH CRITERIA,
   never pick a row. Ambiguity is resolved deterministically downstream, never by you guessing.
`;

function paddedSystemPrompt(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return (
    `Today is ${today}. You are a fast, narrow pre-filter in front of a full financial assistant, ` +
    `specifically handling the "edit/delete/search an EXISTING expense" tier. Your ONLY job is to ` +
    `classify the message into edit_search / delete_search / search_query / other, and extract ` +
    `search criteria + (for edit_search) the intended change — never to pick a specific row (a ` +
    `deterministic system resolves 0/1/many matches from your criteria afterward) and never to ` +
    `invent a detail the user didn't actually say. Bias heavily toward 'other' on any doubt so the ` +
    `full assistant, which has real conversation history and search tools, can handle it instead.\n` +
    CATEGORY_GLOSSARY +
    WORKED_EXAMPLES +
    COMMON_MISTAKES +
    FAQ +
    DESIGN_RATIONALE
  );
}

interface CallResult {
  costUsd: number;
  usage: Anthropic.Usage;
}

const RATES: Record<string, [number, number]> = {
  "claude-sonnet-5": [2, 10],
  "claude-haiku-4-5-20251001": [1, 5],
};

async function call(model: string, system: string, msg: string): Promise<CallResult> {
  const AnthropicSDK = (await import("@anthropic-ai/sdk")).default;
  const client = new AnthropicSDK({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model,
    max_tokens: 300,
    thinking: { type: "disabled" },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    tools: [{ name: "route", description: "Classify the message.", input_schema: ROUTE_PARAMETERS as never }],
    tool_choice: { type: "tool", name: "route" },
    messages: [{ role: "user", content: msg }],
  });
  const u = res.usage;
  const [inRate, outRate] = RATES[model] ?? [2, 10];
  const costUsd =
    (u.input_tokens * inRate +
      (u.cache_read_input_tokens ?? 0) * inRate * 0.1 +
      (u.cache_creation_input_tokens ?? 0) * inRate * 1.25 +
      u.output_tokens * outRate) /
    1e6;
  return { costUsd, usage: u };
}

const MESSAGES = [
  "把手表那笔改成60块",
  "删掉7月13号坐巴士的那笔",
  "帮我删除7月13日的吃饭记录",
  "find my July expenses that are 100 dollars or more",
  "did I ever buy an iPhone?",
];

// ── accuracy re-check: does padding regress or improve accuracy? ──
// The SAME 21-case battery + deterministic-search grading from
// model-compare-classify.ts (accuracy there was measured on the SHORT prompt) —
// re-run here against the PADDED prompt to confirm the cost win above doesn't
// come at the expense of correctness.
interface AccCase {
  label: string;
  msg: string;
  context?: string;
  expectIntent: string;
  check?: (input: Record<string, unknown>) => string | null;
  expectMatches?: number;
  idealSearch?: Record<string, unknown>;
}

const ACCURACY_CASES: AccCase[] = [
  { label: "log-simple", msg: "log $12 lunch at the hawker centre today", expectIntent: "log" },
  {
    label: "log-multi",
    msg: "今天买了咖啡5块，还有午餐12块",
    expectIntent: "log",
    check: (i) => (Array.isArray(i.expenses) && i.expenses.length === 2 ? null : "expected 2 expenses"),
  },
  {
    label: "log-relative-date",
    msg: "上周一花了23块买文具",
    expectIntent: "log",
    check: (i) => {
      const items = Array.isArray(i.expenses) ? (i.expenses as Record<string, unknown>[]) : [];
      const date = items[0]?.date;
      return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? null : `bad/missing date: ${date}`;
    },
  },
  {
    label: "amend-last",
    msg: "改成600块",
    context: "LAST-LOGGED expense (for amend_last/delete_last matching): S$550.00 · other · 酒店费用 · 2026-06-25.",
    expectIntent: "amend_last",
    check: (i) => ((i.amend as Record<string, unknown> | undefined)?.amount === 600 ? null : "expected amend.amount=600"),
  },
  {
    label: "delete-last",
    msg: "删掉刚才那个",
    context: "LAST-LOGGED expense (for amend_last/delete_last matching): S$550.00 · other · 酒店费用 · 2026-06-25.",
    expectIntent: "delete_last",
  },
  {
    label: "edit-search-unique-keyword",
    msg: "把手表那笔改成60块",
    expectIntent: "edit_search",
    expectMatches: 1,
    check: (i) => {
      const a = (i.amend as Record<string, unknown> | undefined) ?? {};
      return a.amount === 60 ? null : `expected amend.amount=60, got ${JSON.stringify(a)}`;
    },
  },
  {
    label: "delete-search-by-date+category (6 real food rows on 07-13)",
    msg: "帮我删除7月13日的吃饭记录",
    expectIntent: "delete_search",
    expectMatches: 6,
  },
  {
    label: "delete-search-by-date+keyword (2 real 'bus' rows on 07-13)",
    msg: "删掉7月13号坐巴士的那笔",
    expectIntent: "delete_search",
    expectMatches: 2,
  },
  {
    label: "delete-search-unique (ShopeeFood买电风扇, 07-13)",
    msg: "帮我删掉ShopeeFood买电风扇那笔",
    expectIntent: "delete_search",
    expectMatches: 1,
  },
  {
    label: "delete-search-zero-matches (no grab entries)",
    msg: "把上周的grab订单删掉",
    expectIntent: "delete_search",
    expectMatches: 0,
  },
  { label: "total-cn", msg: "这个月花了多少？", expectIntent: "total_query" },
  { label: "total-en-category", msg: "how much did I spend on food this month?", expectIntent: "total_query" },
  {
    label: "search-query-cn-month-category",
    msg: "帮我找一下7月份的购物消费记录",
    expectIntent: "search_query",
    idealSearch: { category: "shop", dateFrom: "2026-07-01", dateTo: "2026-07-31" },
  },
  {
    label: "search-query-cn-single-date",
    msg: "帮我找到7月1日的购物消费记录",
    expectIntent: "search_query",
    idealSearch: { category: "shop", dateFrom: "2026-07-01", dateTo: "2026-07-01" },
  },
  {
    label: "search-query-en-amount-filter",
    msg: "find my July expenses that are 100 dollars or more",
    expectIntent: "search_query",
    idealSearch: { dateFrom: "2026-07-01", dateTo: "2026-07-31", minAmount: 100 },
  },
  {
    label: "search-query-cn-amount-filter",
    msg: "帮我找看7月份有什么消费记录是100块以上的",
    expectIntent: "search_query",
    idealSearch: { dateFrom: "2026-07-01", dateTo: "2026-07-31", minAmount: 100 },
  },
  {
    label: "search-query-en-keyword",
    msg: "did I ever buy an iPhone?",
    expectIntent: "search_query",
    idealSearch: { keyword: "iPhone" },
  },
  { label: "search-query-too-vague (must NOT invent criteria)", msg: "帮我找一下我的消费记录", expectIntent: "other" },
  { label: "referenced-conversation", msg: "do another one for the 16th, like we just discussed", expectIntent: "other" },
  { label: "multi-intent", msg: "log lunch 12 today, and how much on food this month?", expectIntent: "other" },
  { label: "future-date-log", msg: "record 100 for a concert ticket on 2026-12-25", expectIntent: "log" },
];

async function accSearch(
  userId: string,
  search: Record<string, unknown>,
): Promise<{ id: number }[]> {
  const { prisma } = await import("../src/lib/db");
  const where: Record<string, unknown> = { userId };
  if (typeof search.category === "string") where.category = search.category;
  const parseDate = (v: unknown, suffix: string): Date | null => {
    if (typeof v !== "string") return null;
    const d = new Date(`${v}${suffix}`);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const from = parseDate(search.dateFrom, "T00:00:00");
  const to = parseDate(search.dateTo, "T23:59:59.999");
  if (from || to) where.spentAt = { ...(from && { gte: from }), ...(to && { lte: to }) };
  if (typeof search.keyword === "string" && search.keyword.trim()) {
    where.note = { contains: search.keyword.trim(), mode: "insensitive" };
  }
  const min = typeof search.minAmount === "number" ? search.minAmount : null;
  const max = typeof search.maxAmount === "number" ? search.maxAmount : null;
  if (min != null || max != null) where.amount = { ...(min != null && { gte: min }), ...(max != null && { lte: max }) };
  return prisma.expense.findMany({ where, take: 20, select: { id: true } });
}

async function runAccuracyCheck(padded: string) {
  const AnthropicSDK = (await import("@anthropic-ai/sdk")).default;
  const client = new AnthropicSDK({ apiKey: process.env.ANTHROPIC_API_KEY });
  const { prisma } = await import("../src/lib/db");
  const user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!user) throw new Error("No user rows in the DB.");

  let pass = 0;
  for (const c of ACCURACY_CASES) {
    const fullSystem = c.context ? `${padded}\n\n${c.context}` : padded;
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      thinking: { type: "disabled" },
      system: [{ type: "text", text: fullSystem, cache_control: { type: "ephemeral" } }],
      tools: [{ name: "route", description: "Classify the message.", input_schema: ROUTE_PARAMETERS as never }],
      tool_choice: { type: "tool", name: "route" },
      messages: [{ role: "user", content: c.msg }],
    });
    const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const input = (block?.input ?? {}) as Record<string, unknown>;

    let ok = input.intent === c.expectIntent;
    let detail = ok ? "" : `intent=${input.intent}`;
    if (ok && c.check) {
      const err = c.check(input);
      if (err) { ok = false; detail = err; }
    }
    if (ok && c.expectMatches != null) {
      const matches = await accSearch(user.id, (input.search as Record<string, unknown>) ?? {});
      ok = matches.length === c.expectMatches;
      detail = ok ? "" : `found ${matches.length}, expected ${c.expectMatches}`;
    }
    if (ok && c.idealSearch) {
      const [modelRows, idealRows] = await Promise.all([
        accSearch(user.id, (input.search as Record<string, unknown>) ?? {}),
        accSearch(user.id, c.idealSearch),
      ]);
      const a = new Set(modelRows.map((r) => r.id));
      const b = new Set(idealRows.map((r) => r.id));
      ok = a.size === b.size && [...a].every((id) => b.has(id));
      detail = ok ? "" : `model found ${modelRows.length}, ideal found ${idealRows.length}`;
    }
    pass += ok ? 1 : 0;
    console.log(`  ${ok ? "✅" : "❌ " + detail}  ${c.label} — "${c.msg}"`);
  }
  console.log(`\nPadded-Haiku accuracy: ${pass}/${ACCURACY_CASES.length}`);
}

async function main() {
  const now = new Date();
  const padded = paddedSystemPrompt(now);

  // Real token length of the padded prompt (from the first, cold, call itself —
  // no separate count_tokens call needed).
  console.log("── Padded-Haiku experiment: does clearing the 4096-token cache floor pay off? ──\n");

  console.log(`Padded system prompt: ${padded.length} chars (measuring real tokens via first call)\n`);

  console.log("▸ Haiku 4.5 — first call (COLD, pays the cache WRITE premium):");
  const haikuCold = await call("claude-haiku-4-5-20251001", padded, MESSAGES[0]);
  console.log(`  usage: in:${haikuCold.usage.input_tokens} out:${haikuCold.usage.output_tokens} cacheR:${haikuCold.usage.cache_read_input_tokens} cacheW:${haikuCold.usage.cache_creation_input_tokens} → $${haikuCold.costUsd.toFixed(6)}`);
  const clearedFloor = (haikuCold.usage.cache_creation_input_tokens ?? 0) > 0;
  console.log(`  cache actually WRITTEN this time: ${clearedFloor ? "YES — prompt cleared the 4096 floor" : "NO — still below the floor, padding wasn't enough"}\n`);

  console.log("▸ Haiku 4.5 — 4 more calls immediately after (WARM, should read the cache):");
  const haikuWarm: CallResult[] = [];
  for (let i = 1; i < MESSAGES.length; i++) {
    const r = await call("claude-haiku-4-5-20251001", padded, MESSAGES[i]);
    haikuWarm.push(r);
    console.log(`  [${i}] in:${r.usage.input_tokens} out:${r.usage.output_tokens} cacheR:${r.usage.cache_read_input_tokens} cacheW:${r.usage.cache_creation_input_tokens} → $${r.costUsd.toFixed(6)}`);
  }
  const avgWarmHaiku = haikuWarm.reduce((a, r) => a + r.costUsd, 0) / haikuWarm.length;

  // Sonnet baseline: SAME padded prompt (fair — same content, so any difference is
  // purely the model/rate, not prompt size) — Sonnet already caches at this size
  // regardless, so this isolates the model-choice question cleanly.
  console.log("\n▸ Sonnet 5 — same padded prompt, first call (COLD):");
  const sonnetCold = await call("claude-sonnet-5", padded, MESSAGES[0]);
  console.log(`  usage: in:${sonnetCold.usage.input_tokens} out:${sonnetCold.usage.output_tokens} cacheR:${sonnetCold.usage.cache_read_input_tokens} cacheW:${sonnetCold.usage.cache_creation_input_tokens} → $${sonnetCold.costUsd.toFixed(6)}`);

  console.log("▸ Sonnet 5 — 4 more calls immediately after (WARM):");
  const sonnetWarm: CallResult[] = [];
  for (let i = 1; i < MESSAGES.length; i++) {
    const r = await call("claude-sonnet-5", padded, MESSAGES[i]);
    sonnetWarm.push(r);
    console.log(`  [${i}] in:${r.usage.input_tokens} out:${r.usage.output_tokens} cacheR:${r.usage.cache_read_input_tokens} cacheW:${r.usage.cache_creation_input_tokens} → $${r.costUsd.toFixed(6)}`);
  }
  const avgWarmSonnet = sonnetWarm.reduce((a, r) => a + r.costUsd, 0) / sonnetWarm.length;

  console.log(`\n${"─".repeat(70)}`);
  console.log(`Haiku  4.5 (padded): cold $${haikuCold.costUsd.toFixed(6)}, avg warm $${avgWarmHaiku.toFixed(6)}`);
  console.log(`Sonnet 5   (padded): cold $${sonnetCold.costUsd.toFixed(6)}, avg warm $${avgWarmSonnet.toFixed(6)}`);
  console.log(`Warm-call ratio (Haiku/Sonnet): ${(avgWarmHaiku / avgWarmSonnet).toFixed(2)}x`);
  console.log(`\nProjected cost for "1 cold start + N warm calls" in a session:`);
  for (const n of [1, 3, 5, 10, 20]) {
    const haikuTotal = haikuCold.costUsd + avgWarmHaiku * n;
    const sonnetTotal = sonnetCold.costUsd + avgWarmSonnet * n;
    console.log(`  N=${n.toString().padStart(2)}: Haiku $${haikuTotal.toFixed(5)}  vs  Sonnet $${sonnetTotal.toFixed(5)}  →  ${haikuTotal < sonnetTotal ? "Haiku cheaper" : "Sonnet cheaper"} (${(haikuTotal / sonnetTotal).toFixed(2)}x)`);
  }

  console.log(`\n${"─".repeat(70)}`);
  console.log("── Accuracy re-check: same 21-case battery, now against the PADDED prompt ──\n");
  await runAccuracyCheck(padded);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
