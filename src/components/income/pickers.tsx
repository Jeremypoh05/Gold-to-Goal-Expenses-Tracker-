'use client';

// ADDED (Phase 9): shared modern form controls for the income modals (salary
// timeline + income sources). Extracted from SalaryTimelineModal so both modals
// share the same look: a popover month grid, a year stepper, and a money field.

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronIcon } from '@/components/icons';
import { MONTH_NAMES } from '@/lib/utils';

/** Parse a loose numeric string → non-negative number (0 on garbage). */
export const num = (s: string) => {
    const n = parseFloat(s);
    return Number.isFinite(n) && n >= 0 ? n : 0;
};

export function CloseIcon({ size = 14 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6 L18 18 M18 6 L6 18" />
        </svg>
    );
}

export function MoneyField({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
}) {
    return (
        <div>
            <div className="text-[10px] md:text-[11px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1.5">
                {label}
            </div>
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-line bg-bg-1 focus-within:border-gold-400 focus-within:bg-bg-card transition-all">
                <span className="text-ink-2 text-sm">S$</span>
                <input
                    type="text"
                    inputMode="decimal"
                    value={value}
                    onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
                    className="flex-1 bg-transparent outline-none mono text-[15px] font-semibold min-w-0"
                    aria-label={label}
                />
            </div>
        </div>
    );
}

/** Modern month picker — a popover with a 3×4 month grid. */
export function MonthGridDropdown({
    value,
    onChange,
    label = 'Effective month',
}: {
    value: number; // 1–12
    onChange: (m: number) => void;
    label?: string;
}) {
    const [open, setOpen] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);

    // CHANGED (Phase 9): the month grid now expands INLINE (in-flow) instead of a
    // floating absolute popover — an absolute popover was clipped by the modal's
    // scroll container and couldn't be reached. Expanding in-flow lets the modal
    // grow/scroll naturally, and we scroll the panel into view so the user never
    // has to hunt for it.
    useEffect(() => {
        if (!open) return;
        const id = requestAnimationFrame(() =>
            panelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
        );
        return () => cancelAnimationFrame(id);
    }, [open]);

    return (
        <div>
            <div className="text-[10px] md:text-[11px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1.5">
                {label}
            </div>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl border bg-bg-1 hover:bg-bg-card transition-all"
                style={{ borderColor: open ? 'oklch(0.82 0.12 88)' : 'var(--color-line)' }}
                aria-haspopup="listbox"
                aria-expanded={open}
            >
                <span className="text-[14px] font-medium">{MONTH_NAMES[value - 1]}</span>
                <ChevronIcon direction={open ? 'up' : 'down'} size={14} className="text-ink-2" />
            </button>
            <AnimatePresence initial={false}>
                {open && (
                    <motion.div
                        ref={panelRef}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden"
                    >
                        <div
                            className="mt-2 p-2 rounded-2xl grid grid-cols-3 gap-1.5"
                            style={{ background: 'var(--color-bg-1)', border: '1px solid var(--color-line)' }}
                            role="listbox"
                        >
                            {MONTH_NAMES.map((m, i) => {
                                const sel = value === i + 1;
                                return (
                                    <button
                                        key={m}
                                        type="button"
                                        onClick={() => {
                                            onChange(i + 1);
                                            setOpen(false);
                                        }}
                                        className="h-9 rounded-lg text-[12px] font-medium transition-all hover:brightness-[1.05]"
                                        style={
                                            sel
                                                ? {
                                                      background:
                                                          'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))',
                                                      color: '#1a120a',
                                                  }
                                                : { background: 'var(--color-bg-card)', color: 'var(--color-ink-1)' }
                                        }
                                        role="option"
                                        aria-selected={sel}
                                    >
                                        {m.slice(0, 3)}
                                    </button>
                                );
                            })}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

/** Year stepper (− / +), replacing a native number input. */
export function YearStepper({
    value,
    onChange,
}: {
    value: string;
    onChange: (v: string) => void;
}) {
    const y = Math.round(num(value)) || new Date().getFullYear();
    return (
        <div>
            <div className="text-[10px] md:text-[11px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1.5">
                Year
            </div>
            <div className="flex items-center rounded-xl border border-line bg-bg-1 overflow-hidden h-[44px]">
                <button
                    type="button"
                    onClick={() => onChange(String(y - 1))}
                    className="px-3.5 h-full text-ink-1 hover:bg-bg-2 transition-colors text-lg leading-none"
                    aria-label="Previous year"
                >
                    −
                </button>
                <span className="flex-1 text-center mono text-[15px] font-semibold">{y}</span>
                <button
                    type="button"
                    onClick={() => onChange(String(y + 1))}
                    className="px-3.5 h-full text-ink-1 hover:bg-bg-2 transition-colors text-lg leading-none"
                    aria-label="Next year"
                >
                    +
                </button>
            </div>
        </div>
    );
}
