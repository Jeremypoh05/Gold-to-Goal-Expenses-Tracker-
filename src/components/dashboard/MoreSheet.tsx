'use client';

// ADDED (mobile nav): "More" hub — a bottom sheet of secondary destinations
// opened from the bottom-bar More tab. Keeps the tab bar at 5 items (centered
// mic intact) while scaling for future modules. Mechanics mirror
// ManualAddModal's MobileModal (AnimatePresence + drag-to-dismiss + ESC +
// scroll-lock) for a consistent feel.

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
    WalletIcon,
    MicIcon,
    SettingsIcon,
    ChevronIcon,
} from '@/components/icons';

interface MoreItem {
    href: string;
    label: string;
    sub: string;
    Icon: React.ComponentType<{ size?: number; className?: string }>;
    soon?: boolean; // not yet built (Phase 6/7) — shown disabled, no dead link
}

const MORE_ITEMS: MoreItem[] = [
    { href: '/income', label: 'Income & savings', sub: 'Salary, bonuses, goals', Icon: WalletIcon },
    { href: '/voice', label: 'Voice log', sub: 'Review voice entries', Icon: MicIcon, soon: true },
    { href: '/settings', label: 'Settings', sub: 'Account & preferences', Icon: SettingsIcon, soon: true },
];

export function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
    const pathname = usePathname();

    // ESC closes
    useEffect(() => {
        if (!open) return;
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [open, onClose]);

    // Lock body scroll while open
    useEffect(() => {
        if (open) document.body.style.overflow = 'hidden';
        else document.body.style.overflow = '';
        return () => {
            document.body.style.overflow = '';
        };
    }, [open]);

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    onClick={onClose}
                    className="md:hidden fixed inset-0 z-50 flex items-end justify-center"
                    style={{
                        background: 'rgba(30, 20, 5, 0.4)',
                        backdropFilter: 'blur(8px)',
                        WebkitBackdropFilter: 'blur(8px)',
                    }}
                >
                    <motion.div
                        initial={{ y: '100%' }}
                        animate={{ y: 0 }}
                        exit={{ y: '100%' }}
                        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                        drag="y"
                        dragConstraints={{ top: 0, bottom: 0 }}
                        dragElastic={0.2}
                        onDragEnd={(_, info) => {
                            if (info.offset.y > 100 || info.velocity.y > 500) onClose();
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="bg-white w-full rounded-t-[24px] relative overflow-hidden"
                        style={{
                            maxHeight: '80vh',
                            overflowY: 'auto',
                            paddingBottom: 'calc(24px + env(safe-area-inset-bottom))',
                            boxShadow: '0 -20px 60px -10px rgba(60, 40, 10, 0.3)',
                        }}
                    >
                        {/* Grab handle */}
                        <div className="flex justify-center pt-2.5 pb-1 sticky top-0 bg-white z-10">
                            <div className="w-10 h-1 rounded-full bg-line" />
                        </div>

                        {/* Header */}
                        <div className="px-5 pb-3 pt-1">
                            <div className="text-[10px] text-gold-900 uppercase tracking-[0.14em] font-semibold">
                                Menu
                            </div>
                            <h2 className="display mt-0.5" style={{ fontSize: 24, lineHeight: 1.1 }}>
                                More
                            </h2>
                        </div>

                        {/* Destination rows */}
                        <div className="px-3 pb-2 flex flex-col gap-1">
                            {MORE_ITEMS.map(({ href, label, sub, Icon, soon }) => {
                                const isActive = !soon && pathname === href;

                                const inner = (
                                    <>
                                        <div
                                            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                                            style={{
                                                background: isActive
                                                    ? 'linear-gradient(135deg, oklch(0.96 0.06 92), oklch(0.88 0.12 88))'
                                                    : 'var(--color-bg-1)',
                                                color: isActive
                                                    ? 'var(--color-gold-700)'
                                                    : 'var(--color-ink-1)',
                                            }}
                                        >
                                            <Icon size={18} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[14px] font-medium text-ink-0">{label}</div>
                                            <div className="text-[11px] text-ink-2">{sub}</div>
                                        </div>
                                        {soon ? (
                                            <span className="chip" style={{ fontSize: 10 }}>
                                                Soon
                                            </span>
                                        ) : (
                                            <ChevronIcon direction="right" size={16} className="text-ink-3" />
                                        )}
                                    </>
                                );

                                // Disabled (not-yet-built) rows render as a static div, not a link,
                                // so we never navigate to a 404.
                                if (soon) {
                                    return (
                                        <div
                                            key={href}
                                            className="flex items-center gap-3 px-3 py-2.5 rounded-2xl opacity-55 cursor-not-allowed"
                                        >
                                            {inner}
                                        </div>
                                    );
                                }

                                return (
                                    <Link
                                        key={href}
                                        href={href}
                                        onClick={onClose}
                                        className="flex items-center gap-3 px-3 py-2.5 rounded-2xl transition-colors active:bg-bg-1"
                                        style={{
                                            background: isActive ? 'var(--color-bg-1)' : 'transparent',
                                        }}
                                    >
                                        {inner}
                                    </Link>
                                );
                            })}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
