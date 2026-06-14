'use client';

// ADDED (Phase 8): the interactive dashboard shell, split out of layout.tsx so the
// layout itself can be a server component that fetches data + ensures the user row.
// This wraps children in ExpensesProvider so every page reads real DB data.
import { useState } from 'react';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { BottomTabBar } from '@/components/dashboard/BottomTabBar';
import { TopBar } from '@/components/dashboard/TopBar';
import { Orbs } from '@/components/shared';
import { AddModalProvider } from '@/components/dashboard/AddModalContext';
import { ManualAddModal } from '@/components/dashboard/ManualAddModal';
import { VoiceProvider, VoiceModal, VoiceToast } from '@/components/voice';
import { ExpensesProvider } from '@/components/data/ExpensesContext';
import type { DashboardData } from '@/lib/queries';

export function DashboardShell({
    data,
    children,
}: {
    data: DashboardData;
    children: React.ReactNode;
}) {
    const [month, setMonth] = useState(data.current.month);
    const [year, setYear] = useState(data.current.year);

    const handleMonthChange = (delta: number) => {
        let newMonth = month + delta;
        let newYear = year;
        if (newMonth < 1) {
            newMonth = 12;
            newYear -= 1;
        } else if (newMonth > 12) {
            newMonth = 1;
            newYear += 1;
        }
        setMonth(newMonth);
        setYear(newYear);
    };

    return (
        <ExpensesProvider value={data}>
            <AddModalProvider>
                <VoiceProvider>
                    <div className="h-screen flex relative bg-bg-0 overflow-hidden">
                        <Orbs count={3} />

                        {/* Sidebar - md+ only */}
                        <div className="hidden md:block flex-shrink-0 relative z-20">
                            <Sidebar />
                        </div>

                        {/* Right side */}
                        <div className="flex-1 flex flex-col relative z-10 min-w-0">
                            <TopBar month={month} year={year} onMonthChange={handleMonthChange} />
                            <main className="flex-1 overflow-y-auto pb-24 md:pb-0">{children}</main>
                        </div>

                        {/* Bottom tab - mobile only */}
                        <BottomTabBar />

                        {/* Modal — rendered once, controlled by context */}
                        <ManualAddModal />

                        {/* Global voice capture modal + save toast */}
                        <VoiceModal />
                        <VoiceToast />
                    </div>
                </VoiceProvider>
            </AddModalProvider>
        </ExpensesProvider>
    );
}
