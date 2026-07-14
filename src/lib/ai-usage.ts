// ADDED (cost tracking): logs one row per completed Anthropic API call so real
// per-user token spend is measurable instead of guessed — the foundation for
// subscription-plan quotas / usage-based billing / spend alerts. Framework-free
// (explicit userId, plain prisma) so it's callable from engine.ts (which has no
// auth()) the same way tools.ts already does. Best-effort: a logging failure must
// never break the actual AI feature, so every call site should `.catch(() => {})`.
import { prisma } from "@/lib/db";

export type AiFeature =
  | "assistant_chat"
  // ADDED (cost optimization — fast-path router): the cheap single-shot classifier
  // that pre-filters brand-new, unambiguous expense logs before the full agent.
  // Logged separately from "assistant_chat" so fast-path vs full-agent cost/volume
  // is measurable independently.
  | "assistant_fast_path"
  // ADDED (cost optimization — arch B): the gpt-4o-mini extract-only path for
  // simple single-item logs (a NON-Anthropic model, ~20x cheaper than the Haiku
  // classifier). Tagged separately so the mini tier's volume/tokens — and the fact
  // that its `model` column holds an OpenAI id, priced differently — stay isolated.
  | "assistant_fast_path_mini"
  | "voice_parse"
  | "voice_edit"
  | "ai_suggest_category"
  | "ai_suggest_fixed_meta";

/** The subset of Anthropic's `response.usage` shape we care about — accepts the
 *  real SDK type structurally so call sites can pass `response.usage` directly. */
export interface AiUsageTokens {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export async function logAiUsage(
  userId: string,
  feature: AiFeature,
  model: string,
  usage: AiUsageTokens,
): Promise<void> {
  await prisma.aiUsageLog.create({
    data: {
      userId,
      feature,
      model,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    },
  });
}

/** Accumulate usage across several API calls (e.g. every iteration of the
 *  assistant's tool-use loop) into one totals object, then log ONE row per
 *  user-visible turn — ties usage to one user action instead of one HTTP call. */
export class AiUsageAccumulator {
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheReadTokens = 0;
  private cacheWriteTokens = 0;

  add(usage: AiUsageTokens): void {
    this.inputTokens += usage.input_tokens;
    this.outputTokens += usage.output_tokens;
    this.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
    this.cacheWriteTokens += usage.cache_creation_input_tokens ?? 0;
  }

  async flush(userId: string, feature: AiFeature, model: string): Promise<void> {
    if (this.inputTokens === 0 && this.outputTokens === 0) return;
    await logAiUsage(userId, feature, model, {
      input_tokens: this.inputTokens,
      output_tokens: this.outputTokens,
      cache_read_input_tokens: this.cacheReadTokens,
      cache_creation_input_tokens: this.cacheWriteTokens,
    });
  }
}
