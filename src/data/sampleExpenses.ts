import type { Expense, MonthInfo, IncomeInfo } from "@/types";

export const CURRENT: MonthInfo = {
  year: 2026,
  month: 4,
  day: 23,
};

export const SAMPLE_EXPENSES: Expense[] = [
  {
    id: 1,
    day: 23,
    time: "08:12",
    cat: "food",
    amt: 5.0,
    note: "Kaya toast + kopi",
    voice: true,
  },
  {
    id: 2,
    day: 23,
    time: "10:45",
    cat: "trans",
    amt: 2.3,
    note: "MRT · Downtown → CBD",
  },
  {
    id: 3,
    day: 23,
    time: "13:02",
    cat: "food",
    amt: 12.8,
    note: "Lunch · chicken rice",
    voice: true,
  },
  {
    id: 4,
    day: 23,
    time: "15:30",
    cat: "ent",
    amt: 6.5,
    note: "Flat white ☕",
  },
  {
    id: 5,
    day: 22,
    time: "19:40",
    cat: "shop",
    amt: 148.0,
    note: "Uniqlo · linen shirt",
  },
  {
    id: 6,
    day: 22,
    time: "12:15",
    cat: "food",
    amt: 18.5,
    note: "Ramen · chashu miso",
  },
  {
    id: 7,
    day: 22,
    time: "09:05",
    cat: "trans",
    amt: 14.8,
    note: "Grab · to client",
  },
  {
    id: 8,
    day: 21,
    time: "20:10",
    cat: "ent",
    amt: 32.0,
    note: "Cinema · Dune Pt3",
  },
  {
    id: 9,
    day: 21,
    time: "18:00",
    cat: "food",
    amt: 42.6,
    note: "Dinner w/ Sam",
  },
  {
    id: 10,
    day: 20,
    time: "21:30",
    cat: "health",
    amt: 68.0,
    note: "Pilates drop-in",
  },
  { id: 11, day: 20, time: "13:00", cat: "food", amt: 9.2, note: "Poke bowl" },
  {
    id: 12,
    day: 19,
    time: "11:20",
    cat: "shop",
    amt: 24.9,
    note: "Muji · stationery",
  },
  {
    id: 13,
    day: 18,
    time: "10:00",
    cat: "bills",
    amt: 85.0,
    note: "Internet · monthly",
  },
  {
    id: 14,
    day: 17,
    time: "14:30",
    cat: "other",
    amt: 15.0,
    note: "Gift card",
  },
  { id: 15, day: 16, time: "08:30", cat: "food", amt: 6.8, note: "Breakfast" },
  {
    id: 16,
    day: 15,
    time: "19:00",
    cat: "food",
    amt: 58.4,
    note: "Sushi omakase",
  },
  { id: 17, day: 14, time: "12:00", cat: "food", amt: 11.5, note: "Lunch" },
  {
    id: 18,
    day: 12,
    time: "16:20",
    cat: "ent",
    amt: 22.0,
    note: "Concert presale",
  },
  {
    id: 19,
    day: 10,
    time: "09:30",
    cat: "health",
    amt: 45.0,
    note: "Pharmacy · vitamins",
  },
  {
    id: 20,
    day: 8,
    time: "11:11",
    cat: "shop",
    amt: 89.0,
    note: "Skincare refill",
  },
  {
    id: 21,
    day: 5,
    time: "10:00",
    cat: "bills",
    amt: 1650.0,
    note: "Rent · April",
    fixed: true,
  },
  {
    id: 22,
    day: 3,
    time: "18:45",
    cat: "food",
    amt: 14.2,
    note: "Dinner · pad thai",
  },
  { id: 23, day: 2, time: "14:00", cat: "trans", amt: 60.0, note: "Petrol" },
  {
    id: 24,
    day: 1,
    time: "09:00",
    cat: "bills",
    amt: 120.0,
    note: "Utilities",
    fixed: true,
  },
];

export const SAMPLE_INCOME: IncomeInfo = {
  salary: 7200,
  bonuses: [
    { month: 2, amt: 5000, label: "Q1 bonus" },
    { month: 6, amt: 5000, label: "Q2 bonus" },
  ],
  yearly: 7200 * 12 + 10000,
  saved: 42360,
};

// Computed values
export const EXPENSES_BY_CATEGORY = SAMPLE_EXPENSES.reduce(
  (acc, t) => {
    acc[t.cat] = (acc[t.cat] || 0) + t.amt;
    return acc;
  },
  {} as Record<string, number>,
);

export const TOTAL_SPENT = Object.values(EXPENSES_BY_CATEGORY).reduce(
  (a, b) => a + b,
  0,
);

export function countByCategory(cat: string): number {
  return SAMPLE_EXPENSES.filter((t) => t.cat === cat).length;
}

export const VOICE_COUNT = SAMPLE_EXPENSES.filter((t) => t.voice).length;
export const FIXED_COUNT = SAMPLE_EXPENSES.filter((t) => t.fixed).length;

// ─────────────────────────────────────────────────────────────
// Daily detail helpers
// ─────────────────────────────────────────────────────────────

/**
 * Get all expenses for a specific day, sorted by time.
 */
export function getExpensesForDay(day: number) {
  return SAMPLE_EXPENSES.filter((t) => t.day === day).sort((a, b) =>
    a.time.localeCompare(b.time)
  );
}

/**
 * Get all unique days with expenses (for navigation: ← previous day, next day →).
 */
export function getAllExpenseDays(): number[] {
  return [...new Set(SAMPLE_EXPENSES.map((t) => t.day))].sort((a, b) => a - b);
}

/**
 * Group expenses for a day into 24 hourly buckets.
 * Returns array of length 24 with sum per hour.
 */
export function getHourlyBuckets(day: number): number[] {
  const dayExpenses = SAMPLE_EXPENSES.filter((t) => t.day === day);
  return Array.from({ length: 24 }, (_, hour) =>
    dayExpenses
      .filter((t) => parseInt(t.time.split(':')[0], 10) === hour)
      .reduce((a, b) => a + b.amt, 0)
  );
}
