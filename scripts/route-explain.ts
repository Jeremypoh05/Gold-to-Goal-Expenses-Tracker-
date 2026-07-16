// ADDED (routing explainer, 2026-07-14): a ZERO-API tool that shows EXACTLY which
// tier a message routes to and WHY — the deterministic pre-model decision only
// (mini vs Haiku-classifier vs full-agent). It cannot predict the classifier's own
// "bail to full agent on doubt" step (that needs a real Haiku call), but that's the
// LESS common flip; the confusing everyday flips are all deterministic and shown here.
//
// The KEY hidden variable the routing depends on — besides the words in the message —
// is the SESSION's card state, so every case is shown for BOTH:
//   • FRESH / prev card resolved  → the cheap path is open
//   • PREV CARD STILL PENDING     → mini is SKIPPED on purpose (a follow-up might be
//                                    amending that pending card — only the context-
//                                    aware classifier should judge that)
//
//   npx tsx scripts/route-explain.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

// The user's real 2026-07-14 browser tests (verbatim), + what they observed.
const CASES: { msg: string; observed: string }[] = [
  { msg: "七月1号我买了一个wet tissue一百块。然后七月五号我买了一个垃圾袋五十块。昨天买了一个拖鞋一百块。还有买了吹风机50块今天/", observed: "Haiku" },
  { msg: "七月5号我买了一个wet tissue一百块。然后七月五号我买了一个垃圾袋五十块。7月8买了一个拖鞋一百块, 还有买了吹风机50块", observed: "mini" },
  { msg: "七月5号我买了一个wet tissue一百块。然后七月五号我买了一个垃圾袋五十块。7月8买了一个拖鞋一百块, 还有买了吹风机50块。今天也买了mouse 100块", observed: "Haiku" },
  { msg: "今天购买了一个wet tissue一百块。我买了一个垃圾袋五十块。一个拖鞋一百块, 还有买了吹风机50块。也买了mouse 100块", observed: "Haiku" },
  { msg: "我今天去靠靠dew Watson买了一个套套五百块。", observed: "quick-mic → mini" },
  { msg: "我今天去靠靠dew Watson买了一个套套五百块", observed: "chat → Haiku (+Sonnet once)" },
];

/** The deterministic route tryFastPath() takes BEFORE any model runs. */
function route(
  msg: string,
  hasLastExpense: boolean,
  pendingCard: boolean,
  gate: (m: string, h: boolean) => boolean,
  simple: (m: string) => boolean,
): string {
  if (!gate(msg, hasLastExpense)) return "Sonnet (full agent) — gate skip (analysis/search/recurring word, or nothing actionable)";
  if (pendingCard) return "Haiku classifier — mini SKIPPED because a card is still pending";
  if (simple(msg)) return "mini (5.4-mini) — clean log, cheap path";
  return "Haiku classifier — amend/delete/question/referential words detected";
}

async function main() {
  const { fastPathGate, looksLikeSimpleLog } = await import("../src/lib/assistant/fast-path");
  console.log("Deterministic pre-model routing (the classifier may STILL escalate to Sonnet if it doubts):\n");
  for (const c of CASES) {
    const fresh = route(c.msg, false, false, fastPathGate, looksLikeSimpleLog);
    const pending = route(c.msg, true, true, fastPathGate, looksLikeSimpleLog);
    console.log(`“${c.msg}”`);
    console.log(`   you saw:            ${c.observed}`);
    console.log(`   no pending card  →  ${fresh}`);
    console.log(`   PREV CARD PENDING →  ${pending}`);
    console.log("");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
