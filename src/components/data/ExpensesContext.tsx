"use client";

// ADDED (Phase 8): single client-side source of truth for the signed-in user's data.
// The server (dashboard layout) fetches once and seeds this provider; every page /
// shared component reads from useExpenses() instead of importing the old SAMPLE_*
// mock arrays. After a mutation, router.refresh() re-runs the layout fetch and the
// new value flows back down here.
import { createContext, useContext } from "react";
import type { DashboardData } from "@/lib/queries";

const ExpensesContext = createContext<DashboardData | null>(null);

export function ExpensesProvider({
  value,
  children,
}: {
  value: DashboardData;
  children: React.ReactNode;
}) {
  return (
    <ExpensesContext.Provider value={value}>
      {children}
    </ExpensesContext.Provider>
  );
}

export function useExpenses(): DashboardData {
  const ctx = useContext(ExpensesContext);
  if (!ctx) {
    throw new Error("useExpenses must be used within an ExpensesProvider");
  }
  return ctx;
}
