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
            {/* Header — legend by default; swaps to the hovered month's detail so the
                readout always lives in the same fixed spot and can never float off
                the card edges (it did as a floating tooltip: tall bars pushed it up
                past the top, edge months pushed it past left/right). */}
            <div className="flex items-start gap-3 mb-5 min-h-[42px]">
                <div className="flex-1 min-w-0">
                    <div className="display text-[20px]">Monthly flow</div>
                    <div className="text-xs text-ink-2 mt-0.5">Income vs spending across the year</div>
                </div>
                <div className="relative flex items-center justify-end">
                    <AnimatePresence mode="wait">
                        {hover === null ? (
                            <motion.div
                                key="legend"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.15 }}
                                className="flex items-center gap-2.5 md:gap-3 text-[11px] text-ink-2 flex-wrap justify-end"
                            >
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
                            </motion.div>
                        ) : (
                            <motion.div
                                key="detail"
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                                transition={{ duration: 0.15 }}
                                className="flex items-center gap-2 md:gap-3 px-3 py-1.5 rounded-full text-[11px] flex-wrap justify-end"
                                style={{ background: 'var(--color-bg-1)', border: '1px solid var(--color-line-soft)' }}
                            >
                                <span
                                    className="font-semibold uppercase tracking-[0.06em]"
                                    style={{ color: hover + 1 > elapsed ? 'var(--color-gold-600)' : 'var(--color-ink-1)' }}
                                >
                                    {MONTH_SHORT[hover]}
                                    {hover + 1 > elapsed && ' · Proj'}
                                </span>
                                <span className="hidden sm:inline text-ink-2">
                                    Income <span className="mono font-semibold text-ink-0">{formatMoney(income[hover])}</span>
                                </span>
                                <span className="hidden sm:inline text-ink-2">
                                    Spent <span className="mono font-semibold text-ink-0">{formatMoney(expenses[hover])}</span>
                                </span>
                                <span
                                    className="mono font-semibold"
                                    style={{ color: income[hover] - expenses[hover] >= 0 ? 'oklch(0.72 0.15 150)' : 'oklch(0.64 0.19 25)' }}
                                >
                                    {income[hover] - expenses[hover] >= 0 ? '+' : '−'}
                                    {formatMoney(Math.abs(income[hover] - expenses[hover]))}
                                </span>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>

            {/* Chart */}
            <div className="relative">
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
