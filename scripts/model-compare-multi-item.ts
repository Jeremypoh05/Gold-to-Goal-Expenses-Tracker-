// ADDED (cost optimization): the user's exact compound-log example — 3 expenses,
// 3 different relative dates, one message — in Chinese, English, and Singlish.
// Tests whether gpt-4o-mini can split a compound message into the right NUMBER
// of expenses with correct per-item amount/category/date/tags, not just resolve
// one date in isolation. NOT wired into production.
//
//   npx tsx scripts/model-compare-multi-item.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import type Anthropic from "@anthropic-ai/sdk";

const CATEGORIES = ["food", "shop", "ent", "trans", "health", "bills", "other"];

const EXPENSE_ITEM = {
  type: "object",
  properties: {
    amount: { type: "number" },
    category: { type: "string", enum: CATEGORIES },
    date: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
  },
  required: ["amount", "category"],
} as const;

const LOG_PARAMS = {
  type: "object",
  properties: { expenses: { type: "array", items: EXPENSE_ITEM } },
  required: ["expenses"],
  additionalProperties: false,
} as const;

const EXPENSE_ITEM_STRICT = {
  type: "object",
  properties: {
    amount: { type: "number" },
    category: { type: "string", enum: CATEGORIES },
    date: { type: ["string", "null"] },
    tags: { type: ["array", "null"], items: { type: "string" } },
  },
  required: ["amount", "category", "date", "tags"],
  additionalProperties: false,
} as const;

const LOG_PARAMS_STRICT = {
  type: "object",
  properties: { expenses: { type: "array", items: EXPENSE_ITEM_STRICT } },
  required: ["expenses"],
  additionalProperties: false,
} as const;

function systemPrompt(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  return (
    `Today is ${weekday}, ${today}. The message may describe MULTIPLE expenses at once — extract ` +
    `every one into the expenses array. Resolve each expense's relative date independently against ` +
    `today's date above. category: food/shop/ent/trans/health/bills/other.`
  );
}

// today = 2026-07-14 Tuesday. last Wednesday = 07-08, 5 days ago = 07-09,
// one month ago today = 06-14 (all timezone-safe local math, verified this session).
interface Case {
  label: string;
  msg: string;
  expect: { amount: number; category: string; date: string; tagHint?: string }[];
}
const CASES: Case[] = [
  {
    label: "user's-exact-example (cn)",
    msg: "帮我记录一个上个星期三的记录，价格是20$，买了一个air pods，tags的话帮我放airpods 3pro 和 电器。还有5天前我买了mouse，100块。tag 放电脑器材。还有一个月前的今天我也买了powerbank，50块",
    expect: [
      { amount: 20, category: "shop", date: "2026-07-08", tagHint: "airpods" },
      { amount: 100, category: "shop", date: "2026-07-09", tagHint: "电脑" },
      { amount: 50, category: "shop", date: "2026-06-14" },
    ],
  },
  {
    label: "same-example-in-english",
    msg: "log last Wednesday's purchase, $20 for airpods, tag airpods-3-pro and electronics. Also 5 days ago I bought a mouse for $100, tag it computer accessories. And one month ago today I also bought a powerbank for $50",
    expect: [
      { amount: 20, category: "shop", date: "2026-07-08", tagHint: "airpods" },
      { amount: 100, category: "shop", date: "2026-07-09", tagHint: "computer" },
      { amount: 50, category: "shop", date: "2026-06-14" },
    ],
  },
  {
    label: "same-example-singlish",
    msg: "eh help me log ah, last wednesday i buy airpods $20 one, tag airpods3pro and electronics can. then 5 days back also bought a mouse $100, tag computer stuff lor. one month ago today also got powerbank $50 leh",
    expect: [
      { amount: 20, category: "shop", date: "2026-07-08", tagHint: "airpods" },
      { amount: 100, category: "shop", date: "2026-07-09", tagHint: "computer" },
      { amount: 50, category: "shop", date: "2026-06-14" },
    ],
  },
];

async function callAnthropic(model: string, system: string, msg: string) {
  const AnthropicSDK = (await import("@anthropic-ai/sdk")).default;
  const client = new AnthropicSDK({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model,
    max_tokens: 500,
    thinking: { type: "disabled" },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    tools: [{ name: "log_expenses", description: "Extract.", input_schema: LOG_PARAMS as never }],
    tool_choice: { type: "tool", name: "log_expenses" },
    messages: [{ role: "user", content: msg }],
  });
  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const u = res.usage;
  const rates: Record<string, [number, number]> = { "claude-sonnet-5": [2, 10], "claude-haiku-4-5-20251001": [1, 5] };
  const [inRate, outRate] = rates[model] ?? [2, 10];
  const costUsd = (u.input_tokens * inRate + (u.cache_read_input_tokens ?? 0) * inRate * 0.1 + (u.cache_creation_input_tokens ?? 0) * inRate * 1.25 + u.output_tokens * outRate) / 1e6;
  return { expenses: ((block?.input as Record<string, unknown>)?.expenses ?? []) as Record<string, unknown>[], costUsd };
}

async function callGpt4oMini(system: string, msg: string) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: system }, { role: "user", content: msg }],
      tools: [{ type: "function", function: { name: "log_expenses", description: "Extract.", parameters: LOG_PARAMS_STRICT, strict: true } }],
      tool_choice: { type: "function", function: { name: "log_expenses" } },
    }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const call = j.choices?.[0]?.message?.tool_calls?.[0];
  const parsed = call ? JSON.parse(call.function.arguments) : { expenses: [] };
  const u = j.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  return { expenses: (parsed.expenses ?? []) as Record<string, unknown>[], costUsd: (u.prompt_tokens * 0.15 + u.completion_tokens * 0.6) / 1e6 };
}

function grade(expenses: Record<string, unknown>[], expect: Case["expect"]): string[] {
  const problems: string[] = [];
  if (expenses.length !== expect.length) {
    problems.push(`got ${expenses.length} expenses, expected ${expect.length}`);
    return problems;
  }
  for (let i = 0; i < expect.length; i++) {
    const e = expenses[i];
    const w = expect[i];
    if (e.amount !== w.amount) problems.push(`item${i}.amount=${e.amount} (expected ${w.amount})`);
    if (e.category !== w.category) problems.push(`item${i}.category=${e.category} (expected ${w.category})`);
    if (e.date !== w.date) problems.push(`item${i}.date=${e.date} (expected ${w.date})`);
    if (w.tagHint) {
      const tags = (Array.isArray(e.tags) ? e.tags : []).map((t) => String(t).toLowerCase());
      if (!tags.some((t) => t.includes(w.tagHint!.toLowerCase()))) problems.push(`item${i} missing tag ~"${w.tagHint}" (got ${JSON.stringify(e.tags)})`);
    }
  }
  return problems;
}

async function main() {
  const now = new Date();
  const system = systemPrompt(now);
  const CONTENDERS: [string, (s: string, m: string) => Promise<{ expenses: Record<string, unknown>[]; costUsd: number }>][] = [
    ["Sonnet 5 ", (s, m) => callAnthropic("claude-sonnet-5", s, m)],
    ["Haiku 4.5", (s, m) => callAnthropic("claude-haiku-4-5-20251001", s, m)],
    ["4o-mini  ", callGpt4oMini],
  ];

  for (const c of CASES) {
    console.log(`\n▸ ${c.label}\n  "${c.msg}"`);
    for (const [name, fn] of CONTENDERS) {
      const r = await fn(system, c.msg).catch((e) => ({ expenses: [{ error: String(e) }], costUsd: 0 }));
      const problems = grade(r.expenses, c.expect);
      console.log(`  ${name}  ${problems.length === 0 ? "✅" : "❌ " + problems.join("; ")}  ($${r.costUsd.toFixed(6)})`);
      console.log(`    ${JSON.stringify(r.expenses)}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
