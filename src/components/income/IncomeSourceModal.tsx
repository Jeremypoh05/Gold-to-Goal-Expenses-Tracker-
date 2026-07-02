'use client';

// ADDED (Phase 9): manage custom recurring income beyond salary — freelance,
// dividends, rental, etc. Each source contributes its monthly amount to every
// month on/after its start, until paused. Mirrors the SalaryTimelineModal pattern
// (mobile sheet / desktop centered, ESC + backdrop, body-scroll lock, shared
// modern pickers) with an emoji picker so each stream gets a friendly glyph.

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PlusIcon, EditIcon } from '@/components/icons';
import { formatMoney, MONTH_NAMES } from '@/lib/utils';
import type { UiIncomeSource } from '@/lib/expense-utils';
import { CloseIcon, MoneyField, MonthGridDropdown, YearStepper, num } from './pickers';

// Curated, platform-friendly glyphs for income streams.
const EMOJI_CHOICES = [
    '💰', '💵', '🪙', '📈', '🏦', '💳', '🎁', '🏠',
    '🚗', '💻', '🎨', '✍️', '📊', '🤝', '🎬', '🌱',
];

export interface IncomeSourceForm {
    id?: number;
    label: string;
    emoji: string;
    monthlyAmount: number;
    effectiveYear: number;
    effectiveMonth: number;
    active: boolean;
}

interface Props {
    open: boolean;
    sources: UiIncomeSource[];
    defaultYear: number;
    pending?: boolean;
    onClose: () => void;
    onSave: (v: IncomeSourceForm) => void;
    onDelete: (id: number) => void;
    onToggle: (id: number, active: boolean) => void;
}

function EmojiPicker({ value, onChange }: { value: string; onChange: (e: string) => void }) {
    return (
        <div>
            <div className="text-[10px] md:text-[11px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1.5">
                Icon
            </div>
            <div className="grid grid-cols-8 gap-1.5">
                {EMOJI_CHOICES.map((e) => {
                    const sel = value === e;
                    return (
                        <button
                            key={e}
                            type="button"
                            onClick={() => onChange(e)}
                            className="aspect-square rounded-xl text-[18px] flex items-center justify-center transition-all hover:brightness-[1.05]"
                            style={
                                sel
                                    ? {
                                          background:
                                              'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))',
                                          boxShadow: 'var(--shadow-gold)',
                                      }
                                    : { background: 'var(--color-bg-1)', border: '1px solid var(--color-line-soft)' }
                            }
                            aria-label={`Choose ${e}`}
                            aria-pressed={sel}
                        >
                            {e}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function Content({
    sources,
    defaultYear,
    pending,
    onClose,
    onSave,
    onDelete,
    onToggle,
}: Omit<Props, 'open'>) {
    const [emoji, setEmoji] = useState('💰');
    const [label, setLabel] = useState('');
    const [amount, setAmount] = useState('');
    const [effYear, setEffYear] = useState(String(defaultYear));
    const [effMonth, setEffMonth] = useState('1');
    const [editingId, setEditingId] = useState<number | null>(null);

    const loadRow = (s: UiIncomeSource) => {
        setEmoji(s.emoji || '💰');
        setLabel(s.label);
        setAmount(String(s.monthlyAmount || ''));
        setEffYear(String(s.year));
        setEffMonth(String(s.month));
        setEditingId(s.id);
    };

    const resetForm = () => {
        setEmoji('💰');
        setLabel('');
        setAmount('');
        setEffYear(String(defaultYear));
        setEffMonth('1');
        setEditingId(null);
    };

    const canSave = num(amount) > 0 && label.trim().length > 0;

    const handleSave = () => {
        if (!canSave) return;
        onSave({
            id: editingId ?? undefined,
            emoji,
            label: label.trim(),
            monthlyAmount: num(amount),
            effectiveYear: Math.round(num(effYear)) || defaultYear,
            effectiveMonth: Math.min(12, Math.max(1, Math.round(num(effMonth)) || 1)),
            active: true,
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
                        Other income
                    </div>
                    <h2 className="display mt-1" style={{ fontSize: 26, lineHeight: 1.1 }}>
                        Income sources
                    </h2>
                    <div className="text-[12px] text-ink-2 mt-1">
                        Add recurring income beyond your salary — freelance, dividends, rental. Each counts every month from its start.
                    </div>
                </div>

                {/* Existing sources */}
                <div className="px-6 md:px-7 flex flex-col gap-2">
                    {sources.length === 0 && (
                        <div className="text-[13px] text-ink-2 py-2">
                            No extra income yet. Add your first stream below.
                        </div>
                    )}
                    {sources.map((s) => (
                        <div
                            key={s.id}
                            className="flex items-center gap-3 p-3 rounded-[14px]"
                            style={{
                                background: 'var(--color-bg-1)',
                                border: editingId === s.id ? '1px solid oklch(0.82 0.12 88)' : '1px solid var(--color-line-soft)',
                                opacity: s.active ? 1 : 0.55,
                            }}
                        >
                            <div
                                className="w-10 h-10 rounded-[10px] bg-bg-card flex items-center justify-center flex-shrink-0 text-[18px]"
                                style={{ border: '1px solid var(--color-line-soft)' }}
                            >
                                {s.emoji}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-[13px] font-medium truncate">
                                    {s.label}
                                    {!s.active && <span className="text-ink-2 font-normal"> · paused</span>}
                                </div>
                                <div className="text-[11px] text-ink-2 mono mt-0.5">
                                    {formatMoney(s.monthlyAmount)}/mo · from {MONTH_NAMES[s.month - 1].slice(0, 3)} {s.year}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => onToggle(s.id, !s.active)}
                                disabled={pending}
                                className="h-7 px-2.5 rounded-full text-[11px] font-medium border border-line hover:border-ink-2 transition-all disabled:opacity-40"
                                aria-label={s.active ? 'Pause this source' : 'Resume this source'}
                            >
                                {s.active ? 'Pause' : 'Resume'}
                            </button>
                            <button
                                type="button"
                                onClick={() => loadRow(s)}
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-1 hover:bg-bg-2 transition-colors"
                                aria-label="Edit this source"
                            >
                                <EditIcon size={13} />
                            </button>
                            <button
                                type="button"
                                onClick={() => onDelete(s.id)}
                                disabled={pending}
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-2 hover:bg-bg-2 hover:text-red-500 transition-colors disabled:opacity-40"
                                aria-label="Delete this source"
                            >
                                <CloseIcon size={13} />
                            </button>
                        </div>
                    ))}
                </div>

                {/* Add / edit form */}
                <div className="px-6 md:px-7 pt-4 pb-2 mt-2 flex flex-col gap-3" style={{ borderTop: '1px solid var(--color-line-soft)' }}>
                    <div className="text-[11px] text-on-soft uppercase tracking-[0.1em] font-semibold">
                        {editingId !== null ? 'Edit source' : 'Add income source'}
                    </div>
                    <EmojiPicker value={emoji} onChange={setEmoji} />
                    <div>
                        <div className="text-[10px] md:text-[11px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1.5">
                            Name
                        </div>
                        <input
                            type="text"
                            value={label}
                            onChange={(e) => setLabel(e.target.value)}
                            placeholder="e.g. Freelance, Dividends, Rental"
                            maxLength={40}
                            className="w-full px-3 py-2.5 rounded-xl border border-line bg-bg-1 outline-none text-[14px] focus:border-gold-400"
                            aria-label="Name"
                        />
                    </div>
                    <MoneyField label="Amount per month" value={amount} onChange={setAmount} />
                    <div className="grid grid-cols-2 gap-3">
                        <MonthGridDropdown
                            label="Starts"
                            value={Math.min(12, Math.max(1, Math.round(num(effMonth)) || 1))}
                            onChange={(m) => setEffMonth(String(m))}
                        />
                        <YearStepper value={effYear} onChange={setEffYear} />
                    </div>
                </div>

                <div className="px-6 md:px-7 py-5 flex items-center gap-2.5">
                    {editingId !== null && (
                        <button
                            type="button"
                            onClick={resetForm}
                            className="h-10 px-4 rounded-full border border-line bg-bg-card text-sm font-medium hover:border-ink-2 transition-all"
                        >
                            New source
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
                        <PlusIcon size={14} /> {editingId !== null ? 'Save' : 'Add'}
                    </button>
                </div>
            </motion.div>
        </motion.div>
    );
}

export function IncomeSourceModal({ open, sources, defaultYear, pending, onClose, onSave, onDelete, onToggle }: Props) {
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
                    key="income-sources"
                    sources={sources}
                    defaultYear={defaultYear}
                    pending={pending}
                    onClose={onClose}
                    onSave={onSave}
                    onDelete={onDelete}
                    onToggle={onToggle}
                />
            )}
        </AnimatePresence>
    );
}
