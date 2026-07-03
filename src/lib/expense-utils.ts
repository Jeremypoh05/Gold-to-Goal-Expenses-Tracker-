// ADDED (Phase 8): DB→UI mappers + the derived-stats helpers, parameterized by an
// expense array. These used to live in src/data/sampleExpenses.ts and operate on the
// static SAMPLE_EXPENSES global; now every consumer passes the user's real expenses
// (from the ExpensesProvider context). The UI shapes (Expense / VoiceLog) are unchanged
// so the components didn't need redesigning — only their data source moved.
import type {
  Expense as DbExpense,
  Bonus as DbBonus,
  SalaryPeriod as DbSalaryPeriod,
  IncomeSource as DbIncomeSource,
} from "@/generated/prisma/client";
import type { Expense, VoiceLog, CategoryKey } from "@/types";

// ─────────────────────────────────────────────────────────────
// DB row → UI shape
// ─────────────────────────────────────────────────────────────

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

/** Map a DB Expense row to the UI `Expense` (day-of-month + HH:MM) shape the views expect. */
export function toUiExpense(row: DbExpense): Expense {
  return {
    id: row.id,
    day: row.spentAt.getDate(),
    time: hhmm(row.spentAt),
    cat: row.category as CategoryKey,
    amt: Number(row.amount), // Prisma Decimal → number
    note: row.note,
    voice: row.source === "voice",
    fixed: row.fixed,
    currency: row.currency,
  };
}

/** Map a voice-sourced DB Expense row to the UI `VoiceLog` shape (history panel). */
export function toUiVoiceLog(row: DbExpense): VoiceLog {
  return {
    id: row.id,
    lang: row.lang ?? "en",
    transcript: row.transcript ?? "",
    cat: row.category as CategoryKey,
    amt: Number(row.amount),
    currency: row.currency,
    note: row.note,
    time: hhmm(row.spentAt),
    day: row.spentAt.getDate(),
    status: row.voiceStatus ?? "confirmed",
  };
}

// ─────────────────────────────────────────────────────────────
// Derived stats — all take the current expense array
// ─────────────────────────────────────────────────────────────

export function expensesByCategory(
  expenses: Expense[],
): Record<string, number> {
  return expenses.reduce(
    (acc, t) => {
      acc[t.cat] = (acc[t.cat] || 0) + t.amt;
      return acc;
    },
    {} as Record<string, number>,
  );
}

export function totalSpent(expenses: Expense[]): number {
  return expenses.reduce((a, b) => a + b.amt, 0);
}

export function countByCategory(expenses: Expense[], cat: string): number {
  return expenses.filter((t) => t.cat === cat).length;
}

export function voiceCount(expenses: Expense[]): number {
  return expenses.filter((t) => t.voice).length;
}

export function fixedCount(expenses: Expense[]): number {
  return expenses.filter((t) => t.fixed).length;
}

/** All expenses for a day, sorted by time. */
export function getExpensesForDay(expenses: Expense[], day: number) {
  return expenses
    .filter((t) => t.day === day)
    .sort((a, b) => a.time.localeCompare(b.time));
}

/** Unique days with expenses (for prev/next-day navigation). */
export function getAllExpenseDays(expenses: Expense[]): number[] {
  return [...new Set(expenses.map((t) => t.day))].sort((a, b) => a - b);
}

/** 24 hourly buckets (sum per hour) for a day. */
export function getHourlyBuckets(expenses: Expense[], day: number): number[] {
  const dayExpenses = expenses.filter((t) => t.day === day);
  return Array.from({ length: 24 }, (_, hour) =>
    dayExpenses
      .filter((t) => parseInt(t.time.split(":")[0], 10) === hour)
      .reduce((a, b) => a + b.amt, 0),
  );
}

/** Spending breakdown by category for a day — sorted desc. */
export function getDayCategoryBreakdown(expenses: Expense[], day: number) {
  const dayExpenses = expenses.filter((t) => t.day === day);
  const byCat: Record<string, number> = {};
  dayExpenses.forEach((t) => {
    byCat[t.cat] = (byCat[t.cat] ?? 0) + t.amt;
  });
  return Object.entries(byCat)
    .map(([cat, amount]) => ({ cat, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/** Brief day summary (for calendar hover preview). */
export function getDayPreview(expenses: Expense[], day: number) {
  const dayExpenses = expenses.filter((t) => t.day === day);
  return {
    expenses: dayExpenses,
    total: dayExpenses.reduce((a, b) => a + b.amt, 0),
    voiceCount: dayExpenses.filter((t) => t.voice).length,
    count: dayExpenses.length,
  };
}

/** Month-wide stats for side panels. Safe on an empty array. */
export function getMonthStats(expenses: Expense[]) {
  const byDay: Record<number, number> = {};
  expenses.forEach((t) => {
    byDay[t.day] = (byDay[t.day] ?? 0) + t.amt;
  });

  const topDayEntry = Object.entries(byDay).sort(
    (a, b) => Number(b[1]) - Number(a[1]),
  )[0];
  const topDay = topDayEntry ? Number(topDayEntry[0]) : 1;
  const topDayAmount = topDayEntry ? Number(topDayEntry[1]) : 0;

  const activeDays = Object.keys(byDay).length;
  const total = totalSpent(expenses);
  const dailyAvg = total / Math.max(activeDays, 1);

  const byCat = expensesByCategory(expenses);
  const topCatEntry = Object.entries(byCat).sort(
    (a, b) => Number(b[1]) - Number(a[1]),
  )[0];

  const vCount = voiceCount(expenses);
  const voiceRatio = expenses.length ? (vCount / expenses.length) * 100 : 0;

  return {
    topDay,
    topDayAmount,
    activeDays,
    total,
    dailyAvg,
    topCategory: topCatEntry ? topCatEntry[0] : "food",
    topCategoryAmount: topCatEntry ? Number(topCatEntry[1]) : 0,
    voiceCount: vCount,
    voiceRatio,
  };
}

// ─────────────────────────────────────────────────────────────
// Income & savings — derived from the user's settings + bonuses + spend
// ─────────────────────────────────────────────────────────────

export interface IncomeInput {
  monthlySalary: number;
  savingsGoal: number;
  saved: number;
  bonuses: { month: number; amt: number; label: string }[];
  /** ADDED (Phase 9): recurring additional income per month (freelance, dividends…),
   *  annualized alongside salary. Excludes one-off sources. Defaults to 0. */
  otherMonthlyIncome?: number;
  /** Projected full-year spend. For now: current-month spend annualized. */
  projectedYearlyExpenses: number;
  /** Current month (1-12) for "months left" projections. */
  month: number;
}

export function getIncomeStats(income: IncomeInput) {
  const monthlySalary = income.monthlySalary;
  const yearlySalary = monthlySalary * 12;
  const yearlyOther = (income.otherMonthlyIncome ?? 0) * 12;
  const totalBonuses = income.bonuses.reduce((a, b) => a + b.amt, 0);
  const yearlyIncome = yearlySalary + yearlyOther + totalBonuses;
  const yearlyExpenses = income.projectedYearlyExpenses;
  const netSavings = yearlyIncome - yearlyExpenses;
  const savingsRate = yearlyIncome > 0 ? (netSavings / yearlyIncome) * 100 : 0;

  const goal = income.savingsGoal;
  const saved = income.saved;
  const toGo = Math.max(0, goal - saved);
  const goalProgressPct = goal > 0 ? (saved / goal) * 100 : 0;

  const monthlyNetSavings = netSavings / 12;
  const monthsToGoal =
    monthlyNetSavings > 0 ? Math.ceil(toGo / monthlyNetSavings) : 0;
  const monthsLeft = Math.max(0, 12 - income.month);
  const projectedYearEnd = Math.round(saved + monthlyNetSavings * monthsLeft);

  const biggestBonus =
    income.bonuses.length > 0
      ? income.bonuses.reduce(
          (max, b) => (b.amt > max.amt ? b : max),
          income.bonuses[0],
        )
      : { label: "—", amt: 0, month: 1 };

  return {
    monthlySalary,
    yearlySalary,
    yearlyOther,
    totalBonuses,
    yearlyIncome,
    yearlyExpenses,
    netSavings,
    savingsRate,
    goal,
    saved,
    toGo,
    goalProgressPct,
    monthlyNetSavings,
    monthsToGoal,
    projectedYearEnd,
    biggestBonus,
  };
}

/** Map DB Bonus rows to the UI bonus shape. */
export function toUiBonus(rows: DbBonus[]) {
  return rows
    .map((b) => ({
      year: b.year,
      month: b.month,
      amt: Number(b.amount),
      label: b.label,
    }))
    .sort((a, b) => a.month - b.month);
}

// ─────────────────────────────────────────────────────────────
// ADDED (Phase 9): time-aware salary — effective-dated periods.
// ─────────────────────────────────────────────────────────────

/** Map a DB SalaryPeriod row to the UI shape (Decimal → number). */
export function toUiSalaryPeriod(row: DbSalaryPeriod) {
  return {
    id: row.id,
    year: row.effectiveYear,
    month: row.effectiveMonth,
    monthlySalary: Number(row.monthlySalary),
    grossSalary: Number(row.grossSalary),
    deductions: Number(row.deductions),
    label: row.label,
  };
}
export type UiSalaryPeriod = ReturnType<typeof toUiSalaryPeriod>;

/**
 * The salary in effect for a given calendar month = the latest period whose
 * (year, month) is on or before it. Returns null when the month is before the
 * very first period (i.e. the user hadn't started earning yet → 0 income).
 */
export function activeSalaryForMonth(
  periods: UiSalaryPeriod[],
  year: number,
  month: number,
): UiSalaryPeriod | null {
  const onOrBefore = periods.filter(
    (p) => p.year < year || (p.year === year && p.month <= month),
  );
  if (onOrBefore.length === 0) return null;
  return onOrBefore.reduce((best, p) =>
    p.year > best.year || (p.year === best.year && p.month > best.month)
      ? p
      : best,
  );
}

/** Map a DB IncomeSource row to the UI shape (Decimal → number). */
export function toUiIncomeSource(row: DbIncomeSource) {
  return {
    id: row.id,
    label: row.label,
    emoji: row.emoji,
    monthlyAmount: Number(row.monthlyAmount),
    year: row.effectiveYear,
    month: row.effectiveMonth,
    recurring: row.recurring,
    active: row.active,
  };
}
export type UiIncomeSource = ReturnType<typeof toUiIncomeSource>;

/** Does an active income source contribute in this specific (year, month)?
 *  Recurring sources apply from their effective month onward; one-off sources
 *  apply only in their single effective month. */
function sourceAppliesTo(s: UiIncomeSource, year: number, month: number): boolean {
  if (!s.active) return false;
  if (s.recurring) return s.year < year || (s.year === year && s.month <= month);
  return s.year === year && s.month === month;
}

/** Total income-source amount in effect for (year, month) — recurring + any
 *  one-off that lands exactly on this month. Used for the per-month series. */
function activeOtherIncome(
  sources: UiIncomeSource[],
  year: number,
  month: number,
): number {
  return sources
    .filter((s) => sourceAppliesTo(s, year, month))
    .reduce((a, s) => a + s.monthlyAmount, 0);
}

/** Recurring-only monthly income in effect for (year, month) — excludes one-off
 *  streams, so it's safe to annualize (× 12). Used by the dashboard snapshot. */
export function recurringMonthlyIncome(
  sources: UiIncomeSource[],
  year: number,
  month: number,
): number {
  return sources
    .filter((s) => s.active && s.recurring && (s.year < year || (s.year === year && s.month <= month)))
    .reduce((a, s) => a + s.monthlyAmount, 0);
}

export interface YearIncomeInput {
  year: number;
  /** Viewing the actual current year (so only elapsed months are "actual"). */
  isCurrentYear: boolean;
  /** Current month 1–12 when viewing this year; 12 for a past year. */
  currentMonth: number;
  periods: UiSalaryPeriod[];
  /** Real expense total per month, index 0 = Jan … 11 = Dec. */
  monthlyExpenseTotals: number[];
  bonuses: { month: number; amt: number; label: string }[];
  /** ADDED (Phase 9): custom recurring income beyond salary. */
  incomeSources: UiIncomeSource[];
  savingsGoal: number;
  saved: number;
}

/**
 * Real, time-aware income/expense/savings figures for a year (replaces the old
 * "current-month salary × 12" assumption). Distinguishes ACTUAL (year-to-date,
 * only elapsed months) from PROJECTED (full year, future months use the salary
 * active then + average spend).
 */
export function computeYearIncomeStats(input: YearIncomeInput) {
  const { year, isCurrentYear, periods, monthlyExpenseTotals, bonuses } = input;
  const incomeSources = input.incomeSources ?? [];
  const elapsed = isCurrentYear ? Math.max(1, input.currentMonth) : 12;

  // Salary active in each of the 12 months (0 before the first period).
  const salaryByMonth = Array.from(
    { length: 12 },
    (_, i) => activeSalaryForMonth(periods, year, i + 1)?.monthlySalary ?? 0,
  );

  // Custom recurring income (freelance, dividends…) active each month.
  const otherByMonth = Array.from({ length: 12 }, (_, i) =>
    activeOtherIncome(incomeSources, year, i + 1),
  );

  // Bonus total per month (index 0 = Jan) for the per-month income series.
  const bonusByMonth = Array(12).fill(0) as number[];
  for (const b of bonuses) {
    if (b.month >= 1 && b.month <= 12) bonusByMonth[b.month - 1] += b.amt;
  }
  // Income each month = salary + other recurring income + bonuses that month.
  const monthlyIncome = salaryByMonth.map(
    (s, i) => s + otherByMonth[i] + bonusByMonth[i],
  );

  const totalBonuses = bonuses.reduce((a, b) => a + b.amt, 0);
  const bonusesYTD = bonuses
    .filter((b) => b.month <= elapsed)
    .reduce((a, b) => a + b.amt, 0);

  const salaryYTD = salaryByMonth
    .slice(0, elapsed)
    .reduce((a, v) => a + v, 0);
  const salaryAnnual = salaryByMonth.reduce((a, v) => a + v, 0);

  const otherIncomeYTD = otherByMonth.slice(0, elapsed).reduce((a, v) => a + v, 0);
  const otherIncomeAnnual = otherByMonth.reduce((a, v) => a + v, 0);

  const actualIncomeYTD = salaryYTD + otherIncomeYTD + bonusesYTD;
  const projectedAnnualIncome = salaryAnnual + otherIncomeAnnual + totalBonuses;

  const actualExpensesYTD = monthlyExpenseTotals
    .slice(0, elapsed)
    .reduce((a, v) => a + v, 0);
  const avgMonthlyExpense = actualExpensesYTD / Math.max(elapsed, 1);
  const projectedAnnualExpenses =
    actualExpensesYTD + avgMonthlyExpense * (12 - elapsed);

  const netSavings = projectedAnnualIncome - projectedAnnualExpenses;
  const savingsRate =
    projectedAnnualIncome > 0 ? (netSavings / projectedAnnualIncome) * 100 : 0;

  // CHANGED (Phase 9): present-focused figures for the stat band — what's actually
  // banked and spent so far this year (not the full-year projection).
  const netSavingsActual = actualIncomeYTD - actualExpensesYTD;
  const savingsRateActual =
    actualIncomeYTD > 0 ? (netSavingsActual / actualIncomeYTD) * 100 : 0;

  const goal = input.savingsGoal;
  const saved = input.saved;
  const toGo = Math.max(0, goal - saved);
  const goalProgressPct = goal > 0 ? Math.min(100, (saved / goal) * 100) : 0;

  const monthlyNetSavings = netSavings / 12;
  const monthsToGoal =
    monthlyNetSavings > 0 ? Math.ceil(toGo / monthlyNetSavings) : 0;
  const monthsLeft = Math.max(0, 12 - elapsed);
  const projectedYearEnd = Math.round(saved + monthlyNetSavings * monthsLeft);

  const biggestBonus =
    bonuses.length > 0
      ? bonuses.reduce((max, b) => (b.amt > max.amt ? b : max), bonuses[0])
      : { label: "—", amt: 0, month: 1 };

  return {
    actualIncomeYTD,
    projectedAnnualIncome,
    actualExpensesYTD,
    projectedAnnualExpenses,
    avgMonthlyExpense,
    salaryAnnual,
    otherIncomeYTD,
    otherIncomeAnnual,
    totalBonuses,
    netSavings,
    savingsRate,
    netSavingsActual,
    savingsRateActual,
    goal,
    saved,
    toGo,
    goalProgressPct,
    monthlyNetSavings,
    monthsToGoal,
    projectedYearEnd,
    biggestBonus,
    elapsed,
    // Per-month series (index 0 = Jan) for the monthly flow chart.
    monthlyIncome,
    monthlyExpenses: monthlyExpenseTotals,
  };
}
