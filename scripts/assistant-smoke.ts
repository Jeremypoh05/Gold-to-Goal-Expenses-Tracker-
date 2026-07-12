// ADDED (AI Assistant · Slice 1): headless smoke test for the assistant engine.
// Drives the SAME engine + tools the chat UI uses, but straight from a script —
// no browser, no Clerk, no mic — so the whole ask/analyze flow is verifiable
// from the terminal (see "TESTING REALITY" in the project notes).
//
//   npx tsx scripts/assistant-smoke.ts                  → run the default suite
//   npx tsx scripts/assistant-smoke.ts 为什么这个月花那么多  → run one utterance
//
// Uses the first User row in the dev DB (their real data, read-only tools only).
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

const DEFAULT_SUITE = [
  "这个月我花最多的是什么？",
  "How much did I spend on food this month?",
  "我需要多久才能存到10万？",
  "What are my recurring commitments?",
];

async function main() {
  // Import AFTER env is loaded — db.ts reads DATABASE_URL at import time.
  const { prisma } = await import("../src/lib/db");
  const { runAssistantTurn } = await import("../src/lib/assistant/engine");
  type History = { role: "user" | "assistant"; content: string }[];

  const user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!user) throw new Error("No user rows in the DB — sign in once first.");
  console.log(`Testing as user ${user.id} (${user.name ?? "no name"})\n`);

  const args = process.argv.slice(2);
  const utterances = args.length > 0 ? [args.join(" ")] : DEFAULT_SUITE;

  const history: History = [];
  for (const u of utterances) {
    console.log(`🗣  USER: ${u}`);
    const started = Date.now();
    const res = await runAssistantTurn(user.id, history, u);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`🔧 TOOLS (${secs}s): ${res.toolsUsed.join(" → ") || "(none)"}`);
    console.log(`🤖 ASSISTANT: ${res.reply}`);
    // Slice 2/2b: WRITE tools return proposals (confirm cards in the UI) — never auto-saved.
    for (const p of res.proposals) {
      let extra = "";
      if (p.closedMonth) extra += ` · closed:${p.closedMonth}`;
      if (p.recurringWarning) extra += " · recurring-row!";
      if (p.recurring) {
        const r = p.recurring;
        extra += ` · mode:${r.mode} · ${r.impact.monthCount}mo(${r.impact.firstMonth}→${r.impact.lastMonth})`;
        if (r.closedInRange.length) extra += ` · closedInRange:${r.closedInRange.join(",")}`;
      }
      if (p.preference) extra += ` · pref:${p.preference.key}`;
      if (p.monthStatus) extra += ` · ${p.monthStatus.action}:${p.monthStatus.monthLabel}`;
      if (p.recurringCreate) extra += ` · ${p.recurringCreate.category} from ${p.recurringCreate.startYear}-${p.recurringCreate.startMonth}`;
      console.log(`📝 PROPOSAL [${p.kind}]: ${p.summary}${extra}`);
    }
    console.log("─".repeat(60));
    if (!res.ok) console.error(`   ⚠ error: ${res.error}`);
    history.push({ role: "user", content: u }, { role: "assistant", content: res.reply });
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
