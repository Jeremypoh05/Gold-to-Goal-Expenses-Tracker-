// ADDED (Phase 8): the app is now real-time. `CURRENT` used to be a hardcoded
// demo date (Apr 23 2026) exported from sampleExpenses.ts; it's now derived from
// the actual date so the dashboard / ledger / calendar all reflect "today".
//
// NOTE: this evaluates `new Date()` at module load. Server and client each evaluate
// it in their own timezone, so on a day boundary the year/month/day could differ
// between SSR and hydration. For a personal tracker that's an acceptable edge; if it
// ever bites, the server-computed `current` from the ExpensesProvider is authoritative.
import type { MonthInfo } from "@/types";

const now = new Date();

export const CURRENT: MonthInfo = {
  year: now.getFullYear(),
  month: now.getMonth() + 1, // JS months are 0-indexed
  day: now.getDate(),
};

/** Build a MonthInfo for an arbitrary date (used server-side where we have a real Date). */
export function monthInfoFrom(date: Date): MonthInfo {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}
