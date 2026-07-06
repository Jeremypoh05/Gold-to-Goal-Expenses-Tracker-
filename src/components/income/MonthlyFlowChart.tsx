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
const POS = 'oklch(0.72 0.15 150)';
const NEG = 'oklch(0.64 0.19 25)';

/** One labeled figure in the detail panel — stacks label above value so nothing
 * gets truncated or hidden at narrow (mobile) widths. */
function StatGroup({
    label,
    value,
    swatch,
    color,
}: {
    label: string;
    value: string;
    swatch?: string;
    color?: string;
}) {
    return (
        <div className="flex flex-col gap-0.5 min-w-0">
            <span className="inline-flex items-center gap-1.5 text-[9px] uppercase tracking-[0.08em] text-ink-2 whitespace-nowrap">
                {swatch && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: swatch }} />}
                {label}
            </span>
            <span className="mono font-semibold text-[13px] md:text-[14px] whitespace-nowrap" style={{ color: color ?? 'var(--color-ink-0)' }}>
                {value}
            </span>
        </div>
    );
}

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
            {/* Header + legend (always visible — a swap-in-place chip here got too
                cramped to show every figure on mobile). */}
            <div className="flex items-start gap-3 mb-4">
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

            {/* Detail panel — a permanently-reserved slot (fixed min-height, always
                rendered) right below the header. Hovering/tapping a month only
                crossfades its CONTENT in place; the slot itself never grows or
                shrinks, so nothing below it ever shifts. This gets the "floating
                tooltip" feel back (appears without disturbing layout) without the
                overflow problems of actually floating it. */}
            <div
                className="rounded-2xl px-3.5 py-2.5 md:py-0 flex items-center mb-4 min-h-[70px] md:min-h-[58px] transition-colors duration-200"
                style={
                    hover !== null
                        ? { background: 'linear-gradient(135deg, var(--grad-soft-a), var(--grad-soft-b))', border: '1px solid oklch(0.88 0.07 88)' }
                        : { background: 'var(--color-bg-1)', border: '1px solid var(--color-line-soft)' }
                }
            >
                <AnimatePresence mode="wait">
                    {hover === null ? (
                        <motion.span
                            key="empty"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            className="text-[12px] text-ink-2"
                        >
                            Hover or tap a month for the breakdown
                        </motion.span>
                    ) : (() => {
                        const net = income[hover] - expenses[hover];
                        const projected = hover + 1 > elapsed;
                        return (
                            <motion.div
                                key="detail"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.15 }}
                                className="flex flex-col md:flex-row md:items-center gap-1.5 md:gap-6 w-full"
                            >
                                <div className="flex items-center gap-2">
                                    <span
                                        className="w-2 h-2 rounded-full flex-shrink-0"
                                        style={{ background: projected ? 'var(--color-gold-600)' : 'var(--color-ink-1)' }}
                                    />
                                    <span className="text-[13px] font-semibold whitespace-nowrap">
                                        {MONTH_SHORT[hover]}
                                        {projected && (
                                            <span className="ml-1.5 text-[9px] font-bold uppercase tracking-[0.06em]" style={{ color: 'var(--color-gold-600)' }}>
                                                Projected
                                            </span>
                                        )}
                                    </span>
                                </div>
                                {/* Fixed 3-column grid — Income / Spent / Net always land in the
                                    same slots and never reflow unpredictably at narrow widths. */}
                                <div className="grid grid-cols-3 gap-2 md:flex md:items-center md:gap-7 md:flex-1 md:justify-end">
                                    <StatGroup label="Income" value={formatMoney(income[hover])} swatch="oklch(0.78 0.155 85)" />
                                    <StatGroup label="Spent" value={formatMoney(expenses[hover])} swatch="var(--color-ink-3)" />
                                    <StatGroup
                                        label="Net"
                                        value={`${net >= 0 ? '+' : '−'}${formatMoney(Math.abs(net))}`}
                                        color={net >= 0 ? POS : NEG}
                                    />
                                </div>
                            </motion.div>
                        );
                    })()}
                </AnimatePresence>
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
                                className="relative flex-1 h-full flex items-end justify-center gap-[2px] md:gap-1 cursor-pointer rounded-md"
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
                                {/* Highlight sits behind the bars (not on them) and at low
                                    opacity — a full-strength fill here read as too loud. */}
                                {active && (
                                    <div
                                        className="absolute inset-0 rounded-md pointer-events-none"
                                        style={{ background: 'var(--color-bg-1)', opacity: 0.4 }}
                                    />
                                )}
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
