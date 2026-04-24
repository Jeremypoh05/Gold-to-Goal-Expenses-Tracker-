'use client';

import {
    HomeIcon,
    CalendarIcon,
    GridIcon,
    PlusIcon,
    MicIcon,
} from '@/components/icons';
import type { NavKey } from './Sidebar';
import { cn } from '@/lib/utils';

interface TabItem {
    key: NavKey | 'add';
    label: string;
    Icon: React.ComponentType<{ size?: number; className?: string }>;
    isCenter?: boolean;
}

const TAB_ITEMS: TabItem[] = [
    { key: 'dashboard', label: 'Home', Icon: HomeIcon },
    { key: 'calendar', label: 'Calendar', Icon: CalendarIcon },
    { key: 'voice', label: '', Icon: MicIcon, isCenter: true },
    { key: 'ledger', label: 'Ledger', Icon: GridIcon },
    { key: 'add', label: 'Add', Icon: PlusIcon },
];

interface BottomTabBarProps {
    activeNav: NavKey;
    onNavChange: (key: NavKey) => void;
}

/**
 * Mobile-only floating bottom tab bar.
 * - Hidden on lg+ screens (sidebar takes over)
 * - Center "voice" button is larger and elevated
 */
export function BottomTabBar({ activeNav, onNavChange }: BottomTabBarProps) {
    return (
        <div
            className="lg:hidden fixed left-3.5 right-3.5 bottom-5 h-16 rounded-[28px] flex items-center justify-around z-30"
            style={{
                background: 'rgba(255, 255, 255, 0.75)',
                backdropFilter: 'blur(24px) saturate(1.6)',
                WebkitBackdropFilter: 'blur(24px) saturate(1.6)',
                border: '1px solid rgba(255, 255, 255, 0.8)',
                boxShadow: '0 12px 36px -8px rgba(60, 40, 10, 0.2)',
            }}
        >
            {TAB_ITEMS.map((item) => {
                const isActive = activeNav === item.key;

                // ─── Center voice button (special) ───
                if (item.isCenter) {
                    return (
                        <button
                            key={item.key}
                            onClick={() => onNavChange(item.key as NavKey)}
                            className="w-14 h-14 rounded-full flex items-center justify-center cursor-pointer border-0 -mt-5 transition-transform hover:scale-105"
                            style={{
                                background: 'linear-gradient(135deg, oklch(0.88 0.13 92), oklch(0.64 0.16 78))',
                                boxShadow: '0 6px 20px -2px oklch(0.65 0.16 78 / 0.55)',
                            }}
                            aria-label="Voice log"
                        >
                            <item.Icon size={24} className="text-[#1a120a]" />
                        </button>
                    );
                }

                // ─── Regular tab ───
                return (
                    <button
                        key={item.key}
                        onClick={() => onNavChange(item.key as NavKey)}
                        className={cn(
                            'flex flex-col items-center gap-0.5 cursor-pointer border-0 bg-transparent p-1.5 transition-colors',
                            isActive ? 'text-gold-700' : 'text-ink-2 hover:text-ink-1'
                        )}
                    >
                        <item.Icon size={22} />
                        <span className="text-[9.5px] font-medium">{item.label}</span>
                    </button>
                );
            })}
        </div>
    );
}