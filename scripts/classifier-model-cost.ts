// ADDED (cost — settling the Haiku-vs-Sonnet question with real numbers). The user
// correctly pushed back: "why would Haiku cost MORE than Sonnet?" The earlier answer
// conflated two things. This measures the ACTUAL production classifier prompt+tool
// (imported, not reconstructed) on BOTH models, cold + warm, so we can see the true
// per-call cost for OUR prompt size — and specifically whether SHORT-prompt Haiku
// (no padding) beats short-prompt Sonnet for cold-start-dominated real usage.
//
//   npx tsx scripts/classifier-model-cost.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import type Anthropic from "@anthropic-ai/sdk";
import { routeSystemPrompt, ROUTE_TOOL } from "../src/lib/assistant/fast-path";

const RATES: Record<string, [number, number]> = {
  "claude-sonnet-5": [2, 10],
  "claude-haiku-4-5-20251001": [1, 5],
};

function cost(model: string, u: Anthropic.Usage): number {
  const [inR, outR] = RATES[model] ?? [2, 10];
  return (
    u.input_tokens * inR +
    (u.cache_read_input_tokens ?? 0) * inR * 0.1 +
    (u.cache_creation_input_tokens ?? 0) * inR * 1.25 +
    u.output_tokens * outR
  ) / 1e6;
}

async function call(client: Anthropic, model: string, system: string, msg: string) {
  const res = await client.messages.create({
    model,
    max_tokens: 300,
    thinking: { type: "disabled" },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    tools: [ROUTE_TOOL],
    tool_choice: { type: "tool", name: "route" },
    messages: [{ role: "user", content: msg }],
  });
  return res.usage;
}

const MESSAGES = ["改成600块", "删掉刚才那个", "这个月花了多少？", "log $12 lunch today", "帮我把上周买的手表改成60"];

async function measure(model: string) {
  const AnthropicSDK = (await import("@anthropic-ai/sdk")).default;
  const client = new AnthropicSDK({ apiKey: process.env.ANTHROPIC_API_KEY });
  // Unique nonce forces a COLD cache for call #1 (so we truly measure cold-write),
  // then calls #2+ read that freshly-written cache (warm).
  const nonce = `\n<!-- probe ${Date.now()}-${model} -->\n`;
  const system = nonce + routeSystemPrompt(new Date());
  const costs: number[] = [];
  console.log(`\n▸ ${model}`);
  for (let i = 0; i < MESSAGES.length; i++) {
    const u = await call(client, model, system, MESSAGES[i]);
    const c = cost(model, u);
    costs.push(c);
    console.log(`  [${i === 0 ? "COLD" : "warm"}] in:${u.input_tokens} cacheR:${u.cache_read_input_tokens ?? 0} cacheW:${u.cache_creation_input_tokens ?? 0} out:${u.output_tokens} → $${c.toFixed(6)}`);
  }
  return { cold: costs[0], warm: costs.slice(1).reduce((a, b) => a + b, 0) / (costs.length - 1) };
}

async function main() {
  console.log("Production classifier prompt+tool — real cold/warm cost on both models\n");
  const sonnet = await measure("claude-sonnet-5");
  const haiku = await measure("claude-haiku-4-5-20251001");

  console.log(`\n${"─".repeat(66)}`);
  console.log(`Sonnet 5 (short): cold $${sonnet.cold.toFixed(6)}  warm $${sonnet.warm.toFixed(6)}`);
  console.log(`Haiku 4.5(short): cold $${haiku.cold.toFixed(6)}  warm $${haiku.warm.toFixed(6)}`);
  console.log(`\nBlended cost per call at different cold-start ratios (real users skew HIGH-cold):`);
  console.log(`  cold%   Sonnet      Haiku       winner`);
  for (const p of [0.2, 0.4, 0.6, 0.8, 1.0]) {
    const s = p * sonnet.cold + (1 - p) * sonnet.warm;
    const h = p * haiku.cold + (1 - p) * haiku.warm;
    console.log(`  ${(p * 100).toFixed(0).padStart(3)}%   $${s.toFixed(6)}  $${h.toFixed(6)}  ${h < s ? `Haiku (${((1 - h / s) * 100).toFixed(0)}% cheaper)` : `Sonnet (${((1 - s / h) * 100).toFixed(0)}% cheaper)`}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
