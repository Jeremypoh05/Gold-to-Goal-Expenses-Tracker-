'use client';

// ADDED (2026-07-17): the AI-usage strip shared by the assistant chat and the quick
// mic. Three states, per the user's design:
//   • ≥70% of a tier used  → a slim warning bar (Quick AI / Advanced AI shown
//     SEPARATELY so they never get confused for one another), updating after every
//     turn (the parent passes the freshest post-turn quota snapshot).
//   • fast exhausted, no choice yet → the Continue-on-Advanced / Pause-for-today
//     buttons (the actual decision the backend's "ask" reply text refers to).
//   • a choice made → a one-line status with an undo, mirrored live in Settings
//     via the QUOTA_CHANGED event (both directions, no refresh needed).
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { notifyQuotaChanged } from '@/lib/data-events';
import { setQuotaOverflowAction } from '@/lib/assistant-actions';
import type { AiQuotaStatus, QuotaOverflowMode } from '@/lib/ai-quota';

const WARN_AT = 0.7; // start showing a tier's bar from 70% used

function pct(used: number, limit: number): number {
    return limit <= 0 ? 100 : Math.min(100, Math.round((used / limit) * 100));
}

function MiniBar({ label, used, limit, exhausted }: { label: string; used: number; limit: number; exhausted: boolean }) {
    const p = pct(used, limit);
    return (
        <div className="flex items-center gap-2 min-w-0">
            <span className="text-[11px] font-semibold whitespace-nowrap">{label}</span>
            <div className="flex-1 h-1.5 rounded-full overflow-hidden min-w-[60px]" style={{ background: 'oklch(0.9 0.02 90 / 0.5)' }}>
                <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                        width: `${p}%`,
                        background: exhausted
                            ? 'linear-gradient(90deg, oklch(0.72 0.19 30), oklch(0.62 0.21 25))'
                            : 'linear-gradient(90deg, oklch(0.86 0.14 90), oklch(0.72 0.16 78))',
                    }}
                />
            </div>
            <span className={cn('text-[11px] tabular-nums whitespace-nowrap', exhausted ? 'font-semibold' : 'text-ink-2')}>
                {used}/{limit}
            </span>
        </div>
    );
}

export function QuotaStrip({
    quota,
    onQuotaChange,
    compact,
}: {
    quota: AiQuotaStatus | null;
    /** Parent keeps its own copy of the snapshot in sync (e.g. after a button tap). */
    onQuotaChange: (q: AiQuotaStatus) => void;
    /** Quick-mic variant: tighter spacing. */
    compact?: boolean;
}) {
    const [saving, setSaving] = useState(false);
    if (!quota || quota.isAdmin) return null;

    const fastExhausted = !quota.fastAllowed;
    const agentExhausted = !quota.agentAllowed;
    const showFast = fastExhausted || quota.fast.used / Math.max(1, quota.fast.limit) >= WARN_AT;
    const showAgent = agentExhausted || quota.agent.used / Math.max(1, quota.agent.limit) >= WARN_AT;
    const needChoice = fastExhausted && quota.overflow === null;
    if (!showFast && !showAgent) return null;

    const choose = async (mode: QuotaOverflowMode | null) => {
        if (saving) return;
        setSaving(true);
        try {
            const fresh = await setQuotaOverflowAction(mode);
            onQuotaChange(fresh);
            notifyQuotaChanged(); // Settings (or any other surface) refreshes live
        } finally {
            setSaving(false);
        }
    };

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                className={cn('rounded-2xl px-3', compact ? 'py-2' : 'py-2.5', 'flex flex-col gap-1.5')}
                style={{
                    background: needChoice || fastExhausted ? 'oklch(0.75 0.12 60 / 0.12)' : 'oklch(0.85 0.1 90 / 0.12)',
                    border: '1px solid oklch(0.8 0.08 80 / 0.4)',
                }}
            >
                {showFast && <MiniBar label="Quick AI" used={quota.fast.used} limit={quota.fast.limit} exhausted={fastExhausted} />}
                {showAgent && <MiniBar label="Advanced AI" used={quota.agent.used} limit={quota.agent.limit} exhausted={agentExhausted} />}

                {needChoice && (
                    <div className="flex items-center gap-2 flex-wrap pt-0.5">
                        <span className="text-[11px] text-ink-2">Quick AI is used up for today.</span>
                        <button
                            type="button"
                            disabled={saving || agentExhausted}
                            onClick={() => choose('sonnet')}
                            className="h-7 px-3 rounded-full text-[11px] font-semibold transition-all hover:brightness-105 disabled:opacity-50"
                            style={{ background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))', color: '#1a120a' }}
                        >
                            Continue with Advanced AI
                        </button>
                        <button
                            type="button"
                            disabled={saving}
                            onClick={() => choose('stop')}
                            className="h-7 px-3 rounded-full text-[11px] font-semibold border transition-all hover:bg-black/5 disabled:opacity-50"
                            style={{ borderColor: 'oklch(0.75 0.05 80 / 0.5)' }}
                        >
                            Pause AI for today
                        </button>
                    </div>
                )}

                {fastExhausted && quota.overflow === 'sonnet' && (
                    <div className="flex items-center gap-2 flex-wrap pt-0.5">
                        <span className="text-[11px] text-ink-2">
                            {agentExhausted ? 'Advanced AI is also used up. AI resumes at midnight.' : 'Running on Advanced AI for the rest of today.'}
                        </span>
                        {!agentExhausted && (
                            <button
                                type="button"
                                disabled={saving}
                                onClick={() => choose('stop')}
                                className="text-[11px] underline underline-offset-2 text-ink-2 hover:text-ink-1 disabled:opacity-50"
                            >
                                pause instead
                            </button>
                        )}
                    </div>
                )}

                {fastExhausted && quota.overflow === 'stop' && (
                    <div className="flex items-center gap-2 flex-wrap pt-0.5">
                        <span className="text-[11px] text-ink-2">AI paused until midnight, as you chose.</span>
                        {!agentExhausted && (
                            <button
                                type="button"
                                disabled={saving}
                                onClick={() => choose('sonnet')}
                                className="text-[11px] underline underline-offset-2 text-ink-2 hover:text-ink-1 disabled:opacity-50"
                            >
                                use Advanced AI instead
                            </button>
                        )}
                    </div>
                )}
            </motion.div>
        </AnimatePresence>
    );
}
