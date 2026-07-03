"use server";

// ADDED (Phase 8): server actions — the only way the client mutates data.
// Every action re-checks auth() (Server Actions are reachable by direct POST, so we
// never trust the client) and scopes writes to the signed-in user. After a write we
// revalidatePath the dashboard routes; client handlers also call the ExpensesProvider's
// refresh() (which re-fetches the viewed month via fetchMonthData) so the UI updates.
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { toUiExpense, suggestFixedMetaLocal } from "@/lib/expense-utils";
import { getMonthDashboardData, getYearSummary, getFixedExpenses } from "@/lib/queries";
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
  year: number;
  month: number;
  amount: number;
  label: string;
}

export async function addBonus(input: BonusInput) {
  const userId = await requireUserId();
  await prisma.bonus.create({
    data: {
      userId,
      year: input.year,
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
  monthlyBudget?: number;
  grossSalary?: number;
  deductions?: number;
  payDay?: number;
  payFrequency?: string;
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
      ...(input.monthlyBudget !== undefined && {
        monthlyBudget: input.monthlyBudget,
      }),
      ...(input.grossSalary !== undefined && { grossSalary: input.grossSalary }),
      ...(input.deductions !== undefined && { deductions: input.deductions }),
      ...(input.payDay !== undefined && { payDay: input.payDay }),
      ...(input.payFrequency !== undefined && {
        payFrequency: input.payFrequency,
      }),
    },
  });
  revalidateDashboard();
}

/**
 * Read-only fetch of a given month's dashboard data — used by the client to
 * browse past months without a full navigation. Auth is enforced inside
 * getMonthDashboardData via getOrCreateUser.
 */
export async function fetchMonthData(year: number, month: number) {
  await requireUserId();
  return getMonthDashboardData(year, month);
}

// ─────────────────────────────────────────────────────────────
// ADDED (Phase 9): time-aware salary periods + the year rollup the Income page
// reads. A "period" = this salary, effective from this month onward.
// ─────────────────────────────────────────────────────────────

/** Read-only year rollup for the Income page (salary timeline + spend + goal). */
export async function fetchYearSummary(year: number) {
  await requireUserId();
  return getYearSummary(year);
}

export interface SalaryPeriodInput {
  effectiveYear: number;
  effectiveMonth: number; // 1–12
  monthlySalary: number;
  grossSalary?: number;
  deductions?: number;
  label?: string;
}

/** Add (or overwrite) the salary effective from a given month — one per month. */
export async function addSalaryPeriod(input: SalaryPeriodInput) {
  const userId = await requireUserId();
  const month = Math.min(12, Math.max(1, Math.round(input.effectiveMonth)));
  await prisma.salaryPeriod.upsert({
    where: {
      userId_effectiveYear_effectiveMonth: {
        userId,
        effectiveYear: input.effectiveYear,
        effectiveMonth: month,
      },
    },
    update: {
      monthlySalary: input.monthlySalary,
      grossSalary: input.grossSalary ?? 0,
      deductions: input.deductions ?? 0,
      label: input.label ?? null,
    },
    create: {
      userId,
      effectiveYear: input.effectiveYear,
      effectiveMonth: month,
      monthlySalary: input.monthlySalary,
      grossSalary: input.grossSalary ?? 0,
      deductions: input.deductions ?? 0,
      label: input.label ?? null,
    },
  });
  revalidateDashboard();
}

/** Edit an existing salary period by id (ownership-checked). */
export async function updateSalaryPeriod(
  id: number,
  input: Partial<SalaryPeriodInput>,
) {
  const userId = await requireUserId();
  const owned = await prisma.salaryPeriod.findFirst({ where: { id, userId } });
  if (!owned) throw new Error("Salary period not found");
  await prisma.salaryPeriod.update({
    where: { id },
    data: {
      ...(input.effectiveYear !== undefined && {
        effectiveYear: input.effectiveYear,
      }),
      ...(input.effectiveMonth !== undefined && {
        effectiveMonth: Math.min(12, Math.max(1, Math.round(input.effectiveMonth))),
      }),
      ...(input.monthlySalary !== undefined && {
        monthlySalary: input.monthlySalary,
      }),
      ...(input.grossSalary !== undefined && { grossSalary: input.grossSalary }),
      ...(input.deductions !== undefined && { deductions: input.deductions }),
      ...(input.label !== undefined && { label: input.label }),
    },
  });
  revalidateDashboard();
}

/** Remove a salary period (ownership-checked). */
export async function deleteSalaryPeriod(id: number) {
  const userId = await requireUserId();
  await prisma.salaryPeriod.deleteMany({ where: { id, userId } });
  revalidateDashboard();
}

// ─────────────────────────────────────────────────────────────
// ADDED (Phase 9): custom recurring income sources (freelance, dividends…).
// Each contributes monthlyAmount to every month on/after its effective date.
// ─────────────────────────────────────────────────────────────

export interface IncomeSourceInput {
  label: string;
  emoji?: string;
  monthlyAmount: number;
  effectiveYear: number;
  effectiveMonth: number; // 1–12
  /** Interval end for recurring streams; null = ongoing. */
  endYear?: number | null;
  endMonth?: number | null;
  recurring?: boolean;
  active?: boolean;
}

const clampMonth = (m: number) => Math.min(12, Math.max(1, Math.round(m)));

export async function addIncomeSource(input: IncomeSourceInput) {
  const userId = await requireUserId();
  await prisma.incomeSource.create({
    data: {
      userId,
      label: input.label.trim() || "Income",
      emoji: input.emoji || "💰",
      monthlyAmount: input.monthlyAmount,
      effectiveYear: input.effectiveYear,
      effectiveMonth: clampMonth(input.effectiveMonth),
      endYear: input.endYear ?? null,
      endMonth: input.endMonth != null ? clampMonth(input.endMonth) : null,
      recurring: input.recurring ?? true,
      active: input.active ?? true,
    },
  });
  revalidateDashboard();
}

/** Edit an income source by id (ownership-checked). */
export async function updateIncomeSource(
  id: number,
  input: Partial<IncomeSourceInput>,
) {
  const userId = await requireUserId();
  const owned = await prisma.incomeSource.findFirst({ where: { id, userId } });
  if (!owned) throw new Error("Income source not found");
  await prisma.incomeSource.update({
    where: { id },
    data: {
      ...(input.label !== undefined && { label: input.label.trim() || "Income" }),
      ...(input.emoji !== undefined && { emoji: input.emoji || "💰" }),
      ...(input.monthlyAmount !== undefined && {
        monthlyAmount: input.monthlyAmount,
      }),
      ...(input.effectiveYear !== undefined && {
        effectiveYear: input.effectiveYear,
      }),
      ...(input.effectiveMonth !== undefined && {
        effectiveMonth: clampMonth(input.effectiveMonth),
      }),
      // null clears the end (reopen → ongoing); a value sets/moves it.
      ...(input.endYear !== undefined && { endYear: input.endYear }),
      ...(input.endMonth !== undefined && {
        endMonth: input.endMonth != null ? clampMonth(input.endMonth) : null,
      }),
      ...(input.recurring !== undefined && { recurring: input.recurring }),
      ...(input.active !== undefined && { active: input.active }),
    },
  });
  revalidateDashboard();
}

/** Remove an income source (ownership-checked). */
export async function deleteIncomeSource(id: number) {
  const userId = await requireUserId();
  await prisma.incomeSource.deleteMany({ where: { id, userId } });
  revalidateDashboard();
}

// ─────────────────────────────────────────────────────────────
// ADDED (Module 4): fixed/recurring expenses.
// ─────────────────────────────────────────────────────────────

/** Read the user's fixed-expense definitions (client fetch after mutations). */
export async function fetchFixedExpenses() {
  await requireUserId();
  return getFixedExpenses();
}

/**
 * Suggest an emoji + best-fit category for a fixed-expense label.
 * SECURITY: only the label text is ever sent to any AI — never amounts or PII.
 * Uses a local keyword map today; when ANTHROPIC_API_KEY + @anthropic-ai/sdk are
 * configured, swap the body for a Claude Haiku `messages.parse()` call (structured
 * output) that falls back to `suggestFixedMetaLocal` on any error.
 */
export async function suggestFixedMeta(
  label: string,
): Promise<{ emoji: string; category: CategoryKey }> {
  return suggestFixedMetaLocal(label);
}

export interface FixedExpenseInput {
  label: string;
  emoji?: string;
  category?: CategoryKey;
  amount: number;
  currency?: Currency;
  dueDay?: number; // 1–31
  startYear: number;
  startMonth: number; // 1–12
  endYear?: number | null;
  endMonth?: number | null;
  active?: boolean;
}

const clampDay = (d: number) => Math.min(31, Math.max(1, Math.round(d)));

export async function addFixedExpense(input: FixedExpenseInput) {
  const userId = await requireUserId();
  // Fill emoji/category from the local suggester when the client didn't set them.
  const fallback = suggestFixedMetaLocal(input.label);
  await prisma.fixedExpense.create({
    data: {
      userId,
      label: input.label.trim() || "Fixed expense",
      emoji: input.emoji || fallback.emoji,
      category: input.category ?? fallback.category,
      amount: input.amount,
      currency: input.currency ?? "SGD",
      dueDay: clampDay(input.dueDay ?? 1),
      startYear: input.startYear,
      startMonth: clampMonth(input.startMonth),
      endYear: input.endYear ?? null,
      endMonth: input.endMonth != null ? clampMonth(input.endMonth) : null,
      active: input.active ?? true,
    },
  });
  revalidateDashboard();
}

export async function updateFixedExpense(
  id: number,
  input: Partial<FixedExpenseInput>,
) {
  const userId = await requireUserId();
  const owned = await prisma.fixedExpense.findFirst({ where: { id, userId } });
  if (!owned) throw new Error("Fixed expense not found");
  await prisma.fixedExpense.update({
    where: { id },
    data: {
      ...(input.label !== undefined && { label: input.label.trim() || "Fixed expense" }),
      ...(input.emoji !== undefined && { emoji: input.emoji || "📌" }),
      ...(input.category !== undefined && { category: input.category }),
      ...(input.amount !== undefined && { amount: input.amount }),
      ...(input.currency !== undefined && { currency: input.currency }),
      ...(input.dueDay !== undefined && { dueDay: clampDay(input.dueDay) }),
      ...(input.startYear !== undefined && { startYear: input.startYear }),
      ...(input.startMonth !== undefined && { startMonth: clampMonth(input.startMonth) }),
      ...(input.endYear !== undefined && { endYear: input.endYear }),
      ...(input.endMonth !== undefined && {
        endMonth: input.endMonth != null ? clampMonth(input.endMonth) : null,
      }),
      ...(input.active !== undefined && { active: input.active }),
    },
  });
  revalidateDashboard();
}

/** Remove a fixed-expense definition. Already-generated Expense rows remain
 *  (their fixedSourceId is set null) so history is preserved. */
export async function deleteFixedExpense(id: number) {
  const userId = await requireUserId();
  await prisma.fixedExpense.deleteMany({ where: { id, userId } });
  revalidateDashboard();
}

/**
 * Guided "amount changed from month X" — models a raise/cut without erasing
 * history or double-counting. Caps the existing recurring stream at the month
 * BEFORE the change, then creates a fresh ongoing stream (same label/emoji) at
 * the new amount from the change month. Both writes + one revalidate.
 */
export async function changeIncomeSourceAmount(
  id: number,
  input: { fromYear: number; fromMonth: number; newAmount: number },
) {
  const userId = await requireUserId();
  const src = await prisma.incomeSource.findFirst({ where: { id, userId } });
  if (!src) throw new Error("Income source not found");

  const fromMonth = clampMonth(input.fromMonth);
  const fromYear = input.fromYear;
  // The month just before the change (handles Jan → Dec of prior year).
  const prevMonth = fromMonth === 1 ? 12 : fromMonth - 1;
  const prevYear = fromMonth === 1 ? fromYear - 1 : fromYear;

  await prisma.$transaction([
    prisma.incomeSource.update({
      where: { id },
      data: { endYear: prevYear, endMonth: prevMonth },
    }),
    prisma.incomeSource.create({
      data: {
        userId,
        label: src.label,
        emoji: src.emoji,
        monthlyAmount: input.newAmount,
        effectiveYear: fromYear,
        effectiveMonth: fromMonth,
        endYear: null,
        endMonth: null,
        recurring: true,
        active: true,
      },
    }),
  ]);
  revalidateDashboard();
}
