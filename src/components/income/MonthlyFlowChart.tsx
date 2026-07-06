'use client';

// ADDED (Phase 9): interactive monthly Income-vs-Spent bar chart. Visualizes the
// new time-aware year data — each month shows a gold income bar and a neutral
// "spent" bar, so salary changes and spending swings are obvious at a glance.
// Months past the current one (this year) are dimmed as projections. Bars animate
// in; hovering a month reveals a floating tooltip with income / spent / net.

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { spotlightMove, SpotlightLayer } from '@/components/shared';
import { formatMoney } from '@/lib/utils';

const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const CHART_H = 150; // px — tallest bar

export function MonthlyFlowChart({
    income,
    expenses,
    elapsed,
    delay = 0,
}: {
    income: number[]; // 12 entries, index 0 = Jan
    expenses: number[]; // 12 entries
    /** Months 1..elapsed are actual; later months (this year) are projections. */
    elapsed: number;
    delay?: number;
}) {
    const [hover, setHover] = useState<number | null>(null);

    const max = Math.max(1, ...income, ...expenses);

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
            whileHover={{ y: -3 }}
            onPointerMove={spotlightMove}
            className="spotlight-card rounded-3xl bg-bg-card p-5 md:p-6 relative overflow-hidden"
            style={{ border: '1px solid var(--color-line-soft)' }}
        >
            <SpotlightLayer />
            {/* Header + legend */}
            <div className="flex items-start gap-3 mb-5">
                <div className="flex-1 min-w-0">
                    <div className="display text-[20px]">Monthly flow</div>
                    <div className="text-xs text-ink-2 mt-0.5">Income vs spending across the year</div>
                </div>
                <div className="flex items-center gap-2.5 md:gap-3 text-[11px] text-ink-2 flex-wrap justify-end">
                    <span className="inline-flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: 'linear-gradient(180deg, oklch(0.82 0.155 88), oklch(0.64 0.16 78))' }} />
                        Income
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: 'var(--color-ink-3)' }} />
                        Spent
                    </span>
                    {/* CHANGED (Phase 9): explicit legend for the striped "projected" bars
                        so future/estimate months read clearly (not just as faded actuals). */}
                    <span className="inline-flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: 'repeating-linear-gradient(45deg, oklch(0.80 0.15 84) 0 2px, oklch(0.80 0.15 84 / 0.25) 2px 4px)' }} />
                        Projected
                    </span>
                </div>
            </div>

            {/* Chart */}
            <div className="relative">
                {/* Floating tooltip — anchored to the top of the plot and horizontally
                    clamped (left / center / right zones) so it can never spill past the
                    card edges and get clipped by `overflow-hidden` (e.g. Dec on the right). */}
                <AnimatePresence>
                    {hover !== null && (() => {
                        const frac = (hover + 0.5) / 12;
                        const pos =
                            frac < 0.22
                                ? { left: 0 }
                                : frac > 0.78
                                    ? { right: 0 }
                                    : { left: `${frac * 100}%`, transform: 'translateX(-50%)' };
                        return (
                        <motion.div
                            initial={{ opacity: 0, y: -6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={{ duration: 0.15 }}
                            className="absolute z-30 pointer-events-none"
                            style={{ ...pos, top: 0 }}
                        >
                            <div
                                className="px-3 py-2 rounded-xl whitespace-nowrap shadow-lg"
                                style={{ background: 'oklch(0.20 0.015 75)', color: '#fff' }}
                            >
                                <div className="text-[10px] uppercase tracking-[0.08em] mb-1">
                                    <span className="opacity-60">{MONTH_SHORT[hover]}</span>
                                    {hover + 1 > elapsed && (
                                        <span style={{ color: 'oklch(0.86 0.15 88)', fontWeight: 700 }}> · projected</span>
                                    )}
                                </div>
                                <div className="flex items-center justify-between gap-4 text-[11px]">
                                    <span className="opacity-70">Income</span>
                                    <span className="mono font-semibold">{formatMoney(income[hover])}</span>
                                </div>
                                <div className="flex items-center justify-between gap-4 text-[11px]">
                                    <span className="opacity-70">Spent</span>
                                    <span className="mono font-semibold">{formatMoney(expenses[hover])}</span>
                                </div>
                                <div className="flex items-center justify-between gap-4 text-[11px] mt-0.5 pt-0.5" style={{ borderTop: '1px solid rgba(255,255,255,0.15)' }}>
                                    <span className="opacity-70">Net</span>
                                    <span className="mono font-semibold" style={{ color: income[hover] - expenses[hover] >= 0 ? 'oklch(0.85 0.14 145)' : 'oklch(0.8 0.13 30)' }}>
                                        {income[hover] - expenses[hover] >= 0 ? '+' : '−'}
                                        {formatMoney(Math.abs(income[hover] - expenses[hover]))}
                                    </span>
                                </div>
                            </div>
                        </motion.div>
                        );
                    })()}
                </AnimatePresence>

                {/* Bars */}
                <div className="flex items-end gap-1 md:gap-2" style={{ height: CHART_H }}>
                    {MONTH_INITIALS.map((_, i) => {
                        const projected = i + 1 > elapsed;
                        const active = hover === i;
                        return (
                            <div
                                key={i}
                                className="flex-1 h-full flex items-end justify-center gap-[2px] md:gap-1 cursor-pointer rounded-md transition-colors"
                                style={{ background: active ? 'var(--color-bg-1)' : 'transparent' }}
                                // CHANGED (Phase 9): pointer-aware so touch works — hover on
                                // mouse only (touch fires a spurious leave that closed the
                                // tooltip instantly on mobile); tap toggles and holds it open.
                                onPointerEnter={(e) => {
                                    if (e.pointerType === 'mouse') setHover(i);
                                }}
                                onPointerLeave={(e) => {
                                    if (e.pointerType === 'mouse') setHover((p) => (p === i ? null : p));
                                }}
                                onClick={() => setHover((p) => (p === i ? null : i))}
                            >
                                <motion.div
                                    initial={{ height: 0 }}
                                    animate={{ height: Math.max(2, (income[i] / max) * (CHART_H - 6)) }}
                                    transition={{ duration: 0.7, delay: delay + 0.1 + i * 0.03, ease: [0.16, 1, 0.3, 1] }}
                                    className="w-1/2 rounded-t-[4px]"
                                    style={{
                                        maxWidth: 14,
                                        // Projected months → gold stripes (vivid, clearly "estimate"),
                                        // not just a faded solid bar that reads as a real actual.
                                        background: projected
                                            ? 'repeating-linear-gradient(45deg, oklch(0.80 0.15 84) 0 3px, oklch(0.80 0.15 84 / 0.28) 3px 6px)'
                                            : 'linear-gradient(180deg, oklch(0.82 0.155 88), oklch(0.64 0.16 78))',
                                        opacity: projected ? 0.9 : 1,
                                        boxShadow: active ? '0 2px 8px -2px oklch(0.6 0.16 78 / 0.5)' : 'none',
                                    }}
                                />
                                <motion.div
                                    initial={{ height: 0 }}
                                    animate={{ height: Math.max(2, (expenses[i] / max) * (CHART_H - 6)) }}
                                    transition={{ duration: 0.7, delay: delay + 0.16 + i * 0.03, ease: [0.16, 1, 0.3, 1] }}
                                    className="w-1/2 rounded-t-[4px]"
                                    style={{
                                        maxWidth: 14,
                                        background: projected
                                            ? 'repeating-linear-gradient(45deg, var(--color-ink-3) 0 3px, transparent 3px 6px)'
                                            : 'var(--color-ink-3)',
                                        opacity: projected ? 0.65 : 0.85,
                                    }}
                                />
                            </div>
                        );
                    })}
                </div>

                {/* Month labels */}
                <div className="flex gap-1 md:gap-2 mt-2">
                    {MONTH_INITIALS.map((m, i) => (
                        <div
                            key={i}
                            className="flex-1 text-center text-[10px] mono transition-colors"
                            style={{ color: hover === i ? 'var(--color-ink-0)' : 'var(--color-ink-3)', fontWeight: hover === i ? 600 : 400 }}
                        >
                            {m}
                        </div>
                    ))}
                </div>
            </div>
        </motion.div>
    );
}
