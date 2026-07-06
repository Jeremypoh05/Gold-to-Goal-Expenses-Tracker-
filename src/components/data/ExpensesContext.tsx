"use client";

// CHANGED (Phase 8.1): the provider is now STATEFUL so the user can browse past
// months without a full navigation. It seeds from the server (current month), and
// `goToMonth` / `refresh` re-fetch via the fetchMonthData server action and swap the
// data in place. Because the data lives in client state, mutations refresh through
// this context's `refresh()` (not router.refresh(), which would re-run the layout but
// not update this state).
//
// `current.day` is today's date only when viewing the actual current month (server
// sets it to 0 otherwise), so `canGoNext === (current.day === 0)` — you can move
// forward only from a past month, never into the future.
import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { fetchMonthData } from "@/lib/actions";
import type { DashboardData } from "@/lib/queries";

interface ExpensesContextValue extends DashboardData {
  /** A month fetch / refresh is in flight. */
  pending: boolean;
  /** False when already viewing the real current month (can't browse into the future). */
  canGoNext: boolean;
  /** Step the viewed month by delta (±1). Forward past the current month is ignored. */
  goToMonth: (delta: number) => void;
  /** Re-fetch the currently-viewed month (call after a mutation). */
  refresh: () => void;
  /** ADDED (Module 5): whether the REAL current month (today) is closed —
   *  independent of whichever month is being browsed. New expenses (manual
   *  "+"/"Add row" and voice logging) always land on today, so gating those
   *  entry points needs this rather than the viewed month's `monthClosed`. */
  todayClosed: boolean;
}

const ExpensesContext = createContext<ExpensesContextValue | null>(null);

export function ExpensesProvider({
  initial,
  children,
}: {
  initial: DashboardData;
  children: ReactNode;
}) {
  const [data, setData] = useState(initial);
  // `initial` is always fetched via getDashboardData() (real now()), so at
  // mount it always represents today's month — a safe seed for todayClosed.
  const [todayClosed, setTodayClosed] = useState(initial.monthClosed);
  const [pending, startTransition] = useTransition();

  const canGoNext = data.current.day === 0; // only past months have day === 0

  // Whenever a fetch happens to land on the real current month (day !== 0),
  // sync todayClosed from it too — covers closing/reopening today's own month.
  const applyFetched = (next: DashboardData) => {
    setData(next);
    if (next.current.day !== 0) setTodayClosed(next.monthClosed);
  };

  const goToMonth = (delta: number) => {
    if (delta > 0 && !canGoNext) return; // never navigate into the future
    let month = data.current.month + delta;
    let year = data.current.year;
    if (month < 1) {
      month = 12;
      year -= 1;
    } else if (month > 12) {
      month = 1;
      year += 1;
    }
    startTransition(async () => {
      applyFetched(await fetchMonthData(year, month));
    });
  };

  const refresh = () => {
    startTransition(async () => {
      applyFetched(await fetchMonthData(data.current.year, data.current.month));
    });
  };

  return (
    <ExpensesContext.Provider
      value={{ ...data, pending, canGoNext, goToMonth, refresh, todayClosed }}
    >
      {children}
    </ExpensesContext.Provider>
  );
}

export function useExpenses(): ExpensesContextValue {
  const ctx = useContext(ExpensesContext);
  if (!ctx) {
    throw new Error("useExpenses must be used within an ExpensesProvider");
  }
  return ctx;
}
