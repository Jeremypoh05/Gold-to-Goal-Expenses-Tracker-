'use client';

import {
    HomeIcon,
    MicIcon,
    GridIcon,
    CalendarIcon,
    WalletIcon,
    SettingsIcon,
    SparkleIcon,
} from '@/components/icons';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────
// Navigation item type — order matches design: Dashboard, Ledger,
// Calendar, Income, Voice log (voice at BOTTOM, not second)
// ─────────────────────────────────────────────────────────────
export type NavKey = 'dashboard' | 'ledger' | 'calendar' | 'income' | 'voice';

interface NavItem {
    key: NavKey;
    label: string;
    Icon: React.ComponentType<{ size?: number; className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
    { key: 'dashboard', label: 'Dashboard', Icon: HomeIcon },
    { key: 'ledger', label: 'Ledger', Icon: GridIcon },
    { key: 'calendar', label: 'Calendar', Icon: CalendarIcon },
    { key: 'income', label: 'Income', Icon: WalletIcon },
    { key: 'voice', label: 'Voice log', Icon: MicIcon },
];

interface SidebarProps {
    activeNav: NavKey;
    onNavChange: (key: NavKey) => void;
}

export function Sidebar({ activeNav, onNavChange }: SidebarProps) {
    return (
        <aside
            className="w-[220px] h-screen flex flex-col px-[14px] py-5 border-r border-line-soft relative z-20"
            style={{
                background: 'rgba(255, 255, 255, 0.55)',
                backdropFilter: 'blur(20px)',
            }}
        >
            {/* ─── Logo / Brand ─── */}
            <div className="flex items-center gap-2.5 px-2.5 pb-5">
                <div
                    className="w-8 h-8 rounded-[10px] flex items-center justify-center shadow-gold"
                    style={{
                        background: 'linear-gradient(135deg, oklch(0.85 0.14 90), oklch(0.65 0.16 78))',
                    }}
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="#1a120a">
                        <path d="M12 2 L13.5 9 L20 10.5 L13.5 12 L12 19 L10.5 12 L4 10.5 L10.5 9 Z" />
                    </svg>
                </div>
                <div>
                    <div className="serif text-[18px] leading-none">Honey</div>
                    <div className="text-[10px] uppercase tracking-[0.1em] text-ink-2 mt-0.5">
                        expense tracker
                    </div>
                </div>
            </div>

            {/* ─── Navigation ─── */}
            <nav className="flex flex-col gap-0.5">
                {NAV_ITEMS.map(({ key, label, Icon }) => {
                    const isActive = activeNav === key;
                    return (
                        <button
                            key={key}
                            onClick={() => onNavChange(key)}
                            className={cn(
                                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13.5px] font-medium transition-all text-left w-full',
                                isActive
                                    ? 'bg-white text-ink-0 shadow-sm'
                                    : 'bg-transparent text-ink-1 hover:bg-white/40'
                            )}
                        >
                            <Icon size={18} />
                            <span>{label}</span>
                            {isActive && (
                                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-gold-500" />
                            )}
                        </button>
                    );
                })}
            </nav>

            {/* Spacer pushes content below to bottom */}
            <div className="flex-1" />

            {/* ─── AI Tip Card (Bottom) ─── */}
            <div
                className="rounded-[18px] p-[14px] mb-2"
                style={{
                    background: 'linear-gradient(135deg, oklch(0.98 0.03 92), oklch(0.93 0.08 88))',
                    border: '1px solid oklch(0.88 0.08 88)',
                }}
            >
                <div className="flex items-center gap-1.5 mb-1.5">
                    <SparkleIcon size={14} className="text-gold-700" />
                    <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-gold-900">
                        AI tip
                    </span>
                </div>
                <p className="text-xs leading-[1.4] text-ink-1 m-0">
                    You spent <b>32% less</b> on Shopping this month. Keep going — you&apos;re
                    on track to save <b>S$960</b> more in April.
                </p>
            </div>

            {/* ─── User profile ─── */}
            <div className="flex items-center gap-2.5 px-1.5 pt-3.5 pb-1 border-t border-line-soft">
                <div
                    className="w-[30px] h-[30px] rounded-[10px] flex items-center justify-center text-xs font-semibold"
                    style={{
                        background: 'oklch(0.85 0.10 40)',
                        color: '#5a2a10',
                    }}
                >
                    AC
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">Amelia Chan</div>
                    <div className="text-[10px] text-ink-2">Pro · Clerk auth</div>
                </div>
                <SettingsIcon size={16} className="text-ink-2" />
            </div>
        </aside>
    );
}