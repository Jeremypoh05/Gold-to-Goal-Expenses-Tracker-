'use client';

// ADDED (Phase 5): Income & savings page.
// Desktop is 1:1 with .claude/References/desktop.jsx → IncomeView (header → salary |
// bonuses → full-width stat band + goal progress). Mobile is a derived, content-parity
// stacked layout (no mobile design existed in References). Bonus features layered on:
// Income-vs-Expenses viz, Savings insights panel, animated goal progress, interactive
// Add Bonus. Light theme only (dark mode is a separate app-wide phase).

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { PlusIcon, SparkleIcon } from '@/components/icons';
import { AnimatedNumber } from '@/components/shared/AnimatedNumber';
import {
    GoalProgress,
    IncomeBreakdown,
    IncomeSummary,
    AddBonusModal,
    type NewBonus,
} from '@/components/income';
import {
    SAMPLE_INCOME,
    PROJECTED_YEARLY_EXPENSES,
    SAVINGS_GOAL,
    CURRENT,
} from '@/data/sampleExpenses';
import { formatMoney, MONTH_NAMES } from '@/lib/utils';
import type { IncomeInfo } from '@/types';

type Bonus = IncomeInfo['bonuses'][number];

// ═══════════════════════════════════════════════════════════════
// Small shared helpers
// ═══════════════════════════════════════════════════════════════

function CardHeader({
    title,
    subtitle,
    right,
}: {
    title: string;
    subtitle?: string;
    right?: React.ReactNode;
}) {
    return (
        <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
                <div className="display text-[20px]">{title}</div>
                {subtitle && <div className="text-xs text-ink-2 mt-0.5">{subtitle}</div>}
            </div>
            {right}
        </div>
    );
}

function Field({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center">
            <div className="flex-1 text-xs text-ink-2">{label}</div>
            <div className="text-[13px] font-medium">{value}</div>
        </div>
    );
}

function BigStat({
    label,
    value,
    sub,
    accent = false,
    percent = false,
    delay = 0,
}: {
    label: string;
    value: number;
    sub: string;
    accent?: boolean;
    percent?: boolean;
    delay?: number;
}) {
    return (
        <div>
            <div
                className="text-[11px] uppercase tracking-[0.1em] font-semibold"
                style={{ color: accent ? 'var(--color-on-soft)' : 'var(--color-ink-2)' }}
            >
                {label}
            </div>
            <div
                className="display mt-1.5"
                style={{
                    fontSize: 'clamp(26px, 4vw, 36px)',
                    color: accent ? 'var(--color-on-soft)' : 'var(--color-ink-0)',
                }}
            >
                {percent ? (
                    <>
                        <AnimatedNumber value={value} format="integer" duration={1500} delay={delay} />
                        <span style={{ fontSize: '0.55em', color: 'var(--color-ink-2)' }}>%</span>
                    </>
                ) : (
                    <>
                        <span style={{ fontSize: '0.55em', color: 'var(--color-ink-2)', marginRight: 4 }}>
                            S$
                        </span>
                        <AnimatedNumber value={value} format="integer" duration={1500} delay={delay} />
                    </>
                )}
            </div>
            <div className="text-[11px] text-ink-2 mt-0.5">{sub}</div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
// Cards (responsive — reused by both desktop + mobile layouts)
// ═══════════════════════════════════════════════════════════════

function SalaryCard({ salary, delay = 0 }: { salary: number; delay?: number }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
            className="glass rounded-3xl p-6 md:p-7 bg-bg-card"
            style={{ border: '1px solid var(--color-line-soft)' }}
        >
            <CardHeader title="Monthly salary" />
            <div className="mt-4 flex items-baseline gap-3 flex-wrap">
                <div className="display-number" style={{ fontSize: 'clamp(40px, 7vw, 56px)', lineHeight: 1 }}>
                    <span style={{ fontSize: '0.42em', color: 'var(--color-ink-2)', marginRight: 4 }}>S$</span>
                    <AnimatedNumber value={salary} format="integer" duration={1600} delay={300} />
                </div>
                <span className="chip">Take-home</span>
            </div>
            <div
                className="mt-5 pt-4 flex flex-col gap-3"
                style={{ borderTop: '1px solid var(--color-line-soft)' }}
            >
                {/* Static design values — these become editable fields once the DB lands (Phase 8). */}
                <Field label="Gross monthly" value="S$ 8,500" />
                <Field label="CPF / deductions" value="S$ 1,300" />
                <Field label="Pay day" value="25th of every month" />
                <Field label="Frequency" value="Monthly" />
            </div>
        </motion.div>
    );
}

function BonusesCard({
    bonuses,
    total,
    onAdd,
    delay = 0,
}: {
    bonuses: Bonus[];
    total: number;
    onAdd: () => void;
    delay?: number;
}) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
            className="glass rounded-3xl p-6 md:p-7 bg-bg-card"
            style={{ border: '1px solid var(--color-line-soft)' }}
        >
            <CardHeader
                title="Bonuses"
                subtitle="Add bonus months and amounts"
                right={
                    <button
                        type="button"
                        onClick={onAdd}
                        className="flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium border border-line bg-bg-card hover:border-ink-2 transition-all"
                    >
                        <PlusIcon size={14} /> Add
                    </button>
                }
            />
            <div className="mt-4 flex flex-col gap-2.5">
                {bonuses.map((b, i) => (
                    <motion.div
                        // key by content+index so a freshly added bonus animates in
                        key={`${b.label}-${b.month}-${i}`}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, delay: delay + 0.2 + i * 0.06 }}
                        className="flex items-center gap-3 p-3.5 rounded-[14px]"
                        style={{
                            // CHANGED (dark mode): theme-aware soft-gold so the row darkens
                            // and its (theme-ink) text stays legible in dark.
                            background:
                                'linear-gradient(135deg, var(--grad-soft-a), var(--grad-soft-b))',
                            border: '1px solid oklch(0.88 0.07 88)',
                        }}
                    >
                        <div
                            className="w-10 h-10 rounded-[10px] bg-bg-card flex items-center justify-center flex-shrink-0"
                            style={{ color: 'var(--color-gold-700)' }}
                        >
                            <SparkleIcon size={18} className="text-gold-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-medium truncate">{b.label}</div>
                            <div className="text-[11px] text-ink-2">{MONTH_NAMES[b.month - 1]} 2026</div>
                        </div>
                        <div className="mono text-[16px] font-semibold">{formatMoney(b.amt)}</div>
                    </motion.div>
                ))}
            </div>
            <div className="mt-5 p-3.5 rounded-[14px] flex items-baseline gap-2" style={{ background: 'var(--color-bg-1)' }}>
                <span className="text-[11px] text-ink-2 uppercase tracking-[0.06em]">
                    Total bonuses &rsquo;26
                </span>
                <div className="flex-1" />
                <span className="mono font-semibold text-[18px]">
                    S$ <AnimatedNumber value={total} format="integer" duration={1200} delay={500} />
                </span>
            </div>
        </motion.div>
    );
}

function StatBand({
    stats,
    delay = 0,
}: {
    stats: ReturnType<typeof useIncomeStats>;
    delay?: number;
}) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
            className="glass grad-gold-soft rounded-3xl p-6 md:p-8"
            style={{ border: '1px solid oklch(0.88 0.08 88)' }}
        >
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 md:gap-6">
                <BigStat label="Yearly income" value={stats.yearlyIncome} sub="salary + bonuses" delay={300} />
                <BigStat label="Yearly expenses" value={stats.yearlyExpenses} sub="projected" delay={400} />
                <BigStat label="Net savings" value={stats.netSavings} sub="target" accent delay={500} />
                <BigStat label="Savings rate" value={stats.savingsRate} percent sub="of income" delay={600} />
            </div>
            <div className="mt-7">
                <GoalProgress
                    saved={stats.saved}
                    goal={stats.goal}
                    toGo={stats.toGo}
                    progressPct={stats.goalProgressPct}
                    delay={0.6}
                />
            </div>
        </motion.div>
    );
}

// ═══════════════════════════════════════════════════════════════
// Live stats hook — recomputes from the current (possibly user-added) bonuses
// so the stat band, breakdown, and insights all update when a bonus is added.
// ═══════════════════════════════════════════════════════════════

function useIncomeStats(bonuses: Bonus[]) {
    return useMemo(() => {
        const monthlySalary = SAMPLE_INCOME.salary;
        const yearlySalary = monthlySalary * 12;
        const totalBonuses = bonuses.reduce((a, b) => a + b.amt, 0);
        const yearlyIncome = yearlySalary + totalBonuses;
        const yearlyExpenses = PROJECTED_YEARLY_EXPENSES;
        const netSavings = yearlyIncome - yearlyExpenses;
        const savingsRate = (netSavings / yearlyIncome) * 100;

        const goal = SAVINGS_GOAL;
        const saved = SAMPLE_INCOME.saved;
        const toGo = Math.max(0, goal - saved);
        const goalProgressPct = (saved / goal) * 100;

        const monthlyNetSavings = netSavings / 12;
        const monthsToGoal =
            monthlyNetSavings > 0 ? Math.ceil(toGo / monthlyNetSavings) : 0;
        const monthsLeft = Math.max(0, 12 - CURRENT.month);
        const projectedYearEnd = Math.round(saved + monthlyNetSavings * monthsLeft);

        const biggestBonus =
            bonuses.length > 0
                ? bonuses.reduce((max, b) => (b.amt > max.amt ? b : max), bonuses[0])
                : { label: '—', amt: 0, month: 1 };

        return {
            monthlySalary,
            yearlySalary,
            totalBonuses,
            yearlyIncome,
            yearlyExpenses,
            netSavings,
            savingsRate,
            goal,
            saved,
            toGo,
            goalProgressPct,
            projectedYearEnd,
            monthsToGoal,
            biggestBonus,
        };
    }, [bonuses]);
}

// ═══════════════════════════════════════════════════════════════
// Page
// ═══════════════════════════════════════════════════════════════

export default function IncomePage() {
    // Bonuses live in page state so the interactive "Add bonus" updates the whole
    // page (band, breakdown, insights) live. Non-persistent until Phase 8 DB.
    const [bonuses, setBonuses] = useState<Bonus[]>(() => [...SAMPLE_INCOME.bonuses]);
    const [addOpen, setAddOpen] = useState(false);

    const stats = useIncomeStats(bonuses);

    const handleAddBonus = (b: NewBonus) => {
        // Insert keeping chronological (by month) order.
        setBonuses((prev) =>
            [...prev, b].sort((a, c) => a.month - c.month)
        );
    };

    return (
        <>
            <div className="px-4 md:px-8 py-5 md:py-7 pb-24 md:pb-16 max-w-[1320px] mx-auto flex flex-col gap-5 md:gap-6">
                {/* Header */}
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                >
                    <div className="text-[10px] md:text-[11px] text-on-soft uppercase tracking-[0.14em] font-semibold">
                        Income · {MONTH_NAMES[CURRENT.month - 1]} {CURRENT.year}
                    </div>
                    <h1 className="display mt-0.5 md:mt-1" style={{ fontSize: 'clamp(28px, 5vw, 40px)', lineHeight: 1.05 }}>
                        Income &amp; savings
                    </h1>
                    <div className="text-[13px] text-ink-2 mt-1">
                        Salary, bonuses, net savings targets
                    </div>
                </motion.div>

                {/* ═══════════ DESKTOP / TABLET (md+) ═══════════ */}
                <div className="hidden md:flex md:flex-col md:gap-6">
                    {/* Row 1: Salary | Bonuses (1:1 with design) */}
                    <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
                        <SalaryCard salary={stats.monthlySalary} delay={0.05} />
                        <BonusesCard
                            bonuses={bonuses}
                            total={stats.totalBonuses}
                            onAdd={() => setAddOpen(true)}
                            delay={0.1}
                        />
                    </div>

                    {/* Row 2: Full-width stat band + goal (1:1 with design) */}
                    <StatBand stats={stats} delay={0.15} />

                    {/* Row 3: Bonus features — breakdown viz + savings insights */}
                    <div className="grid gap-6 grid-cols-1 lg:[grid-template-columns:1.4fr_1fr] items-start">
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
                        >
                            <IncomeBreakdown
                                yearlySalary={stats.yearlySalary}
                                totalBonuses={stats.totalBonuses}
                                yearlyIncome={stats.yearlyIncome}
                                yearlyExpenses={stats.yearlyExpenses}
                                netSavings={stats.netSavings}
                            />
                        </motion.div>
                        <IncomeSummary
                            savingsRate={stats.savingsRate}
                            monthsToGoal={stats.monthsToGoal}
                            projectedYearEnd={stats.projectedYearEnd}
                            biggestBonus={stats.biggestBonus}
                        />
                    </div>
                </div>

                {/* ═══════════ MOBILE (< md) — derived, content parity ═══════════ */}
                <div className="md:hidden flex flex-col gap-5">
                    <SalaryCard salary={stats.monthlySalary} delay={0.05} />
                    <IncomeBreakdown
                        yearlySalary={stats.yearlySalary}
                        totalBonuses={stats.totalBonuses}
                        yearlyIncome={stats.yearlyIncome}
                        yearlyExpenses={stats.yearlyExpenses}
                        netSavings={stats.netSavings}
                    />
                    <StatBand stats={stats} delay={0.1} />
                    <BonusesCard
                        bonuses={bonuses}
                        total={stats.totalBonuses}
                        onAdd={() => setAddOpen(true)}
                        delay={0.15}
                    />
                    <IncomeSummary
                        savingsRate={stats.savingsRate}
                        monthsToGoal={stats.monthsToGoal}
                        projectedYearEnd={stats.projectedYearEnd}
                        biggestBonus={stats.biggestBonus}
                    />
                </div>
            </div>

            {/* Interactive Add Bonus modal / sheet */}
            <AddBonusModal open={addOpen} onClose={() => setAddOpen(false)} onAdd={handleAddBonus} />
        </>
    );
}
