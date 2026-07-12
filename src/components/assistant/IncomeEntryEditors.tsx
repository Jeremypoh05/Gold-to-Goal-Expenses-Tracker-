'use client';

// ADDED (Slice 2d): manual-edit fallbacks for the income confirm cards — the same
// "Edit" escape hatch create_expense/create_recurring already have, so the user can
// fix a field the AI got slightly wrong WITHOUT another chat round-trip. One inline
// editor per income entity (bonus / salary / savings settings), each reusing the
// shared income pickers (MonthGridDropdown / YearStepper / num) so they look and
// behave like the Income-page modals. Mirrors RecurringEntryEditor's role.

import { useState } from 'react';
import { MonthGridDropdown, YearStepper, num } from '@/components/income/pickers';
import type { BonusFields, SalaryFields, SavingsSettingsFields } from '@/lib/assistant/types';
import type { Currency } from '@/types';

const SYMBOL: Record<string, string> = { SGD: 'S$', MYR: 'RM', CNY: '¥', USD: '$' };

function CheckIcon({ size = 14 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12 L10 17 L19 7" />
        </svg>
    );
}

function AmountField({
    label,
    symbol,
    value,
    onChange,
}: {
    label: string;
    symbol: string;
    value: string;
    onChange: (v: string) => void;
}) {
    return (
        <div>
            <div className="text-[10px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1">{label}</div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-line bg-bg-1">
                <span className="text-ink-2 text-sm w-7">{symbol}</span>
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

function TextField({
    label,
    value,
    onChange,
    placeholder,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
}) {
    return (
        <div>
            <div className="text-[10px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1">{label}</div>
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="w-full px-3 py-2 border border-line rounded-xl bg-bg-1 text-[13px] outline-none focus:border-gold-400 focus:bg-bg-card transition-all"
            />
        </div>
    );
}

function DayField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <div>
            <div className="text-[10px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1">Pay day</div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-line bg-bg-1">
                <input
                    type="text"
                    inputMode="numeric"
                    value={value}
                    onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
                    className="flex-1 bg-transparent outline-none mono text-[15px] font-semibold min-w-0"
                    aria-label="Pay day of month"
                />
                <span className="text-ink-3 text-[11px]">of month</span>
            </div>
        </div>
    );
}

function Actions({
    onSave,
    onCancel,
    saveLabel,
}: {
    onSave: () => void;
    onCancel: () => void;
    saveLabel: string;
}) {
    return (
        <div className="flex gap-2.5">
            <button
                type="button"
                onClick={onSave}
                className="flex-1 h-10 rounded-full text-sm font-semibold flex items-center justify-center gap-2 hover:brightness-[1.03] transition-all"
                style={{
                    background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))',
                    color: '#1a120a',
                    boxShadow: 'var(--shadow-gold)',
                }}
            >
                <CheckIcon size={15} /> {saveLabel}
            </button>
            <button
                type="button"
                onClick={onCancel}
                className="h-10 px-5 rounded-full border border-line bg-bg-card text-sm font-medium hover:border-ink-2 transition-all"
            >
                Cancel
            </button>
        </div>
    );
}

const wrapCls = 'flex flex-col gap-3 p-3.5 rounded-[14px]';
const wrapStyle = { background: 'var(--color-bg-card)', border: '1px solid var(--color-line-soft)' } as const;

/** Manual-edit fallback for a bonus (create/update) card. */
export function BonusEntryEditor({
    initial,
    currency,
    onSave,
    onCancel,
    saveLabel = 'Save bonus',
}: {
    initial: BonusFields;
    currency: Currency;
    onSave: (f: BonusFields) => void;
    onCancel: () => void;
    saveLabel?: string;
}) {
    const [label, setLabel] = useState(initial.label);
    const [amt, setAmt] = useState(initial.amount.toFixed(2));
    const [month, setMonth] = useState(initial.month);
    const [year, setYear] = useState(String(initial.year));
    const symbol = SYMBOL[currency] ?? 'S$';

    const save = () =>
        onSave({
            year: Math.round(num(year)) || initial.year,
            month,
            amount: parseFloat(amt) || 0,
            label: label.trim() || 'Bonus',
        });

    return (
        <div className={wrapCls} style={wrapStyle}>
            <TextField label="Name" value={label} onChange={setLabel} placeholder="e.g. Year-end bonus" />
            <AmountField label="Amount" symbol={symbol} value={amt} onChange={setAmt} />
            <div className="flex flex-wrap gap-3">
                <div className="flex-1 min-w-[140px]">
                    <MonthGridDropdown value={month} onChange={setMonth} label="Month" />
                </div>
                <div className="w-[110px]">
                    <YearStepper value={year} onChange={setYear} />
                </div>
            </div>
            <Actions onSave={save} onCancel={onCancel} saveLabel={saveLabel} />
        </div>
    );
}

/** Manual-edit fallback for the adjust_salary card. */
export function SalaryEntryEditor({
    initial,
    currency,
    onSave,
    onCancel,
    saveLabel = 'Save salary',
}: {
    initial: SalaryFields;
    currency: Currency;
    onSave: (f: SalaryFields) => void;
    onCancel: () => void;
    saveLabel?: string;
}) {
    const [amt, setAmt] = useState(initial.monthlySalary.toFixed(2));
    const [gross, setGross] = useState(initial.grossSalary != null ? initial.grossSalary.toFixed(2) : '');
    const [ded, setDed] = useState(initial.deductions != null ? initial.deductions.toFixed(2) : '');
    const [month, setMonth] = useState(initial.effectiveMonth);
    const [year, setYear] = useState(String(initial.effectiveYear));
    const [label, setLabel] = useState(initial.label);
    const symbol = SYMBOL[currency] ?? 'S$';

    const save = () =>
        onSave({
            effectiveYear: Math.round(num(year)) || initial.effectiveYear,
            effectiveMonth: month,
            monthlySalary: parseFloat(amt) || 0,
            grossSalary: gross.trim() ? parseFloat(gross) || 0 : null,
            deductions: ded.trim() ? parseFloat(ded) || 0 : null,
            label: label.trim(),
        });

    return (
        <div className={wrapCls} style={wrapStyle}>
            <AmountField label="Take-home / month" symbol={symbol} value={amt} onChange={setAmt} />
            <div className="flex flex-wrap gap-3">
                <div className="flex-1 min-w-[140px]">
                    <MonthGridDropdown value={month} onChange={setMonth} label="Effective from" />
                </div>
                <div className="w-[110px]">
                    <YearStepper value={year} onChange={setYear} />
                </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <AmountField label="Gross" symbol={symbol} value={gross} onChange={setGross} />
                <AmountField label="CPF / deductions" symbol={symbol} value={ded} onChange={setDed} />
            </div>
            <TextField label="Note" value={label} onChange={setLabel} placeholder="e.g. Raise, Promotion" />
            <Actions onSave={save} onCancel={onCancel} saveLabel={saveLabel} />
        </div>
    );
}

/** Manual-edit fallback for the set_savings_goal card — edits only the fields the AI
 *  proposed changing (the keys present in `initial`), so the form stays focused. */
export function SavingsGoalEditor({
    initial,
    currency,
    onSave,
    onCancel,
    saveLabel = 'Save changes',
}: {
    initial: SavingsSettingsFields;
    currency: Currency;
    onSave: (c: SavingsSettingsFields) => void;
    onCancel: () => void;
    saveLabel?: string;
}) {
    const [goal, setGoal] = useState(initial.savingsGoal != null ? String(initial.savingsGoal) : '');
    const [saved, setSaved] = useState(initial.saved != null ? String(initial.saved) : '');
    const [budget, setBudget] = useState(initial.monthlyBudget != null ? String(initial.monthlyBudget) : '');
    const [payDay, setPayDay] = useState(initial.payDay != null ? String(initial.payDay) : '');
    const [payFrequency, setPayFrequency] = useState(initial.payFrequency ?? '');
    const symbol = SYMBOL[currency] ?? 'S$';

    const save = () => {
        const out: SavingsSettingsFields = {};
        if (initial.savingsGoal !== undefined) out.savingsGoal = num(goal);
        if (initial.saved !== undefined) out.saved = num(saved);
        if (initial.monthlyBudget !== undefined) out.monthlyBudget = num(budget);
        if (initial.payDay !== undefined) out.payDay = Math.min(31, Math.max(1, Math.round(num(payDay)) || 1));
        if (initial.payFrequency !== undefined) out.payFrequency = payFrequency.trim() || 'Monthly';
        onSave(out);
    };

    const FREQUENCIES = ['Monthly', 'Bi-weekly', 'Weekly'];

    return (
        <div className={wrapCls} style={wrapStyle}>
            {initial.savingsGoal !== undefined && (
                <AmountField label="Savings goal" symbol={symbol} value={goal} onChange={setGoal} />
            )}
            {initial.saved !== undefined && (
                <AmountField label="Saved so far" symbol={symbol} value={saved} onChange={setSaved} />
            )}
            {initial.monthlyBudget !== undefined && (
                <AmountField label="Monthly budget" symbol={symbol} value={budget} onChange={setBudget} />
            )}
            {initial.payDay !== undefined && <DayField value={payDay} onChange={setPayDay} />}
            {initial.payFrequency !== undefined && (
                <div>
                    <div className="text-[10px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1.5">Frequency</div>
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
            )}
            <Actions onSave={save} onCancel={onCancel} saveLabel={saveLabel} />
        </div>
    );
}
