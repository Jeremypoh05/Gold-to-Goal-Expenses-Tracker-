'use client';

// ADDED (Module 4 · viz): "Net so far this year" — the ACTUAL picture up to today
// (not the full-year projection the breakdown/insights show). A hero net number
// plus an interactive earned-vs-spent comparison: hover (or tap on mobile) either
// bar for its amount, monthly average, and share. Follows the app's gold=income /
// neutral=spent / green|red=net tokens.

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AnimatedNumber } from '@/components/shared/AnimatedNumber';
import { spotlightMove, SpotlightLayer } from '@/components/shared';
import { formatMoney } from '@/lib/utils';

const INCOME_GRAD = 'linear-gradient(90deg, oklch(0.82 0.155 88), oklch(0.66 0.16 78))';
const SPENT_COLOR = 'var(--color-ink-3)';
const POS = 'oklch(0.72 0.15 150)';
const NEG = 'oklch(0.64 0.19 25)';

type Row = 'earned' | 'spent';

export function NetProfitPanel({
    earned,
    spent,
    elapsed,
    delay = 0,
}: {
    earned: number; // actual income YTD
    spent: number; // actual expenses YTD
    elapsed: number; // months counted (for /mo average)
    delay?: number;
}) {
    const [active, setActive] = useState<Row | null>(null);
    const net = earned - spent;
    const positive = net >= 0;
    const max = Math.max(1, earned, spent);
    const months = Math.max(1, elapsed);

    const rows: { key: Row; label: string; value: number; grad: string; avg: number }[] = [
        { key: 'earned', label: 'Earned', value: earned, grad: INCOME_GRAD, avg: earned / months },
        { key: 'spent', label: 'Spent', value: spent, grad: `linear-gradient(90deg, ${SPENT_COLOR}, var(--color-ink-2))`, avg: spent / months },
    ];

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
            {/* soft aura in the net's colour (slowly drifts) */}
            <div
                className="aurora-blob absolute -top-16 -right-16 w-48 h-48 rounded-full pointer-events-none"
                style={{ background: positive ? POS : NEG, opacity: 0.1, filter: 'blur(30px)' }}
            />

            <div className="flex items-start gap-3 mb-4 relative">
                <div className="flex-1 min-w-0">
                    <div className="display text-[20px]">Net so far</div>
                    <div className="text-xs text-ink-2 mt-0.5">Earned − spent, this year to date</div>
                </div>
                <div className="text-right">
                    <div className="display-number" style={{ fontSize: 'clamp(26px, 5vw, 34px)', lineHeight: 1, color: positive ? POS : NEG }}>
                        <span style={{ fontSize: '0.5em', marginRight: 2 }}>{positive ? '+' : '−'}</span>
                        <span style={{ fontSize: '0.5em', color: 'var(--color-ink-2)', marginRight: 3 }}>S$</span>
                        <AnimatedNumber value={Math.abs(net)} format="integer" duration={1400} delay={delay * 1000 + 200} />
                    </div>
                    <div className="text-[11px] text-ink-2 mt-1">{positive ? 'net saved' : 'over budget'} · {months} mo</div>
                </div>
            </div>

            {/* Interactive earned vs spent bars */}
            <div className="relative flex flex-col gap-3 mt-5">
                <AnimatePresence>
                    {active && (
                        <motion.div
                            key={active}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 6 }}
                            transition={{ duration: 0.15 }}
                            className="absolute -top-1 right-0 z-10 px-3 py-2 rounded-xl whitespace-nowrap shadow-lg pointer-events-none"
                            style={{ background: 'oklch(0.20 0.015 75)', color: '#fff' }}
                        >
                            {rows
                                .filter((r) => r.key === active)
                                .map((r) => (
                                    <div key={r.key}>
                                        <div className="text-[10px] uppercase tracking-[0.08em] opacity-60">{r.label}</div>
                                        <div className="mono font-semibold text-[13px]">{formatMoney(r.value)}</div>
                                        <div className="text-[10px] opacity-70 mt-0.5">{formatMoney(r.avg)}/mo avg</div>
                                    </div>
                                ))}
                        </motion.div>
                    )}
                </AnimatePresence>

                {rows.map((r, i) => (
                    <div
                        key={r.key}
                        role="button"
                        tabIndex={0}
                        onPointerEnter={(e) => { if (e.pointerType === 'mouse') setActive(r.key); }}
                        onPointerLeave={(e) => { if (e.pointerType === 'mouse') setActive((p) => (p === r.key ? null : p)); }}
                        onClick={() => setActive((p) => (p === r.key ? null : r.key))}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActive((p) => (p === r.key ? null : r.key)); } }}
                        className="cursor-pointer group"
                    >
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] font-medium" style={{ color: active === r.key ? 'var(--color-ink-0)' : 'var(--color-ink-2)' }}>
                                {r.label}
                            </span>
                            <span className="mono text-[12px] font-semibold">{formatMoney(r.value)}</span>
                        </div>
                        <div className="h-3 rounded-full overflow-hidden" style={{ background: 'var(--color-bg-1)' }}>
                            <motion.div
                                className="h-full rounded-full"
                                initial={{ width: 0 }}
                                animate={{ width: `${(r.value / max) * 100}%` }}
                                transition={{ duration: 1, delay: delay + 0.2 + i * 0.12, ease: [0.16, 1, 0.3, 1] }}
                                style={{ background: r.grad, opacity: active && active !== r.key ? 0.4 : 1 }}
                            />
                        </div>
                    </div>
                ))}

                {/* savings-rate footnote */}
                <div className="text-[11px] text-ink-2 mt-1">
                    {earned > 0 ? (
                        <>You&rsquo;ve kept <span className="font-semibold" style={{ color: positive ? POS : NEG }}>{Math.round((net / earned) * 100)}%</span> of what you earned so far.</>
                    ) : (
                        'Add your income to see net savings.'
                    )}
                </div>
            </div>
        </motion.div>
    );
}
