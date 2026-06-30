'use client';

// ADDED (Phase 5): Income & savings page.
// Desktop is 1:1 with .claude/References/desktop.jsx → IncomeView (header → salary |
// bonuses → full-width stat band + goal progress). Mobile is a derived, content-parity
// stacked layout (no mobile design existed in References). Bonus features layered on:
// Income-vs-Expenses viz, Savings insights panel, animated goal progress, interactive
// Add Bonus. Light theme only (dark mode is a separate app-wide phase).

import { useState, useMemo, useTransition, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { PlusIcon, SparkleIcon, EditIcon } from '@/components/icons';
import { AnimatedNumber } from '@/components/shared/AnimatedNumber';
import {
    GoalProgress,
    IncomeBreakdown,
    IncomeSummary,
    AddBonusModal,
    IncomeSettingsModal,
    SalaryTimelineModal,
    MonthlyFlowChart,
    type NewBonus,
    type SalaryPeriodForm,
} from '@/components/income';
import { useExpenses } from '@/components/data/ExpensesContext';
import { computeYearIncomeStats } from '@/lib/expense-utils';
import type { YearSummary } from '@/lib/queries';
import {
    addBonus,
    updateIncomeSettings,
    fetchYearSummary,
    addSalaryPeriod,
    deleteSalaryPeriod,
} from '@/lib/actions';
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

function ordinal(n: number): string {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function SalaryCard({
    salary,
    gross,
    deductions,
    payDay,
    payFrequency,
    delay = 0,
    onEdit,
}: {
    salary: number;
    gross: number;
    deductions: number;
    payDay: number;
    payFrequency: string;
    delay?: number;
    onEdit: () => void;
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
                title="Monthly salary"
                right={
                    <button
                        type="button"
                        onClick={onEdit}
                        className="flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium border border-line bg-bg-card hover:border-ink-2 transition-all"
                    >
                        <EditIcon size={13} /> Edit
                    </button>
                }
            />
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
                {/* CHANGED (Phase 8.1): real, editable values (via the Edit → settings modal). */}
                <Field label="Gross monthly" value={gross > 0 ? formatMoney(gross) : '—'} />
                <Field label="CPF / deductions" value={deductions > 0 ? formatMoney(deductions) : '—'} />
                <Field label="Pay day" value={payDay > 0 ? `${ordinal(payDay)} of every month` : '—'} />
                <Field label="Frequency" value={payFrequency} />
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
    onEditGoal,
    delay = 0,
}: {
    stats: ReturnType<typeof computeYearIncomeStats>;
    onEditGoal: () => void;
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
            {/* CHANGED (Phase 9): real actual-vs-projected numbers. The main figure is
                the full-year projection; the sub-line shows what's actually banked so far. */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 md:gap-6">
                <BigStat label="Income" value={stats.projectedAnnualIncome} sub={`${formatMoney(stats.actualIncomeYTD)} so far · est. year`} delay={300} />
                <BigStat label="Expenses" value={stats.projectedAnnualExpenses} sub={`${formatMoney(stats.actualExpensesYTD)} so far · est. year`} delay={400} />
                <BigStat label="Net savings" value={stats.netSavings} sub="projected year" accent delay={500} />
                <BigStat label="Savings rate" value={stats.savingsRate} percent sub="of income" delay={600} />
            </div>
            <div className="mt-7">
                <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] uppercase tracking-[0.1em] font-semibold text-on-soft">
                        Savings goal
                    </span>
                    <button
                        type="button"
                        onClick={onEditGoal}
                        className="flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-medium border border-line bg-bg-card/70 hover:border-ink-2 transition-all"
                    >
                        <EditIcon size={12} /> {stats.goal > 0 ? 'Edit goal' : 'Set goal'}
                    </button>
                </div>
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
// Page
// ═══════════════════════════════════════════════════════════════

export default function IncomePage() {
    const { current, income, refresh } = useExpenses();
    const [pending, startTransition] = useTransition();

    const year = current.year;
    // CHANGED (Phase 9): income figures now come from a real full-year rollup
    // (salary timeline + per-month spend), fetched on mount + after mutations,
    // instead of "current-month salary × 12". Bonuses still ride the month
    // context (kept in sync by refresh()).
    const [summary, setSummary] = useState<YearSummary | null>(null);

    const loadSummary = useCallback(() => {
        startTransition(async () => {
            setSummary(await fetchYearSummary(year));
        });
    }, [year]);

    useEffect(() => {
        loadSummary();
    }, [loadSummary]);

    const bonuses = income.bonuses;
    const [addOpen, setAddOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [salaryOpen, setSalaryOpen] = useState(false);

    // Compute from the server summary; fall back to a zero/loading shape so the
    // page renders instantly before the fetch resolves.
    const stats = useMemo(
        () =>
            computeYearIncomeStats(
                summary ?? {
                    year,
                    isCurrentYear: current.day > 0,
                    currentMonth: current.month,
                    periods: [],
                    monthlyExpenseTotals: Array(12).fill(0),
                    bonuses,
                    savingsGoal: income.savingsGoal,
                    saved: income.saved,
                },
            ),
        [summary, year, current.day, current.month, bonuses, income.savingsGoal, income.saved],
    );

    const refreshAll = () => {
        refresh();
        loadSummary();
    };

    const handleAddBonus = (b: NewBonus) => {
        startTransition(async () => {
            await addBonus({ month: b.month, amount: b.amt, label: b.label });
            refreshAll();
        });
    };

    const handleSaveSettings = (v: {
        savingsGoal: number;
        saved: number;
        monthlyBudget: number;
        payDay: number;
        payFrequency: string;
    }) => {
        startTransition(async () => {
            await updateIncomeSettings(v);
            refreshAll();
        });
    };

    const handleSaveSalary = (v: SalaryPeriodForm) => {
        startTransition(async () => {
            await addSalaryPeriod({
                effectiveYear: v.effectiveYear,
                effectiveMonth: v.effectiveMonth,
                monthlySalary: v.monthlySalary,
                grossSalary: v.grossSalary,
                deductions: v.deductions,
                label: v.label || undefined,
            });
            refreshAll();
        });
    };

    const handleDeleteSalary = (id: number) => {
        startTransition(async () => {
            await deleteSalaryPeriod(id);
            refreshAll();
        });
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
                        Income · {MONTH_NAMES[current.month - 1]} {current.year}
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
                        <SalaryCard salary={income.monthlySalary} gross={income.grossSalary} deductions={income.deductions} payDay={income.payDay} payFrequency={income.payFrequency} delay={0.05} onEdit={() => setSalaryOpen(true)} />
                        <BonusesCard
                            bonuses={bonuses}
                            total={stats.totalBonuses}
                            onAdd={() => setAddOpen(true)}
                            delay={0.1}
                        />
                    </div>

                    {/* Row 2: Full-width stat band + goal (1:1 with design) */}
                    <StatBand stats={stats} onEditGoal={() => setSettingsOpen(true)} delay={0.15} />

                    {/* Row 2.5 (Phase 9): interactive monthly income-vs-spent chart */}
                    <MonthlyFlowChart income={stats.monthlyIncome} expenses={stats.monthlyExpenses} elapsed={stats.elapsed} delay={0.18} />

                    {/* Row 3: Bonus features — breakdown viz + savings insights */}
                    <div className="grid gap-6 grid-cols-1 lg:[grid-template-columns:1.4fr_1fr] items-start">
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
                        >
                            <IncomeBreakdown
                                yearlySalary={stats.salaryAnnual}
                                totalBonuses={stats.totalBonuses}
                                yearlyIncome={stats.projectedAnnualIncome}
                                yearlyExpenses={stats.projectedAnnualExpenses}
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
                    <SalaryCard salary={income.monthlySalary} gross={income.grossSalary} deductions={income.deductions} payDay={income.payDay} payFrequency={income.payFrequency} delay={0.05} onEdit={() => setSalaryOpen(true)} />
                    <IncomeBreakdown
                        yearlySalary={stats.salaryAnnual}
                        totalBonuses={stats.totalBonuses}
                        yearlyIncome={stats.projectedAnnualIncome}
                        yearlyExpenses={stats.projectedAnnualExpenses}
                        netSavings={stats.netSavings}
                    />
                    <StatBand stats={stats} onEditGoal={() => setSettingsOpen(true)} delay={0.1} />
                    <MonthlyFlowChart income={stats.monthlyIncome} expenses={stats.monthlyExpenses} elapsed={stats.elapsed} delay={0.12} />
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

            {/* Goal / budget / pay settings (salary itself lives in the timeline) */}
            <IncomeSettingsModal
                open={settingsOpen}
                initial={{
                    savingsGoal: income.savingsGoal,
                    saved: income.saved,
                    monthlyBudget: income.monthlyBudget,
                    payDay: income.payDay,
                    payFrequency: income.payFrequency,
                }}
                onClose={() => setSettingsOpen(false)}
                onSave={handleSaveSettings}
            />

            {/* ADDED (Phase 9): time-aware salary timeline */}
            <SalaryTimelineModal
                open={salaryOpen}
                periods={summary?.periods ?? []}
                defaultYear={year}
                pending={pending}
                onClose={() => setSalaryOpen(false)}
                onSave={handleSaveSalary}
                onDelete={handleDeleteSalary}
            />
        </>
    );
}
