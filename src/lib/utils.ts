import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Currency } from "@/types";

/**
 * Combine Tailwind classes intelligently.
 * Resolves conflicts (e.g., `px-2 px-4` → `px-4`).
 *
 * @example
 * cn('px-2 py-1', isActive && 'bg-gold-500')
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Get number of days in a given month.
 * Handles leap years automatically.
 *
 * @param year - Full year (e.g., 2026)
 * @param month - Month (1-12)
 */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Format money with currency symbol.
 * Uses Singapore locale by default for proper number formatting.
 */
export function formatMoney(n: number, currency: Currency = "SGD"): string {
  const symbols: Record<Currency, string> = {
    SGD: "S$",
    USD: "$",
    MYR: "RM",
    CNY: "¥",
  };
  return (
    symbols[currency] +
    n.toLocaleString("en-SG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
