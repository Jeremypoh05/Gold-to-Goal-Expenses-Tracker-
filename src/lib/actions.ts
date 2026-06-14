"use server";

// ADDED (Phase 8): server actions — the only way the client mutates data.
// Every action re-checks auth() (Server Actions are reachable by direct POST, so we
// never trust the client) and scopes writes to the signed-in user. After a write we
// revalidatePath the dashboard routes; client handlers also call router.refresh() so
// the layout re-fetches and the context updates immediately.
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { toUiExpense } from "@/lib/expense-utils";
import type { CategoryKey, Currency } from "@/types";

const DASHBOARD_ROUTES = [
  "/dashboard",
  "/ledger",
  "/calendar",
  "/income",
  "/voice",
];

function revalidateDashboard() {
  for (const path of DASHBOARD_ROUTES) revalidatePath(path);
}

async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

export interface ExpenseInput {
  amount: number;
  category: CategoryKey;
  currency: Currency;
  note: string;
  fixed?: boolean;
  /** Defaults to now; callers may pass a specific timestamp. */
  spentAt?: string; // ISO string (Date isn't serializable across the boundary)
  // Voice metadata — only when source = "voice"
  source?: "manual" | "voice";
  transcript?: string;
  lang?: string;
  voiceStatus?: "confirmed" | "edited" | "reparsed";
}

export async function createExpense(input: ExpenseInput) {
  const userId = await requireUserId();

  const row = await prisma.expense.create({
    data: {
      userId,
      spentAt: input.spentAt ? new Date(input.spentAt) : new Date(),
      category: input.category,
      amount: input.amount,
      currency: input.currency,
      note: input.note,
      fixed: input.fixed ?? false,
      source: input.source ?? "manual",
      transcript: input.transcript ?? null,
      lang: input.lang ?? null,
      voiceStatus: input.source === "voice" ? input.voiceStatus ?? "confirmed" : null,
    },
  });

  revalidateDashboard();
  return toUiExpense(row);
}

export async function updateExpense(
  id: number,
  input: Partial<ExpenseInput>,
) {
  const userId = await requireUserId();

  // Ownership check — never let a user edit a row that isn't theirs.
  const owned = await prisma.expense.findFirst({ where: { id, userId } });
  if (!owned) throw new Error("Expense not found");

  const row = await prisma.expense.update({
    where: { id },
    data: {
      ...(input.amount !== undefined && { amount: input.amount }),
      ...(input.category !== undefined && { category: input.category }),
      ...(input.currency !== undefined && { currency: input.currency }),
      ...(input.note !== undefined && { note: input.note }),
      ...(input.fixed !== undefined && { fixed: input.fixed }),
      ...(input.spentAt !== undefined && { spentAt: new Date(input.spentAt) }),
      ...(input.transcript !== undefined && { transcript: input.transcript }),
      ...(input.lang !== undefined && { lang: input.lang }),
      ...(input.voiceStatus !== undefined && { voiceStatus: input.voiceStatus }),
    },
  });

  revalidateDashboard();
  return toUiExpense(row);
}

export async function deleteExpense(id: number) {
  const userId = await requireUserId();
  // deleteMany with the userId guard = atomic ownership-checked delete.
  await prisma.expense.deleteMany({ where: { id, userId } });
  revalidateDashboard();
}

export interface BonusInput {
  month: number;
  amount: number;
  label: string;
}

export async function addBonus(input: BonusInput) {
  const userId = await requireUserId();
  await prisma.bonus.create({
    data: {
      userId,
      month: input.month,
      amount: input.amount,
      label: input.label,
    },
  });
  revalidateDashboard();
}

export interface IncomeSettingsInput {
  monthlySalary?: number;
  savingsGoal?: number;
  saved?: number;
}

export async function updateIncomeSettings(input: IncomeSettingsInput) {
  const userId = await requireUserId();
  await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.monthlySalary !== undefined && {
        monthlySalary: input.monthlySalary,
      }),
      ...(input.savingsGoal !== undefined && { savingsGoal: input.savingsGoal }),
      ...(input.saved !== undefined && { saved: input.saved }),
    },
  });
  revalidateDashboard();
}
