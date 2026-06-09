'use client';

// ADDED (Phase 6.1): one editable form for a parsed voice entry —
// amount + currency + category + note. Reused by both the capture inline-edit
// and the history-row edit so there's a single editor to maintain. Self-contained
// (seeds its own state from `initial` on mount); mount fresh (keyed) per edit.

import { useState } from 'react';
import { CategoryTile } from '@/components/icons';
import { CATEGORIES } from '@/data/categories';
import type { CategoryKey, Currency } from '@/types';

const CATEGORY_KEYS: CategoryKey[] = [
    'food',
    'shop',
    'ent',
    'trans',
    'health',
    'bills',
    'other',
];

const CURRENCY_OPTIONS: { code: Currency; label: string }[] = [
    { code: 'SGD', label: 'S$' },
    { code: 'MYR', label: 'RM' },
    { code: 'CNY', label: '¥' },
    { code: 'USD', label: '$' },
];

export interface VoiceEntryValue {
    amt: number;
    currency: Currency;
    cat: CategoryKey;
    note: string;
}

function CheckIcon({ size = 14 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12 L10 17 L19 7" />
        </svg>
    );
}

export function VoiceEntryEditor({
    initial,
    onSave,
    onCancel,
    saveLabel = 'Save changes',
}: {
    initial: VoiceEntryValue;
    onSave: (value: VoiceEntryValue) => void;
    onCancel?: () => void;
    saveLabel?: string;
}) {
    const [amt, setAmt] = useState(initial.amt.toFixed(2));
    const [currency, setCurrency] = useState<Currency>(initial.currency);
    const [cat, setCat] = useState<CategoryKey>(initial.cat);
    const [note, setNote] = useState(initial.note);

    const symbol = CURRENCY_OPTIONS.find((c) => c.code === currency)?.label ?? 'S$';

    const handleSave = () =>
        onSave({ amt: parseFloat(amt) || 0, currency, cat, note });

    return (
        <div className="flex flex-col gap-3 p-3.5 rounded-[14px]" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-line-soft)' }}>
            {/* Amount + currency */}
            <div>
                <div className="text-[10px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1">Amount</div>
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
                <div className="grid grid-cols-7 gap-1.5">
                    {CATEGORY_KEYS.map((k) => (
                        <button
                            key={k}
                            type="button"
                            onClick={() => setCat(k)}
                            aria-label={CATEGORIES[k].label}
                            className="rounded-xl py-2 flex items-center justify-center transition-all"
                            style={{
                                background: k === cat ? 'linear-gradient(135deg, oklch(0.96 0.06 92), oklch(0.88 0.12 88))' : 'var(--color-bg-1)',
                                border: k === cat ? '1px solid oklch(0.80 0.12 88)' : '1px solid transparent',
                                boxShadow: k === cat ? 'var(--shadow-gold)' : 'none',
                            }}
                        >
                            <CategoryTile kind={k} size={24} variant="filled" />
                        </button>
                    ))}
                </div>
            </div>

            {/* Note */}
            <div>
                <div className="text-[10px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1">Note</div>
                <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Add a note (optional)"
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
                {onCancel && (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="h-10 px-5 rounded-full border border-line bg-bg-card text-sm font-medium hover:border-ink-2 transition-all"
                    >
                        Cancel
                    </button>
                )}
            </div>
        </div>
    );
}
