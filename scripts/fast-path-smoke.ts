// ADDED (cost optimization — fast-path router): headless smoke test for the v3
// router in src/lib/assistant/fast-path.ts. Verifies every routing outcome against
// real data:
//   GATE-SKIP — the zero-cost deterministic gate rejects it (NO API call at all)
//   LOG       — clean create(s) → 1-3 proposal cards
//   AMEND     — corrects the just-logged expense (context) → update/replacement card
//   DELETE    — deletes the just-logged expense (context) → delete card or
//               tap-Cancel guidance for a never-confirmed card
//   TOTAL     — simple spend total → deterministic templated answer
//   SEARCH    — read-only list/find/biggest-smallest → templated answer (2026-07-15)
//   CLARIFY   — classifier asks ONE missing-detail question directly (2026-07-15)
//   ESCALATE  — the classifier declines → full agent (unchanged)
//   FUTURE    — a future-dated log → canned text decline
//
//   npx tsx scripts/fast-path-smoke.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import type { LastExpenseContext } from "../src/lib/assistant/fast-path";
import type { Proposal } from "../src/lib/assistant/types";

type Expect = "log" | "amend" | "delete" | "total" | "search" | "clarify" | "oos" | "escalate" | "gate-skip" | "future";
interface Case {
  msg: string;
  expect: Expect;
  /** Simulated last-logged expense (the session context). */
  ctx?: LastExpenseContext | null;
  /** Extra assertion on a non-null result. */
  check?: (r: { reply: string; proposals: Proposal[] }) => string | null;
}

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { tryFastPath, fastPathGate } = await import("../src/lib/assistant/fast-path");

  const user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!user) throw new Error("No user rows in the DB — sign in once first.");
  console.log(`Testing as user ${user.id} (${user.name ?? "no name"})\n`);

  // A CONFIRMED context built from a real row (the Jun-25 hotel) so amend/delete
  // row-resolution (exact amount+spentAt match) can find an actual expense id.
  const hotelRow = await prisma.expense.findFirst({
    where: { userId: user.id, amount: 550 },
    orderBy: { createdAt: "desc" },
  });
  if (!hotelRow) throw new Error("Expected the Jun-25 550 hotel rows in the dev DB.");
  const HOTEL_CTX: LastExpenseContext = {
    fields: {
      amount: Number(hotelRow.amount),
      currency: hotelRow.currency as LastExpenseContext["fields"]["currency"],
      category: hotelRow.category as LastExpenseContext["fields"]["category"],
      note: hotelRow.note ?? "",
      tags: hotelRow.tags,
      spentAt: hotelRow.spentAt.toISOString(),
    },
    outcome: "confirmed",
  };
  // A PENDING (never-confirmed) $12 lunch card — deliberately matches NO real row.
  const PENDING_LUNCH_CTX: LastExpenseContext = {
    fields: {
      amount: 12.34,
      currency: "SGD",
      category: "food",
      note: "lunch",
      tags: [],
      spentAt: new Date().toISOString(),
    },
    outcome: "pending",
  };

  const CASES: Case[] = [
    // ── GATE-SKIP: zero-cost, no classifier call ──
    { msg: "why did I spend so much in March?", expect: "gate-skip" },
    { msg: "为什么我上个月花了那么多？", expect: "gate-skip" },
    { msg: "我需要多久才能存到10万？", expect: "gate-skip" },
    { msg: "change my rent to 1300", expect: "gate-skip" }, // recurring keyword
    // "biggest/find/list" now PERMIT into the classifier (search_query intent, 2026-07-15)
    // instead of a zero-cost SKIP_RE block — "this year" isn't a supported period, so the
    // classifier itself (not the free gate) correctly bails to escalate. Net cost: one
    // extra Haiku call for this specific unsupported-period phrasing; other biggest/find/
    // list phrasings now resolve cheaply instead of always paying for Sonnet — see below.
    { msg: "find my biggest expense this year", expect: "escalate" },
    { msg: "what's my biggest expense this month?", expect: "search" },
    { msg: "帮我找一下这个月最便宜的一笔", expect: "search" },
    // CHANGED (2026-07-17, default-classifier gate): these two used to be zero-cost
    // gate-skips; now Haiku sees them. "delete the grab ride" → delete_search with no
    // matching row → escalate (Sonnet searches harder). "log something for lunch" →
    // domain-correct but missing the amount → Haiku asks via clarify (was a Sonnet turn).
    { msg: "delete the grab ride from last week", expect: "escalate" },
    { msg: "log something for lunch", expect: "clarify" },
    { msg: "把我的工资改成5000", expect: "gate-skip" }, // income
    { msg: "how much did I spend per day on average?", expect: "gate-skip" }, // average → deep analysis
    // ── OUT OF SCOPE (2026-07-17): 三件套 now answered by Haiku, NOT Sonnet ──
    { msg: "今天天气怎么样？", expect: "oos" },
    {
      msg: "can you export my expenses to Excel?",
      expect: "oos",
      check: (r) => (r.reply.includes("jeremypoh0205@gmail.com") ? null : "unsupported-feature reply lacks the feedback email"),
    },
    { msg: "which stocks should I buy to get rich?", expect: "oos" },
    // ── LOG ──
    { msg: "log $12 lunch at the hawker centre today", expect: "log" },
    {
      msg: "今天买了咖啡5块，还有午餐12块",
      expect: "log",
      check: (r) => (r.proposals.length === 2 ? null : `expected 2 cards, got ${r.proposals.length}`),
    },
    {
      msg: "再来一个六月二十五号酒店的费用五百五十块新币",
      expect: "log",
      check: (r) => (r.proposals[0]?.duplicate ? null : "expected duplicate warning (DB has Jun-25 550 rows)"),
    },
    // ── AMEND (context-dependent) ──
    {
      msg: "改成600块",
      expect: "amend",
      ctx: HOTEL_CTX,
      check: (r) =>
        r.proposals[0]?.kind === "update_expense" ? null : `expected update card, got ${r.proposals[0]?.kind}`,
    },
    {
      msg: "wrong, it should be 15 and tag it work",
      expect: "amend",
      ctx: PENDING_LUNCH_CTX,
      check: (r) =>
        r.proposals[0]?.kind === "create_expense"
          ? null
          : `expected replacement create card, got ${r.proposals[0]?.kind}`,
    },
    // 2026-07-15: "to 10" is genuinely ambiguous (new amount, or move the date to the
    // 10th?) — the classifier now asks that directly via `clarify` (cheap, fast) instead
    // of escalating just to have Sonnet ask the same question. Not a regression.
    { msg: "change my coffee from Tuesday to 10", expect: "clarify", ctx: HOTEL_CTX },
    // ── DELETE (context-dependent) ──
    {
      msg: "删掉刚才那个",
      expect: "delete",
      ctx: HOTEL_CTX,
      check: (r) =>
        r.proposals[0]?.kind === "delete_expense" ? null : `expected delete card, got ${r.proposals[0]?.kind}`,
    },
    {
      msg: "delete that",
      expect: "delete",
      ctx: PENDING_LUNCH_CTX,
      check: (r) =>
        r.proposals.length === 0 && /cancel/i.test(r.reply)
          ? null
          : `expected text-only tap-Cancel guidance, got ${r.proposals.length} cards / "${r.reply}"`,
    },
    // ── TOTAL ──
    { msg: "这个月花了多少？", expect: "total" },
    { msg: "how much did I spend on food this month?", expect: "total" },
    // ── ESCALATE / FUTURE ──
    { msg: "log lunch 12 today, and did I overspend this week?", expect: "gate-skip" }, // "overspend" → deep-analysis skip
    { msg: "log lunch 12 today, and how much did I spend on food this month?", expect: "escalate" }, // multi-intent
    { msg: "do another one for the 16th, like we just discussed", expect: "escalate" },
    { msg: "record 100 for a concert ticket on 2026-12-25", expect: "future" },
  ];

  let pass = 0;
  for (const c of CASES) {
    const ctx = c.ctx ?? null;
    const gateOpen = fastPathGate(c.msg);
    const started = Date.now();
    const result = gateOpen ? await tryFastPath(user.id, c.msg, new Date(), ctx) : null;
    const secs = ((Date.now() - started) / 1000).toFixed(1);

    let actual: Expect;
    if (!gateOpen) actual = "gate-skip";
    else if (result == null) actual = "escalate";
    else if (result.proposals.length === 0) {
      // Disambiguate text-only replies: `handled` marks the oos/clarify mechanisms
      // explicitly; otherwise analyze_spending = total_query, find_expenses =
      // search_query, and the reply wording separates future-decline / tap-Cancel.
      actual =
        result.handled === "out_of_scope"
          ? "oos"
          : result.handled === "clarify"
            ? "clarify"
            : /future|还没到|hasn't happened/i.test(result.reply)
              ? "future"
              : /cancel/i.test(result.reply)
                ? "delete"
                : result.toolsUsed.includes("analyze_spending")
                  ? "total"
                  : result.toolsUsed.includes("find_expenses")
                    ? "search"
                    : "clarify";
    } else {
      const kind = result.proposals[0].kind;
      actual = kind === "update_expense" ? "amend" : kind === "delete_expense" ? "delete" : "log";
      // A replacement-create IS the amend outcome when the card was never confirmed.
      if (c.expect === "amend" && kind === "create_expense") actual = "amend";
    }
    let ok = actual === c.expect;
    let detail = "";
    if (ok && c.check && result) {
      const err = c.check(result);
      if (err) {
        ok = false;
        detail = ` — ${err}`;
      }
    }
    pass += ok ? 1 : 0;
    console.log(
      `${ok ? "✅" : "❌"} (${secs}s) [expect ${c.expect.toUpperCase()}, got ${actual.toUpperCase()}${detail}] "${c.msg}"`,
    );
    if (result) {
      console.log(`    reply: ${result.reply}`);
      for (const p of result.proposals) {
        console.log(`    card [${p.kind}]: ${p.summary}${p.duplicate ? "  ⚠ DUPLICATE" : ""}`);
      }
    }
  }
  console.log(`\n${pass}/${CASES.length} matched expected routing.`);
  if (pass !== CASES.length) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
