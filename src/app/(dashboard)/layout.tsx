// CHANGED (Phase 8): now a Server Component. It ensures the signed-in user's DB row
// exists, fetches their current-month data, and seeds the client DashboardShell (which
// holds the interactive shell + ExpensesProvider). The old client body moved to
// DashboardShell.tsx.
import { getDashboardData } from '@/lib/queries';
import { DashboardShell } from '@/components/dashboard/DashboardShell';

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const data = await getDashboardData();

    return <DashboardShell data={data}>{children}</DashboardShell>;
}
