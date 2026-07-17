"use server";

// ADDED (2026-07-16): server actions for the Settings page — currently the AI-usage
// panel (per-user daily quota + this month's consumption). Reads AiUsageLog only;
// the quota math lives in lib/ai-quota.ts so the enforcement points and this view
// can never disagree.
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { getAiQuotaStatus, type AiQuotaStatus } from "@/lib/ai-quota";

async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

export interface AiUsageTierMonth {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Rough USD estimate at current list prices — a dev/curiosity number, not a bill. */
  estCostUsd: number;
}

export interface AiUsageSummary {
  quota: AiQuotaStatus;
  month: {
    fast: AiUsageTierMonth;
    agent: AiUsageTierMonth;
    /** Everything else AI-powered (category suggestions, STT is not logged here). */
    other: AiUsageTierMonth;
  };
}

// Rough per-MTok list prices for the estimate (verified 2026-07; Sonnet 5 is intro
// pricing until 2026-08-31 → $3/$15 after). Cache reads ~0.1x input, writes ~1.25x.
const PRICE: Record<string, { in: number; out: number }> = {
  "gpt-5.4-mini": { in: 0.75, out: 4.5 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "claude-haiku": { in: 1, out: 5 },
  "claude-sonnet": { in: 2, out: 10 },
};

function priceFor(model: string): { in: number; out: number } {
  for (const [prefix, p] of Object.entries(PRICE)) {
    if (model.startsWith(prefix)) return p;
  }
  return { in: 2, out: 10 }; // unknown model → assume Sonnet-ish, err high
}

const FAST_FEATURES = ["assistant_fast_path", "assistant_fast_path_mini"];
const AGENT_FEATURES = ["assistant_chat"];

export async function fetchAiUsage(): Promise<AiUsageSummary> {
  const userId = await requireUserId();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [quota, rows] = await Promise.all([
    getAiQuotaStatus(userId, now),
    prisma.aiUsageLog.groupBy({
      by: ["feature", "model"],
      where: { userId, createdAt: { gte: monthStart } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true },
    }),
  ]);

  const empty = (): AiUsageTierMonth => ({ calls: 0, inputTokens: 0, outputTokens: 0, estCostUsd: 0 });
  const month = { fast: empty(), agent: empty(), other: empty() };

  for (const r of rows) {
    const bucket = FAST_FEATURES.includes(r.feature)
      ? month.fast
      : AGENT_FEATURES.includes(r.feature)
        ? month.agent
        : month.other;
    const inTok = r._sum.inputTokens ?? 0;
    const outTok = r._sum.outputTokens ?? 0;
    const cacheR = r._sum.cacheReadTokens ?? 0;
    const cacheW = r._sum.cacheWriteTokens ?? 0;
    const p = priceFor(r.model);
    bucket.calls += r._count._all;
    bucket.inputTokens += inTok + cacheR + cacheW;
    bucket.outputTokens += outTok;
    bucket.estCostUsd += (inTok * p.in + outTok * p.out + cacheR * p.in * 0.1 + cacheW * p.in * 1.25) / 1e6;
  }

  return { quota, month };
}
