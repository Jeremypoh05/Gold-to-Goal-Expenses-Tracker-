// ADDED (cost — verify mini handles MANY items, not just 3, per user request).
//   npx tsx scripts/mini-many-items.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
async function main() {
  const { prisma } = await import("../src/lib/db");
  const { tryFastPath } = await import("../src/lib/assistant/fast-path");
  const user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!user) throw new Error("no user");
  const cases = [
    "帮我记录今天的：早餐麦当劳6块，午餐鸡排18块，下午茶奶茶5块，晚餐火锅40块，宵夜炸鸡15块",
    "log today: coffee $5, lunch $12, grab ride $8, movie ticket $14, groceries $30, phone bill $40",
    // MIXED complexity: 3 simple + a 4th with a weekday date → gate escalates the WHOLE
    // message to the Haiku classifier, which should still return all 4 cards (not fall
    // to the full agent). Item 4's date should resolve to last Friday.
    "帮我记录：早餐6块，午餐18块，晚餐40块，啊还有一个上个星期五我买了鞋子80块",
    "记录：早餐6块，午餐18块，晚餐40块，上个星期五买鞋子80块",
    // 22 items > cap(20) → should get a clear "please split" message, NOT cards, NOT full agent.
    "帮我记录今天：" + Array.from({ length: 22 }, (_, i) => `第${i + 1}样${i + 3}块`).join("，"),
  ];
  for (const msg of cases) {
    const r = await tryFastPath(user.id, msg, new Date(), null);
    console.log(`\n"${msg}"`);
    console.log(`  → ${r ? `${r.proposals.length} cards` : "null (escalated)"}: ${r?.reply ?? ""}`);
    for (const p of r?.proposals ?? []) console.log(`     [${p.create?.category}] $${p.create?.amount} · ${p.create?.note} · ${p.create?.spentAt?.slice(0, 10) ?? "today"} ${p.create?.tags?.length ? JSON.stringify(p.create.tags) : ""}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
