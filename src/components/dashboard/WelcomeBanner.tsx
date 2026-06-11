'use client';

// ADDED (Phase 7 · Auth): one-time welcome shown after sign-up. Clerk redirects
// new users to /dashboard?welcome=1; this dismissible banner reads that flag.
// Must be wrapped in <Suspense> by the caller (useSearchParams requirement).

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useUser } from '@clerk/nextjs';
import { SparkleIcon } from '@/components/icons';

export function WelcomeBanner() {
    const params = useSearchParams();
    const { user } = useUser();
    const [dismissed, setDismissed] = useState(false);

    const show = params.get('welcome') === '1' && !dismissed;

    return (
        <AnimatePresence>
            {show && (
                <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                    className="grad-gold-soft rounded-2xl p-4 flex items-center gap-3"
                    style={{ border: '1px solid oklch(0.88 0.08 88)' }}
                >
                    <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{
                            background:
                                'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.65 0.155 78))',
                        }}
                    >
                        <SparkleIcon size={18} className="text-[#1a120a]" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-semibold" style={{ color: 'var(--color-on-soft)' }}>
                            Welcome to Honey{user?.firstName ? `, ${user.firstName}` : ''} 🎉
                        </div>
                        <div className="text-[12px] text-ink-1">
                            Tap the mic to log your first expense by voice — or add one by hand.
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setDismissed(true)}
                        aria-label="Dismiss welcome"
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-2 hover:bg-bg-1 transition-colors flex-shrink-0"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M6 6 L18 18 M18 6 L6 18" />
                        </svg>
                    </button>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
