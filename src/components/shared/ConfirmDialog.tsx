'use client';

// ADDED (Module 4 · UX): a global promise-based confirm dialog so destructive
// actions (deleting an expense / a recurring rule) always ask first. Usage:
//   const confirm = useConfirm();
//   if (await confirm({ title, message, confirmLabel, danger: true })) { …delete… }
// Provider is mounted once in DashboardShell.

import {
    createContext,
    useContext,
    useState,
    useCallback,
    useRef,
    useEffect,
    type ReactNode,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface ConfirmOptions {
    title: string;
    message?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
    const [opts, setOpts] = useState<ConfirmOptions | null>(null);
    const resolver = useRef<((v: boolean) => void) | null>(null);

    const confirm = useCallback<ConfirmFn>((o) => {
        return new Promise<boolean>((resolve) => {
            resolver.current = resolve;
            setOpts(o);
        });
    }, []);

    const settle = useCallback((v: boolean) => {
        resolver.current?.(v);
        resolver.current = null;
        setOpts(null);
    }, []);

    // ESC cancels
    useEffect(() => {
        if (!opts) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') settle(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [opts, settle]);

    return (
        <ConfirmContext.Provider value={confirm}>
            {children}
            <AnimatePresence>
                {opts && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        onClick={() => settle(false)}
                        className="fixed inset-0 z-[60] flex items-center justify-center p-5"
                        style={{ background: 'rgba(30, 20, 5, 0.45)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}
                    >
                        <motion.div
                            initial={{ opacity: 0, y: 16, scale: 0.97 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 16, scale: 0.97 }}
                            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                            onClick={(e) => e.stopPropagation()}
                            className="bg-bg-card rounded-[22px] shadow-2xl w-full max-w-[380px] p-6"
                            style={{ border: '1px solid var(--color-line)' }}
                            role="alertdialog"
                            aria-modal="true"
                        >
                            <div className="display" style={{ fontSize: 20, lineHeight: 1.15 }}>{opts.title}</div>
                            {opts.message && (
                                <div className="text-[13px] text-ink-2 mt-2 leading-relaxed">{opts.message}</div>
                            )}
                            <div className="flex items-center gap-2.5 mt-6">
                                <div className="flex-1" />
                                <button
                                    type="button"
                                    onClick={() => settle(false)}
                                    className="h-10 px-4 rounded-full border border-line bg-bg-card text-sm font-medium hover:border-ink-2 transition-all"
                                >
                                    {opts.cancelLabel ?? 'Cancel'}
                                </button>
                                <button
                                    type="button"
                                    autoFocus
                                    onClick={() => settle(true)}
                                    className="h-10 px-5 rounded-full text-sm font-semibold text-white transition-all hover:brightness-[1.05]"
                                    style={{
                                        background: opts.danger
                                            ? 'oklch(0.58 0.21 25)'
                                            : 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))',
                                        color: opts.danger ? '#fff' : '#1a120a',
                                    }}
                                >
                                    {opts.confirmLabel ?? 'Confirm'}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </ConfirmContext.Provider>
    );
}

export function useConfirm(): ConfirmFn {
    const ctx = useContext(ConfirmContext);
    if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
    return ctx;
}
