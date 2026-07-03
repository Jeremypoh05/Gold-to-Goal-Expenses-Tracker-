// CHANGED (Phase 8): now a Server Component. It ensures the signed-in user's DB row
// exists, fetches their current-month data, and seeds the client DashboardShell (which
// holds the interactive shell + ExpensesProvider). The old client body moved to
// DashboardShell.tsx.
import { getDashboardData, syncFixedExpenses } from '@/lib/queries';
import { DashboardShell } from '@/components/dashboard/DashboardShell';

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // ADDED (Module 4): materialize any due fixed/recurring expenses up to today
    // BEFORE reading the month, so freshly-generated rows appear immediately.
    // Guarded so a generation hiccup never blocks the dashboard.
    try {
        await syncFixedExpenses();
    } catch {
        /* non-fatal */
    }
    const data = await getDashboardData();

    return <DashboardShell data={data}>{children}</DashboardShell>;
}
