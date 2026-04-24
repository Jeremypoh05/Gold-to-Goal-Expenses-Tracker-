// ─────────────────────────────────────────────────────────────
// Expense type definitions
// ─────────────────────────────────────────────────────────────

export type CategoryKey =
  | "food"
  | "shop"
  | "ent"
  | "trans"
  | "health"
  | "bills"
  | "other";

export interface Category {
  key: CategoryKey;
  label: string;
  color: string; // CSS variable reference, e.g. 'var(--color-hue-food)'
  hue: number; // OKLCH hue value for dynamic backgrounds
}

export interface Expense {
  id: number;
  day: number; // Day of month (1-31)
  time: string; // HH:MM format
  cat: CategoryKey;
  amt: number; // Amount in default currency (SGD)
  note: string;
  voice?: boolean; // Was this logged via voice?
  fixed?: boolean; // Is this a recurring fixed expense?
}

export interface MonthInfo {
  year: number;
  month: number; // 1-12
  day: number; // Today's day
}

export interface IncomeInfo {
  salary: number;
  bonuses: { month: number; amt: number; label: string }[];
  yearly: number;
  saved: number;
}

export type Currency = "SGD" | "USD" | "MYR" | "CNY";
