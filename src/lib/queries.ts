// ADDED (Phase 8): server-only read layer. These run in Server Components (the
// dashboard layout) and never reach the client bundle. All reads are scoped to the
// signed-in Clerk user via auth(). Decimal → number / DB → UI mapping happens here so
// the client only ever sees plain serializable data.
import "server-only";
import { cache } from "react";
import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { monthInfoFrom } from "@/lib/today";
import { toUiExpense, toUiBonus } from "@/lib/expense-utils";
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
  income: {
    monthlySalary: number;
    savingsGoal: number;
    saved: number;
    bonuses: ReturnType<typeof toUiBonus>;
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  const user = await getOrCreateUser();

  const now = new Date();
  const current = monthInfoFrom(now);
  const monthStart = new Date(current.year, current.month - 1, 1);
  const monthEnd = new Date(current.year, current.month, 1);

  const [rows, bonuses] = await Promise.all([
    prisma.expense.findMany({
      where: { userId: user.id, spentAt: { gte: monthStart, lt: monthEnd } },
      orderBy: { spentAt: "desc" },
    }),
    prisma.bonus.findMany({ where: { userId: user.id } }),
  ]);

  return {
    current,
    expenses: rows.map(toUiExpense),
    income: {
      monthlySalary: Number(user.monthlySalary),
      savingsGoal: Number(user.savingsGoal),
      saved: Number(user.saved),
      bonuses: toUiBonus(bonuses),
    },
  };
}
