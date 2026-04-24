'use client';

import { ChevronIcon, PlusIcon, BellIcon } from '@/components/icons';
import { MONTH_NAMES } from '@/lib/utils';
import { useGreeting } from '@/hooks/useGreeting';

interface TopBarProps {
    month: number;
    year: number;
    onMonthChange: (delta: number) => void;
}

function SearchIcon({ size = 14 }: { size?: number }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
        >
            <circle cx="11" cy="11" r="6" />
            <path d="M20 20 L16 16" />
        </svg>
    );
}

export function TopBar({ month, year, onMonthChange }: TopBarProps) {
    const today = new Date();
    const isCurrentMonth =
        today.getMonth() + 1 === month && today.getFullYear() === year;

    const todayBadge = `Today · ${MONTH_NAMES[today.getMonth()]} ${today.getDate()}`;
    const greeting = useGreeting('Amelia');

    return (
        <div
            className="border-b border-line-soft sticky top-0 z-30"
            style={{
                background: 'rgba(255, 255, 255, 0.5)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
            }}
        >
            {/* ═══════════════════════════════════════════════════
          MOBILE LAYOUT (< md): Two-row stacked
          Row 1: [AC] Greeting     [🔔]
          Row 2: ← Apr 2026 →   [Today chip]
          ═══════════════════════════════════════════════════ */}
            <div className="md:hidden">
                {/* Row 1: User greeting + Bell */}
                <div className="flex items-center gap-3 px-4 pt-3 pb-2">
                    <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-semibold flex-shrink-0"
                        style={{
                            background: 'oklch(0.85 0.10 40)',
                            color: '#5a2a10',
                        }}
                    >
                        AC
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-[11px] text-ink-2 leading-tight">
                            {greeting.emoji} {greeting.text.split(',')[0]}
                        </div>
                        <div className="text-[15px] font-semibold text-ink-0 truncate leading-tight">
                            Amelia
                        </div>
                    </div>

                    {/* Quick add button */}
                    <button
                        className="w-10 h-10 flex items-center justify-center rounded-xl border border-line bg-white hover:border-ink-2 transition-all"
                        aria-label="Add expense"
                    >
                        <PlusIcon size={18} />
                    </button>

                    {/* Bell with notification dot */}
                    <div className="relative">
                        <button
                            className="w-10 h-10 flex items-center justify-center rounded-xl border border-line-soft bg-white text-ink-1 hover:bg-bg-2 transition-colors"
                            aria-label="Notifications"
                        >
                            <BellIcon size={18} />
                        </button>
                        <div
                            className="absolute top-2 right-2 w-2 h-2 rounded-full bg-gold-500"
                            style={{ border: '2px solid white' }}
                        />
                    </div>
                </div>

                {/* Row 2: Month switcher + Today badge */}
                <div className="flex items-center gap-2 px-4 pb-3">
                    <button
                        onClick={() => onMonthChange(-1)}
                        className="w-8 h-8 flex items-center justify-center rounded-full text-ink-1 hover:bg-bg-2 transition-colors"
                        aria-label="Previous month"
                    >
                        <ChevronIcon direction="left" size={14} />
                    </button>

                    <div className="display text-[18px] leading-none whitespace-nowrap">
                        {MONTH_NAMES[month - 1]} {year}
                    </div>

                    <button
                        onClick={() => onMonthChange(1)}
                        className="w-8 h-8 flex items-center justify-center rounded-full text-ink-1 hover:bg-bg-2 transition-colors"
                        aria-label="Next month"
                    >
                        <ChevronIcon direction="right" size={14} />
                    </button>

                    {isCurrentMonth && (
                        <div className="chip ml-1">
                            <span className="dot" style={{ background: 'var(--color-gold-500)' }} />
                            {todayBadge}
                        </div>
                    )}
                </div>
            </div>

            {/* ═══════════════════════════════════════════════════
          DESKTOP / TABLET LAYOUT (md+): Single row
          ═══════════════════════════════════════════════════ */}
            <div className="hidden md:flex items-center gap-3 px-8 py-[18px]">
                {/* Month switcher + Today */}
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => onMonthChange(-1)}
                        className="w-8 h-8 flex items-center justify-center rounded-full text-ink-1 hover:bg-bg-2 transition-colors"
                        aria-label="Previous month"
                    >
                        <ChevronIcon direction="left" size={16} />
                    </button>

                    <div className="display text-[22px] leading-none whitespace-nowrap">
                        {MONTH_NAMES[month - 1]} {year}
                    </div>

                    <button
                        onClick={() => onMonthChange(1)}
                        className="w-8 h-8 flex items-center justify-center rounded-full text-ink-1 hover:bg-bg-2 transition-colors"
                        aria-label="Next month"
                    >
                        <ChevronIcon direction="right" size={16} />
                    </button>

                    {isCurrentMonth && (
                        <div className="chip ml-2">
                            <span className="dot" style={{ background: 'var(--color-gold-500)' }} />
                            {todayBadge}
                        </div>
                    )}
                </div>

                <div className="flex-1" />

                {/* Search - lg+ only */}
                <div className="relative hidden lg:block">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-2 pointer-events-none">
                        <SearchIcon size={14} />
                    </div>
                    <input
                        placeholder="Search expenses, notes, categories…"
                        className="border border-line bg-white py-[9px] pl-[34px] pr-3.5 rounded-[10px] text-[13px] w-[280px] outline-none focus:border-gold-400 transition-colors"
                    />
                </div>

                <button className="flex items-center gap-2 h-10 px-[18px] rounded-full border border-line bg-white text-sm font-medium hover:border-ink-2 transition-all">
                    <PlusIcon size={16} />
                    <span>New</span>
                </button>

                <div className="relative">
                    <button
                        className="w-9 h-9 flex items-center justify-center rounded-full text-ink-1 hover:bg-bg-2 transition-colors"
                        aria-label="Notifications"
                    >
                        <BellIcon size={18} />
                    </button>
                    <div
                        className="absolute top-[7px] right-[7px] w-[7px] h-[7px] rounded-full bg-gold-500"
                        style={{ border: '2px solid rgba(255, 255, 255, 0.5)' }}
                    />
                </div>
            </div>
        </div>
    );
}