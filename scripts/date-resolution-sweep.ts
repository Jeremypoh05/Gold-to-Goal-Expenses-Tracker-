// ADDED (cost optimization — root-cause investigation): log is the user's single
// most frequent action, and gpt-4o-mini is ~25x cheaper than even padded-Haiku for
// it — but round 3 found ONE reproducible miss: Chinese "上个星期三" resolved to
// exactly 7 days ago (a Tuesday) instead of the correct Wednesday 6 days ago, while
// the identical English "last Wednesday" was correct. This sweep tests EVERY
// relative-date pattern the user asked about (days-ago, all 7 weekdays, weeks,
// months, "N months ago same day", "day of a month N back") in Chinese, English,
// AND Singlish, to find whether this is one unlucky case or a systematic pattern —
// and if systematic, tries ONE concrete fix (forcing a "show your work" reasoning
// field before the date field, a standard technique for improving arithmetic-style
// accuracy on smaller models with no hidden reasoning tokens).
//
//   npx tsx scripts/date-resolution-sweep.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import type Anthropic from "@anthropic-ai/sdk";

// ── ground truth, computed via LOCAL date math (NOT toISOString — that shift
// bug from the last round is exactly why every date here goes through the same
// fmt() helper actually used at runtime, never hand-typed) ──
function fmt(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function daysAgo(today: Date, n: number): string {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return fmt(d);
}
function lastWeekday(today: Date, target: number): string {
  const d = new Date(today);
  const diff = (d.getDay() + 7 - target) % 7 || 7;
  d.setDate(d.getDate() - diff);
  return fmt(d);
}
function monthsAgoSameDay(today: Date, n: number): string {
  const d = new Date(today);
  d.setMonth(d.getMonth() - n);
  return fmt(d);
}
function dayOfMonthAgo(today: Date, monthsBack: number, day: number): string {
  return fmt(new Date(today.getFullYear(), today.getMonth() - monthsBack, day));
}

interface Case {
  label: string;
  msg: string;
  expectDate: string;
}

function buildCases(today: Date): Case[] {
  const WD = [0, 1, 2, 3, 4, 5, 6]; // Sun..Sat
  const cnWeekday = ["日", "一", "二", "三", "四", "五", "六"];
  const enWeekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const cases: Case[] = [
    { label: "cn-yesterday", msg: "昨天买咖啡花了5块", expectDate: daysAgo(today, 1) },
    { label: "en-yesterday", msg: "bought coffee yesterday, $5", expectDate: daysAgo(today, 1) },
    { label: "singlish-yesterday", msg: "yesterday I buy coffee, $5 lor", expectDate: daysAgo(today, 1) },
    { label: "cn-day-before-yesterday", msg: "前天买了本书，20块", expectDate: daysAgo(today, 2) },
    { label: "en-day-before-yesterday", msg: "bought a book the day before yesterday, $20", expectDate: daysAgo(today, 2) },
    { label: "cn-3-days-ago", msg: "3天前吃饭花了15块", expectDate: daysAgo(today, 3) },
    { label: "en-3-days-ago", msg: "3 days ago I spent 15 on food", expectDate: daysAgo(today, 3) },
    { label: "cn-5-days-ago", msg: "5天前买了个mouse，100块", expectDate: daysAgo(today, 5) },
    { label: "singlish-5-days-ago", msg: "5 days ago I bought a mouse, 100 bucks one", expectDate: daysAgo(today, 5) },
  ];
  for (const i of WD) {
    cases.push({
      label: `cn-last-星期${cnWeekday[i]}`,
      msg: `上个星期${cnWeekday[i]}买了东西，10块`,
      expectDate: lastWeekday(today, i),
    });
    cases.push({
      label: `en-last-${enWeekday[i]}`,
      msg: `bought something last ${enWeekday[i]}, $10`,
      expectDate: lastWeekday(today, i),
    });
  }
  cases.push(
    { label: "cn-two-weeks-ago", msg: "两个星期前买了衣服，40块", expectDate: daysAgo(today, 14) },
    { label: "en-two-weeks-ago", msg: "bought clothes two weeks ago, $40", expectDate: daysAgo(today, 14) },
    { label: "cn-last-month-15th", msg: "上个月15号买了本书，30块", expectDate: dayOfMonthAgo(today, 1, 15) },
    { label: "en-last-month-15th", msg: "bought a book on the 15th of last month, $30", expectDate: dayOfMonthAgo(today, 1, 15) },
    { label: "cn-two-months-ago-25th", msg: "上两个月25号买了鞋子，60块", expectDate: dayOfMonthAgo(today, 2, 25) },
    { label: "en-two-months-ago-25th", msg: "bought shoes on the 25th, two months ago, $60", expectDate: dayOfMonthAgo(today, 2, 25) },
    { label: "cn-half-year-ago", msg: "半年前买了个包，200块", expectDate: monthsAgoSameDay(today, 6) },
    { label: "en-six-months-ago", msg: "bought a bag six months ago, $200", expectDate: monthsAgoSameDay(today, 6) },
    { label: "cn-one-month-ago-today", msg: "一个月前的今天买了个杯子，12块", expectDate: monthsAgoSameDay(today, 1) },
    { label: "en-one-month-ago-today", msg: "bought a cup one month ago today, $12", expectDate: monthsAgoSameDay(today, 1) },
  );
  return cases;
}

// gpt-4o-mini strict mode requires every property in `required` — nullable
// (type array incl. "null") is how a field stays effectively optional.
const LOG_TOOL_PARAMS_STRICT = {
  type: "object",
  properties: {
    amount: { type: "number" },
    date: { type: ["string", "null"], description: "YYYY-MM-DD, resolved against today. null for today." },
  },
  required: ["amount", "date"],
  additionalProperties: false,
} as const;

// Anthropic tool schema — `required` may be a strict subset, no nullable dance needed.
const LOG_TOOL_PARAMS = {
  type: "object",
  properties: {
    amount: { type: "number" },
    date: { type: "string", description: "YYYY-MM-DD, resolved against today. Omit for today." },
  },
  required: ["amount"],
  additionalProperties: false,
} as const;

// FIX ATTEMPT: force a "show your work" reasoning field BEFORE the date field —
// a standard technique for arithmetic-style accuracy on models with no hidden
// reasoning tokens (gpt-4o-mini has none; forcing it to articulate the day-count
// in the structured output itself, in generation order, gives it a scratchpad).
const LOG_TOOL_PARAMS_WITH_REASONING = {
  type: "object",
  properties: {
    amount: { type: "number" },
    dateReasoning: {
      type: ["string", "null"],
      description:
        "Show your work: state today's weekday, identify the target weekday/offset the user " +
        "mentioned, count the exact number of days back, then state the resulting date.",
    },
    date: { type: ["string", "null"], description: "YYYY-MM-DD — must match the date you derived in dateReasoning." },
  },
  required: ["amount", "dateReasoning", "date"],
  additionalProperties: false,
} as const;

function systemPrompt(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  return (
    `Today is ${weekday}, ${today}. Extract the amount and resolve any relative date mentioned ` +
    `against today's date above. A month/day given without a year means the CURRENT year. Never ` +
    `invent a date the user didn't reference — omit the field if none was mentioned.`
  );
}

async function callGpt4oMini(system: string, msg: string, withReasoning: boolean): Promise<{ date?: string; dateReasoning?: string; costUsd: number }> {
  const params = withReasoning ? LOG_TOOL_PARAMS_WITH_REASONING : LOG_TOOL_PARAMS_STRICT;
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: msg },
      ],
      tools: [{ type: "function", function: { name: "log_expense", description: "Extract.", parameters: params, strict: true } }],
      tool_choice: { type: "function", function: { name: "log_expense" } },
    }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const call = j.choices?.[0]?.message?.tool_calls?.[0];
  const fields = call ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
  const u = j.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  return {
    date: typeof fields.date === "string" ? fields.date : undefined,
    dateReasoning: typeof fields.dateReasoning === "string" ? fields.dateReasoning : undefined,
    costUsd: (u.prompt_tokens * 0.15 + u.completion_tokens * 0.6) / 1e6,
  };
}

async function callAnthropic(model: string, system: string, msg: string): Promise<{ date?: string; costUsd: number }> {
  const AnthropicSDK = (await import("@anthropic-ai/sdk")).default;
  const client = new AnthropicSDK({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model,
    max_tokens: 300,
    thinking: { type: "disabled" },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    tools: [{ name: "log_expense", description: "Extract.", input_schema: LOG_TOOL_PARAMS as never }],
    tool_choice: { type: "tool", name: "log_expense" },
    messages: [{ role: "user", content: msg }],
  });
  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const input = (block?.input ?? {}) as Record<string, unknown>;
  const u = res.usage;
  const rates: Record<string, [number, number]> = { "claude-sonnet-5": [2, 10], "claude-haiku-4-5-20251001": [1, 5] };
  const [inRate, outRate] = rates[model] ?? [2, 10];
  const costUsd =
    (u.input_tokens * inRate + (u.cache_read_input_tokens ?? 0) * inRate * 0.1 + (u.cache_creation_input_tokens ?? 0) * inRate * 1.25 + u.output_tokens * outRate) / 1e6;
  return { date: typeof input.date === "string" ? input.date : undefined, costUsd };
}

async function main() {
  const now = new Date();
  const cases = buildCases(now);
  const system = systemPrompt(now);

  console.log(`Today: ${fmt(now)} (${now.toLocaleDateString("en-US", { weekday: "long" })})\n`);
  console.log("── Phase 1: broad sweep — gpt-4o-mini (plain) vs Sonnet vs Haiku ──\n");

  let miniPass = 0;
  let miniCnFails = 0;
  let miniEnFails = 0;
  const miniFailures: { label: string; msg: string; got?: string; expect: string }[] = [];

  for (const c of cases) {
    const [mini, sonnet, haiku] = await Promise.all([
      callGpt4oMini(system, c.msg, false),
      callAnthropic("claude-sonnet-5", system, c.msg),
      callAnthropic("claude-haiku-4-5-20251001", system, c.msg),
    ]);
    const miniOk = mini.date === c.expectDate;
    const sonnetOk = sonnet.date === c.expectDate;
    const haikuOk = haiku.date === c.expectDate;
    miniPass += miniOk ? 1 : 0;
    if (!miniOk) {
      const isCn = /[一-鿿]/.test(c.msg);
      if (isCn) miniCnFails++; else miniEnFails++;
      miniFailures.push({ label: c.label, msg: c.msg, got: mini.date, expect: c.expectDate });
    }
    console.log(
      `${miniOk ? "✅" : "❌"} [expect ${c.expectDate}] ${c.label.padEnd(24)} mini=${mini.date ?? "—"}  sonnet=${sonnetOk ? "✓" : sonnet.date}  haiku=${haikuOk ? "✓" : haiku.date}`,
    );
  }

  console.log(`\n${"─".repeat(70)}`);
  console.log(`gpt-4o-mini: ${miniPass}/${cases.length} correct. CN failures: ${miniCnFails}, EN/Singlish failures: ${miniEnFails}`);
  if (miniFailures.length) {
    console.log("\nFailure detail:");
    for (const f of miniFailures) console.log(`  ${f.label}: "${f.msg}" → got ${f.got ?? "(omitted)"}, expected ${f.expect}`);
  }

  // ── Phase 2: fix attempt — only re-test the cases mini got wrong, WITH a forced
  // reasoning field, to see if "showing its work" fixes the specific failures.
  if (miniFailures.length > 0) {
    console.log(`\n${"─".repeat(70)}`);
    console.log("── Phase 2: fix attempt — same failing cases, WITH forced reasoning field ──\n");
    let fixedCount = 0;
    for (const f of miniFailures) {
      const c = cases.find((c) => c.label === f.label)!;
      const withReasoning = await callGpt4oMini(system, c.msg, true);
      const ok = withReasoning.date === c.expectDate;
      fixedCount += ok ? 1 : 0;
      console.log(`${ok ? "✅ FIXED" : "❌ still wrong"} ${f.label}: got ${withReasoning.date ?? "(omitted)"}, expected ${c.expectDate}`);
      if (withReasoning.dateReasoning) console.log(`   reasoning: ${withReasoning.dateReasoning}`);
    }
    console.log(`\nForced-reasoning fix: ${fixedCount}/${miniFailures.length} of the previously-failing cases now correct.`);
  } else {
    console.log("\n(no failures to re-test with the reasoning fix)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
