// ADDED (Phase 8): server-only read layer. These run in Server Components (the
// dashboard layout) and never reach the client bundle. All reads are scoped to the
// signed-in Clerk user via auth(). Decimal → number / DB → UI mapping happens here so
// the client only ever sees plain serializable data.
import "server-only";
import { cache } from "react";
import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { toUiExpense, toUiVoiceLog, toUiBonus } from "@/lib/expense-utils";
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

  const [rows, bonuses, prevAgg] = await Promise.all([
    prisma.expense.findMany({
      where: { userId: user.id, spentAt: { gte: monthStart, lt: monthEnd } },
      orderBy: { spentAt: "desc" },
    }),
    prisma.bonus.findMany({ where: { userId: user.id } }),
    prisma.expense.aggregate({
      _sum: { amount: true },
      where: {
        userId: user.id,
        spentAt: { gte: prevMonthStart, lt: monthStart },
      },
    }),
  ]);

  return {
    current,
    expenses: rows.map(toUiExpense),
    // Voice logs are the same rows where source = voice (single source of truth).
    voiceLogs: rows.filter((r) => r.source === "voice").map(toUiVoiceLog),
    prevMonthTotal: Number(prevAgg._sum.amount ?? 0),
    income: {
      monthlySalary: Number(user.monthlySalary),
      savingsGoal: Number(user.savingsGoal),
      saved: Number(user.saved),
      monthlyBudget: Number(user.monthlyBudget),
      grossSalary: Number(user.grossSalary),
      deductions: Number(user.deductions),
      payDay: user.payDay,
      payFrequency: user.payFrequency,
      bonuses: toUiBonus(bonuses),
    },
  };
}

export function getDashboardData(): Promise<DashboardData> {
  const now = new Date();
  return getMonthDashboardData(now.getFullYear(), now.getMonth() + 1);
}
