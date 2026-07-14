// ADDED (cost optimization — model comparison, NOT wired into production): a
// side-by-side harness comparing claude-sonnet-5 (what fast-path.ts uses today)
// against gpt-4o-mini on intent + field-extraction accuracy + real measured cost.
// Does NOT touch src/lib/assistant/* — pure research before touching anything live.
//
// V2 design change (from the user's own idea): edit_search/delete_search no
// longer ask the model to pick a row out of a candidate list (v1 found gpt-4o-mini
// will GUESS under ambiguity instead of declining — a real, unacceptable failure
// mode for money-affecting actions). Instead the model ONLY extracts SEARCH
// CRITERIA (keyword / category / date range) + the intended change — it never sees
// or picks candidates at all. A deterministic Prisma query (zero AI, real dev DB)
// then resolves how many rows actually match:
//   0 matches   → nothing to show (free, no card, no guessing possible)
//   1 match     → propose the one edit/delete card, as usual
//   2+ matches  → propose ONE CARD PER CANDIDATE (reusing the existing multi-card
//                 rendering that "log" already uses for 1-3 expenses) so the user
//                 picks/confirms the right one themselves — ambiguity resolved by
//                 the UI, never by the model guessing.
// This removes the model's most failure-prone judgment call entirely, regardless
// of which provider ends up doing the extraction.
//
//   npx tsx scripts/model-compare-classify.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import type Anthropic from "@anthropic-ai/sdk";

const WRITABLE_CATEGORIES = ["food", "shop", "ent", "trans", "health", "bills", "other"];
const CURRENCIES = ["SGD", "MYR", "CNY", "USD"];

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
        "extract ONLY the search criteria (a deterministic search resolves the actual row(s) " +
        "afterward; you never see or guess which row it is). search_query: a READ-ONLY request to " +
        "list/find/count past expenses matching some criteria (keyword/category/date/amount range) " +
        "— NO edit or delete intent, just 'show me' / 'find' / 'what did I spend on'. total_query: " +
        "a simple spend TOTAL (one number) for today/this_week/this_month/last_month, optionally " +
        "one category — use search_query instead if the user wants a LIST or if the period/filter " +
        "doesn't fit those four buckets (e.g. a specific date, an amount threshold, a custom range). " +
        "other: anything else — not enough info to search, analysis, projections, recurring/income, " +
        "questions needing conversation history not provided here, or multi-intent. When in doubt, 'other'.",
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
      description:
        "intent=edit_search/delete_search/search_query: whatever identifying details the user " +
        "actually gave — leave a field OUT entirely if not mentioned (never invent a keyword/" +
        "category/date/amount to narrow it down). A deterministic search runs on these afterward; " +
        "being too narrow risks 0 matches, too broad risks many — give exactly what was said, no " +
        "more, no less.",
      properties: {
        keyword: { type: "string", description: "A word from the note/description, if any was given." },
        category: { type: "string", enum: [...WRITABLE_CATEGORIES, "family"] },
        dateFrom: { type: "string", description: "YYYY-MM-DD, if a date or range was mentioned." },
        dateTo: { type: "string", description: "YYYY-MM-DD, if a date or range was mentioned." },
        minAmount: { type: "number", description: "Only if the user gave a lower amount bound (e.g. 'over 100')." },
        maxAmount: { type: "number", description: "Only if the user gave an upper amount bound (e.g. 'under 50')." },
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

function systemPrompt(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return (
    `Today is ${today}. You are a fast, narrow pre-filter in front of a full financial assistant — ` +
    `spot the simplest cases and extract them, or bail out (intent 'other') so the full assistant, ` +
    `which has the whole conversation and real search tools, handles it instead. Bias heavily toward ` +
    `'other' on any doubt. A month/day given WITHOUT a year resolves to the CURRENT year. Never invent ` +
    `a detail (keyword, category, date, amount) the user didn't actually say.`
  );
}

// ── test cases (built from REAL rows in the dev DB — see the DB peek this session) ──

interface Case {
  label: string;
  msg: string;
  context?: string;
  expectIntent: string;
  check?: (input: Record<string, unknown>) => string | null;
  /** For edit_search/delete_search: how many REAL rows we expect the deterministic query to find
   *  (hand-verified against a DB peek earlier this session). */
  expectMatches?: number;
  /** For search_query: what a PERFECT extraction would contain. Graded by running the model's
   *  extracted criteria AND this ideal criteria through the SAME live-DB query and comparing the
   *  resulting row-id sets — robust to exactly how many real rows exist (computed fresh, not
   *  hand-counted from a partial sample). */
  idealSearch?: Record<string, unknown>;
}

const CASES: Case[] = [
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
  // ── edit_search / delete_search — REAL data: 手表 (id173, MYR50, 2026-07-13) is a
  // UNIQUE keyword (unambiguous, 1 match). "bus" and "food" on 2026-07-13 are
  // GENUINELY ambiguous (2 and 6 real rows respectively) — this is the design's
  // actual target case: the search resolves multiple candidates and we'd show one
  // card per match instead of asking the model to pick.
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
    label: "delete-search-by-date+category (genuinely ambiguous: 6 real food rows on 07-13)",
    msg: "帮我删除7月13日的吃饭记录",
    expectIntent: "delete_search",
    expectMatches: 6,
  },
  {
    label: "delete-search-by-date+keyword (genuinely ambiguous: 2 real 'bus' rows on 07-13)",
    msg: "删掉7月13号坐巴士的那笔",
    expectIntent: "delete_search",
    expectMatches: 2,
  },
  {
    label: "delete-search-unique (real row: ShopeeFood买电风扇, 07-13)",
    msg: "帮我删掉ShopeeFood买电风扇那笔",
    expectIntent: "delete_search",
    expectMatches: 1,
  },
  {
    label: "delete-search-zero-matches (no grab entries exist)",
    msg: "把上周的grab订单删掉",
    expectIntent: "delete_search",
    expectMatches: 0,
  },
  { label: "total-cn", msg: "这个月花了多少？", expectIntent: "total_query" },
  { label: "total-en-category", msg: "how much did I spend on food this month?", expectIntent: "total_query" },
  // ── search_query — READ-ONLY (no edit/delete intent). Lower blast radius than
  // edit/delete_search: a wrong LIST is a much smaller mistake than a wrong DELETE,
  // so this is the more plausible place for a cheaper model even if not flawless.
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
  {
    label: "search-query-too-vague (must NOT invent criteria)",
    msg: "帮我找一下我的消费记录",
    expectIntent: "other",
  },
  { label: "referenced-conversation", msg: "do another one for the 16th, like we just discussed", expectIntent: "other" },
  { label: "multi-intent", msg: "log lunch 12 today, and how much on food this month?", expectIntent: "other" },
  {
    label: "future-date-log",
    msg: "record 100 for a concert ticket on 2026-12-25",
    expectIntent: "log",
  },
];

// ── deterministic search (zero AI, real dev DB — validates the multi-card design) ──

async function runDeterministicSearch(
  userId: string,
  search: Record<string, unknown>,
): Promise<{ id: number; amount: number; currency: string; category: string; note: string; date: string }[]> {
  const { prisma } = await import("../src/lib/db");
  const where: Record<string, unknown> = { userId };
  if (typeof search.category === "string") where.category = search.category;
  // Validate — a model (esp. under stress-testing) can emit a malformed date string; treat
  // that as "no bound" rather than crashing the harness on an invalid Date passed to Prisma.
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
  if (min != null || max != null) {
    where.amount = { ...(min != null && { gte: min }), ...(max != null && { lte: max }) };
  }
  const rows = await prisma.expense.findMany({ where, take: 20 });
  return rows.map((r) => ({
    id: r.id,
    amount: Number(r.amount),
    currency: r.currency,
    category: r.category,
    note: r.note ?? "",
    date: r.spentAt.toISOString().slice(0, 10),
  }));
}

// ── provider callers ──────────────────────────────────────────

interface ClassifyResult {
  input: Record<string, unknown>;
  costUsd: number;
  ms: number;
  usage?: string; // raw token breakdown, for diagnosing surprising cost deltas
}

// Per-Mtok $ rates [input, output] for the cost math below — cache read is always
// 0.1x input, cache write 1.25x input (Anthropic's standard ratios).
const ANTHROPIC_RATES: Record<string, [number, number]> = {
  "claude-sonnet-5": [2, 10], // intro pricing until 2026-08-31
  "claude-haiku-4-5-20251001": [1, 5],
};

async function classifyWithAnthropic(model: string, system: string, msg: string): Promise<ClassifyResult> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const started = Date.now();
  const res = await client.messages.create({
    model,
    max_tokens: 500,
    thinking: { type: "disabled" },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    tools: [{ name: "route", description: "Classify the message.", input_schema: ROUTE_PARAMETERS as never }],
    tool_choice: { type: "tool", name: "route" },
    messages: [{ role: "user", content: msg }],
  });
  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const u = res.usage;
  const [inRate, outRate] = ANTHROPIC_RATES[model] ?? [2, 10];
  const costUsd =
    (u.input_tokens * inRate +
      (u.cache_read_input_tokens ?? 0) * inRate * 0.1 +
      (u.cache_creation_input_tokens ?? 0) * inRate * 1.25 +
      u.output_tokens * outRate) /
    1e6;
  return {
    input: (block?.input ?? {}) as Record<string, unknown>,
    costUsd,
    ms: Date.now() - started,
    usage: `in:${u.input_tokens} out:${u.output_tokens} cacheR:${u.cache_read_input_tokens ?? 0} cacheW:${u.cache_creation_input_tokens ?? 0}`,
  };
}
const classifyWithSonnet = (system: string, msg: string) => classifyWithAnthropic("claude-sonnet-5", system, msg);
const classifyWithHaiku = (system: string, msg: string) =>
  classifyWithAnthropic("claude-haiku-4-5-20251001", system, msg);

// OpenAI Structured Outputs STRICT mode (the mechanism Gemini's suggestion actually
// relies on for "almost never gives wrong params") — every object, including
// nested ones, needs additionalProperties:false + ALL properties in `required`;
// optional-in-spirit fields become nullable (`type: [T, "null"]`) instead of
// omitted. The non-strict v1 run above let gpt-4o-mini invent a "date" key instead
// of "dateFrom"/"dateTo" — exactly the class of slip strict mode exists to prevent.
const EXPENSE_ITEM_STRICT = {
  type: "object",
  properties: {
    amount: { type: "number" },
    category: { type: "string", enum: WRITABLE_CATEGORIES },
    currency: { type: ["string", "null"], enum: [...CURRENCIES, null] },
    note: { type: ["string", "null"] },
    date: { type: ["string", "null"], description: "YYYY-MM-DD, resolved against today. null for today." },
  },
  required: ["amount", "category", "currency", "note", "date"],
  additionalProperties: false,
} as const;

const AMEND_STRICT = {
  type: ["object", "null"],
  properties: {
    amount: { type: ["number", "null"] },
    category: { type: ["string", "null"], enum: [...WRITABLE_CATEGORIES, null] },
    currency: { type: ["string", "null"], enum: [...CURRENCIES, null] },
    note: { type: ["string", "null"] },
    date: { type: ["string", "null"] },
  },
  required: ["amount", "category", "currency", "note", "date"],
  additionalProperties: false,
} as const;

const SEARCH_STRICT = {
  type: ["object", "null"],
  properties: {
    keyword: { type: ["string", "null"], description: "A word from the note/description, if any was given." },
    category: { type: ["string", "null"], enum: [...WRITABLE_CATEGORIES, "family", null] },
    dateFrom: { type: ["string", "null"], description: "YYYY-MM-DD, if a date/range was mentioned." },
    dateTo: { type: ["string", "null"], description: "YYYY-MM-DD, if a date/range was mentioned." },
    minAmount: { type: ["number", "null"], description: "Only if the user gave a lower amount bound." },
    maxAmount: { type: ["number", "null"], description: "Only if the user gave an upper amount bound." },
  },
  required: ["keyword", "category", "dateFrom", "dateTo", "minAmount", "maxAmount"],
  additionalProperties: false,
} as const;

const TOTAL_STRICT = {
  type: ["object", "null"],
  properties: {
    category: { type: ["string", "null"], enum: [...WRITABLE_CATEGORIES, "all", null] },
    period: { type: ["string", "null"], enum: ["today", "this_week", "this_month", "last_month", null] },
  },
  required: ["category", "period"],
  additionalProperties: false,
} as const;

const ROUTE_PARAMETERS_STRICT = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: ["log", "amend_last", "delete_last", "edit_search", "delete_search", "search_query", "total_query", "other"],
    },
    expenses: { type: ["array", "null"], items: EXPENSE_ITEM_STRICT },
    amend: AMEND_STRICT,
    search: SEARCH_STRICT,
    total: TOTAL_STRICT,
  },
  required: ["intent", "expenses", "amend", "search", "total"],
  additionalProperties: false,
} as const;

async function classifyWithGpt4oMini(system: string, msg: string): Promise<ClassifyResult> {
  const started = Date.now();
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: msg },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "route",
            description: "Classify the message.",
            parameters: ROUTE_PARAMETERS_STRICT,
            strict: true,
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "route" } },
    }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const call = j.choices?.[0]?.message?.tool_calls?.[0];
  const input = call ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
  const u = j.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  const costUsd = (u.prompt_tokens * 0.15 + u.completion_tokens * 0.6) / 1e6;
  return { input, costUsd, ms: Date.now() - started };
}

// ── run ────────────────────────────────────────────────────────

async function main() {
  const { prisma } = await import("../src/lib/db");
  const user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!user) throw new Error("No user rows in the DB — sign in once first.");

  const now = new Date();
  const system = systemPrompt(now);

  const CONTENDERS: [string, (s: string, m: string) => Promise<ClassifyResult>][] = [
    ["Sonnet 5 ", classifyWithSonnet],
    ["Haiku 4.5", classifyWithHaiku],
    ["4o-mini  ", classifyWithGpt4oMini],
  ];
  const totals = CONTENDERS.map(() => ({ pass: 0, cost: 0 }));

  for (const c of CASES) {
    const fullSystem = c.context ? `${system}\n\n${c.context}` : system;
    const results = await Promise.all(
      CONTENDERS.map(([, fn]) =>
        fn(fullSystem, c.msg).catch((e): ClassifyResult => ({ input: { error: String(e) }, costUsd: 0, ms: 0, usage: undefined })),
      ),
    );

    const grade = async (r: ClassifyResult): Promise<{ ok: boolean; detail: string }> => {
      if (r.input.intent !== c.expectIntent) return { ok: false, detail: `intent=${r.input.intent}` };
      if (c.check) {
        const err = c.check(r.input);
        if (err) return { ok: false, detail: err };
      }
      if (c.expectMatches != null && (c.expectIntent === "edit_search" || c.expectIntent === "delete_search")) {
        const search = (r.input.search as Record<string, unknown>) ?? {};
        const matches = await runDeterministicSearch(user.id, search);
        const ok = matches.length === c.expectMatches;
        return { ok, detail: ok ? "" : `real search found ${matches.length}, expected ${c.expectMatches}` };
      }
      if (c.idealSearch && c.expectIntent === "search_query") {
        const search = (r.input.search as Record<string, unknown>) ?? {};
        const [modelRows, idealRows] = await Promise.all([
          runDeterministicSearch(user.id, search),
          runDeterministicSearch(user.id, c.idealSearch),
        ]);
        const modelIds = new Set(modelRows.map((r) => r.id));
        const idealIds = new Set(idealRows.map((r) => r.id));
        const sameSet = modelIds.size === idealIds.size && [...modelIds].every((id) => idealIds.has(id));
        return {
          ok: sameSet,
          detail: sameSet ? "" : `model's criteria found ${modelRows.length} rows, ideal criteria found ${idealRows.length} (mismatched sets)`,
        };
      }
      return { ok: true, detail: "" };
    };

    console.log(`\n▸ ${c.label} — "${c.msg}"`);
    for (let i = 0; i < CONTENDERS.length; i++) {
      const [name] = CONTENDERS[i];
      const r = results[i];
      const g = await grade(r);
      totals[i].pass += g.ok ? 1 : 0;
      totals[i].cost += r.costUsd;
      console.log(
        `  ${name}  ${g.ok ? "✅" : "❌ " + g.detail}  ($${r.costUsd.toFixed(6)} · ${r.usage ?? "n/a"})  ${JSON.stringify(r.input)}`,
      );
    }
  }

  console.log(`\n${"─".repeat(70)}`);
  for (let i = 0; i < CONTENDERS.length; i++) {
    const [name] = CONTENDERS[i];
    const t = totals[i];
    console.log(
      `${name}: ${t.pass}/${CASES.length} correct — total $${t.cost.toFixed(5)} (avg $${(t.cost / CASES.length).toFixed(6)}/call${name.startsWith("Sonnet") || name.startsWith("Haiku") ? ", COLD — no cache reuse in this run" : ""})`,
    );
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
