'use client';

// ADDED (Phase 9): manage the time-aware salary timeline. Each entry is "this
// salary, effective from this month onward" — so a mid-year start and any number
// of raises are just rows. Tapping a row loads it into the form; saving the same
// month upserts (server action addSalaryPeriod), a different month adds a change.
// Mirrors the app's modal pattern (mobile sheet / desktop centered, ESC + backdrop,
// body-scroll lock). Mounts fresh per open.

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PlusIcon, EditIcon } from '@/components/icons';
import { formatMoney, MONTH_NAMES } from '@/lib/utils';
import type { UiSalaryPeriod } from '@/lib/expense-utils';

export interface SalaryPeriodForm {
    effectiveYear: number;
    effectiveMonth: number;
    monthlySalary: number;
    grossSalary: number;
    deductions: number;
    label: string;
}

interface Props {
    open: boolean;
    periods: UiSalaryPeriod[];
    /** Default year for a brand-new entry (the viewing year). */
    defaultYear: number;
    pending?: boolean;
    onClose: () => void;
    onSave: (v: SalaryPeriodForm) => void;
    onDelete: (id: number) => void;
}

function CloseIcon({ size = 14 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6 L18 18 M18 6 L6 18" />
        </svg>
    );
}

function MoneyField({
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

const num = (s: string) => {
    const n = parseFloat(s);
    return Number.isFinite(n) && n >= 0 ? n : 0;
};

function Content({
    periods,
    defaultYear,
    pending,
    onClose,
    onSave,
    onDelete,
}: Omit<Props, 'open'>) {
    // Newest first for display.
    const sorted = [...periods].sort((a, b) =>
        b.year !== a.year ? b.year - a.year : b.month - a.month,
    );

    const [effYear, setEffYear] = useState(String(defaultYear));
    const [effMonth, setEffMonth] = useState('1');
    const [salary, setSalary] = useState('');
    const [gross, setGross] = useState('');
    const [deductions, setDeductions] = useState('');
    const [label, setLabel] = useState('');
    const [editingId, setEditingId] = useState<number | null>(null);

    const loadRow = (p: UiSalaryPeriod) => {
        setEffYear(String(p.year));
        setEffMonth(String(p.month));
        setSalary(String(p.monthlySalary || ''));
        setGross(String(p.grossSalary || ''));
        setDeductions(String(p.deductions || ''));
        setLabel(p.label ?? '');
        setEditingId(p.id);
    };

    const resetForm = () => {
        setEffYear(String(defaultYear));
        setEffMonth('1');
        setSalary('');
        setGross('');
        setDeductions('');
        setLabel('');
        setEditingId(null);
    };

    const canSave = num(salary) > 0;

    const handleSave = () => {
        if (!canSave) return;
        onSave({
            effectiveYear: Math.round(num(effYear)) || defaultYear,
            effectiveMonth: Math.min(12, Math.max(1, Math.round(num(effMonth)) || 1)),
            monthlySalary: num(salary),
            grossSalary: num(gross),
            deductions: num(deductions),
            label: label.trim(),
        });
        resetForm();
    };

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
                className="bg-bg-card rounded-t-[24px] md:rounded-[24px] shadow-2xl relative overflow-hidden w-full md:w-[min(520px,100%)]"
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

                <div className="px-6 md:px-7 pt-7 pb-3">
                    <div className="text-[11px] text-on-soft uppercase tracking-[0.14em] font-semibold">
                        Salary timeline
                    </div>
                    <h2 className="display mt-1" style={{ fontSize: 26, lineHeight: 1.1 }}>
                        Salary changes
                    </h2>
                    <div className="text-[12px] text-ink-2 mt-1">
                        Each entry sets your salary from that month onward — add one when you start, and again whenever it changes.
                    </div>
                </div>

                {/* Existing periods */}
                <div className="px-6 md:px-7 flex flex-col gap-2">
                    {sorted.length === 0 && (
                        <div className="text-[13px] text-ink-2 py-2">
                            No salary set yet. Add your first one below.
                        </div>
                    )}
                    {sorted.map((p) => (
                        <div
                            key={p.id}
                            className="flex items-center gap-3 p-3 rounded-[14px]"
                            style={{ background: 'var(--color-bg-1)', border: editingId === p.id ? '1px solid oklch(0.82 0.12 88)' : '1px solid var(--color-line-soft)' }}
                        >
                            <div className="flex-1 min-w-0">
                                <div className="text-[13px] font-medium">
                                    {MONTH_NAMES[p.month - 1]} {p.year}
                                    {p.label ? <span className="text-ink-2 font-normal"> · {p.label}</span> : null}
                                </div>
                                <div className="text-[11px] text-ink-2 mono mt-0.5">
                                    {formatMoney(p.monthlySalary)} take-home
                                    {p.grossSalary > 0 ? ` · ${formatMoney(p.grossSalary)} gross` : ''}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => loadRow(p)}
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-1 hover:bg-bg-2 transition-colors"
                                aria-label="Edit this salary"
                            >
                                <EditIcon size={13} />
                            </button>
                            <button
                                type="button"
                                onClick={() => onDelete(p.id)}
                                disabled={pending}
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-2 hover:bg-bg-2 hover:text-red-500 transition-colors disabled:opacity-40"
                                aria-label="Delete this salary"
                            >
                                <CloseIcon size={13} />
                            </button>
                        </div>
                    ))}
                </div>

                {/* Add / edit form */}
                <div className="px-6 md:px-7 pt-4 pb-2 mt-2 flex flex-col gap-3" style={{ borderTop: '1px solid var(--color-line-soft)' }}>
                    <div className="text-[11px] text-on-soft uppercase tracking-[0.1em] font-semibold">
                        {editingId !== null ? 'Edit salary' : 'Add a salary change'}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <div className="text-[10px] md:text-[11px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1.5">
                                Effective month
                            </div>
                            <select
                                value={effMonth}
                                onChange={(e) => setEffMonth(e.target.value)}
                                className="w-full px-3 py-2.5 rounded-xl border border-line bg-bg-1 outline-none text-[14px] font-medium focus:border-gold-400"
                                aria-label="Effective month"
                            >
                                {MONTH_NAMES.map((m, i) => (
                                    <option key={m} value={i + 1}>{m}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <div className="text-[10px] md:text-[11px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1.5">
                                Year
                            </div>
                            <input
                                type="text"
                                inputMode="numeric"
                                value={effYear}
                                onChange={(e) => setEffYear(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
                                className="w-full px-3 py-2.5 rounded-xl border border-line bg-bg-1 outline-none mono text-[15px] font-semibold focus:border-gold-400"
                                aria-label="Effective year"
                            />
                        </div>
                    </div>
                    <MoneyField label="Monthly salary (take-home)" value={salary} onChange={setSalary} />
                    <div className="grid grid-cols-2 gap-3">
                        <MoneyField label="Gross monthly" value={gross} onChange={setGross} />
                        <MoneyField label="CPF / deductions" value={deductions} onChange={setDeductions} />
                    </div>
                    <div>
                        <div className="text-[10px] md:text-[11px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1.5">
                            Label (optional)
                        </div>
                        <input
                            type="text"
                            value={label}
                            onChange={(e) => setLabel(e.target.value)}
                            placeholder="e.g. Joined, Raise, Promotion"
                            maxLength={40}
                            className="w-full px-3 py-2.5 rounded-xl border border-line bg-bg-1 outline-none text-[14px] focus:border-gold-400"
                            aria-label="Label"
                        />
                    </div>
                </div>

                <div className="px-6 md:px-7 py-5 flex items-center gap-2.5">
                    {editingId !== null && (
                        <button
                            type="button"
                            onClick={resetForm}
                            className="h-10 px-4 rounded-full border border-line bg-bg-card text-sm font-medium hover:border-ink-2 transition-all"
                        >
                            New entry
                        </button>
                    )}
                    <div className="flex-1" />
                    <button
                        type="button"
                        onClick={onClose}
                        className="h-10 px-5 rounded-full border border-line bg-bg-card text-sm font-medium hover:border-ink-2 transition-all"
                    >
                        Done
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={!canSave || pending}
                        className="h-10 px-5 rounded-full text-sm font-semibold flex items-center gap-2 hover:brightness-[1.03] transition-all disabled:opacity-40"
                        style={{
                            background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))',
                            color: '#1a120a',
                            boxShadow: 'var(--shadow-gold)',
                        }}
                    >
                        <PlusIcon size={14} /> {editingId !== null ? 'Save change' : 'Add'}
                    </button>
                </div>
            </motion.div>
        </motion.div>
    );
}

export function SalaryTimelineModal({ open, periods, defaultYear, pending, onClose, onSave, onDelete }: Props) {
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
            {open && (
                <Content
                    key="salary-timeline"
                    periods={periods}
                    defaultYear={defaultYear}
                    pending={pending}
                    onClose={onClose}
                    onSave={onSave}
                    onDelete={onDelete}
                />
            )}
        </AnimatePresence>
    );
}
