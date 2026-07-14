// ADDED (cost optimization — round 4): tests the user's NARROW proposal that the
// three earlier rounds never isolated — route ONLY the simplest single-item creates
// (no date = today, an explicit calendar date, or a NON-weekday relative like
// "yesterday"/"3 days ago"/"the 15th of last month") to gpt-4o-mini, and escalate
// ANYTHING with weekday phrasing or multiple items to Haiku. Rounds 1-3 killed mini
// for the WHOLE log tier; round 3's own data showed mini was 9/9 on exactly this
// non-weekday single-item slice. This battery confirms (or refutes) that directly,
// and — just as important — checks mini can SELF-FLAG the cases it must NOT handle
// (multi-item, weekday, bundled question, missing amount, edit) via an `escalate`
// signal, which is what makes the mini-first triage safe.
//
//   npx tsx scripts/model-compare-simple-log.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import type Anthropic from "@anthropic-ai/sdk";

// ── timezone-safe ground truth (same fmt() the runtime uses; never toISOString) ──
function fmt(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function daysAgo(today: Date, n: number): string {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return fmt(d);
}
function dayOfMonthAgo(today: Date, monthsBack: number, day: number): string {
  return fmt(new Date(today.getFullYear(), today.getMonth() - monthsBack, day));
}

type Kind = "handle" | "escalate";
interface Case {
  label: string;
  msg: string;
  kind: Kind;
  // for kind==="handle": what a correct single-item extraction looks like.
  amount?: number;
  category?: string;
  currency?: string; // omit = SGD default
  date?: string | null; // null/undefined = today; a YYYY-MM-DD string otherwise
}

function buildCases(today: Date): Case[] {
  return [
    // ── SHOULD-HANDLE: the exact slice we want mini to own ──
    { label: "cn-no-date", msg: "午餐12块", kind: "handle", amount: 12, category: "food", date: null },
    { label: "en-no-date", msg: "coffee $5", kind: "handle", amount: 5, category: "food", date: null },
    { label: "singlish-no-date", msg: "eh lunch 12 dollars lor", kind: "handle", amount: 12, category: "food", date: null },
    { label: "malay-no-date", msg: "makan tengah hari 12", kind: "handle", amount: 12, category: "food", date: null },
    { label: "en-today-explicit", msg: "lunch today $12", kind: "handle", amount: 12, category: "food", date: null },
    { label: "cn-explicit-date", msg: "7月10号买了鞋子80块", kind: "handle", amount: 80, category: "shop", date: `${today.getFullYear()}-07-10` },
    { label: "en-explicit-date", msg: "bought shoes for $80 on July 10", kind: "handle", amount: 80, category: "shop", date: `${today.getFullYear()}-07-10` },
    { label: "cn-yesterday", msg: "昨天打车15块", kind: "handle", amount: 15, category: "trans", date: daysAgo(today, 1) },
    { label: "en-yesterday", msg: "grab ride yesterday $15", kind: "handle", amount: 15, category: "trans", date: daysAgo(today, 1) },
    { label: "malay-yesterday", msg: "beli kopi 5 dolar semalam", kind: "handle", amount: 5, category: "food", date: daysAgo(today, 1) },
    { label: "cn-3-days-ago", msg: "3天前看医生120块", kind: "handle", amount: 120, category: "health", date: daysAgo(today, 3) },
    { label: "en-3-days-ago", msg: "doctor visit 3 days ago, $120", kind: "handle", amount: 120, category: "health", date: daysAgo(today, 3) },
    { label: "cn-day-of-month", msg: "上个月15号交电费90块", kind: "handle", amount: 90, category: "bills", date: dayOfMonthAgo(today, 1, 15) },
    { label: "en-day-of-month", msg: "paid electricity $90 on the 15th of last month", kind: "handle", amount: 90, category: "bills", date: dayOfMonthAgo(today, 1, 15) },
    { label: "cn-ringgit", msg: "买菜35令吉", kind: "handle", amount: 35, category: "food", currency: "MYR", date: null },
    { label: "en-ringgit", msg: "groceries 35 ringgit", kind: "handle", amount: 35, category: "food", currency: "MYR", date: null },

    // ── SHOULD-ESCALATE: the cases mini must self-flag (escalate=true) ──
    { label: "multi-item-cn", msg: "咖啡5块，还有午餐12块", kind: "escalate" },
    { label: "multi-item-en", msg: "coffee $5 and lunch $12", kind: "escalate" },
    { label: "multi-item-singlish", msg: "breakfast 6 dollars then also taxi 20 leh", kind: "escalate" },
    { label: "weekday-cn", msg: "上个星期三买了20块的airpods", kind: "escalate" },
    { label: "weekday-en", msg: "bought airpods $20 last Wednesday", kind: "escalate" },
    { label: "bundled-question", msg: "log lunch $12, and how much did I spend on food this month?", kind: "escalate" },
    { label: "missing-amount", msg: "买了杯咖啡", kind: "escalate" },
    { label: "edit-intent", msg: "把刚才那笔改成15块", kind: "escalate" },
  ];
}

const CATEGORIES = ["food", "shop", "ent", "trans", "health", "bills", "other"];

// A compact production-shaped prompt: the currency word-map (bare 块 in SG/MY =
// dollars, NOT CNY) + category set + the escalate rule that keeps the two known
// mini failure modes (weekday math, multi-item duplication) out of mini entirely.
function systemPrompt(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  return (
    `Today is ${weekday}, ${today}. You log ONE simple new expense from the user's message.\n` +
    `Set escalate=true (and skip the other fields) if ANY of these hold: the message describes MORE ` +
    `THAN ONE expense; it uses a weekday relative date ("last Wednesday", "上个星期三"); it also asks ` +
    `a question or bundles a second request; it edits/deletes an earlier expense; or the amount is ` +
    `missing/ambiguous. Otherwise escalate=false and extract:\n` +
    `- amount: the number spent.\n` +
    `- category: one of food/shop/ent/trans/health/bills/other. Hotels/lodging → other.\n` +
    `- currency: SGD default. 令吉/马币/ringgit/RM → MYR; 人民币/RMB → CNY; 新币 → SGD. The user is in ` +
    `Singapore/Malaysia — a bare 块/元/dollars with no country word means SGD, never infer CNY from 块.\n` +
    `- date: YYYY-MM-DD if a specific/relative date was given (resolve "yesterday", "3 days ago", ` +
    `"the 15th of last month" against today above; a month/day with no year = CURRENT year). null for today.\n` +
    `Never invent a detail the user didn't say.`
  );
}

// strict-mode (gpt-4o-mini): every property must be in `required`; nullable = optional.
const PARAMS_STRICT = {
  type: "object",
  properties: {
    escalate: { type: "boolean", description: "true = do NOT handle here (see rules), leave other fields null." },
    amount: { type: ["number", "null"] },
    category: { type: ["string", "null"], enum: [...CATEGORIES, null] },
    currency: { type: ["string", "null"], enum: ["SGD", "MYR", "CNY", "USD", null] },
    date: { type: ["string", "null"], description: "YYYY-MM-DD or null for today." },
  },
  required: ["escalate", "amount", "category", "currency", "date"],
  additionalProperties: false,
} as const;

// Anthropic (Haiku/Sonnet): `required` may be a strict subset, no nullable dance.
const PARAMS_ANTHROPIC = {
  type: "object",
  properties: {
    escalate: { type: "boolean", description: "true = do NOT handle here (see rules)." },
    amount: { type: "number" },
    category: { type: "string", enum: CATEGORIES },
    currency: { type: "string", enum: ["SGD", "MYR", "CNY", "USD"] },
    date: { type: "string", description: "YYYY-MM-DD, omit for today." },
  },
  required: ["escalate"],
  additionalProperties: false,
} as const;

interface Extract {
  escalate: boolean;
  amount?: number;
  category?: string;
  currency?: string;
  date?: string;
  costUsd: number;
  raw: Record<string, unknown>;
}

async function callGpt4oMini(system: string, msg: string): Promise<Extract> {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: system }, { role: "user", content: msg }],
      tools: [{ type: "function", function: { name: "log_expense", description: "Extract or escalate.", parameters: PARAMS_STRICT, strict: true } }],
      tool_choice: { type: "function", function: { name: "log_expense" } },
    }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const call = j.choices?.[0]?.message?.tool_calls?.[0];
  const f = (call ? JSON.parse(call.function.arguments) : {}) as Record<string, unknown>;
  const u = j.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  return {
    escalate: f.escalate === true,
    amount: typeof f.amount === "number" ? f.amount : undefined,
    category: typeof f.category === "string" ? f.category : undefined,
    currency: typeof f.currency === "string" ? f.currency : undefined,
    date: typeof f.date === "string" ? f.date : undefined,
    costUsd: (u.prompt_tokens * 0.15 + u.completion_tokens * 0.6) / 1e6,
    raw: f,
  };
}

async function callAnthropic(model: string, system: string, msg: string): Promise<Extract> {
  const AnthropicSDK = (await import("@anthropic-ai/sdk")).default;
  const client = new AnthropicSDK({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model,
    max_tokens: 300,
    thinking: { type: "disabled" },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    tools: [{ name: "log_expense", description: "Extract or escalate.", input_schema: PARAMS_ANTHROPIC as never }],
    tool_choice: { type: "tool", name: "log_expense" },
    messages: [{ role: "user", content: msg }],
  });
  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const f = (block?.input ?? {}) as Record<string, unknown>;
  const u = res.usage;
  const rates: Record<string, [number, number]> = { "claude-sonnet-5": [2, 10], "claude-haiku-4-5-20251001": [1, 5] };
  const [inRate, outRate] = rates[model] ?? [2, 10];
  const costUsd =
    (u.input_tokens * inRate + (u.cache_read_input_tokens ?? 0) * inRate * 0.1 + (u.cache_creation_input_tokens ?? 0) * inRate * 1.25 + u.output_tokens * outRate) / 1e6;
  return {
    escalate: f.escalate === true,
    amount: typeof f.amount === "number" ? f.amount : undefined,
    category: typeof f.category === "string" ? f.category : undefined,
    currency: typeof f.currency === "string" ? f.currency : undefined,
    date: typeof f.date === "string" ? f.date : undefined,
    costUsd,
    raw: f,
  };
}

// today = null-date means today; accept either null or today's fmt from the model.
function grade(c: Case, e: Extract, today: Date): string[] {
  const problems: string[] = [];
  if (c.kind === "escalate") {
    if (!e.escalate) problems.push(`should ESCALATE but escalate=false (got ${JSON.stringify(e.raw)})`);
    return problems;
  }
  // kind === "handle"
  if (e.escalate) {
    problems.push("wrongly escalated a case mini SHOULD handle");
    return problems;
  }
  if (e.amount !== c.amount) problems.push(`amount=${e.amount} (expected ${c.amount})`);
  const expectCur = c.currency ?? "SGD";
  if ((e.currency ?? "SGD") !== expectCur) problems.push(`currency=${e.currency} (expected ${expectCur})`);
  const gotDate = e.date ?? null;
  const expectDate = c.date ?? null;
  const dateOk = expectDate === null ? gotDate === null || gotDate === fmt(today) : gotDate === expectDate;
  if (!dateOk) problems.push(`date=${gotDate ?? "(today)"} (expected ${expectDate ?? "today"})`);
  // category is softer (model taste) — report as a note, don't fail the case on it.
  if (e.category !== c.category) problems.push(`~category=${e.category} (expected ${c.category}) [soft]`);
  return problems;
}

// a "hard" fail ignores the [soft] category-only notes.
const isHardFail = (problems: string[]) => problems.some((p) => !p.endsWith("[soft]"));

async function main() {
  const now = new Date();
  const cases = buildCases(now);
  const system = systemPrompt(now);
  console.log(`Today: ${fmt(now)} (${now.toLocaleDateString("en-US", { weekday: "long" })})`);
  console.log(`Battery: ${cases.filter((c) => c.kind === "handle").length} should-handle + ${cases.filter((c) => c.kind === "escalate").length} should-escalate\n`);

  const tally: Record<string, { hard: number; soft: number; cost: number }> = {
    mini: { hard: 0, soft: 0, cost: 0 },
    haiku: { hard: 0, soft: 0, cost: 0 },
  };

  for (const c of cases) {
    const [mini, haiku] = await Promise.all([
      callGpt4oMini(system, c.msg).catch((e) => ({ escalate: false, costUsd: 0, raw: { error: String(e) } } as Extract)),
      callAnthropic("claude-haiku-4-5-20251001", system, c.msg).catch((e) => ({ escalate: false, costUsd: 0, raw: { error: String(e) } } as Extract)),
    ]);
    const mp = grade(c, mini, now);
    const hp = grade(c, haiku, now);
    tally.mini.cost += mini.costUsd;
    tally.haiku.cost += haiku.costUsd;
    if (!isHardFail(mp)) tally.mini.hard++;
    if (mp.length === 0) tally.mini.soft++;
    if (!isHardFail(hp)) tally.haiku.hard++;
    if (hp.length === 0) tally.haiku.soft++;

    const tag = c.kind === "escalate" ? "⤴" : " ";
    console.log(`${tag} ${c.label.padEnd(20)} "${c.msg}"`);
    console.log(`    mini : ${isHardFail(mp) ? "❌ " + mp.join("; ") : mp.length ? "✅ (" + mp.join("; ") + ")" : "✅"}`);
    console.log(`    haiku: ${isHardFail(hp) ? "❌ " + hp.join("; ") : hp.length ? "✅ (" + hp.join("; ") + ")" : "✅"}`);
  }

  const n = cases.length;
  console.log(`\n${"─".repeat(72)}`);
  console.log(`gpt-4o-mini : ${tally.mini.hard}/${n} hard-pass, ${tally.mini.soft}/${n} incl. category  ·  $${tally.mini.cost.toFixed(6)} total  (avg $${(tally.mini.cost / n).toFixed(6)}/call)`);
  console.log(`Haiku 4.5   : ${tally.haiku.hard}/${n} hard-pass, ${tally.haiku.soft}/${n} incl. category  ·  $${tally.haiku.cost.toFixed(6)} total  (avg $${(tally.haiku.cost / n).toFixed(6)}/call)`);
  console.log(`\n(hard-pass = amount+currency+date+escalate correct; category is a soft note. Note: Haiku cost here is UNCACHED single calls — production Haiku warm-cache reads at 0.1x.)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
