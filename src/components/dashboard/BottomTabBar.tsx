'use client';

import { useState } from 'react'; // ADDED: local state for the More sheet
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
    HomeIcon,
    CalendarIcon,
    GridIcon,
    MoreIcon, // CHANGED: was PlusIcon (Add) — Add now lives in the mobile header "+"
    MicIcon,
} from '@/components/icons';
import { cn } from '@/lib/utils';
import { MoreSheet } from './MoreSheet'; // ADDED
import { useVoice } from '@/components/voice'; // ADDED (Phase 6.1): open voice modal

// Destinations reachable from the More sheet — used to keep the More tab
// highlighted while the user is on one of them.
const MORE_ROUTES = ['/income', '/voice', '/settings'];

interface TabItem {
    href: string;
    label: string;
    Icon: React.ComponentType<{ size?: number; className?: string }>;
    isCenter?: boolean;
    isMore?: boolean; // CHANGED: was isAction (opened Add modal) — now opens the More sheet
}

const TAB_ITEMS: TabItem[] = [
    { href: '/dashboard', label: 'Home', Icon: HomeIcon },
    { href: '/calendar', label: 'Calendar', Icon: CalendarIcon },
    { href: '/voice', label: '', Icon: MicIcon, isCenter: true },
    { href: '/ledger', label: 'Ledger', Icon: GridIcon },
    // CHANGED: Add → More. Manual Add stays available via the header "+" (TopBar).
    { href: '#more', label: 'More', Icon: MoreIcon, isMore: true },
];

export function BottomTabBar() {
    const pathname = usePathname();
    const [moreOpen, setMoreOpen] = useState(false); // ADDED
    const { openModal: openVoiceModal } = useVoice(); // ADDED (Phase 6.1)

    return (
        <>
            <div
                className="md:hidden fixed left-3.5 right-3.5 bottom-5 h-16 rounded-[28px] flex items-center justify-around z-30"
                style={{
                    background: 'var(--surface-glass-strong)',
                    backdropFilter: 'blur(24px) saturate(1.6)',
                    WebkitBackdropFilter: 'blur(24px) saturate(1.6)',
                    border: '1px solid var(--surface-glass-border)',
                    boxShadow: '0 12px 36px -8px rgba(60, 40, 10, 0.2)',
                }}
            >
                {TAB_ITEMS.map((item) => {
                    const isActive =
                        !item.isMore &&
                        (pathname === item.href ||
                            pathname?.startsWith(item.href + '/'));

                    // Center voice button — CHANGED (Phase 6.1): opens the global voice
                    // capture modal instead of navigating to /voice (quick talk anywhere).
                    if (item.isCenter) {
                        return (
                            <button
                                key={item.href}
                                type="button"
                                onClick={openVoiceModal}
                                // CHANGED (Slice 1 polish): breathing glow invites the tap,
                                // mirroring the desktop mic's pulse (user feedback).
                                className="mic-glow w-14 h-14 rounded-full flex items-center justify-center border-0 -mt-5 transition-transform hover:scale-105"
                                style={{
                                    background:
                                        'linear-gradient(135deg, oklch(0.88 0.13 92), oklch(0.64 0.16 78))',
                                }}
                                aria-label="Voice log"
                            >
                                <item.Icon size={24} className="text-[#1a120a]" />
                            </button>
                        );
                    }

                    // CHANGED: More button — opens the secondary-destinations sheet instead
                    // of navigating. Highlights while the sheet is open or the user is on a
                    // More destination (e.g. /income).
                    if (item.isMore) {
                        const moreActive =
                            moreOpen ||
                            MORE_ROUTES.some(
                                (r) => pathname === r || pathname?.startsWith(r + '/')
                            );
                        return (
                            <button
                                key={item.href}
                                onClick={() => setMoreOpen(true)}
                                type="button"
                                aria-label="More"
                                aria-expanded={moreOpen}
                                className={cn(
                                    'flex flex-col items-center gap-0.5 border-0 bg-transparent p-1.5 transition-colors',
                                    moreActive ? 'text-gold-700' : 'text-ink-2 hover:text-ink-1'
                                )}
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

            {/* ADDED: the More hub sheet */}
            <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
        </>
    );
}
