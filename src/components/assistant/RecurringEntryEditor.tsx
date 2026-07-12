'use client';

// ADDED (Slice 2c fix, user feedback): manual-edit fallback for the create_recurring
// confirm card — mirrors VoiceEntryEditor's role for create_expense (an inline form
// so the user can fix any field without another AI round-trip). The value shape IS
// RecurringCreateFields exactly, so no separate Value/Initial split is needed here —
// every field is always relevant to setting up a recurring rule. Reuses the shared
// income month/year pickers (MonthGridDropdown/YearStepper) for start/end month.

import { useState } from 'react';
import { CategoryTile } from '@/components/icons';
import { CATEGORIES } from '@/data/categories';
import { MonthGridDropdown, YearStepper, num } from '@/components/income/pickers';
import type { RecurringCreateFields } from '@/lib/assistant/types';
import type { CategoryKey, Currency } from '@/types';

// All 8 categories, incl. "family" — recurring items support it, unlike plain expenses.
const ALL_CATEGORY_KEYS: CategoryKey[] = ['food', 'shop', 'ent', 'trans', 'health', 'bills', 'family', 'other'];
const CURRENCY_OPTIONS: { code: Currency; label: string }[] = [
    { code: 'SGD', label: 'S$' },
    { code: 'MYR', label: 'RM' },
    { code: 'CNY', label: '¥' },
    { code: 'USD', label: '$' },
];

function CheckIcon({ size = 14 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12 L10 17 L19 7" />
        </svg>
    );
}

function DueDayField({ value, onChange }: { value: number; onChange: (n: number) => void }) {
    return (
        <div>
            <div className="text-[10px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1.5">Due day</div>
            <div className="flex items-center rounded-xl border border-line bg-bg-1 overflow-hidden h-[44px] w-fit">
                <button type="button" onClick={() => onChange(Math.max(1, value - 1))} className="px-3.5 h-full text-ink-1 hover:bg-bg-2 transition-colors text-lg leading-none" aria-label="Earlier due day">−</button>
                <span className="px-4 text-center mono text-[15px] font-semibold">{value}</span>
                <button type="button" onClick={() => onChange(Math.min(31, value + 1))} className="px-3.5 h-full text-ink-1 hover:bg-bg-2 transition-colors text-lg leading-none" aria-label="Later due day">+</button>
            </div>
        </div>
    );
}

export function RecurringEntryEditor({
    initial,
    onSave,
    onCancel,
    saveLabel = 'Set up recurring',
}: {
    initial: RecurringCreateFields;
    onSave: (value: RecurringCreateFields) => void;
    onCancel: () => void;
    saveLabel?: string;
}) {
    const [label, setLabel] = useState(initial.label);
    const [note, setNote] = useState(initial.note);
    const [category, setCategory] = useState<CategoryKey>(initial.category);
    const [currency, setCurrency] = useState<Currency>(initial.currency);
    const [amt, setAmt] = useState(initial.amount.toFixed(2));
    const [dueDay, setDueDay] = useState(initial.dueDay);
    const [startMonth, setStartMonth] = useState(initial.startMonth);
    const [startYear, setStartYear] = useState(String(initial.startYear));
    const now = new Date();
    const [hasEnd, setHasEnd] = useState(initial.endYear != null && initial.endMonth != null);
    const [endMonth, setEndMonth] = useState(initial.endMonth ?? now.getMonth() + 1);
    const [endYear, setEndYear] = useState(String(initial.endYear ?? now.getFullYear()));

    const symbol = CURRENCY_OPTIONS.find((c) => c.code === currency)?.label ?? 'S$';

    const handleSave = () => {
        onSave({
            label: label.trim() || 'Fixed expense',
            note: note.trim(),
            category,
            currency,
            amount: parseFloat(amt) || 0,
            dueDay,
            startYear: Math.round(num(startYear)) || now.getFullYear(),
            startMonth,
            endYear: hasEnd ? Math.round(num(endYear)) || now.getFullYear() : null,
            endMonth: hasEnd ? endMonth : null,
        });
    };

    return (
        <div className="flex flex-col gap-3 p-3.5 rounded-[14px]" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-line-soft)' }}>
            {/* Name */}
            <div>
                <div className="text-[10px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1">Name</div>
                <input
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="e.g. Rent, Netflix, Family support"
                    className="w-full px-3 py-2 border border-line rounded-xl bg-bg-1 text-[13px] outline-none focus:border-gold-400 focus:bg-bg-card transition-all"
                />
            </div>

            {/* Amount + currency */}
            <div>
                <div className="text-[10px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1">Amount / month</div>
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-line bg-bg-1">
                    <span className="text-ink-2 text-sm w-7">{symbol}</span>
                    <input
                        type="text"
                        inputMode="decimal"
                        value={amt}
                        onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ''))}
                        className="flex-1 bg-transparent outline-none mono text-[15px] font-semibold min-w-0"
                        aria-label="Amount"
                    />
                </div>
                <div className="flex gap-1.5 mt-2">
                    {CURRENCY_OPTIONS.map((c) => (
                        <button
                            key={c.code}
                            type="button"
                            onClick={() => setCurrency(c.code)}
                            className="chip"
                            style={{
                                cursor: 'pointer',
                                background: c.code === currency ? 'oklch(0.96 0.06 92)' : 'var(--color-bg-2)',
                                color: c.code === currency ? 'var(--color-gold-900)' : 'var(--color-ink-1)',
                                border: c.code === currency ? '1px solid oklch(0.85 0.10 88)' : '1px solid var(--color-line-soft)',
                            }}
                        >
                            {c.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Category */}
            <div>
                <div className="text-[10px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1.5">Category</div>
                <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                    {ALL_CATEGORY_KEYS.map((k) => {
                        const isSelected = k === category;
                        return (
                            <button
                                key={k}
                                type="button"
                                onClick={() => setCategory(k)}
                                aria-label={CATEGORIES[k].label}
                                className="rounded-xl flex flex-col items-center gap-1 py-2 px-1 transition-all hover:scale-[1.03]"
                                style={{
                                    background: isSelected ? 'linear-gradient(135deg, oklch(0.96 0.06 92), oklch(0.88 0.12 88))' : 'var(--color-bg-1)',
                                    border: isSelected ? '1px solid oklch(0.80 0.12 88)' : '1px solid transparent',
                                    boxShadow: isSelected ? 'var(--shadow-gold)' : 'none',
                                }}
                            >
                                <CategoryTile kind={k} size={24} variant="filled" />
                                {/* Fixed dark ink when selected — theme ink turns white in
                                    dark mode and is unreadable on the bright gold tile. */}
                                <span
                                    className="text-[9px] font-medium leading-tight text-center"
                                    style={isSelected ? { color: '#2a1805' } : undefined}
                                >
                                    {CATEGORIES[k].label}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Due day + start month/year */}
            <div className="flex flex-wrap gap-3">
                <DueDayField value={dueDay} onChange={setDueDay} />
                <div className="flex-1 min-w-[140px]">
                    <MonthGridDropdown value={startMonth} onChange={setStartMonth} label="Start month" />
                </div>
                <div className="w-[110px]">
                    <YearStepper value={startYear} onChange={setStartYear} />
                </div>
            </div>

            {/* Has an end month */}
            <div>
                <div className="text-[10px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1.5">Ends?</div>
                <div className="flex gap-1.5">
                    <button
                        type="button"
                        onClick={() => setHasEnd(false)}
                        className="chip"
                        style={{
                            cursor: 'pointer',
                            background: !hasEnd ? 'oklch(0.96 0.06 92)' : 'var(--color-bg-2)',
                            color: !hasEnd ? 'var(--color-gold-900)' : 'var(--color-ink-1)',
                            border: !hasEnd ? '1px solid oklch(0.85 0.10 88)' : '1px solid var(--color-line-soft)',
                        }}
                    >
                        Ongoing
                    </button>
                    <button
                        type="button"
                        onClick={() => setHasEnd(true)}
                        className="chip"
                        style={{
                            cursor: 'pointer',
                            background: hasEnd ? 'oklch(0.96 0.06 92)' : 'var(--color-bg-2)',
                            color: hasEnd ? 'var(--color-gold-900)' : 'var(--color-ink-1)',
                            border: hasEnd ? '1px solid oklch(0.85 0.10 88)' : '1px solid var(--color-line-soft)',
                        }}
                    >
                        Has an end month
                    </button>
                </div>
                {hasEnd && (
                    <div className="flex flex-wrap gap-3 mt-2">
                        <div className="flex-1 min-w-[140px]">
                            <MonthGridDropdown value={endMonth} onChange={setEndMonth} label="End month" />
                        </div>
                        <div className="w-[110px]">
                            <YearStepper value={endYear} onChange={setEndYear} />
                        </div>
                    </div>
                )}
            </div>

            {/* Note */}
            <div>
                <div className="text-[10px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1">Note</div>
                <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Optional detail"
                    className="w-full px-3 py-2 border border-line rounded-xl bg-bg-1 text-[13px] outline-none focus:border-gold-400 focus:bg-bg-card transition-all"
                />
            </div>

            {/* Actions */}
            <div className="flex gap-2.5">
                <button
                    type="button"
                    onClick={handleSave}
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
        </div>
    );
}
