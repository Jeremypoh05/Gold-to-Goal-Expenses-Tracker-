'use client';

// ADDED (Phase 5 · Bonus "Savings insights panel"):
// Mirrors calendar/MonthSummary.tsx — same StatCard + stagger pattern
// (initial y:8, easing [0.16,1,0.3,1], incremental delays) so the Income page
// feels consistent with the Calendar side panel. StatCard is replicated locally
// (rather than refactoring MonthSummary) — could be extracted to a shared
// component later if a third page needs it.

import { motion } from 'framer-motion';
import { SparkleIcon } from '@/components/icons';
import { AnimatedNumber } from '@/components/shared/AnimatedNumber';
import { formatMoney, MONTH_NAMES } from '@/lib/utils';

function StatCard({
    label,
    children,
    delay = 0,
}: {
    label: string;
    children: React.ReactNode;
    delay?: number;
}) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-2xl p-4"
            style={{
                background: 'var(--color-bg-card)',
                border: '1px solid var(--color-line-soft)',
            }}
        >
            <div className="text-[10px] text-ink-2 uppercase tracking-[0.08em] font-semibold">
                {label}
            </div>
            <div className="mt-1.5">{children}</div>
        </motion.div>
    );
}

interface IncomeSummaryProps {
    savingsRate: number;
    monthsToGoal: number;
    projectedYearEnd: number;
    biggestBonus: { label: string; amt: number; month: number };
}

export function IncomeSummary({
    savingsRate,
    monthsToGoal,
    projectedYearEnd,
    biggestBonus,
}: IncomeSummaryProps) {
    return (
        <div className="flex flex-col gap-3">
            {/* Section header */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4 }}
                className="px-1"
            >
                <div className="text-[11px] text-on-soft uppercase tracking-[0.14em] font-semibold">
                    Savings outlook
                </div>
                <div className="display text-[20px] mt-0.5">Insights</div>
            </motion.div>

            {/* Savings rate */}
            <StatCard label="Savings rate" delay={0.1}>
                <div className="flex items-baseline gap-1.5">
                    <div className="display-number text-[22px] leading-none">
                        <AnimatedNumber value={savingsRate} format="decimal" duration={1500} delay={300} />
                        <span style={{ fontSize: '0.55em', color: 'var(--color-ink-2)' }}>%</span>
                    </div>
                    <span className="text-[11px] text-ink-2">of income</span>
                </div>
                <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-bg-2)' }}>
                    <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${savingsRate}%` }}
                        transition={{ duration: 1.4, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
                        className="h-full"
                        style={{
                            background: 'linear-gradient(90deg, oklch(0.78 0.165 85), oklch(0.55 0.15 75))',
                        }}
                    />
                </div>
            </StatCard>

            {/* Months to goal */}
            <StatCard label="At this pace" delay={0.18}>
                <div className="flex items-baseline gap-1.5">
                    <div className="display text-[22px] leading-none">
                        ≈ <AnimatedNumber value={monthsToGoal} format="integer" duration={1200} delay={400} />
                    </div>
                    <div className="text-[11px] text-ink-2">
                        {monthsToGoal === 1 ? 'month' : 'months'} to goal
                    </div>
                </div>
            </StatCard>

            {/* Projected year-end */}
            <StatCard label="Projected year-end" delay={0.26}>
                <div className="display-number text-[22px] leading-none">
                    <span style={{ fontSize: '0.5em', color: 'var(--color-ink-2)', marginRight: 3 }}>
                        S$
                    </span>
                    <AnimatedNumber value={projectedYearEnd} format="integer" duration={1500} delay={500} />
                </div>
                <div className="text-[11px] text-ink-2 mt-1">
                    if you keep saving at this rate
                </div>
            </StatCard>

            {/* Biggest bonus */}
            <StatCard label="Biggest bonus" delay={0.34}>
                <div className="flex items-center gap-2.5">
                    <div
                        className="w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0"
                        style={{ background: 'oklch(0.95 0.05 92)' }}
                    >
                        <SparkleIcon size={16} className="text-gold-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="font-medium text-[13px]">{biggestBonus.label}</div>
                        <div className="text-[11px] text-ink-2 mt-0.5">
                            {MONTH_NAMES[biggestBonus.month - 1]} 2026
                        </div>
                    </div>
                    <div className="mono text-sm font-semibold">{formatMoney(biggestBonus.amt)}</div>
                </div>
            </StatCard>
        </div>
    );
}
