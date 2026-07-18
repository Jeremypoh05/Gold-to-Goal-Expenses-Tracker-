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

// Small inline glyphs so the action buttons read as buttons, not plain links
// (user feedback: "pause instead / use Advanced AI instead 太朴素了, 加 icon/effect").
function BoltIcon({ size = 13 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M13 2L4.5 13.2c-.4.5 0 1.3.7 1.3H11l-1 7.5c-.1.7.8 1.1 1.3.5L20 11.3c.4-.5 0-1.3-.7-1.3H13l1-7.6c.1-.8-.8-1.2-1.3-.4z" />
        </svg>
    );
}
function PauseIcon({ size = 13 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <rect x="6" y="5" width="4" height="14" rx="1.4" />
            <rect x="14" y="5" width="4" height="14" rx="1.4" />
        </svg>
    );
}
function SwapIcon({ size = 12 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M7 4L3 8l4 4M3 8h13M17 20l4-4-4-4M21 16H8" />
        </svg>
    );
}

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
                    <div className="flex flex-col gap-2 pt-1">
                        <span className="text-[11px] text-ink-2">Quick AI is used up for today. Keep going, or rest?</span>
                        <div className="flex items-center gap-2 flex-wrap">
                            <motion.button
                                type="button"
                                whileHover={{ scale: agentExhausted ? 1 : 1.04 }}
                                whileTap={{ scale: 0.96 }}
                                disabled={saving || agentExhausted}
                                onClick={() => choose('sonnet')}
                                className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-[12px] font-semibold cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                style={{ background: 'linear-gradient(135deg, oklch(0.84 0.155 88), oklch(0.68 0.16 76))', color: '#1a120a', boxShadow: '0 4px 14px -3px oklch(0.7 0.16 78 / 0.5)' }}
                            >
                                <BoltIcon /> Continue with Advanced AI
                            </motion.button>
                            <motion.button
                                type="button"
                                whileHover={{ scale: 1.04 }}
                                whileTap={{ scale: 0.96 }}
                                disabled={saving}
                                onClick={() => choose('stop')}
                                className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-[12px] font-semibold border cursor-pointer transition-all hover:bg-black/[0.04] disabled:opacity-40 disabled:cursor-not-allowed"
                                style={{ borderColor: 'oklch(0.75 0.06 80 / 0.6)', color: 'var(--color-ink-1)' }}
                            >
                                <PauseIcon /> Pause AI for today
                            </motion.button>
                        </div>
                    </div>
                )}

                {fastExhausted && quota.overflow === 'sonnet' && (
                    <div className="flex items-center gap-2 flex-wrap pt-1">
                        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium" style={{ color: 'oklch(0.5 0.13 78)' }}>
                            <BoltIcon size={12} />
                            {agentExhausted ? 'Advanced AI also used up — AI resumes at midnight.' : 'Running on Advanced AI for the rest of today.'}
                        </span>
                        {!agentExhausted && (
                            <motion.button
                                type="button"
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                disabled={saving}
                                onClick={() => choose('stop')}
                                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[11px] font-semibold border cursor-pointer transition-all hover:bg-black/[0.04] disabled:opacity-40"
                                style={{ borderColor: 'oklch(0.75 0.06 80 / 0.55)', color: 'var(--color-ink-1)' }}
                            >
                                <SwapIcon /> Pause instead
                            </motion.button>
                        )}
                    </div>
                )}

                {fastExhausted && quota.overflow === 'stop' && (
                    <div className="flex items-center gap-2 flex-wrap pt-1">
                        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-ink-2">
                            <PauseIcon size={12} /> AI paused until midnight, as you chose.
                        </span>
                        {!agentExhausted && (
                            <motion.button
                                type="button"
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                disabled={saving}
                                onClick={() => choose('sonnet')}
                                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[11px] font-semibold cursor-pointer transition-all hover:brightness-105 disabled:opacity-40"
                                style={{ background: 'linear-gradient(135deg, oklch(0.84 0.155 88), oklch(0.68 0.16 76))', color: '#1a120a' }}
                            >
                                <SwapIcon /> Use Advanced AI instead
                            </motion.button>
                        )}
                    </div>
                )}
            </motion.div>
        </AnimatePresence>
    );
}
