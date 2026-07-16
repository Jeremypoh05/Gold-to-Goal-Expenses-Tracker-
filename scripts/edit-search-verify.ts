// ADDED (2026-07-14): verify the new edit_search/delete_search fast-path tier + the
// pending-card routing fix, using the user's REAL bug cases. tryFastPath only PROPOSES
// (proposeUpdate/Delete build a card, never write), so this is read-only against the
// dev DB — safe to run.
//
//   npx tsx scripts/edit-search-verify.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import type { LastExpenseContext } from "../src/lib/assistant/fast-path";
import type { Proposal } from "../src/lib/assistant/types";

/** Decode the route a FastPathResult (or null) represents, from its toolsUsed. */
function routeLabel(r: { toolsUsed: string[]; proposals: Proposal[] } | null): string {
  if (r === null) return "→ ESCALATE to Sonnet (full agent)";
  const t = r.toolsUsed;
  if (t.includes("find_expenses") && t.includes("update_expense")) return "→ Haiku edit_search";
  if (t.includes("find_expenses") && t.includes("delete_expense")) return "→ Haiku delete_search";
  if (t.every((x) => x === "create_expense") && t.length > 0) return "→ mini/Haiku log (create)";
  if (t.includes("update_expense")) return "→ Haiku amend_last (edit just-logged)";
  if (t.includes("delete_expense")) return "→ Haiku delete_last";
  if (t.includes("analyze_spending")) return "→ Haiku total_query";
  if (t.length === 0) return "→ template text reply (no card)";
  return `→ ${t.join("+")}`;
}

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { tryFastPath } = await import("../src/lib/assistant/fast-path");
  const now = new Date();

  const user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!user) throw new Error("No user rows — sign in once first.");
  console.log(`User ${user.id} (${user.name ?? "?"})\n`);

  // Show what's findable, so edit_search/delete_search results make sense.
  const recent = await prisma.expense.findMany({
    where: { userId: user.id },
    orderBy: { spentAt: "desc" },
    take: 15,
    select: { spentAt: true, amount: true, currency: true, category: true, note: true, fixed: true },
  });
  console.log("── recent expenses (what edit/delete-search can find) ──");
  for (const r of recent) {
    const d = r.spentAt.toISOString().slice(0, 10);
    console.log(`  ${d}  ${r.currency}${Number(r.amount).toFixed(2)}  ${r.category}  ${r.note ?? ""}${r.fixed ? "  [recurring]" : ""}`);
  }
  console.log("");

  // A pending "Watson 套套" last-expense — the exact context that caused the original
  // amend_last mis-match. edit_search must WIN over amend_last here.
  const SUKU: LastExpenseContext = {
    fields: { amount: 100, currency: "SGD", category: "shop", note: "Watson 套套", tags: [], spentAt: `${now.toISOString().slice(0, 10)}T04:00:00.000Z` },
    outcome: "pending",
  };

  const CASES: { msg: string; ctx: LastExpenseContext | null; want: string }[] = [
    // '之前' + '好像' edit — the case that WRONGLY hit Sonnet (SKIP_RE '之前'). Now
    // it should reach the classifier → edit_search (names 吹风机), NOT gate-skip.
    { msg: "我之前有add一个一千块的吹风机，但是我记错了，好像是一千五百块，帮我修改一下。", ctx: SUKU, want: "NOT Sonnet-via-gate; edit_search or escalate (no 吹风机 in DB)" },
    // DATE-RELAXATION: 下午茶 is really on 7/14; user says 7/1 (wrong). keyword+date=0
    // → drop date → find 下午茶(7/14). Card must show the REAL date, 200 as new amount.
    { msg: "把7月1号的下午茶改成200", ctx: SUKU, want: "edit_search via date-relax → 下午茶 (shows Jul 14)" },
    // DATE-RELAXATION for delete: 日本餐 is on 7/14; user says 7/2.
    { msg: "删除7月2号的日本餐", ctx: SUKU, want: "delete_search via date-relax → 日本餐 (Jul 14)" },
    // amend_last still works with NO locating description (edit the just-logged 套套)
    { msg: "改成100", ctx: SUKU, want: "amend_last (edit the 套套)" },
    // referential LOG with NO amount still escalates (no-number gate, not SKIP_RE)
    { msg: "再来一个像之前那样的", ctx: SUKU, want: "ESCALATE (no amount)" },
    // AMBIGUOUS category-only still escalates
    { msg: "把7月14号的food那笔改成100", ctx: SUKU, want: "ESCALATE (N matches)" },
  ];

  for (const c of CASES) {
    const r = await tryFastPath(user.id, c.msg, now, c.ctx);
    console.log(`“${c.msg}”`);
    console.log(`   want: ${c.want}`);
    console.log(`   got:  ${routeLabel(r)}`);
    if (r) {
      if (r.reply) console.log(`   reply: ${r.reply}`);
      for (const p of r.proposals) console.log(`   card:  ${p.summary}`);
    }
    console.log("");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
