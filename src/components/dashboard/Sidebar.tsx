'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
    HomeIcon,
    MicIcon,
    GridIcon,
    CalendarIcon,
    WalletIcon,
    RepeatIcon,
    SparkleIcon,
} from '@/components/icons';
import { cn, formatMoney, MONTH_NAMES } from '@/lib/utils';
import { CATEGORIES } from '@/data/categories';
import { useExpenses } from '@/components/data/ExpensesContext';
import { totalSpent, expensesByCategory } from '@/lib/expense-utils';
import type { CategoryKey } from '@/types';
// ADDED (Phase 7 · Auth): real user account row + explicit sign-out.
import { UserButton, useUser, useClerk } from '@clerk/nextjs';

// Small logout glyph (door + arrow) — kept local to the sidebar.
function LogOutIcon({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
            <path d="M10 17l-5-5 5-5M4 12h11" />
        </svg>
    );
}

// ─────────────────────────────────────────────────────────────
// Navigation item type
// ─────────────────────────────────────────────────────────────
interface NavItem {
    href: string;
    label: string;
    Icon: React.ComponentType<{ size?: number; className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
    { href: '/dashboard', label: 'Dashboard', Icon: HomeIcon },
    { href: '/ledger', label: 'Ledger', Icon: GridIcon },
    { href: '/calendar', label: 'Calendar', Icon: CalendarIcon },
    { href: '/income', label: 'Income', Icon: WalletIcon },
    { href: '/fixed', label: 'Fixed', Icon: RepeatIcon },
    { href: '/voice', label: 'Voice log', Icon: MicIcon },
];

export function Sidebar() {
    const pathname = usePathname();
    const { user } = useUser(); // ADDED (Phase 7): signed-in user
    const { signOut } = useClerk(); // ADDED (Phase 7): explicit sign-out

    // CHANGED (Phase 8.1): real, deterministic insight from this month's data
    // (replaces the hardcoded "32% less … April" placeholder). True AI tips land in Phase 9.
    const { current, expenses } = useExpenses();
    const monthName = MONTH_NAMES[current.month - 1];
    const total = totalSpent(expenses);
    const topCat = (
        Object.entries(expensesByCategory(expenses)) as [CategoryKey, number][]
    ).sort((a, b) => b[1] - a[1])[0];

    return (
        <aside
            className="w-[220px] h-screen flex flex-col px-[14px] py-5 border-r border-line-soft relative z-20"
            style={{
                background: 'var(--surface-glass-soft)',
                backdropFilter: 'blur(20px)',
            }}
        >
            {/* Logo */}
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
                    <div className="display text-[18px] leading-none">Honey</div>
                    <div className="text-[10px] uppercase tracking-[0.1em] text-ink-2 mt-0.5">
                        expense tracker
                    </div>
                </div>
            </div>

            {/* Navigation */}
            <nav className="flex flex-col gap-0.5">
                {NAV_ITEMS.map(({ href, label, Icon }) => {
                    const isActive = pathname === href;
                    return (
                        <Link
                            key={href}
                            href={href}
                            className={cn(
                                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13.5px] font-medium transition-all',
                                isActive
                                    ? 'bg-bg-card text-ink-0 shadow-sm'
                                    : 'bg-transparent text-ink-1 hover:bg-white/40'
                            )}
                        >
                            <Icon size={18} />
                            <span>{label}</span>
                            {isActive && (
                                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-gold-500" />
                            )}
                        </Link>
                    );
                })}
            </nav>

            <div className="flex-1" />

            {/* AI Tip */}
            <div
                className="rounded-[18px] p-[14px] mb-2"
                style={{
                    background: 'linear-gradient(135deg, var(--grad-soft-a), var(--grad-soft-b))',
                    border: '1px solid oklch(0.88 0.08 88)',
                }}
            >
                <div className="flex items-center gap-1.5 mb-1.5">
                    <SparkleIcon size={14} className="text-gold-700" />
                    <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-on-soft">
                        AI tip
                    </span>
                </div>
                <p className="text-xs leading-[1.4] text-ink-1 m-0">
                    {topCat ? (
                        <>
                            Your top category in {monthName} is{' '}
                            <b>{CATEGORIES[topCat[0]].label}</b> at{' '}
                            <b>{formatMoney(topCat[1])}</b> —{' '}
                            {Math.round((topCat[1] / total) * 100)}% of {formatMoney(total)}{' '}
                            across {expenses.length}{' '}
                            {expenses.length === 1 ? 'entry' : 'entries'}.
                        </>
                    ) : (
                        <>No expenses logged yet in {monthName}. Tap <b>+</b> or the mic to start.</>
                    )}
                </p>
            </div>

            {/* Account — CHANGED (Phase 7): real Clerk user. Clicking the avatar opens
                Clerk's menu (manage account + sign out). */}
            <div className="flex items-center gap-2.5 px-1.5 pt-3.5 pb-1 border-t border-line-soft">
                <UserButton
                    appearance={{ elements: { avatarBox: 'w-[30px] h-[30px]' } }}
                />
                <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">
                        {user?.fullName ?? user?.firstName ?? 'Account'}
                    </div>
                    <div className="text-[10px] text-ink-2 truncate">
                        {user?.primaryEmailAddress?.emailAddress ?? 'Manage account'}
                    </div>
                </div>
                {/* ADDED (Phase 7): explicit sign-out (the UserButton menu is the other path,
                    but its avatar can collide with the dev-tools button in the corner). */}
                <button
                    type="button"
                    onClick={() => signOut({ redirectUrl: '/sign-in' })}
                    aria-label="Sign out"
                    title="Sign out"
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-2 hover:text-ink-0 hover:bg-bg-2 transition-colors flex-shrink-0"
                >
                    <LogOutIcon size={16} />
                </button>
            </div>
        </aside>
    );
}