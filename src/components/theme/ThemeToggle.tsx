'use client';

// ADDED (Dark mode): sun/moon toggle button. Token-based styling so it themes
// itself. Lives in the TopBar (desktop) + mobile header.

import { motion, AnimatePresence } from 'framer-motion';
import { SunIcon, MoonIcon } from '@/components/icons';
import { useTheme } from './ThemeProvider';

export function ThemeToggle({ size = 36 }: { size?: number }) {
    const { theme, toggle } = useTheme();
    const dark = theme === 'dark';

    return (
        <button
            type="button"
            onClick={toggle}
            aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
            title={dark ? 'Switch to light' : 'Switch to dark'}
            className="flex items-center justify-center rounded-xl border border-line-soft bg-bg-card hover:bg-bg-2 transition-colors relative overflow-hidden"
            style={{ width: size, height: size, boxShadow: 'var(--shadow-sm)' }}
        >
            <AnimatePresence mode="wait" initial={false}>
                <motion.span
                    key={dark ? 'moon' : 'sun'}
                    initial={{ opacity: 0, rotate: -45, scale: 0.6 }}
                    animate={{ opacity: 1, rotate: 0, scale: 1 }}
                    exit={{ opacity: 0, rotate: 45, scale: 0.6 }}
                    transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                    className="inline-flex"
                >
                    {dark ? (
                        <MoonIcon size={Math.round(size * 0.5)} className="text-gold-400" />
                    ) : (
                        <SunIcon size={Math.round(size * 0.5)} className="text-gold-600" />
                    )}
                </motion.span>
            </AnimatePresence>
        </button>
    );
}
