"use server";

// ADDED (Phase 8): server actions — the only way the client mutates data.
// Every action re-checks auth() (Server Actions are reachable by direct POST, so we
// never trust the client) and scopes writes to the signed-in user. After a write we
// revalidatePath the dashboard routes; client handlers also call the ExpensesProvider's
// refresh() (which re-fetches the viewed month via fetchMonthData) so the UI updates.
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { toUiExpense, suggestFixedMetaLocal } from "@/lib/expense-utils";
import {
  getMonthDashboardData,
  getYearSummary,
  getFixedExpenses,
  resyncFixedExpense,
  getClosedMonthKeys,
} from "@/lib/queries";
import type { CategoryKey, Currency } from "@/types";

const VALID_CATEGORIES: CategoryKey[] = [
  "food",
  "shop",
  "ent",
  "trans",
  "health",
  "bills",
  "other",
];

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

/** ADDED (Module 5): defense-in-depth — every expense mutation re-checks this,
 *  even though the UI already disables the relevant buttons for a closed month. */
async function assertMonthOpen(userId: string, year: number, month: number) {
  const closed = await prisma.monthClose.findUnique({
    where: { userId_year_month: { userId, year, month } },
  });
  if (closed) {
    throw new Error(
      "This month is closed. Reopen it on the Ledger page to make changes.",
    );
  }
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

  const spentAt = input.spentAt ? new Date(input.spentAt) : new Date();
  await assertMonthOpen(userId, spentAt.getFullYear(), spentAt.getMonth() + 1);

  const row = await prisma.expense.create({
    data: {
      userId,
      spentAt,
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

  // The row's current month must be open; if the edit also moves it to a
  // different month (rare — the manual-add modal doesn't expose a date field
  // today, but the check stays correct if that ever changes), that month must
  // be open too.
  await assertMonthOpen(userId, owned.spentAt.getFullYear(), owned.spentAt.getMonth() + 1);
  if (input.spentAt !== undefined) {
    const newDate = new Date(input.spentAt);
    await assertMonthOpen(userId, newDate.getFullYear(), newDate.getMonth() + 1);
  }

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
  const owned = await prisma.expense.findFirst({ where: { id, userId } });
  if (!owned) return;
  await assertMonthOpen(userId, owned.spentAt.getFullYear(), owned.spentAt.getMonth() + 1);
  await prisma.expense.delete({ where: { id } });
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
// ADDED (Module 5): monthly account closing (hard lock). Closing a month
// blocks add/edit/delete of expenses (manual or voice) dated in it, enforced
// by assertMonthOpen above. Scope is expenses only — income stays editable.
// ─────────────────────────────────────────────────────────────

/** All months this user has hard-closed (for client-side edit warnings). */
export async function fetchClosedMonths(): Promise<{ year: number; month: number }[]> {
  const userId = await requireUserId();
  const rows = await prisma.monthClose.findMany({
    where: { userId },
    select: { year: true, month: true },
  });
  return rows;
}

export async function closeMonth(year: number, month: number) {
  const userId = await requireUserId();
  await prisma.monthClose.upsert({
    where: { userId_year_month: { userId, year, month } },
    update: {},
    create: { userId, year, month },
  });
  revalidateDashboard();
}

export async function reopenMonth(year: number, month: number) {
  const userId = await requireUserId();
  await prisma.monthClose.deleteMany({ where: { userId, year, month } });
  revalidateDashboard();
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
 * Suggest an emoji + best-fit category for a fixed-expense label via Claude Haiku,
 * falling back to the local keyword map when the key is unset, the label is empty,
 * or anything goes wrong. SECURITY: only the label text is ever sent to the model —
 * never amounts, dates, or any other PII.
 */
export async function suggestFixedMeta(
  label: string,
): Promise<{ emoji: string; category: CategoryKey }> {
  const fallback = suggestFixedMetaLocal(label);
  const trimmed = label.trim().slice(0, 60);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !trimmed) return fallback;

  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 80,
      system:
        `You tag a personal recurring-expense label with one emoji and one spending category. ` +
        `Valid categories: ${VALID_CATEGORIES.join(", ")}. ` +
        `Reply with ONLY a compact JSON object, no prose: {"emoji":"<one emoji>","category":"<one category>"}. ` +
        `Pick the single most fitting emoji and the closest category.`,
      messages: [{ role: "user", content: trimmed }],
    });
    const text = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("");
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    const parsed = JSON.parse(match[0]) as { emoji?: unknown; category?: unknown };
    const category = VALID_CATEGORIES.includes(parsed.category as CategoryKey)
      ? (parsed.category as CategoryKey)
      : fallback.category;
    const emoji =
      typeof parsed.emoji === "string" && parsed.emoji.trim()
        ? parsed.emoji.trim().slice(0, 8)
        : fallback.emoji;
    return { emoji, category };
  } catch {
    return fallback;
  }
}

export interface FixedExpenseInput {
  label: string;
  note?: string | null;
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
  const created = await prisma.fixedExpense.create({
    data: {
      userId,
      label: input.label.trim() || "Fixed expense",
      note: input.note?.trim() || null,
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
  // Materialize its due entries right away (from start to today).
  await resyncFixedExpense(created.id);
  revalidateDashboard();
}

export async function updateFixedExpense(
  id: number,
  input: Partial<FixedExpenseInput>,
  // CHANGED (Module 5.1 · override): when true, the redefine also rewrites any
  // closed months the rule spans (user opted in via the closed-month guard).
  overrideClosed = false,
) {
  const userId = await requireUserId();
  const owned = await prisma.fixedExpense.findFirst({ where: { id, userId } });
  if (!owned) throw new Error("Fixed expense not found");
  await prisma.fixedExpense.update({
    where: { id },
    data: {
      ...(input.label !== undefined && { label: input.label.trim() || "Fixed expense" }),
      ...(input.note !== undefined && { note: input.note?.trim() || null }),
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

  // Editing = redefine: fully re-materialize the whole [start, today] range at the
  // new values, so a changed start month / amount / label is reflected across every
  // affected month (ledger, calendar, dashboard, income). To change the rate from a
  // point in time while KEEPING past months, use changeFixedAmount instead.
  await resyncFixedExpense(id, overrideClosed);

  revalidateDashboard();
}

/** Remove a fixed-expense definition AND its auto-generated Expense rows, so the
 *  recurring entries disappear from the ledger/calendar/dashboard when the rule is
 *  deleted (they were system-generated, not hand-entered).
 *  CHANGED (Module 5.1): rows in CLOSED months are kept — a closed month's books
 *  never change. Deleting the rule detaches them (fixedSourceId → null via the
 *  relation's onDelete: SetNull), so they live on as plain frozen entries. */
export async function deleteFixedExpense(id: number, overrideClosed = false) {
  const userId = await requireUserId();
  const owned = await prisma.fixedExpense.findFirst({ where: { id, userId } });
  if (!owned) return;

  // CHANGED (Module 5.1 · override): by default a closed month's generated row is
  // KEPT (detached) when the rule is deleted — a closed month's books never change.
  // When the user explicitly opts in (overrideClosed), delete those rows too.
  const closedKeys = overrideClosed
    ? new Set<string>()
    : await getClosedMonthKeys(userId);
  const rows = await prisma.expense.findMany({
    where: { userId, fixedSourceId: id },
    select: { id: true, spentAt: true },
  });
  const deletableIds = rows
    .filter((r) => !closedKeys.has(`${r.spentAt.getFullYear()}-${r.spentAt.getMonth() + 1}`))
    .map((r) => r.id);

  await prisma.$transaction([
    ...(deletableIds.length > 0
      ? [prisma.expense.deleteMany({ where: { id: { in: deletableIds } } })]
      : []),
    prisma.fixedExpense.delete({ where: { id } }),
  ]);
  revalidateDashboard();
}

/**
 * Guided "amount changed from month X" for a fixed expense (e.g. rent went up).
 * Caps the current definition at the month before the change and starts a fresh
 * one (same label/emoji/category/due-day) at the new amount from the change month
 * — so past months keep their old figure and there's no double-count. Any rows
 * already generated on/after the change month are removed so the new segment can
 * re-materialize them at the new amount.
 */
export async function changeFixedAmount(
  id: number,
  input: { fromYear: number; fromMonth: number; newAmount: number },
  // CHANGED (Module 5.1 · override): when true, closed months from the change
  // point forward are also rewritten to the new amount (user opted in).
  overrideClosed = false,
) {
  const userId = await requireUserId();
  const src = await prisma.fixedExpense.findFirst({ where: { id, userId } });
  if (!src) throw new Error("Fixed expense not found");

  const fromMonth = clampMonth(input.fromMonth);
  const fromYear = input.fromYear;
  const prevMonth = fromMonth === 1 ? 12 : fromMonth - 1;
  const prevYear = fromMonth === 1 ? fromYear - 1 : fromYear;

  // If the old definition had an end on/after the change, the new segment inherits it.
  const cmp = (aY: number, aM: number, bY: number, bM: number) => (aY !== bY ? aY - bY : aM - bM);
  const carryEnd =
    src.endYear != null && src.endMonth != null && cmp(src.endYear, src.endMonth, fromYear, fromMonth) >= 0;

  const fromStart = new Date(fromYear, fromMonth - 1, 1);

  // ADDED (Module 5): a closed month's row is frozen — never delete it even
  // though it falls on/after the change point (it just keeps its old amount;
  // the new segment's generation already skips closed months on its own).
  // (Module 5.1) …unless the user chose to override — then rewrite them too.
  const closedKeys = overrideClosed
    ? new Set<string>()
    : await getClosedMonthKeys(userId);
  const candidates = await prisma.expense.findMany({
    where: { userId, fixedSourceId: id, spentAt: { gte: fromStart } },
    select: { id: true, spentAt: true },
  });
  const deletableIds = candidates
    .filter((r) => !closedKeys.has(`${r.spentAt.getFullYear()}-${r.spentAt.getMonth() + 1}`))
    .map((r) => r.id);

  // Build the ops in order so we can pick the created segment's id back out.
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  if (deletableIds.length > 0) {
    // Remove any generated rows at/after the change month (old-amount rows,
    // excluding closed months unless overriding) — the new segment regenerates them.
    ops.push(prisma.expense.deleteMany({ where: { id: { in: deletableIds } } }));
  }
  // Cap the old definition at the month before the change.
  ops.push(
    prisma.fixedExpense.update({
      where: { id },
      data: { endYear: prevYear, endMonth: prevMonth },
    }),
  );
  const createIdx = ops.length;
  // New ongoing (or end-inheriting) segment at the new amount.
  ops.push(
    prisma.fixedExpense.create({
      data: {
        userId,
        label: src.label,
        note: src.note,
        emoji: src.emoji,
        category: src.category,
        amount: input.newAmount,
        currency: src.currency,
        dueDay: src.dueDay,
        startYear: fromYear,
        startMonth: fromMonth,
        endYear: carryEnd ? src.endYear : null,
        endMonth: carryEnd ? src.endMonth : null,
        active: true,
      },
    }),
  );

  const results = await prisma.$transaction(ops);
  // CHANGED (Module 5.1): materialize the new segment right away (was left to the
  // lazy dashboard-layout sync) so the new amount shows immediately after refresh()
  // — and, when overriding, so the closed months actually get regenerated.
  const newSeg = results[createIdx] as { id: number };
  await resyncFixedExpense(newSeg.id, overrideClosed);
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
