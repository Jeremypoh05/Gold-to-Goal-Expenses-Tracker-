'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
    HomeIcon,
    CalendarIcon,
    GridIcon,
    PlusIcon,
    MicIcon,
} from '@/components/icons';
import { cn } from '@/lib/utils';
import { useAddModal } from './AddModalContext';

interface TabItem {
    href: string;
    label: string;
    Icon: React.ComponentType<{ size?: number; className?: string }>;
    isCenter?: boolean;
    isAction?: boolean; // ← if true, opens modal instead of navigating
}

const TAB_ITEMS: TabItem[] = [
    { href: '/dashboard', label: 'Home', Icon: HomeIcon },
    { href: '/calendar', label: 'Calendar', Icon: CalendarIcon },
    { href: '/voice', label: '', Icon: MicIcon, isCenter: true },
    { href: '/ledger', label: 'Ledger', Icon: GridIcon },
    { href: '#add', label: 'Add', Icon: PlusIcon, isAction: true },
];

export function BottomTabBar() {
    const pathname = usePathname();
    const { open: openAddModal } = useAddModal();

    return (
        <div
            className="md:hidden fixed left-3.5 right-3.5 bottom-5 h-16 rounded-[28px] flex items-center justify-around z-30"
            style={{
                background: 'rgba(255, 255, 255, 0.75)',
                backdropFilter: 'blur(24px) saturate(1.6)',
                WebkitBackdropFilter: 'blur(24px) saturate(1.6)',
                border: '1px solid rgba(255, 255, 255, 0.8)',
                boxShadow: '0 12px 36px -8px rgba(60, 40, 10, 0.2)',
            }}
        >
            {TAB_ITEMS.map((item) => {
                const isActive =
                    !item.isAction &&
                    (pathname === item.href ||
                        pathname?.startsWith(item.href + '/'));

                // Center voice button (special)
                if (item.isCenter) {
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className="w-14 h-14 rounded-full flex items-center justify-center border-0 -mt-5 transition-transform hover:scale-105"
                            style={{
                                background:
                                    'linear-gradient(135deg, oklch(0.88 0.13 92), oklch(0.64 0.16 78))',
                                boxShadow: '0 6px 20px -2px oklch(0.65 0.16 78 / 0.55)',
                            }}
                            aria-label="Voice log"
                        >
                            <item.Icon size={24} className="text-[#1a120a]" />
                        </Link>
                    );
                }

                // Action button (Add) — opens modal, doesn't navigate
                if (item.isAction) {
                    return (
                        <button
                            key={item.href}
                            onClick={openAddModal}
                            type="button"
                            className="flex flex-col items-center gap-0.5 border-0 bg-transparent p-1.5 text-ink-2 hover:text-ink-1 transition-colors"
                        >
                            <item.Icon size={22} />
                            <span className="text-[9.5px] font-medium">{item.label}</span>
                        </button>
                    );
                }

                // Regular tab (navigates)
                return (
                    <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                            'flex flex-col items-center gap-0.5 border-0 bg-transparent p-1.5 transition-colors',
                            isActive ? 'text-gold-700' : 'text-ink-2 hover:text-ink-1'
                        )}
                    >
                        <item.Icon size={22} />
                        <span className="text-[9.5px] font-medium">{item.label}</span>
                    </Link>
                );
            })}
        </div>
    );
}