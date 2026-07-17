'use client';

// ADDED (2026-07-16): platform Settings page. First resident: the AI usage panel —
// today's quota (the per-user daily limits that protect the shared API keys) and
// this month's consumption per tier. Deliberately transparent so (a) the developer
// can watch real usage during dev, and (b) future users understand why the AI
// occasionally asks them to wait until tomorrow instead of it feeling like a bug.
import { useEffect, useState, useTransition } from 'react';
import { motion } from 'framer-motion';
import { SettingsIcon, SparkleIcon, BotIcon } from '@/components/icons';
import { fetchAiUsage, type AiUsageSummary } from '@/lib/settings-actions';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────
// Small pieces
// ─────────────────────────────────────────────────────────────

function QuotaBar({ used, limit, exhausted }: { used: number; limit: number; exhausted: boolean }) {
    const pct = limit === 0 ? 100 : Math.min(100, Math.round((used / limit) * 100));
    return (
        <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'oklch(0.92 0.02 90 / 0.6)' }}>
            <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                className="h-full rounded-full"
                style={{
                    background: exhausted
                        ? 'linear-gradient(90deg, oklch(0.72 0.19 30), oklch(0.62 0.21 25))'
                        : 'linear-gradient(90deg, oklch(0.86 0.14 90), oklch(0.72 0.16 78))',
                }}
            />
        </div>
    );
}

function TierRow({
    title,
    subtitle,
    used,
    limit,
    unlimited,
}: {
    title: string;
    subtitle: string;
    used: number;
    limit: number;
    unlimited: boolean;
}) {
    const exhausted = !unlimited && used >= limit;
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
                <div>
                    <span className="text-[13px] font-semibold">{title}</span>
                    <span className="text-[11px] text-ink-2 ml-2">{subtitle}</span>
                </div>
                <div className="text-[13px] font-semibold tabular-nums">
                    {used}
                    <span className="text-ink-2 font-normal"> / {unlimited ? '∞' : limit}</span>
                </div>
            </div>
            {!unlimited && <QuotaBar used={used} limit={limit} exhausted={exhausted} />}
            {exhausted && (
                <div className="text-[11px]" style={{ color: 'oklch(0.6 0.18 28)' }}>
                    Used up for today — resets at midnight. Manual logging is never affected.
                </div>
            )}
        </div>
    );
}

const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function MonthRow({ label, calls, tokens, cost }: { label: string; calls: number; tokens: number; cost: number }) {
    return (
        <div className="flex items-center justify-between py-2 border-b last:border-b-0" style={{ borderColor: 'oklch(0.9 0.02 90 / 0.5)' }}>
            <div className="text-[13px]">{label}</div>
            <div className="flex items-center gap-4 text-[12px] text-ink-2 tabular-nums">
                <span>{calls} calls</span>
                <span>{fmtTokens(tokens)} tokens</span>
                <span className="font-semibold text-ink-1">≈ US${cost.toFixed(3)}</span>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────

export default function SettingsPage() {
    const [usage, setUsage] = useState<AiUsageSummary | null>(null);
    const [, startTransition] = useTransition();

    useEffect(() => {
        startTransition(async () => {
            setUsage(await fetchAiUsage());
        });
    }, []);

    const resetLabel = usage
        ? new Date(usage.quota.resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';

    return (
        <div className="px-4 md:px-8 py-5 md:py-7 pb-24 md:pb-16 max-w-[900px] mx-auto flex flex-col gap-5 md:gap-6">
            {/* Header */}
            <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            >
                <div className="text-[10px] md:text-[11px] text-on-soft uppercase tracking-[0.14em] font-semibold">Platform</div>
                <h1
                    className="display mt-0.5 md:mt-1"
                    style={{
                        fontSize: 'clamp(30px, 5.5vw, 46px)',
                        lineHeight: 1.02,
                        width: 'fit-content',
                        backgroundImage: 'linear-gradient(100deg, var(--color-ink-0) 32%, oklch(0.74 0.17 80) 92%)',
                        WebkitBackgroundClip: 'text',
                        backgroundClip: 'text',
                        color: 'transparent',
                        letterSpacing: '-0.01em',
                    }}
                >
                    Settings
                </h1>
                <div className="text-[13px] text-ink-2 mt-1">Your account, AI usage and platform preferences</div>
            </motion.div>

            {/* Today's AI quota */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
                className="glass grad-gold-soft rounded-3xl p-6 md:p-7 relative overflow-hidden"
                style={{ border: '1px solid oklch(0.88 0.08 88)' }}
            >
                <div className="absolute -right-6 -bottom-8 opacity-[0.07] pointer-events-none" style={{ color: 'var(--color-gold-700)' }}>
                    <BotIcon size={170} />
                </div>
                <div className="relative flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                        <div
                            className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
                            style={{ background: 'linear-gradient(135deg, oklch(0.86 0.14 90), oklch(0.72 0.16 78))', color: '#3a2708', boxShadow: 'var(--shadow-gold)' }}
                        >
                            <SparkleIcon size={22} />
                        </div>
                        <div>
                            <div className="text-[11px] uppercase tracking-[0.1em] font-semibold text-on-soft">AI usage · today</div>
                            <div className="text-[12px] text-ink-2 mt-0.5">
                                {usage?.quota.isAdmin
                                    ? 'Admin account — no limits apply.'
                                    : `Daily limits keep the shared AI fair for everyone · resets at ${resetLabel || 'midnight'}`}
                            </div>
                        </div>
                    </div>

                    {usage ? (
                        <div className="flex flex-col gap-4">
                            <TierRow
                                title="Quick AI"
                                subtitle="logging · edits · deletes · searches · totals"
                                used={usage.quota.fast.used}
                                limit={usage.quota.fast.limit}
                                unlimited={usage.quota.isAdmin}
                            />
                            <TierRow
                                title="Advanced AI"
                                subtitle="analysis · projections · recurring · income · complex asks"
                                used={usage.quota.agent.used}
                                limit={usage.quota.agent.limit}
                                unlimited={usage.quota.isAdmin}
                            />
                        </div>
                    ) : (
                        <div className="text-[13px] text-ink-2">Loading…</div>
                    )}
                </div>
            </motion.div>

            {/* This month */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
                className="glass rounded-3xl p-6 md:p-7"
                style={{ border: '1px solid oklch(0.9 0.03 90 / 0.7)' }}
            >
                <div className="flex items-center gap-2 mb-3">
                    <SettingsIcon size={16} className={cn('text-ink-2')} />
                    <div className="text-[11px] uppercase tracking-[0.1em] font-semibold text-on-soft">This month</div>
                </div>
                {usage ? (
                    <div>
                        <MonthRow
                            label="Quick AI (logging & edits)"
                            calls={usage.month.fast.calls}
                            tokens={usage.month.fast.inputTokens + usage.month.fast.outputTokens}
                            cost={usage.month.fast.estCostUsd}
                        />
                        <MonthRow
                            label="Advanced AI (full assistant)"
                            calls={usage.month.agent.calls}
                            tokens={usage.month.agent.inputTokens + usage.month.agent.outputTokens}
                            cost={usage.month.agent.estCostUsd}
                        />
                        {usage.month.other.calls > 0 && (
                            <MonthRow
                                label="Other AI (suggestions)"
                                calls={usage.month.other.calls}
                                tokens={usage.month.other.inputTokens + usage.month.other.outputTokens}
                                cost={usage.month.other.estCostUsd}
                            />
                        )}
                        <div className="text-[11px] text-ink-2 mt-3">
                            Cost is a rough estimate at list prices — for transparency, not a bill. Honey is free while in beta.
                        </div>
                    </div>
                ) : (
                    <div className="text-[13px] text-ink-2">Loading…</div>
                )}
            </motion.div>
        </div>
    );
}
