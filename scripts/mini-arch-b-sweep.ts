// ADDED (cost optimization — round 4b, "architecture B"): round 4a showed mini is
// SAFE for simple logs (it refused every dangerous case) but jumpy at SELF-judging
// escalation, especially in Chinese. Arch B removes that weak link: a DETERMINISTIC
// gate does the risky routing (it only has to catch weekday phrasing, edits, and
// questions — all reliably pattern-matched), mini ONLY extracts (its proven 9/9
// non-weekday zone), and a DETERMINISTIC post-check (mini must return exactly ONE
// item) contains multi-item + the duplication bug without a fragile regex.
//
// This sweep drives the WHOLE pipeline per case and checks two things:
//   • SAFETY  — every should-escalate case must end in 'escalate' (gate OR post-check);
//               a should-escalate case reaching mini-handled is a hard safety failure.
//   • SAVINGS — how many should-handle cases mini actually owns (not over-escalated),
//               and the real mini cost of those.
//
//   npx tsx scripts/mini-arch-b-sweep.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

// ── timezone-safe ground truth (same fmt() the runtime uses) ──
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

// ── THE DETERMINISTIC GATE (candidate for fast-path.ts) ──────────────
// Returns 'mini' only for a plausible SINGLE simple log with no weekday math,
// no edit/delete, and no bundled question. Anything else → 'escalate' (Haiku).
// Biased hard toward 'escalate' — a false 'mini' is the only unsafe direction.

const HAS_NUMBER_RE = /[0-9０-９]|[一二两三四五六七八九十百千万]/;

// Weekday phrasing — mini's ONE proven date-arithmetic weakness (round 3).
const WEEKDAY_RE = new RegExp(
  [
    // English full names (abbreviations intentionally omitted — too many false hits like "sun")
    "\\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\\b",
    // Chinese 星期X / 周X / 礼拜X / 拜X  (X = 一..六/日/天) — NOT 星期前/周末 etc.
    "星期[一二三四五六日天]", "周[一二三四五六日天]", "礼拜[一二三四五六日天]", "拜[一二三四五六]",
    // Malay weekday NAMES (not bare "hari", which appears in "tengah hari" = noon)
    "\\b(isnin|selasa|rabu|khamis|jumaat|sabtu|ahad)\\b",
  ].join("|"),
  "i",
);

// Edit / amend / delete an earlier row — needs the full agent's context.
const AMEND_RE = new RegExp(
  [
    "改成", "改到", "改为", "修改", "改一下", "换成", "删掉", "删除", "不对", "错了", "记错",
    "\\bchange\\b", "\\bupdate\\b", "\\bedit\\b", "\\bfix\\b", "\\bwrong\\b", "\\bdelete\\b",
    "\\bremove\\b", "\\bundo\\b", "\\bcancel\\b", "取消", "刚才", "上一", "那笔",
  ].join("|"),
  "i",
);

// Any question / bundled second request — not a pure log.
const QUESTION_RE = new RegExp(
  ["多少", "几多", "为什么", "怎么", "how much", "how many", "how long", "\\bwhy\\b", "？", "\\?"].join("|"),
  "i",
);

function routeSimpleLog(message: string): "mini" | "escalate" {
  if (!HAS_NUMBER_RE.test(message)) return "escalate"; // no amount → not a clean log
  if (WEEKDAY_RE.test(message)) return "escalate"; // mini's date-math weak spot
  if (AMEND_RE.test(message)) return "escalate"; // edit/delete an earlier row
  if (QUESTION_RE.test(message)) return "escalate"; // a question / bundled request
  return "mini";
}

// ── mini EXTRACT-ONLY (no self-triage) ───────────────────────────────
const CATEGORIES = ["food", "shop", "ent", "trans", "health", "bills", "other"];

function extractPrompt(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  return (
    `Today is ${weekday}, ${today}. Extract EVERY expense the user is logging into the expenses ` +
    `array (usually exactly one). Each: amount (the number spent); category ∈ ` +
    `food/shop/ent/trans/health/bills/other (hotels/lodging → other); currency (SGD by default; ` +
    `令吉/马币/ringgit/RM → MYR; 人民币/RMB → CNY; a bare 块/元/dollars with no country word means ` +
    `SGD, never infer CNY from 块); optional note; date as YYYY-MM-DD (resolve "yesterday", ` +
    `"N days ago", "the Nth of last month" against today above; a month/day with no year = CURRENT ` +
    `year; omit for today). Never invent a detail the user didn't say.`
  );
}

const ITEM_STRICT = {
  type: "object",
  properties: {
    amount: { type: ["number", "null"] },
    category: { type: ["string", "null"], enum: [...CATEGORIES, null] },
    currency: { type: ["string", "null"], enum: ["SGD", "MYR", "CNY", "USD", null] },
    note: { type: ["string", "null"] },
    date: { type: ["string", "null"] },
  },
  required: ["amount", "category", "currency", "note", "date"],
  additionalProperties: false,
} as const;

const PARAMS_STRICT = {
  type: "object",
  properties: { expenses: { type: "array", items: ITEM_STRICT } },
  required: ["expenses"],
  additionalProperties: false,
} as const;

interface MiniResult {
  items: Record<string, unknown>[];
  costUsd: number;
}

async function callMini(system: string, msg: string): Promise<MiniResult> {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: system }, { role: "user", content: msg }],
      tools: [{ type: "function", function: { name: "log_expenses", description: "Extract every expense.", parameters: PARAMS_STRICT, strict: true } }],
      tool_choice: { type: "function", function: { name: "log_expenses" } },
    }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const call = j.choices?.[0]?.message?.tool_calls?.[0];
  const parsed = (call ? JSON.parse(call.function.arguments) : { expenses: [] }) as { expenses?: Record<string, unknown>[] };
  const u = j.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  return { items: parsed.expenses ?? [], costUsd: (u.prompt_tokens * 0.15 + u.completion_tokens * 0.6) / 1e6 };
}

// ── the same battery as round 4a ─────────────────────────────────────
type Kind = "handle" | "escalate";
interface Case {
  label: string; msg: string; kind: Kind;
  amount?: number; currency?: string; date?: string | null;
}
function buildCases(today: Date): Case[] {
  return [
    { label: "cn-no-date", msg: "午餐12块", kind: "handle", amount: 12, date: null },
    { label: "en-no-date", msg: "coffee $5", kind: "handle", amount: 5, date: null },
    { label: "singlish-no-date", msg: "eh lunch 12 dollars lor", kind: "handle", amount: 12, date: null },
    { label: "malay-no-date", msg: "makan tengah hari 12", kind: "handle", amount: 12, date: null },
    { label: "en-today-explicit", msg: "lunch today $12", kind: "handle", amount: 12, date: null },
    { label: "cn-explicit-date", msg: "7月10号买了鞋子80块", kind: "handle", amount: 80, date: `${today.getFullYear()}-07-10` },
    { label: "en-explicit-date", msg: "bought shoes for $80 on July 10", kind: "handle", amount: 80, date: `${today.getFullYear()}-07-10` },
    { label: "cn-yesterday", msg: "昨天打车15块", kind: "handle", amount: 15, date: daysAgo(today, 1) },
    { label: "en-yesterday", msg: "grab ride yesterday $15", kind: "handle", amount: 15, date: daysAgo(today, 1) },
    { label: "malay-yesterday", msg: "beli kopi 5 dolar semalam", kind: "handle", amount: 5, date: daysAgo(today, 1) },
    { label: "cn-3-days-ago", msg: "3天前看医生120块", kind: "handle", amount: 120, date: daysAgo(today, 3) },
    { label: "en-3-days-ago", msg: "doctor visit 3 days ago, $120", kind: "handle", amount: 120, date: daysAgo(today, 3) },
    { label: "cn-day-of-month", msg: "上个月15号交电费90块", kind: "handle", amount: 90, date: dayOfMonthAgo(today, 1, 15) },
    { label: "en-day-of-month", msg: "paid electricity $90 on the 15th of last month", kind: "handle", amount: 90, date: dayOfMonthAgo(today, 1, 15) },
    { label: "cn-ringgit", msg: "买菜35令吉", kind: "handle", amount: 35, currency: "MYR", date: null },
    { label: "en-ringgit", msg: "groceries 35 ringgit", kind: "handle", amount: 35, currency: "MYR", date: null },
    // should-escalate
    { label: "multi-item-cn", msg: "咖啡5块，还有午餐12块", kind: "escalate" },
    { label: "multi-item-en", msg: "coffee $5 and lunch $12", kind: "escalate" },
    { label: "multi-item-singlish", msg: "breakfast 6 dollars then also taxi 20 leh", kind: "escalate" },
    { label: "multi-item-comma-cn", msg: "咖啡5块，午餐12块", kind: "escalate" }, // comma-only, no 还有 — the hard one
    { label: "weekday-cn", msg: "上个星期三买了20块的airpods", kind: "escalate" },
    { label: "weekday-en", msg: "bought airpods $20 last Wednesday", kind: "escalate" },
    { label: "bundled-question", msg: "log lunch $12, and how much did I spend on food this month?", kind: "escalate" },
    { label: "missing-amount", msg: "买了杯咖啡", kind: "escalate" },
    { label: "edit-intent", msg: "把刚才那笔改成15块", kind: "escalate" },
  ];
}

function gradeExtraction(c: Case, item: Record<string, unknown>, today: Date): string[] {
  const problems: string[] = [];
  const amount = typeof item.amount === "number" ? item.amount : undefined;
  if (amount !== c.amount) problems.push(`amount=${amount} (expected ${c.amount})`);
  const cur = typeof item.currency === "string" ? item.currency : "SGD";
  const expectCur = c.currency ?? "SGD";
  if (cur !== expectCur) problems.push(`currency=${cur} (expected ${expectCur})`);
  const gotDate = typeof item.date === "string" ? item.date : null;
  const expectDate = c.date ?? null;
  const dateOk = expectDate === null ? gotDate === null || gotDate === fmt(today) : gotDate === expectDate;
  if (!dateOk) problems.push(`date=${gotDate ?? "(today)"} (expected ${expectDate ?? "today"})`);
  return problems;
}

async function main() {
  const now = new Date();
  const cases = buildCases(now);
  const system = extractPrompt(now);
  const nHandle = cases.filter((c) => c.kind === "handle").length;
  const nEscalate = cases.filter((c) => c.kind === "escalate").length;
  console.log(`Today: ${fmt(now)} (${now.toLocaleDateString("en-US", { weekday: "long" })})`);
  console.log(`Arch B pipeline sweep — ${nHandle} should-handle + ${nEscalate} should-escalate\n`);

  let safetyFailures = 0; // should-escalate that reached mini-handled = UNSAFE
  let miniHandledCorrect = 0; // should-handle mini owned AND got right
  let overEscalated = 0; // should-handle bailed to Haiku (safe, lost saving)
  let miniCost = 0;
  let miniCalls = 0;

  for (const c of cases) {
    const gate = routeSimpleLog(c.msg);
    let finalRoute: string;
    let detail = "";

    if (gate === "escalate") {
      finalRoute = "escalate(gate)";
    } else {
      const mini = await callMini(system, c.msg).catch((e) => ({ items: [{ error: String(e) }], costUsd: 0 } as MiniResult));
      miniCost += mini.costUsd;
      miniCalls++;
      const valid = mini.items.length === 1 && typeof mini.items[0]?.amount === "number" && (mini.items[0].amount as number) > 0;
      if (!valid) {
        finalRoute = "escalate(post-check)";
        detail = `mini returned ${mini.items.length} item(s): ${JSON.stringify(mini.items)}`;
      } else {
        const problems = gradeExtraction(c, mini.items[0], now);
        finalRoute = problems.length ? "mini❌" : "mini✅";
        detail = problems.length ? problems.join("; ") : JSON.stringify(mini.items[0]);
      }
    }

    // evaluate
    let verdict: string;
    if (c.kind === "escalate") {
      if (finalRoute.startsWith("escalate")) verdict = "✅ safely escalated";
      else { verdict = "🚨 UNSAFE — reached mini"; safetyFailures++; }
    } else {
      if (finalRoute === "mini✅") { verdict = "✅ mini handled correctly"; miniHandledCorrect++; }
      else if (finalRoute.startsWith("escalate")) { verdict = "◽ over-escalated (safe, lost saving)"; overEscalated++; }
      else { verdict = "❌ mini handled but WRONG extraction"; }
    }
    const tag = c.kind === "escalate" ? "⤴" : " ";
    console.log(`${tag} ${c.label.padEnd(20)} gate=${gate.padEnd(8)} → ${finalRoute.padEnd(20)} ${verdict}`);
    if (detail) console.log(`     ${detail}`);
  }

  console.log(`\n${"─".repeat(72)}`);
  console.log(`SAFETY  : ${safetyFailures === 0 ? "✅ 0 unsafe (every should-escalate case escalated)" : `🚨 ${safetyFailures} UNSAFE`}`);
  console.log(`SAVINGS : mini owned ${miniHandledCorrect}/${nHandle} should-handle cases correctly; ${overEscalated}/${nHandle} over-escalated to Haiku`);
  console.log(`COST    : ${miniCalls} mini calls, $${miniCost.toFixed(6)} total (avg $${miniCalls ? (miniCost / miniCalls).toFixed(6) : "0"}/handled call)`);
  console.log(`\n(Reference: Haiku warm-cache ≈ $0.0013/call. mini owns the cheap slice; everything else is Haiku either way.)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
