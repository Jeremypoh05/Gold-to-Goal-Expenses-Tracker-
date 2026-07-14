// ADDED (cost optimization — fast-path router): headless smoke test for the v3
// router in src/lib/assistant/fast-path.ts. Verifies every routing outcome against
// real data:
//   GATE-SKIP — the zero-cost deterministic gate rejects it (NO API call at all)
//   LOG       — clean create(s) → 1-3 proposal cards
//   AMEND     — corrects the just-logged expense (context) → update/replacement card
//   DELETE    — deletes the just-logged expense (context) → delete card or
//               tap-Cancel guidance for a never-confirmed card
//   TOTAL     — simple spend total → deterministic templated answer
//   ESCALATE  — the classifier declines → full agent (unchanged)
//   FUTURE    — a future-dated log → canned text decline
//
//   npx tsx scripts/fast-path-smoke.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import type { LastExpenseContext } from "../src/lib/assistant/fast-path";
import type { Proposal } from "../src/lib/assistant/types";

type Expect = "log" | "amend" | "delete" | "total" | "escalate" | "gate-skip" | "future";
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
    { msg: "find my biggest expense this year", expect: "gate-skip" },
    { msg: "delete the grab ride from last week", expect: "gate-skip" }, // no number, no context
    { msg: "log something for lunch", expect: "gate-skip" }, // no amount
    { msg: "把我的工资改成5000", expect: "gate-skip" }, // income
    { msg: "how much did I spend per day on average?", expect: "gate-skip" }, // average → deep analysis
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
    { msg: "change my coffee from Tuesday to 10", expect: "escalate", ctx: HOTEL_CTX }, // different expense
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
    const gateOpen = fastPathGate(c.msg, ctx != null);
    const started = Date.now();
    const result = gateOpen ? await tryFastPath(user.id, c.msg, new Date(), ctx) : null;
    const secs = ((Date.now() - started) / 1000).toFixed(1);

    let actual: Expect;
    if (!gateOpen) actual = "gate-skip";
    else if (result == null) actual = "escalate";
    else if (result.proposals.length === 0) {
      actual = /future|还没到|hasn't happened/i.test(result.reply)
        ? "future"
        : /cancel/i.test(result.reply)
          ? "delete"
          : "total";
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
