// ADDED (Phase 8): DB→UI mappers + the derived-stats helpers, parameterized by an
// expense array. These used to live in src/data/sampleExpenses.ts and operate on the
// static SAMPLE_EXPENSES global; now every consumer passes the user's real expenses
// (from the ExpensesProvider context). The UI shapes (Expense / VoiceLog) are unchanged
// so the components didn't need redesigning — only their data source moved.
import type {
  Expense as DbExpense,
  Bonus as DbBonus,
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
  /** Projected full-year spend. For now: current-month spend annualized. */
  projectedYearlyExpenses: number;
  /** Current month (1-12) for "months left" projections. */
  month: number;
}

export function getIncomeStats(income: IncomeInput) {
  const monthlySalary = income.monthlySalary;
  const yearlySalary = monthlySalary * 12;
  const totalBonuses = income.bonuses.reduce((a, b) => a + b.amt, 0);
  const yearlyIncome = yearlySalary + totalBonuses;
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
    .map((b) => ({ month: b.month, amt: Number(b.amount), label: b.label }))
    .sort((a, b) => a.month - b.month);
}
