'use client';

// ADDED (Phase 5 · Bonus "Income-vs-Expenses viz"):
// Composition donut (salary vs bonuses) reusing the shared Donut with the new
// per-datum `color` + custom center props, plus a slim income-vs-spending bar
// (how much of the year's income is spent vs saved). All figures via props so it
// stays live when a bonus is added.

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Donut } from '@/components/shared';
import { formatMoney } from '@/lib/utils';

// Gold shades for the income segments (kept here so legend + donut match).
const SALARY_COLOR = 'oklch(0.72 0.165 82)';
const BONUS_COLOR = 'oklch(0.86 0.13 92)';
// ADDED (Phase 9): custom recurring income (freelance/dividends/rental) — a
// warmer amber so it reads distinct from salary/bonus in the donut.
const OTHER_COLOR = 'oklch(0.78 0.145 68)';
// Spending segment of the income-vs-spending bar (peach, distinct from gold savings).
const SPEND_COLOR = 'oklch(0.80 0.12 40)';
const SAVE_COLOR = 'oklch(0.70 0.155 80)';

interface IncomeBreakdownProps {
    yearlySalary: number;
    totalBonuses: number;
    /** ADDED (Phase 9): annual total of custom recurring income sources. */
    otherIncome?: number;
    yearlyIncome: number;
    yearlyExpenses: number;
    netSavings: number;
}

export function IncomeBreakdown({
    yearlySalary,
    totalBonuses,
    otherIncome = 0,
    yearlyIncome,
    yearlyExpenses,
    netSavings,
}: IncomeBreakdownProps) {
    const spentPct = yearlyIncome > 0 ? (yearlyExpenses / yearlyIncome) * 100 : 0;
    const savedPct = yearlyIncome > 0 ? (netSavings / yearlyIncome) * 100 : 0;
    // Hover/tap the income-vs-spending bar to read each part.
    const [barActive, setBarActive] = useState<'spent' | 'saved' | null>(null);

    return (
        <div
            className="glass rounded-3xl p-5 md:p-6 bg-bg-card"
            style={{ border: '1px solid var(--color-line-soft)' }}
        >
            <div className="display text-[20px]">Income breakdown</div>
            <div className="text-xs text-ink-2 mt-0.5">Projected across the full year</div>

            <div className="flex flex-col sm:flex-row items-center gap-5 mt-4">
                <Donut
                    size={150}
                    thickness={20}
                    data={[
                        { k: 'salary', v: yearlySalary, color: SALARY_COLOR, label: 'Salary' },
                        { k: 'other', v: otherIncome, color: OTHER_COLOR, label: 'Other income' },
                        { k: 'bonus', v: totalBonuses, color: BONUS_COLOR, label: 'Bonuses' },
                    ]}
                    centerLabel="Income"
                    centerValue={yearlyIncome}
                    centerSub={otherIncome > 0 ? 'salary + extras' : 'salary + bonuses'}
                />

                {/* Legend */}
                <div className="flex-1 w-full flex flex-col gap-3">
                    <LegendRow color={SALARY_COLOR} label="Salary" value={yearlySalary} />
                    {otherIncome > 0 && <LegendRow color={OTHER_COLOR} label="Other income" value={otherIncome} />}
                    <LegendRow color={BONUS_COLOR} label="Bonuses" value={totalBonuses} />
                </div>
            </div>

            {/* Income vs spending bar — hover/tap a part for its share */}
            <div className="mt-6 relative">
                <div className="flex items-center justify-between mb-2">
                    <div className="text-[11px] text-ink-2 uppercase tracking-[0.06em] font-semibold">
                        Income vs spending
                    </div>
                    <AnimatePresence mode="wait">
                        {barActive && (
                            <motion.div
                                key={barActive}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.12 }}
                                className="text-[11px] mono font-semibold"
                                style={{ color: barActive === 'spent' ? SPEND_COLOR : SAVE_COLOR }}
                            >
                                {barActive === 'spent'
                                    ? `${Math.round(spentPct)}% spent`
                                    : `${Math.round(savedPct)}% saved`}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
                <div className="h-3.5 rounded-full overflow-hidden flex" style={{ background: 'var(--color-bg-2)' }}>
                    <motion.div
                        className="h-full cursor-pointer"
                        initial={{ width: 0 }}
                        animate={{ width: `${spentPct}%` }}
                        transition={{ duration: 1.2, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
                        style={{ background: SPEND_COLOR, opacity: barActive === 'saved' ? 0.45 : 1 }}
                        onPointerEnter={(e) => { if (e.pointerType === 'mouse') setBarActive('spent'); }}
                        onPointerLeave={(e) => { if (e.pointerType === 'mouse') setBarActive((p) => (p === 'spent' ? null : p)); }}
                        onClick={() => setBarActive((p) => (p === 'spent' ? null : 'spent'))}
                    />
                    <motion.div
                        className="h-full cursor-pointer"
                        initial={{ width: 0 }}
                        animate={{ width: `${savedPct}%` }}
                        transition={{ duration: 1.2, delay: 0.55, ease: [0.16, 1, 0.3, 1] }}
                        style={{ background: SAVE_COLOR, opacity: barActive === 'spent' ? 0.45 : 1 }}
                        onPointerEnter={(e) => { if (e.pointerType === 'mouse') setBarActive('saved'); }}
                        onPointerLeave={(e) => { if (e.pointerType === 'mouse') setBarActive((p) => (p === 'saved' ? null : p)); }}
                        onClick={() => setBarActive((p) => (p === 'saved' ? null : 'saved'))}
                    />
                </div>
                <div className="flex justify-between mt-2 text-[11px]">
                    <span className="flex items-center gap-1.5">
                        <span className="dot" style={{ background: SPEND_COLOR }} />
                        <span className="text-ink-1">Spent {formatMoney(yearlyExpenses)}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="text-ink-1">Saved {formatMoney(netSavings)}</span>
                        <span className="dot" style={{ background: SAVE_COLOR }} />
                    </span>
                </div>
            </div>
        </div>
    );
}

function LegendRow({
    color,
    label,
    value,
}: {
    color: string;
    label: string;
    value: number;
}) {
    return (
        <div className="flex items-center gap-2.5">
            <span className="dot" style={{ background: color, width: 10, height: 10 }} />
            <span className="flex-1 text-[13px] font-medium">{label}</span>
            <span className="mono text-[13px] font-semibold">{formatMoney(value)}</span>
        </div>
    );
}
