'use client';

import { useState } from 'react';
import { Sidebar, type NavKey } from '@/components/dashboard/Sidebar';
import { BottomTabBar } from '@/components/dashboard/BottomTabBar';
import { TopBar } from '@/components/dashboard/TopBar';
import { Orbs } from '@/components/shared';
import { CURRENT } from '@/data/sampleExpenses';

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const [activeNav, setActiveNav] = useState<NavKey>('dashboard');
    const [month, setMonth] = useState(CURRENT.month);
    const [year, setYear] = useState(CURRENT.year);

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
        <div className="h-screen flex relative bg-bg-0 overflow-hidden">
            <Orbs count={3} />

            {/* ─── Sidebar: HIDDEN on mobile, visible lg+ ─── */}
            <div className="hidden lg:block flex-shrink-0 relative z-20">
                <Sidebar activeNav={activeNav} onNavChange={setActiveNav} />
            </div>

            {/* ─── Right side: TopBar + main content ─── */}
            <div className="flex-1 flex flex-col relative z-10 min-w-0">
                <TopBar month={month} year={year} onMonthChange={handleMonthChange} />

                {/* Scrollable main - extra bottom padding on mobile for tab bar */}
                <main className="flex-1 overflow-y-auto pb-24 lg:pb-0">
                    {children}
                </main>
            </div>

            {/* ─── Bottom Tab Bar: visible on mobile, HIDDEN on lg+ ─── */}
            <BottomTabBar activeNav={activeNav} onNavChange={setActiveNav} />
        </div>
    );
}