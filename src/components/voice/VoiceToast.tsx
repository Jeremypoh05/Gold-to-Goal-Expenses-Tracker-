'use client';

// ADDED (Phase 6.1): save confirmation toast. Appears after a voice save with
// quick links to review the entry; auto-dismisses (~5s, handled by the provider)
// and has a manual close. Bottom-centre above the tab bar on mobile, bottom-right
// on desktop.

import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { useVoice } from './VoiceContext';
import { formatMoney } from '@/lib/utils';

function CloseIcon({ size = 12 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6 L18 18 M18 6 L6 18" />
        </svg>
    );
}

export function VoiceToast() {
    const { toast, dismissToast } = useVoice();

    return (
        <AnimatePresence>
            {toast && (
                <motion.div
                    initial={{ opacity: 0, y: 24, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 24, scale: 0.96 }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    className="fixed z-[60] left-1/2 -translate-x-1/2 bottom-24 w-[calc(100%-28px)] max-w-[420px] md:left-auto md:right-6 md:translate-x-0 md:bottom-6 md:w-[360px]"
                >
                    <div
                        className="rounded-2xl p-3.5 flex items-center gap-3"
                        style={{
                            background: 'var(--color-bg-card)',
                            border: '1px solid var(--color-line-soft)',
                            boxShadow: 'var(--shadow-lg)',
                        }}
                    >
                        {/* Success badge */}
                        <div
                            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                            style={{ background: 'oklch(0.94 0.09 160)', color: 'oklch(0.45 0.10 160)' }}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M5 12 L10 17 L19 7" />
                            </svg>
                        </div>

                        <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-semibold">
                                Logged · <span className="mono">{formatMoney(toast.amt, toast.currency)}</span>
                            </div>
                            <div className="flex items-center gap-3 mt-0.5">
                                <Link href="/ledger" onClick={dismissToast} className="text-[12px] font-medium text-gold-700 hover:underline">
                                    View in Ledger
                                </Link>
                                <Link href="/voice" onClick={dismissToast} className="text-[12px] font-medium text-ink-2 hover:underline">
                                    Voice logs
                                </Link>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={dismissToast}
                            aria-label="Dismiss"
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-2 hover:bg-bg-1 transition-colors flex-shrink-0"
                        >
                            <CloseIcon size={12} />
                        </button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
