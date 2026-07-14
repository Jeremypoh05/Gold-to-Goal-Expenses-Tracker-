// ADDED (cost optimization — arch B wiring verification): drives the REAL
// tryFastPath and proves, via AiUsageLog feature-tag deltas, that a simple
// single-item log is actually handled by the gpt-4o-mini tier (not the classifier),
// and that a multi-item message hits mini FIRST then falls through to the classifier.
//
//   npx tsx scripts/mini-tier-verify.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { tryFastPath } = await import("../src/lib/assistant/fast-path");

  const user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!user) throw new Error("No user rows — sign in once first.");
  const uid = user.id; // capture non-null for the nested closure (TS won't re-narrow it)

  const count = (feature: string) =>
    prisma.aiUsageLog.count({ where: { userId: uid, feature } });

  async function run(label: string, msg: string) {
    const before = { mini: await count("assistant_fast_path_mini"), cls: await count("assistant_fast_path") };
    const started = Date.now();
    const r = await tryFastPath(uid, msg, new Date(), null);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    // usage logging is fire-and-forget (void .catch) — give it a beat to land.
    await new Promise((res) => setTimeout(res, 400));
    const after = { mini: await count("assistant_fast_path_mini"), cls: await count("assistant_fast_path") };
    const dMini = after.mini - before.mini;
    const dCls = after.cls - before.cls;
    console.log(`\n▸ ${label}  (${secs}s)  "${msg}"`);
    console.log(`   mini calls +${dMini}, classifier calls +${dCls}`);
    console.log(`   result: ${r ? `${r.proposals.length} card(s) [${r.proposals.map((p) => p.kind).join(", ")}] — "${r.reply}"` : "null (escalated to full agent)"}`);
    return { dMini, dCls, r };
  }

  console.log(`Verifying mini tier as user ${user.id} (${user.name ?? "no name"})`);

  // Expected "last Friday" via the SAME code the app uses (weekday 5).
  const p2 = (n: number) => String(n).padStart(2, "0");
  const lastFri = (() => { const d = new Date(); const diff = ((d.getDay() + 7 - 5) % 7) || 7; d.setDate(d.getDate() - diff); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; })();

  const simple = await run("SIMPLE single-item log (expect mini +1, classifier +0)", "午餐15块");
  // Since the cap raise, mini handles multi-item (≤20) DIRECTLY — no classifier fallback.
  const multi = await run("MULTI-item (expect mini +1, classifier +0, 2 cards)", "早餐6块，午餐18块");
  const relative = await run("NON-weekday relative (expect mini +1)", "昨天打车15块");
  // Weekday now on mini too — mini flags lastWeekday, code computes the date.
  const weekday = await run(`WEEKDAY log (expect mini +1, date=${lastFri})`, "上个星期五买鞋子80块");

  console.log(`\n${"─".repeat(60)}`);
  const wkDate = weekday.r?.proposals[0]?.create?.spentAt?.slice(0, 10);
  const ok =
    simple.dMini === 1 && simple.dCls === 0 && simple.r?.proposals[0]?.kind === "create_expense" &&
    multi.dMini === 1 && multi.dCls === 0 && multi.r?.proposals.length === 2 &&
    relative.dMini === 1 &&
    weekday.dMini === 1 && weekday.dCls === 0 && wkDate === lastFri;
  console.log(ok ? `✅ mini tier verified: simple/multi/relative/WEEKDAY(${wkDate}) all → mini, classifier untouched` : `❌ unexpected routing — see deltas above (weekday date=${wkDate}, expected ${lastFri})`);
  if (!ok) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
