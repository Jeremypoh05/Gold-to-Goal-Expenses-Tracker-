// ADDED (AI Assistant · Slice 2): types shared by the server (tools/engine/actions)
// AND the client (AssistantChat confirm cards). Kept in a types-only module so the
// client can import them without pulling prisma (from tools.ts) into its bundle —
// type-only imports are erased at build time.
import type { CategoryKey, Currency } from "@/types";

/** The 7 writable spending categories (matches VALID_CATEGORIES in actions.ts and
 *  the tiles in VoiceEntryEditor — "family" is read-only, so writes never use it). */
export const WRITABLE_CATEGORIES: CategoryKey[] = [
  "food",
  "shop",
  "ent",
  "trans",
  "health",
  "bills",
  "other",
];

/** A complete, self-contained expense value — enough to render a card AND execute
 *  the write. `spentAt` is an ISO string (Date isn't serializable across the wire);
 *  null means "now" (create) / "leave as-is" (update). */
export interface ExpenseFields {
  amount: number;
  currency: Currency;
  category: CategoryKey;
  note: string;
  tags: string[];
  spentAt: string | null;
}

export type ProposalKind =
  | "create_expense"
  | "update_expense"
  | "delete_expense"
  // ADDED (Slice 2b):
  | "edit_recurring" // change a recurring RULE (all/future months) — the "big one"
  | "set_preference" // remember what the user values (persona-aware suggestions)
  // ADDED (Slice 2b fix batch):
  | "set_month_status" // reopen / close a month's books, confirm-gated
  // ADDED (Slice 2c):
  | "create_recurring" // set up a brand-new recurring rule
  // ADDED (Slice 2d — income management via chat):
  | "set_savings_goal" // savings goal / saved / budget / pay schedule
  | "adjust_salary" // salary effective from a month (raise / correction)
  | "create_bonus" // add a year-scoped bonus
  | "update_bonus" // edit an existing bonus
  | "delete_bonus" // remove a bonus
  | "create_income_source" // add a custom recurring/one-off income stream
  | "edit_income_source"; // edit/rate-change/end/delete an income stream

/** A brand-new recurring rule the agent proposes (routes to addFixedExpense). Unlike
 *  plain expenses, a recurring item MAY use category "family" (家用/family support). */
export interface RecurringCreateFields {
  label: string;
  note: string;
  category: CategoryKey;
  currency: Currency;
  amount: number;
  dueDay: number;
  startYear: number;
  startMonth: number;
  endYear: number | null;
  endMonth: number | null;
}

/** A month reopen/close the agent proposes (routes to reopenMonth/closeMonth). */
export interface MonthStatusEdit {
  year: number;
  month: number; // 1–12
  monthLabel: string; // "June 2026"
  action: "reopen" | "close";
}

// ── recurring-rule edits (Slice 2b) ──────────────────────────
// The smart edit the user was blocked on: changing a recurring commitment must
// touch the RULE (so every generated month + ledger + calendar + dashboard +
// income move together), not one stray generated row. Two shapes, matching the
// existing server machinery:
//   • "rate_change" → changeFixedAmount: the amount changes from a month onward,
//      EARLIER months keep their old figure (a raise/cut, history-preserving).
//   • "redefine"    → updateFixedExpense: the rule's definition is rewritten and
//      the WHOLE [start, today] range re-materialized to the new values.

/** A compact snapshot of a recurring rule, for the card's before→after display. */
export interface RecurringSnapshot {
  label: string;
  amount: number;
  currency: Currency;
  category: CategoryKey;
  note: string;
  dueDay: number;
  activeFrom: string; // "YYYY-MM"
  activeUntil: string; // "YYYY-MM" | "ongoing"
}

/** The field changes to hand updateFixedExpense on a "redefine" (only what moved). */
export interface RecurringChanges {
  label?: string;
  note?: string;
  category?: CategoryKey;
  currency?: Currency;
  amount?: number;
  dueDay?: number;
  startYear?: number;
  startMonth?: number;
  endYear?: number | null;
  endMonth?: number | null;
}

export interface RecurringEdit {
  ruleId: number;
  mode: "rate_change" | "redefine";
  before: RecurringSnapshot;
  after: RecurringSnapshot; // resulting definition (redefine) or going-forward amount (rate_change)
  /** rate_change: the month the new amount takes effect (earlier months untouched). */
  fromYear?: number;
  fromMonth?: number;
  newAmount?: number;
  /** redefine: the exact field changes for updateFixedExpense. */
  changes?: RecurringChanges;
  /** The affected month span, for the client closed-month guard AND impact preview. */
  range: { startYear: number; startMonth: number; endYear: number | null; endMonth: number | null };
  impact: { monthCount: number; firstMonth: string; lastMonth: string };
  /** Closed months within the affected range (heads-up; the guard re-checks on confirm). */
  closedInRange: string[];
}

/** A lightweight preference the agent wants to remember (get/set via UserPreference). */
export interface PreferenceFields {
  key: string;
  value: string;
}

// ── income management (Slice 2d) ─────────────────────────────
// The WRITE counterparts to get_financial_overview: adjust salary, set the savings
// goal / budget / pay schedule, CRUD bonuses, and manage other income streams — all
// confirm-gated like the expense/recurring writes. Each routes (on Confirm) to the
// SAME server action the Income page uses, so the whole year rollup + dashboard move.

/** set_savings_goal — the income-settings fields the user asked to change (only the
 *  touched keys are present). Routes to updateIncomeSettings. */
export interface SavingsSettingsFields {
  savingsGoal?: number;
  saved?: number;
  monthlyBudget?: number;
  payDay?: number;
  payFrequency?: string;
}
export interface SavingsGoalEdit {
  currency: Currency;
  /** The new values to write (only the fields being changed). */
  changes: SavingsSettingsFields;
  /** The current value of each changed field, for the before→after card. */
  before: SavingsSettingsFields;
}

/** adjust_salary — a salary effective from a month. Routes to addSalaryPeriod, which
 *  upserts by effective month: the SAME month corrects that period; a LATER month is a
 *  raise/cut that keeps earlier months (activeSalaryForMonth picks the latest ≤ month). */
export interface SalaryFields {
  effectiveYear: number;
  effectiveMonth: number; // 1–12
  monthlySalary: number; // take-home
  grossSalary: number | null;
  deductions: number | null;
  label: string;
}
export interface SalaryEdit {
  currency: Currency;
  fields: SalaryFields;
  /** Take-home in effect at the effective month before this change (before→after). */
  previousTakeHome: number | null;
  /** True when a period already exists exactly at that month (this overwrites it). */
  overwritesExisting: boolean;
}

/** Bonus CRUD (Slice 2d) — a year-scoped one-off amount on top of salary. */
export interface BonusFields {
  year: number;
  month: number; // 1–12
  amount: number;
  label: string;
}
export interface BonusEdit {
  currency: Currency;
  /** present for update/delete (the row being changed, from find_bonuses). */
  bonusId?: number;
  /** update/delete: the current values (the target). */
  before?: BonusFields;
  /** create/update: the resulting values. */
  after?: BonusFields;
}

/** create_income_source / edit_income_source — a custom income stream (freelance,
 *  dividends, rental…). Recurring streams span [start, end] (null end = ongoing);
 *  one-off streams count once in their effective month. */
export interface IncomeSourceFields {
  label: string;
  emoji: string;
  monthlyAmount: number;
  effectiveYear: number;
  effectiveMonth: number; // 1–12
  endYear: number | null;
  endMonth: number | null;
  recurring: boolean;
}
export interface IncomeSourceSnapshot {
  label: string;
  emoji: string;
  monthlyAmount: number;
  activeFrom: string; // "YYYY-MM"
  activeUntil: string; // "YYYY-MM" | "ongoing"
  recurring: boolean;
}
export interface IncomeSourceEdit {
  currency: Currency;
  sourceId: number;
  mode: "rate_change" | "redefine" | "delete";
  before: IncomeSourceSnapshot;
  after: IncomeSourceSnapshot; // redefine/rate_change result; == before for delete
  /** rate_change: the new amount from a month (earlier months keep their figure). */
  fromYear?: number;
  fromMonth?: number;
  newAmount?: number;
  /** redefine: the exact field changes for updateIncomeSource. */
  changes?: Partial<IncomeSourceFields>;
}

/**
 * A WRITE the agent wants to make. The write tools NEVER touch the DB — they return
 * one of these, the engine surfaces it to the chat as a confirm card, and nothing is
 * saved until the user taps Confirm (→ executeAssistantAction). Self-contained so a
 * reload of the live turn's React state can still render/execute it.
 */
export interface Proposal {
  /** Stable id for keying + resolving on the client (the tool_use block id). */
  id: string;
  kind: ProposalKind;
  /** One-line human summary for the card header (e.g. "Add $12.00 · Food"). */
  summary: string;
  /** "YYYY-MM" if the affected month is hard-closed — the card warns / offers override. */
  closedMonth?: string | null;
  /** The row being changed is generated by a recurring rule — editing/deleting it
   *  touches only this month and leaves the rule out of sync (Slice 2b handles rules). */
  recurringWarning?: boolean;

  // create_expense
  create?: ExpenseFields;

  // update_expense
  expenseId?: number;
  before?: ExpenseFields;
  after?: ExpenseFields;

  // delete_expense
  target?: ExpenseFields;

  // edit_recurring (Slice 2b)
  recurring?: RecurringEdit;

  // set_preference (Slice 2b)
  preference?: PreferenceFields;

  // set_month_status (Slice 2b fix batch)
  monthStatus?: MonthStatusEdit;

  // create_recurring (Slice 2c)
  recurringCreate?: RecurringCreateFields;
  /** Closed months within a create_recurring's [start, today] span — a heads-up;
   *  the card's guard re-checks live and threads overrideClosed on Confirm. */
  closedInRange?: string[];

  // income management (Slice 2d)
  savingsGoal?: SavingsGoalEdit; // set_savings_goal
  salary?: SalaryEdit; // adjust_salary
  bonus?: BonusEdit; // create_bonus / update_bonus / delete_bonus
  incomeSourceCreate?: IncomeSourceFields; // create_income_source
  incomeSourceEdit?: IncomeSourceEdit; // edit_income_source
}

/** What the client sends back to executeAssistantAction on Confirm (or after a
 *  manual edit in the VoiceEntryEditor). `fields` carries the FINAL values. */
export type AssistantActionInput =
  | { kind: "create_expense"; fields: ExpenseFields; overrideClosed?: boolean }
  | { kind: "update_expense"; expenseId: number; fields: ExpenseFields; overrideClosed?: boolean }
  | { kind: "delete_expense"; expenseId: number }
  // edit_recurring (Slice 2b) — routes to changeFixedAmount / updateFixedExpense.
  | {
      kind: "edit_recurring";
      ruleId: number;
      mode: "rate_change";
      fromYear: number;
      fromMonth: number;
      newAmount: number;
      overrideClosed?: boolean;
    }
  | {
      kind: "edit_recurring";
      ruleId: number;
      mode: "redefine";
      changes: RecurringChanges;
      overrideClosed?: boolean;
    }
  // set_preference (Slice 2b) — upserts UserPreference.
  | { kind: "set_preference"; key: string; value: string }
  // set_month_status (Slice 2b fix batch) — reopenMonth / closeMonth.
  | { kind: "set_month_status"; year: number; month: number; action: "reopen" | "close" }
  // create_recurring (Slice 2c) — addFixedExpense.
  | { kind: "create_recurring"; fields: RecurringCreateFields; overrideClosed?: boolean }
  // income management (Slice 2d).
  | { kind: "set_savings_goal"; changes: SavingsSettingsFields }
  | { kind: "adjust_salary"; fields: SalaryFields }
  | { kind: "create_bonus"; fields: BonusFields }
  | { kind: "update_bonus"; bonusId: number; fields: BonusFields }
  | { kind: "delete_bonus"; bonusId: number }
  | { kind: "create_income_source"; fields: IncomeSourceFields }
  | {
      kind: "edit_income_source";
      sourceId: number;
      mode: "rate_change";
      fromYear: number;
      fromMonth: number;
      newAmount: number;
    }
  | { kind: "edit_income_source"; sourceId: number; mode: "redefine"; changes: Partial<IncomeSourceFields> }
  | { kind: "edit_income_source"; sourceId: number; mode: "delete" };

export interface AssistantActionResult {
  ok: boolean;
  /** Short confirmation for the resolved card, e.g. "Added $12.00 · Food". */
  summary?: string;
  error?: string;
}

// ── persisted proposals + outcomes (Slice 2b-part-2) ─────────
// So the confirmation cards AND a permanent "what did I do here" status survive a
// reload / navigating away — stored on ChatMessage.data. `pending` = the user never
// tapped (card still actionable on return); `confirmed`/`cancelled` = resolved.

export type ProposalOutcome = "pending" | "confirmed" | "cancelled";

export interface PersistedProposal extends Proposal {
  outcome: ProposalOutcome;
  /** A short server confirmation kept as a fallback label. */
  resultSummary?: string;
  resolvedAt?: string; // ISO
}

/** The JSON blob stored on ChatMessage.data. */
export interface ChatMessageData {
  proposals?: PersistedProposal[];
}
