// ADDED (2026-07-15): real-API verification for the three new fast-path mechanisms
// (user request, 2026-07-14): (A) search_query on Haiku — read-only list/find/biggest
// answered without Sonnet; (B) 2+-match edit_search/delete_search now asks "which one"
// from the candidates we already fetched, instead of escalating; (C) `clarify` — the
// classifier can ask ONE missing-detail question directly, without a Sonnet round-trip.
// Read-only against the dev DB (search_query never writes; edit/delete_search only
// PROPOSE, they don't write either) — safe to run.
//
//   npx tsx scripts/route-expand-verify.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import type { LastExpenseContext } from "../src/lib/assistant/fast-path";
import type { Proposal } from "../src/lib/assistant/types";

function routeLabel(r: { toolsUsed: string[]; proposals: Proposal[] } | null): string {
  if (r === null) return "ESCALATE to Sonnet";
  if (r.proposals.length > 0) return `CARD (${r.toolsUsed.join("+")})`;
  if (r.toolsUsed.includes("find_expenses")) return "TEXT via find_expenses (no card)";
  return "TEXT (no card, no tool)";
}

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { tryFastPath } = await import("../src/lib/assistant/fast-path");
  const now = new Date();

  const user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!user) throw new Error("No user rows — sign in once first.");

  const recent = await prisma.expense.findMany({
    where: { userId: user.id },
    orderBy: { spentAt: "desc" },
    take: 20,
    select: { spentAt: true, amount: true, currency: true, category: true, note: true, fixed: true },
  });
  console.log(`User ${user.id} — recent expenses:`);
  for (const r of recent) {
    console.log(`  ${r.spentAt.toISOString().slice(0, 10)}  ${r.currency}${Number(r.amount).toFixed(2)}  ${r.category}  ${r.note ?? ""}${r.fixed ? "  [recurring]" : ""}`);
  }
  console.log("");

  const shopCount = recent.filter((r) => r.category === "shop" && r.spentAt.toISOString().startsWith(recent[0]?.spentAt.toISOString().slice(0, 10) ?? "")).length;
  console.log(`(rows on the most recent date so far: ${recent.filter((r) => r.spentAt.toISOString().slice(0, 10) === recent[0]?.spentAt.toISOString().slice(0, 10)).length}, shop-category same-day: ${shopCount})\n`);

  const CTX: LastExpenseContext = {
    fields: { amount: 5, currency: "SGD", category: "food", note: "咖啡", tags: [], spentAt: `${now.toISOString().slice(0, 10)}T04:00:00.000Z` },
    outcome: "confirmed",
  };

  console.log("═══ A. search_query (read-only, no Sonnet) ═══");
  const A_CASES = [
    "我这个月shopping类花最多的一笔是什么？",
    "what's the cheapest thing I bought in shopping this month?",
    "帮我列一下这个月food类的消费",
    "find my Netflix charges",
    "查一下我买过的xyz123nonexistent",
  ];
  for (const msg of A_CASES) {
    const r = await tryFastPath(user.id, msg, now, null);
    console.log(`"${msg}"\n   → ${routeLabel(r)}${r?.reply ? `\n   ${r.reply.split("\n").join("\n   ")}` : ""}\n`);
  }

  console.log("═══ B. 2+-match ambiguity → candidates list (no Sonnet) ═══");
  const B_CASES = [
    "把今天的shopping那笔改成50",
    "delete my food expense from today",
    "把7月14号shopping类的改成30", // category+date, still many matches on 7/14
  ];
  for (const msg of B_CASES) {
    const r = await tryFastPath(user.id, msg, now, CTX);
    console.log(`"${msg}"\n   → ${routeLabel(r)}${r?.reply ? `\n   ${r.reply.split("\n").join("\n   ")}` : ""}\n`);
  }

  console.log("═══ B-debug. RAW classifier output for the B cases (bypasses mini/tryFastPath) ═══");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { ROUTE_TOOL, routeSystemPrompt } = await import("../src/lib/assistant/fast-path");
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  for (const msg of B_CASES) {
    const f = CTX.fields;
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      thinking: { type: "disabled" },
      system: [
        { type: "text", text: routeSystemPrompt(now) },
        { type: "text", text: `LAST-LOGGED expense in this chat: S$${f.amount.toFixed(2)} · ${f.category} · ${f.note} · ${f.spentAt?.slice(0, 10)} (card status: ${CTX.outcome}).` },
      ],
      tools: [ROUTE_TOOL],
      tool_choice: { type: "tool", name: "route" },
      messages: [{ role: "user", content: msg }],
    });
    const block = response.content.find((b) => b.type === "tool_use");
    console.log(`"${msg}"\n   raw: ${JSON.stringify(block && "input" in block ? block.input : {})}\n`);
  }

  console.log("═══ C. clarify (missing ONE detail, answered without Sonnet) ═══");
  const C_CASES = [
    { msg: "200", ctx: null as LastExpenseContext | null },
    { msg: "这笔不对，帮我改一下", ctx: CTX },
    { msg: "it's wrong, fix it", ctx: CTX },
  ];
  for (const c of C_CASES) {
    const r = await tryFastPath(user.id, c.msg, now, c.ctx);
    console.log(`"${c.msg}"\n   → ${routeLabel(r)}${r?.reply ? `\n   ${r.reply}` : ""}\n`);
  }

  console.log("═══ D. NEGATIVE CONTROLS — must still cleanly ESCALATE (not hijacked by clarify/search_query) ═══");
  const D_CASES = [
    "为什么我这个月花这么多钱？给我一些建议",
    "log lunch 12 today, and how much have I spent on food this month?",
    "change my rent to 1300",
    "how long until I save 100000?",
  ];
  for (const msg of D_CASES) {
    const r = await tryFastPath(user.id, msg, now, null);
    const ok = r === null ? "✅" : "❌ SHOULD HAVE ESCALATED";
    console.log(`${ok} "${msg}"\n   → ${routeLabel(r)}${r?.reply ? `\n   ${r.reply}` : ""}\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
