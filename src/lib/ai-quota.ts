// ADDED (2026-07-16, pre-launch guard): per-user daily AI quotas.
//
// WHY: every user shares the developer's own API keys (see honey-ai-cost-strategy —
// the org credit balance has ALREADY been drained once during dev). Before any real
// user touches the app, a runaway user / bug loop must not be able to spend without
// bound. AiUsageLog (one row per completed AI call) is the data source; this module
// only READS it — enforcement is a cheap count query per turn, no schema change.
//
// MODEL: two buckets, counted per LOCAL calendar day (server timezone — dev machine
// and target users are both SG/MY, UTC+8):
//   • fast  — the cheap tiers: gpt-5.4-mini extraction + Haiku classifier
//             (features assistant_fast_path_mini / assistant_fast_path)
//   • agent — full Sonnet turns (feature assistant_chat), ~10-40x pricier per turn
// Free limits are generous for real personal use but a hard wall against runaway
// spend. When `agent` runs out, the cheap tiers KEEP WORKING (basic log/edit/search
// still fine — the user's explicit design); when `fast` runs out, all AI pauses
// until midnight (manual logging in the UI is never affected — it uses no AI).
//
// Admins (the developer + comped friends/family later) bypass all limits: set
// ADMIN_USERS in .env.local to a comma-separated list of Clerk user ids AND/OR
// emails (matched against the User row's email, case-insensitive).
import { prisma } from "@/lib/db";

// Overridable via env so tests (and later, plans) can tune without a code change.
const FAST_DAILY = envInt("AI_QUOTA_FAST_DAILY", 150);
const AGENT_DAILY = envInt("AI_QUOTA_AGENT_DAILY", 30);

const FAST_FEATURES = ["assistant_fast_path", "assistant_fast_path_mini"];
const AGENT_FEATURES = ["assistant_chat"];

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

export interface AiQuotaStatus {
  isAdmin: boolean;
  fast: { used: number; limit: number };
  agent: { used: number; limit: number };
  /** false = ALL AI paused until reset (manual logging unaffected). */
  fastAllowed: boolean;
  /** false = complex (Sonnet) turns paused; cheap log/edit/search still allowed. */
  agentAllowed: boolean;
  /** Next local midnight — when both counters reset. ISO string. */
  resetAt: string;
}

/** Start of the current LOCAL calendar day. */
function dayStart(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Next local midnight (when the daily counters reset). */
export function quotaResetAt(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
}

async function isAdminUser(userId: string): Promise<boolean> {
  const raw = process.env.ADMIN_USERS ?? "";
  if (!raw.trim()) return false;
  const entries = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (entries.includes(userId.toLowerCase())) return true;
  // Fall back to email match (one indexed point-read; only when ids didn't match).
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return !!user?.email && entries.includes(user.email.toLowerCase());
}

/** Today's usage vs limits for one user. ONE groupBy query + (rarely) one user read. */
export async function getAiQuotaStatus(userId: string, now: Date = new Date()): Promise<AiQuotaStatus> {
  const [admin, rows] = await Promise.all([
    isAdminUser(userId),
    prisma.aiUsageLog.groupBy({
      by: ["feature"],
      where: {
        userId,
        createdAt: { gte: dayStart(now) },
        feature: { in: [...FAST_FEATURES, ...AGENT_FEATURES] },
      },
      _count: { _all: true },
    }),
  ]);

  let fastUsed = 0;
  let agentUsed = 0;
  for (const r of rows) {
    if (FAST_FEATURES.includes(r.feature)) fastUsed += r._count._all;
    else agentUsed += r._count._all;
  }

  return {
    isAdmin: admin,
    fast: { used: fastUsed, limit: FAST_DAILY },
    agent: { used: agentUsed, limit: AGENT_DAILY },
    fastAllowed: admin || fastUsed < FAST_DAILY,
    agentAllowed: admin || agentUsed < AGENT_DAILY,
    resetAt: quotaResetAt(now).toISOString(),
  };
}

const isCJK = (s: string) => /[一-鿿]/.test(s);

/** Hours until reset, rounded up — friendlier than an exact timestamp. */
function hoursUntil(resetAt: Date, now: Date): number {
  return Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 3_600_000));
}

/**
 * The friendly, honest "you've hit today's limit" reply (persisted as a normal
 * assistant message so the conversation stays coherent).
 *  - kind "agent": only the complex tier is paused — basic log/edit/search still work.
 *  - kind "all":   all AI is paused until reset — manual logging is unaffected.
 * Language follows the user's message (same CJK heuristic as the fast-path templates).
 */
export function quotaExceededReply(kind: "agent" | "all", userMessage: string, resetAt: Date, now: Date = new Date()): string {
  const h = hoursUntil(resetAt, now);
  if (isCJK(userMessage)) {
    return kind === "agent"
      ? `今天的「复杂问题」AI 额度用完啦 🙏 分析、预测这类要等大约 ${h} 小时后刷新。不过别担心——记账、修改、删除、简单查询这些还能正常用,手动记账也完全不受影响～`
      : `今天的 AI 额度全部用完啦 🙏 大约 ${h} 小时后自动刷新。这段时间你还是可以在页面上手动记账、编辑和查看所有数据——只是 AI 对话要休息一下～`;
  }
  return kind === "agent"
    ? `You've used up today's quota for complex AI questions 🙏 Analysis and projections will refresh in about ${h}h. Don't worry — logging, editing, deleting and simple searches still work, and manual entry is never affected.`
    : `You've used up all of today's AI quota 🙏 It refreshes in about ${h}h. Meanwhile you can still log, edit and view everything manually — only the AI chat is taking a break.`;
}
