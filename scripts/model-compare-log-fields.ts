// ADDED (cost optimization — is gpt-4o-mini viable for the SIMPLEST tier, plain
// expense logging?): the user's own idea — since round 2 showed gpt-4o-mini is
// unreliable for edit/delete/search, maybe the CHEAPEST model (~10x cheaper than
// even padded-Haiku) is still good enough for the narrowest case: a brand-new
// expense log with amount/category/date/tags/note, INCLUDING relative dates
// ("上星期三", "上个月15号") and multi-tag, mixed-language extraction — modeled
// directly on the user's own real voice-log example. NOT wired into production.
//
//   npx tsx scripts/model-compare-log-fields.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import type Anthropic from "@anthropic-ai/sdk";

const CATEGORIES = ["food", "shop", "ent", "trans", "health", "bills", "other"];
const CURRENCIES = ["SGD", "MYR", "CNY", "USD"];

const LOG_TOOL_PARAMS = {
  type: "object",
  properties: {
    amount: { type: "number" },
    category: { type: "string", enum: CATEGORIES },
    currency: { type: "string", enum: CURRENCIES },
    note: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    date: { type: "string", description: "YYYY-MM-DD, resolved against today. Omit for today." },
  },
  required: ["amount", "category"],
  additionalProperties: false,
} as const;

function systemPrompt(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  return (
    `Today is ${weekday}, ${today}. Extract this brand-new expense log into structured fields. ` +
    `Resolve any relative date ("last Wednesday", "上星期三", "上个月15号") against today's date ` +
    `above — a month/day given without a year means the CURRENT year. category must best-fit one ` +
    `of: food (dining), shop (goods/electronics/clothing), ent (entertainment), trans (transport), ` +
    `health, bills, other. tags is a flat list of every tag the user asked for, in whatever ` +
    `language they used. Never invent a detail the user didn't say.`
  );
}

interface Case {
  label: string;
  msg: string;
  expectAmount: number;
  expectCategory: string;
  expectDate: string; // YYYY-MM-DD
  expectTags?: string[]; // substrings, case-insensitive, order-independent
  expectNoteContains?: string;
}

// today = 2026-07-14 (Tuesday). Reference dates computed via real, TIMEZONE-SAFE
// local-date math (getFullYear/getMonth/getDate — NOT toISOString, which shifts
// the calendar day backward on a UTC-behind-local machine and silently corrupted
// the first version of these numbers): last Wednesday = 2026-07-08 (NOT 07-07),
// last Friday = 2026-07-10 (NOT 07-09), "上个月15号" = 2026-06-15.
const CASES: Case[] = [
  {
    label: "user's-own-example (cn, relative weekday, 2 mixed-lang tags, note)",
    msg: "帮我记录一个上个星期三的记录，价格是20$，买了一个air pods，tags的话帮我放airpods 3pro 和 电器。然后我还要放note是CS Mall",
    expectAmount: 20,
    expectCategory: "shop",
    expectDate: "2026-07-08",
    expectTags: ["airpods", "电器"],
    expectNoteContains: "CS Mall",
  },
  {
    label: "same-example-in-english",
    msg: "log last Wednesday's purchase, $20 for airpods, tag it airpods-3-pro and electronics, note CS Mall",
    expectAmount: 20,
    expectCategory: "shop",
    expectDate: "2026-07-08",
    expectTags: ["airpods", "electronic"],
    expectNoteContains: "CS Mall",
  },
  {
    label: "cn-different-relative-pattern (上个月X号)",
    msg: "上个月15号买了本书，30块，分类是购物",
    expectAmount: 30,
    expectCategory: "shop",
    expectDate: "2026-06-15",
  },
  {
    label: "en-different-weekday+category (movie → ent)",
    msg: "last Friday I spent 15 on a movie ticket",
    expectAmount: 15,
    expectCategory: "ent",
    expectDate: "2026-07-10",
  },
  {
    label: "cn-food-category-check (previously a real 4o-mini miss: 吃饭→ent instead of food)",
    msg: "刚刚在食堂吃饭花了8块",
    expectAmount: 8,
    expectCategory: "food",
    expectDate: "2026-07-14", // "today", no relative date given — omitting the field is ALSO correct (see grade())
  },
];

interface CallResult {
  fields: Record<string, unknown>;
  costUsd: number;
  usage?: string;
}

const ANTHROPIC_RATES: Record<string, [number, number]> = {
  "claude-sonnet-5": [2, 10],
  "claude-haiku-4-5-20251001": [1, 5],
};

async function callAnthropic(model: string, system: string, msg: string): Promise<CallResult> {
  const AnthropicSDK = (await import("@anthropic-ai/sdk")).default;
  const client = new AnthropicSDK({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model,
    max_tokens: 300,
    thinking: { type: "disabled" },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    tools: [{ name: "log_expense", description: "Extract the expense.", input_schema: LOG_TOOL_PARAMS as never }],
    tool_choice: { type: "tool", name: "log_expense" },
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
    fields: (block?.input ?? {}) as Record<string, unknown>,
    costUsd,
    usage: `in:${u.input_tokens} cacheR:${u.cache_read_input_tokens ?? 0} cacheW:${u.cache_creation_input_tokens ?? 0}`,
  };
}

const LOG_STRICT = {
  type: "object",
  properties: {
    amount: { type: "number" },
    category: { type: "string", enum: CATEGORIES },
    currency: { type: ["string", "null"], enum: [...CURRENCIES, null] },
    note: { type: ["string", "null"] },
    tags: { type: ["array", "null"], items: { type: "string" } },
    date: { type: ["string", "null"] },
  },
  required: ["amount", "category", "currency", "note", "tags", "date"],
  additionalProperties: false,
} as const;

async function callGpt4oMini(system: string, msg: string): Promise<CallResult> {
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
        { type: "function", function: { name: "log_expense", description: "Extract the expense.", parameters: LOG_STRICT, strict: true } },
      ],
      tool_choice: { type: "function", function: { name: "log_expense" } },
    }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const call = j.choices?.[0]?.message?.tool_calls?.[0];
  const fields = call ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
  const u = j.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  const costUsd = (u.prompt_tokens * 0.15 + u.completion_tokens * 0.6) / 1e6;
  return { fields, costUsd };
}

function grade(f: Record<string, unknown>, c: Case, todayIso: string): string[] {
  const problems: string[] = [];
  if (f.amount !== c.expectAmount) problems.push(`amount=${f.amount} (expected ${c.expectAmount})`);
  if (f.category !== c.expectCategory) problems.push(`category=${f.category} (expected ${c.expectCategory})`);
  // Omitting date means "today" per the prompt's own instruction — only a mismatch
  // if a date WAS given and it's wrong, or the case expects a non-today date.
  const effectiveDate = f.date == null ? todayIso : f.date;
  if (effectiveDate !== c.expectDate) problems.push(`date=${f.date ?? "(omitted→today)"} (expected ${c.expectDate})`);
  if (c.expectTags) {
    const got = (Array.isArray(f.tags) ? f.tags : []).map((t) => String(t).toLowerCase());
    for (const want of c.expectTags) {
      if (!got.some((g) => g.includes(want.toLowerCase()))) problems.push(`missing tag ~"${want}" (got ${JSON.stringify(f.tags)})`);
    }
  }
  if (c.expectNoteContains) {
    const note = typeof f.note === "string" ? f.note : "";
    if (!note.toLowerCase().includes(c.expectNoteContains.toLowerCase())) {
      problems.push(`note missing "${c.expectNoteContains}" (got "${note}")`);
    }
  }
  return problems;
}

async function main() {
  const now = new Date();
  const system = systemPrompt(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  const todayIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const CONTENDERS: [string, (s: string, m: string) => Promise<CallResult>][] = [
    ["Sonnet 5 ", (s, m) => callAnthropic("claude-sonnet-5", s, m)],
    ["Haiku 4.5", (s, m) => callAnthropic("claude-haiku-4-5-20251001", s, m)],
    ["4o-mini  ", callGpt4oMini],
  ];
  const totals = CONTENDERS.map(() => ({ pass: 0, cost: 0 }));

  for (const c of CASES) {
    console.log(`\n▸ ${c.label} — "${c.msg}"`);
    for (let i = 0; i < CONTENDERS.length; i++) {
      const [name, fn] = CONTENDERS[i];
      const r = await fn(system, c.msg).catch((e): CallResult => ({ fields: { error: String(e) }, costUsd: 0, usage: undefined }));
      const problems = grade(r.fields, c, todayIso);
      totals[i].pass += problems.length === 0 ? 1 : 0;
      totals[i].cost += r.costUsd;
      console.log(
        `  ${name}  ${problems.length === 0 ? "✅" : "❌ " + problems.join("; ")}  ($${r.costUsd.toFixed(6)}${r.usage ? " · " + r.usage : ""})  ${JSON.stringify(r.fields)}`,
      );
    }
  }

  console.log(`\n${"─".repeat(70)}`);
  for (let i = 0; i < CONTENDERS.length; i++) {
    const [name] = CONTENDERS[i];
    const t = totals[i];
    console.log(`${name}: ${t.pass}/${CASES.length} fully correct — total $${t.cost.toFixed(6)} (avg $${(t.cost / CASES.length).toFixed(6)}/call)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
