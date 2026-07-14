// ADDED (cost optimization — mini tuning): the user hit two real extraction bugs in
// the shipped mini path — (1) tags were NEVER returned (the schema had no tags field),
// (2) note got the MEAL TYPE (晚餐/午餐) instead of the item (麦当劳/鸡排). This tests
// the fixed prompt+schema (tags added; note = item/merchant, tags = only what the user
// explicitly marks) on the user's exact examples + multi-item + a 3-item non-weekday
// case (to confirm the duplication guard doesn't need to fire). NOT wired — proves the
// prompt before it goes into fast-path.ts.
//
//   npx tsx scripts/mini-extract-tune.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

function fmt(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function daysAgo(today: Date, n: number): string {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return fmt(d);
}

const CATEGORIES = ["food", "shop", "ent", "trans", "health", "bills", "other"];

// ── PRODUCTION-CANDIDATE prompt + schema (copy verbatim into fast-path.ts if good) ──
function miniPrompt(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  return (
    `Today is ${weekday}, ${today}. Extract EVERY expense the user is logging into the expenses ` +
    `array (1-3 of them; usually just one). For EACH expense:\n` +
    `- amount: the number spent.\n` +
    `- category ∈ ${CATEGORIES.join("/")} (hotels/lodging → other).\n` +
    `- currency: SGD by default; 令吉/马币/ringgit/RM → MYR; 人民币/RMB → CNY; a bare 块/元/dollars ` +
    `with no country word means SGD (never infer CNY from 块).\n` +
    `- note: a SHORT description of WHAT was bought or eaten — the item, dish, or merchant ` +
    `(e.g. "麦当劳", "鸡排", "chicken rice", "Grab ride"). Do NOT use the meal type (晚餐/午餐/breakfast) ` +
    `or the category word as the note; a specific item/merchant always wins. Only fall back to the ` +
    `meal type if that is genuinely the only thing named.\n` +
    `- tags: ONLY labels the user EXPLICITLY asks to tag — signalled by 标签/tag/tags/tag一下/加个标签/` +
    `"tag it". e.g. "标签帮我加晚餐" → ["晚餐"]; "tag it work" → ["work"]; "tag 电脑器材" → ["电脑器材"]. ` +
    `A meal type the user asks to put as a TAG goes here, NOT in note. If no tag is requested, use [].\n` +
    `- date: YYYY-MM-DD (resolve "yesterday"/"N days ago"/"the Nth of last month" against today above; ` +
    `a month/day with no year = CURRENT year); null for today.\n` +
    `Never invent a detail the user didn't say.`
  );
}

const ITEM = {
  type: "object",
  properties: {
    amount: { type: ["number", "null"] },
    category: { type: ["string", "null"], enum: [...CATEGORIES, null] },
    currency: { type: ["string", "null"], enum: ["SGD", "MYR", "CNY", "USD", null] },
    note: { type: ["string", "null"] },
    tags: { type: ["array", "null"], items: { type: "string" } },
    date: { type: ["string", "null"] },
  },
  required: ["amount", "category", "currency", "note", "tags", "date"],
  additionalProperties: false,
} as const;

const PARAMS = {
  type: "object",
  properties: { expenses: { type: "array", items: ITEM } },
  required: ["expenses"],
  additionalProperties: false,
} as const;

async function callMini(system: string, msg: string) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: system }, { role: "user", content: msg }],
      tools: [{ type: "function", function: { name: "log_expenses", description: "Extract every expense.", parameters: PARAMS, strict: true } }],
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

interface ItemExpect { amount: number; noteHas: string; noteNot?: string; tags: string[]; date: string | null; currency?: string }
interface Case { label: string; msg: string; expect: ItemExpect[] }

function buildCases(today: Date): Case[] {
  return [
    {
      label: "user-example-1 (dinner/McD, tag晚餐, 7月7)",
      msg: "help me 记录一个晚餐, 我吃了麦当劳。价格是19.9。标签帮我加晚餐吧。日期是7月7。",
      expect: [{ amount: 19.9, noteHas: "麦当劳", noteNot: "晚餐", tags: ["晚餐"], date: `${today.getFullYear()}-07-07` }],
    },
    {
      label: "user-example-2 (鸡排, tag午餐)",
      msg: "帮我记录吃鸡排20块钱。tag的话帮我加午餐",
      expect: [{ amount: 20, noteHas: "鸡排", noteNot: "午餐", tags: ["午餐"], date: null }],
    },
    {
      label: "english tag",
      msg: "log $5 coffee, tag it work",
      expect: [{ amount: 5, noteHas: "coffee", tags: ["work"], date: null }],
    },
    {
      label: "singlish tag",
      msg: "eh log chicken rice 4.50, tag it lunch lor",
      expect: [{ amount: 4.5, noteHas: "chicken rice", noteNot: "lunch", tags: ["lunch"], date: null }],
    },
    {
      label: "multi-item with tags (2)",
      msg: "早餐吃了麦当劳6块，tag早餐；午餐吃鸡排18块，tag午餐",
      expect: [
        { amount: 6, noteHas: "麦当劳", tags: ["早餐"], date: null },
        { amount: 18, noteHas: "鸡排", tags: ["午餐"], date: null },
      ],
    },
    {
      label: "multi-item non-weekday (3) — dup guard must NOT fire",
      msg: "5天前买了mouse 100块 tag电脑，今天买了powerbank 50块，还有今天买了keyboard 30块",
      expect: [
        { amount: 100, noteHas: "mouse", tags: ["电脑"], date: daysAgo(today, 5) },
        { amount: 50, noteHas: "powerbank", tags: [], date: null },
        { amount: 30, noteHas: "keyboard", tags: [], date: null },
      ],
    },
  ];
}

// Mirror the production post-check + duplication guard so the test reflects reality.
function postCheck(items: Record<string, unknown>[]): { ok: boolean; reason?: string } {
  if (items.length < 1 || items.length > 3) return { ok: false, reason: `count ${items.length} (want 1-3)` };
  for (const it of items) if (typeof it.amount !== "number" || (it.amount as number) <= 0) return { ok: false, reason: "an item has no valid amount" };
  const key = (it: Record<string, unknown>) => `${it.amount}|${it.note ?? ""}|${it.date ?? ""}|${it.category ?? ""}`;
  const last = key(items[items.length - 1]);
  for (let i = 0; i < items.length - 1; i++) if (key(items[i]) === last) return { ok: false, reason: "last item duplicates an earlier one (R3 bug signature) → escalate" };
  return { ok: true };
}

function gradeItem(got: Record<string, unknown>, w: ItemExpect, today: Date): string[] {
  const p: string[] = [];
  if (got.amount !== w.amount) p.push(`amount=${got.amount}≠${w.amount}`);
  const note = String(got.note ?? "").toLowerCase();
  if (!note.includes(w.noteHas.toLowerCase())) p.push(`note="${got.note}" missing "${w.noteHas}"`);
  if (w.noteNot && note.includes(w.noteNot.toLowerCase())) p.push(`note="${got.note}" wrongly contains "${w.noteNot}"`);
  const tags = (Array.isArray(got.tags) ? got.tags : []).map((t) => String(t).toLowerCase());
  for (const t of w.tags) if (!tags.some((x) => x.includes(t.toLowerCase()))) p.push(`tags=${JSON.stringify(got.tags)} missing "${t}"`);
  if (w.tags.length === 0 && tags.length > 0) p.push(`tags=${JSON.stringify(got.tags)} should be empty`);
  const gotDate = typeof got.date === "string" ? got.date : null;
  const expectDate = w.date ?? null;
  const dateOk = expectDate === null ? gotDate === null || gotDate === fmt(today) : gotDate === expectDate;
  if (!dateOk) p.push(`date=${gotDate ?? "(today)"}≠${expectDate ?? "today"}`);
  if (w.currency && (got.currency ?? "SGD") !== w.currency) p.push(`currency=${got.currency}≠${w.currency}`);
  return p;
}

async function main() {
  const now = new Date();
  const system = miniPrompt(now);
  console.log(`Today: ${fmt(now)}\n`);
  let pass = 0;
  let cost = 0;
  const cases = buildCases(now);
  for (const c of cases) {
    const r = await callMini(system, c.msg).catch((e) => ({ items: [{ error: String(e) }], costUsd: 0 }));
    cost += r.costUsd;
    const pc = postCheck(r.items);
    let problems: string[] = [];
    if (!pc.ok) {
      problems = [`POST-CHECK would escalate: ${pc.reason}`];
    } else if (r.items.length !== c.expect.length) {
      problems = [`got ${r.items.length} items, expected ${c.expect.length}`];
    } else {
      for (let i = 0; i < c.expect.length; i++) problems.push(...gradeItem(r.items[i], c.expect[i], now).map((p) => `item${i}: ${p}`));
    }
    const ok = problems.length === 0;
    pass += ok ? 1 : 0;
    console.log(`${ok ? "✅" : "❌"} ${c.label}`);
    console.log(`   "${c.msg}"`);
    console.log(`   → ${JSON.stringify(r.items)}`);
    if (!ok) console.log(`   ✗ ${problems.join("; ")}`);
  }
  console.log(`\n${pass}/${cases.length} passed  ·  $${cost.toFixed(6)} total (avg $${(cost / cases.length).toFixed(6)}/call)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
