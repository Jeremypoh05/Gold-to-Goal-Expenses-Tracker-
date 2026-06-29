'use client';

// ADDED (Phase 8): edit the per-user income settings that used to be hardcoded
// design values — monthly salary, savings goal, and amount saved so far. Persists
// via the updateIncomeSettings server action (wired by the Income page). Mirrors
// the app's modal pattern: mobile bottom sheet / desktop centered, ESC + backdrop
// close, body-scroll lock. Mounts fresh per open so fields seed cleanly.

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// CHANGED (Phase 9): salary/gross/deductions moved to the SalaryTimelineModal
// (time-aware periods). This modal now only handles the per-user goal, budget,
// and pay-schedule settings.
export interface IncomeSettingsValue {
    savingsGoal: number;
    saved: number;
    monthlyBudget: number;
    payDay: number;
    payFrequency: string;
}

interface Props {
    open: boolean;
    initial: IncomeSettingsValue;
    onClose: () => void;
    onSave: (v: IncomeSettingsValue) => void;
}

function CloseIcon({ size = 14 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6 L18 18 M18 6 L6 18" />
        </svg>
    );
}

function CheckIcon({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12 L10 17 L19 7" />
        </svg>
    );
}

function MoneyField({
    label,
    value,
    onChange,
    hint,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    hint?: string;
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
            {hint && <div className="text-[11px] text-ink-3 mt-1">{hint}</div>}
        </div>
    );
}

function Content({ initial, onClose, onSave }: Omit<Props, 'open'>) {
    const [goal, setGoal] = useState(String(initial.savingsGoal || ''));
    const [saved, setSaved] = useState(String(initial.saved || ''));
    const [budget, setBudget] = useState(String(initial.monthlyBudget || ''));
    const [payDay, setPayDay] = useState(String(initial.payDay || ''));
    const [payFrequency, setPayFrequency] = useState(initial.payFrequency || 'Monthly');

    const num = (s: string) => {
        const n = parseFloat(s);
        return Number.isFinite(n) && n >= 0 ? n : 0;
    };

    const handleSave = () => {
        // payDay clamped to a valid day-of-month (1–31), 0 = unset.
        const day = Math.min(31, Math.max(0, Math.round(num(payDay))));
        onSave({
            savingsGoal: num(goal),
            saved: num(saved),
            monthlyBudget: num(budget),
            payDay: day,
            payFrequency: payFrequency.trim() || 'Monthly',
        });
        onClose();
    };

    const FREQUENCIES = ['Monthly', 'Bi-weekly', 'Weekly'];

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
            className="fixed inset-0 z-50 flex items-end md:items-center justify-center md:p-6"
            style={{ background: 'rgba(30, 20, 5, 0.4)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
        >
            <motion.div
                initial={{ opacity: 0, y: 24, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 24, scale: 0.98 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                onClick={(e) => e.stopPropagation()}
                className="bg-bg-card rounded-t-[24px] md:rounded-[24px] shadow-2xl relative overflow-hidden w-full md:w-[min(480px,100%)]"
                style={{ maxHeight: '92vh', overflowY: 'auto', paddingBottom: 'calc(8px + env(safe-area-inset-bottom))' }}
            >
                <button
                    onClick={onClose}
                    type="button"
                    className="absolute top-4 right-4 w-9 h-9 rounded-xl bg-bg-1 hover:bg-bg-2 flex items-center justify-center text-ink-1 transition-colors z-10"
                    aria-label="Close"
                >
                    <CloseIcon size={14} />
                </button>

                <div className="px-6 md:px-7 pt-7 pb-4">
                    <div className="text-[11px] text-on-soft uppercase tracking-[0.14em] font-semibold">
                        Income settings
                    </div>
                    <h2 className="display mt-1" style={{ fontSize: 26, lineHeight: 1.1 }}>
                        Goal &amp; budget
                    </h2>
                    <div className="text-[12px] text-ink-2 mt-1">
                        Your savings goal, monthly budget, and pay schedule. (Salary lives in the timeline.)
                    </div>
                </div>

                <div className="px-6 md:px-7 pb-2 flex flex-col gap-4">
                    <MoneyField label="Monthly budget" value={budget} onChange={setBudget} hint="Powers the dashboard spend ring" />
                    <div className="grid grid-cols-2 gap-3">
                        <MoneyField label="Savings goal" value={goal} onChange={setGoal} />
                        <MoneyField label="Saved so far" value={saved} onChange={setSaved} />
                    </div>
                    {/* Pay day + frequency */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <div className="text-[10px] md:text-[11px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1.5">
                                Pay day
                            </div>
                            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-line bg-bg-1 focus-within:border-gold-400 focus-within:bg-bg-card transition-all">
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    value={payDay}
                                    onChange={(e) => setPayDay(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
                                    placeholder="25"
                                    className="flex-1 bg-transparent outline-none mono text-[15px] font-semibold min-w-0"
                                    aria-label="Pay day of month"
                                />
                                <span className="text-ink-3 text-[11px]">of month</span>
                            </div>
                        </div>
                        <div>
                            <div className="text-[10px] md:text-[11px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1.5">
                                Frequency
                            </div>
                            <div className="flex gap-1.5 flex-wrap">
                                {FREQUENCIES.map((f) => (
                                    <button
                                        key={f}
                                        type="button"
                                        onClick={() => setPayFrequency(f)}
                                        className="chip"
                                        style={{
                                            cursor: 'pointer',
                                            background: f === payFrequency ? 'oklch(0.96 0.06 92)' : 'var(--color-bg-2)',
                                            color: f === payFrequency ? 'var(--color-gold-900)' : 'var(--color-ink-1)',
                                            border: f === payFrequency ? '1px solid oklch(0.85 0.10 88)' : '1px solid var(--color-line-soft)',
                                        }}
                                    >
                                        {f}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="px-6 md:px-7 py-5 flex items-center gap-2.5">
                    <div className="flex-1" />
                    <button
                        type="button"
                        onClick={onClose}
                        className="h-10 px-5 rounded-full border border-line bg-bg-card text-sm font-medium hover:border-ink-2 transition-all"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        className="h-10 px-5 rounded-full text-sm font-semibold flex items-center gap-2 hover:brightness-[1.03] transition-all"
                        style={{
                            background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))',
                            color: '#1a120a',
                            boxShadow: 'var(--shadow-gold)',
                        }}
                    >
                        <CheckIcon size={14} /> Save
                    </button>
                </div>
            </motion.div>
        </motion.div>
    );
}

export function IncomeSettingsModal({ open, initial, onClose, onSave }: Props) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    useEffect(() => {
        if (open) document.body.style.overflow = 'hidden';
        else document.body.style.overflow = '';
        return () => {
            document.body.style.overflow = '';
        };
    }, [open]);

    return (
        <AnimatePresence>
            {open && <Content key="income-settings" initial={initial} onClose={onClose} onSave={onSave} />}
        </AnimatePresence>
    );
}
