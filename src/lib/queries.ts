// ADDED (Phase 8): server-only read layer. These run in Server Components (the
// dashboard layout) and never reach the client bundle. All reads are scoped to the
// signed-in Clerk user via auth(). Decimal → number / DB → UI mapping happens here so
// the client only ever sees plain serializable data.
import "server-only";
import { cache } from "react";
import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import {
  toUiExpense,
  toUiVoiceLog,
  toUiBonus,
  toUiSalaryPeriod,
  toUiIncomeSource,
  toUiFixedExpense,
  composeFixedNote,
  activeSalaryForMonth,
  recurringMonthlyIncome,
  type UiSalaryPeriod,
  type UiIncomeSource,
  type UiFixedExpense,
} from "@/lib/expense-utils";
import { daysInMonth } from "@/lib/utils";
import type { MonthInfo } from "@/types";

/**
 * Ensure a User row exists for the current Clerk user, then return it.
 * Called from the dashboard layout so every signed-in visit guarantees the row
 * the Expense/Bonus foreign keys depend on. Wrapped in React.cache so repeated
 * calls within one request hit the DB once.
 */
export const getOrCreateUser = cache(async () => {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (existing) return existing;

  // First sign-in: pull profile basics from Clerk for a friendlier record.
  const clerkUser = await currentUser();
  const email = clerkUser?.primaryEmailAddress?.emailAddress ?? null;
  const name =
    [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(" ") ||
    null;

  return prisma.user.create({ data: { id: userId, email, name } });
});

/** The dashboard payload: the viewing month, this month's expenses (UI shape), income. */
export interface DashboardData {
  current: MonthInfo;
  /** ADDED (Module 5): true when this month has been hard-closed — the UI should
   *  block add/edit/delete/voice for it and offer a Reopen action instead. */
  monthClosed: boolean;
  expenses: ReturnType<typeof toUiExpense>[];
  /** Voice-sourced expenses, in the richer VoiceLog shape (transcript/lang/status). */
  voiceLogs: ReturnType<typeof toUiVoiceLog>[];
  // ADDED (Phase 8.2): previous month's total spend, so the hero can show a REAL
  // month-over-month % instead of a hardcoded figure. 0 when there's no prior data.
  prevMonthTotal: number;
  income: {
    monthlySalary: number;
    savingsGoal: number;
    saved: number;
    monthlyBudget: number;
    grossSalary: number;
    deductions: number;
    payDay: number;
    payFrequency: string;
    bonuses: ReturnType<typeof toUiBonus>;
    /** ADDED (Phase 9): recurring additional income active this month (freelance,
     *  dividends…), so the dashboard snapshot can reflect it. Excludes one-off. */
    otherMonthlyIncome: number;
  };
}

/**
 * Build the dashboard payload for a specific month. Shared by the initial
 * (current-month) layout fetch and the month-browsing server action.
 * `current.day` is today's date only when viewing the actual current month
 * (else 0, so "Today" highlighting never false-matches a past month).
 */
export async function getMonthDashboardData(
  year: number,
  month: number,
): Promise<DashboardData> {
  const user = await getOrCreateUser();

  const now = new Date();
  const isCurrentMonth =
    now.getFullYear() === year && now.getMonth() + 1 === month;
  const current: MonthInfo = {
    year,
    month,
    day: isCurrentMonth ? now.getDate() : 0,
  };
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1);
  // ADDED (Phase 8.2): the prior calendar month, for the month-over-month delta.
  const prevMonthStart = new Date(year, month - 2, 1);

  const [rows, bonuses, prevAgg, periods, sources, monthClose] = await Promise.all([
    prisma.expense.findMany({
      where: { userId: user.id, spentAt: { gte: monthStart, lt: monthEnd } },
      orderBy: { spentAt: "desc" },
    }),
    prisma.bonus.findMany({ where: { userId: user.id, year } }),
    prisma.expense.aggregate({
      _sum: { amount: true },
      where: {
        userId: user.id,
        spentAt: { gte: prevMonthStart, lt: monthStart },
      },
    }),
    prisma.salaryPeriod.findMany({ where: { userId: user.id } }),
    prisma.incomeSource.findMany({ where: { userId: user.id } }),
    prisma.monthClose.findUnique({
      where: { userId_year_month: { userId: user.id, year, month } },
    }),
  ]);

  // CHANGED (Phase 9): salary/gross/deductions now come from the SalaryPeriod
  // active in the viewing month (was the deprecated flat User.monthlySalary).
  const active = activeSalaryForMonth(periods.map(toUiSalaryPeriod), year, month);
  // Recurring additional income active this month (excludes one-off streams).
  const otherMonthlyIncome = recurringMonthlyIncome(
    sources.map(toUiIncomeSource),
    year,
    month,
  );

  return {
    current,
    monthClosed: !!monthClose,
    expenses: rows.map(toUiExpense),
    // Voice logs are the same rows where source = voice (single source of truth).
    voiceLogs: rows.filter((r) => r.source === "voice").map(toUiVoiceLog),
    prevMonthTotal: Number(prevAgg._sum.amount ?? 0),
    income: {
      monthlySalary: active?.monthlySalary ?? 0,
      savingsGoal: Number(user.savingsGoal),
      saved: Number(user.saved),
      monthlyBudget: Number(user.monthlyBudget),
      grossSalary: active?.grossSalary ?? 0,
      deductions: active?.deductions ?? 0,
      payDay: user.payDay,
      payFrequency: user.payFrequency,
      bonuses: toUiBonus(bonuses),
      otherMonthlyIncome,
    },
  };
}

/** ADDED (Phase 9): full-year rollup for the Income page — salary timeline,
 *  per-month expense totals, bonuses, and goal settings. The client computes
 *  actual-vs-projected figures from this via computeYearIncomeStats. */
export interface YearSummary {
  year: number;
  isCurrentYear: boolean;
  currentMonth: number;
  periods: UiSalaryPeriod[];
  incomeSources: UiIncomeSource[];
  monthlyExpenseTotals: number[];
  /** ADDED (Module 4): scheduled + materialized fixed-expense amounts per month. */
  scheduledFixedByMonth: number[];
  materializedFixedByMonth: number[];
  bonuses: ReturnType<typeof toUiBonus>;
  savingsGoal: number;
  saved: number;
  monthlyBudget: number;
  payDay: number;
  payFrequency: string;
}

export async function getYearSummary(year: number): Promise<YearSummary> {
  const user = await getOrCreateUser();
  const now = new Date();
  const isCurrentYear = now.getFullYear() === year;
  const currentMonth = isCurrentYear ? now.getMonth() + 1 : 12;
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);

  const [periods, rows, bonuses, sources, fixed] = await Promise.all([
    prisma.salaryPeriod.findMany({
      where: { userId: user.id },
      orderBy: [{ effectiveYear: "asc" }, { effectiveMonth: "asc" }],
    }),
    prisma.expense.findMany({
      where: { userId: user.id, spentAt: { gte: yearStart, lt: yearEnd } },
      select: { spentAt: true, amount: true, fixedSourceId: true },
    }),
    prisma.bonus.findMany({ where: { userId: user.id, year } }),
    prisma.incomeSource.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    }),
    prisma.fixedExpense.findMany({ where: { userId: user.id, active: true } }),
  ]);

  const monthlyExpenseTotals = Array(12).fill(0) as number[];
  // ADDED (Module 4): how much fixed expense was actually materialized per month.
  const materializedFixedByMonth = Array(12).fill(0) as number[];
  for (const r of rows) {
    const m = r.spentAt.getMonth();
    monthlyExpenseTotals[m] += Number(r.amount);
    if (r.fixedSourceId != null) materializedFixedByMonth[m] += Number(r.amount);
  }
  // Scheduled fixed commitment per month from the definitions (active items whose
  // [start, end] interval covers that month) — used to project future expenses.
  const scheduledFixedByMonth = Array(12).fill(0) as number[];
  const cmp = (aY: number, aM: number, bY: number, bM: number) => (aY !== bY ? aY - bY : aM - bM);
  for (const f of fixed) {
    for (let m = 1; m <= 12; m++) {
      const afterStart = cmp(year, m, f.startYear, f.startMonth) >= 0;
      const beforeEnd =
        f.endYear == null || f.endMonth == null ? true : cmp(year, m, f.endYear, f.endMonth) <= 0;
      if (afterStart && beforeEnd) scheduledFixedByMonth[m - 1] += Number(f.amount);
    }
  }

  return {
    year,
    isCurrentYear,
    currentMonth,
    periods: periods.map(toUiSalaryPeriod),
    incomeSources: sources.map(toUiIncomeSource),
    monthlyExpenseTotals,
    scheduledFixedByMonth,
    materializedFixedByMonth,
    bonuses: toUiBonus(bonuses),
    savingsGoal: Number(user.savingsGoal),
    saved: Number(user.saved),
    monthlyBudget: Number(user.monthlyBudget),
    payDay: user.payDay,
    payFrequency: user.payFrequency,
  };
}

export function getDashboardData(): Promise<DashboardData> {
  const now = new Date();
  return getMonthDashboardData(now.getFullYear(), now.getMonth() + 1);
}

// ─────────────────────────────────────────────────────────────
// ADDED (Module 4): fixed/recurring expenses — read + lazy generation.
// ─────────────────────────────────────────────────────────────

/** All of the user's fixed-expense definitions (UI shape). */
export async function getFixedExpenses(): Promise<UiFixedExpense[]> {
  const user = await getOrCreateUser();
  const rows = await prisma.fixedExpense.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toUiFixedExpense);
}

const cmpYM = (aY: number, aM: number, bY: number, bM: number) =>
  aY !== bY ? aY - bY : aM - bM;
const nextYM = (y: number, m: number) => (m >= 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 });

/** ADDED (Module 5): months this user has hard-closed, as a `"y-m"` key set —
 *  fixed-expense generation must never create a row in one of these. */
async function getClosedMonthKeys(userId: string): Promise<Set<string>> {
  const rows = await prisma.monthClose.findMany({ where: { userId } });
  return new Set(rows.map((r) => `${r.year}-${r.month}`));
}

/**
 * Lazily materialize due fixed-expense rows up to today, forward-only. For each
 * active item we walk from the month after its watermark (or its start month if
 * never generated) up to the current month, creating a real Expense on each due
 * day that has passed — then advance the watermark. Never touches months before
 * the start (no retroactive backfill); the watermark means a deleted/skipped row
 * is not regenerated. Called from the dashboard layout (cached per request).
 */
export async function syncFixedExpenses(): Promise<void> {
  const user = await getOrCreateUser();
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;
  const curD = now.getDate();

  const items = await prisma.fixedExpense.findMany({
    where: { userId: user.id, active: true },
  });
  // ADDED (Module 5): never auto-generate into a hard-closed month.
  const closedKeys = await getClosedMonthKeys(user.id);

  for (const it of items) {
    // Starting cursor = month after the watermark, floored at the start month.
    let cy: number;
    let cm: number;
    if (it.lastGenYear != null && it.lastGenMonth != null) {
      const n = nextYM(it.lastGenYear, it.lastGenMonth);
      cy = n.y;
      cm = n.m;
      if (cmpYM(cy, cm, it.startYear, it.startMonth) < 0) {
        cy = it.startYear;
        cm = it.startMonth;
      }
    } else {
      cy = it.startYear;
      cm = it.startMonth;
    }

    const toCreate: { y: number; m: number; due: number }[] = [];
    let wmY = it.lastGenYear;
    let wmM = it.lastGenMonth;

    while (cmpYM(cy, cm, curY, curM) <= 0) {
      // Stop once past the end month (if any).
      if (it.endYear != null && it.endMonth != null && cmpYM(cy, cm, it.endYear, it.endMonth) > 0) break;
      const due = Math.min(it.dueDay, daysInMonth(cy, cm));
      // In the current month, only generate once the due day has arrived.
      if (cy === curY && cm === curM && due > curD) break;
      // Closed months still advance the watermark (so they're never retried) but
      // never get a generated row.
      if (!closedKeys.has(`${cy}-${cm}`)) toCreate.push({ y: cy, m: cm, due });
      wmY = cy;
      wmM = cm;
      const n = nextYM(cy, cm);
      cy = n.y;
      cm = n.m;
    }

    if (toCreate.length > 0) {
      try {
        await prisma.$transaction([
          ...toCreate.map((t) =>
            prisma.expense.create({
              data: {
                userId: user.id,
                spentAt: new Date(t.y, t.m - 1, t.due, 9, 0, 0),
                category: it.category,
                amount: it.amount,
                currency: it.currency,
                note: composeFixedNote(it.label, it.note),
                fixed: true,
                fixedSourceId: it.id,
                source: "manual",
              },
            }),
          ),
          prisma.fixedExpense.update({
            where: { id: it.id },
            data: { lastGenYear: wmY, lastGenMonth: wmM },
          }),
        ]);
      } catch {
        // One bad item shouldn't block the rest / the page render.
      }
    }
  }
}

/**
 * Fully re-materialize ONE fixed expense: delete all its generated rows and
 * regenerate the entire [start, today] range (respecting the end month + due day)
 * at the definition's current values, resetting the watermark. Called after an
 * add or edit so a changed start month / amount is reflected across every affected
 * month immediately (ledger, calendar, dashboard, income) — unlike the lazy,
 * forward-only sync. History-preserving rate changes use `changeFixedAmount`.
 */
export async function resyncFixedExpense(id: number): Promise<void> {
  const user = await getOrCreateUser();
  const it = await prisma.fixedExpense.findFirst({ where: { id, userId: user.id } });
  if (!it) return;

  // Clear existing generated rows for this item — the definition is the source of truth.
  await prisma.expense.deleteMany({ where: { userId: user.id, fixedSourceId: id } });

  if (!it.active) {
    await prisma.fixedExpense.update({
      where: { id },
      data: { lastGenYear: null, lastGenMonth: null },
    });
    return;
  }

  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;
  const curD = now.getDate();
  // ADDED (Module 5): never re-materialize into a hard-closed month.
  const closedKeys = await getClosedMonthKeys(user.id);

  let cy = it.startYear;
  let cm = it.startMonth;
  const toCreate: { y: number; m: number; due: number }[] = [];
  let wmY: number | null = null;
  let wmM: number | null = null;

  while (cmpYM(cy, cm, curY, curM) <= 0) {
    if (it.endYear != null && it.endMonth != null && cmpYM(cy, cm, it.endYear, it.endMonth) > 0) break;
    const due = Math.min(it.dueDay, daysInMonth(cy, cm));
    if (cy === curY && cm === curM && due > curD) break;
    if (!closedKeys.has(`${cy}-${cm}`)) toCreate.push({ y: cy, m: cm, due });
    wmY = cy;
    wmM = cm;
    const n = nextYM(cy, cm);
    cy = n.y;
    cm = n.m;
  }

  await prisma.$transaction([
    ...toCreate.map((t) =>
      prisma.expense.create({
        data: {
          userId: user.id,
          spentAt: new Date(t.y, t.m - 1, t.due, 9, 0, 0),
          category: it.category,
          amount: it.amount,
          currency: it.currency,
          note: composeFixedNote(it.label, it.note),
          fixed: true,
          fixedSourceId: id,
          source: "manual",
        },
      }),
    ),
    prisma.fixedExpense.update({
      where: { id },
      data: { lastGenYear: wmY, lastGenMonth: wmM },
    }),
  ]);
}
