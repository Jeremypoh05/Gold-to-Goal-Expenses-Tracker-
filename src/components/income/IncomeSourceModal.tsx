'use client';

// ADDED (Phase 9): manage custom recurring income beyond salary — freelance,
// dividends, rental, etc. Each source contributes its monthly amount to every
// month on/after its start, until paused.
//
// CHANGED (Phase 9 · scalable UI): master–detail. The modal has two internal views
// that swap in place — a compact, scrollable LIST (with a sticky total header and a
// pinned "Add" action so it's always reachable no matter how long the list grows),
// and a focused EDIT panel. This replaces the old "full list + form permanently
// stapled to the bottom", which got frustrating to scroll once sources piled up.
// Mirrors the app's modal shell (mobile sheet / desktop centered, ESC + backdrop,
// body-scroll lock) and the shared modern pickers.

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PlusIcon, ChevronIcon } from '@/components/icons';
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
    recurring: boolean;
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

// ── One compact source row (list view). Tap the row to edit; the pause toggle
//    stops propagation so it doesn't also open the editor. ──────────────────
function SourceRow({
    s,
    pending,
    onEdit,
    onToggle,
}: {
    s: UiIncomeSource;
    pending?: boolean;
    onEdit: () => void;
    onToggle: () => void;
}) {
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onEdit}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onEdit();
                }
            }}
            className="group flex items-center gap-3 p-2.5 rounded-[14px] cursor-pointer transition-colors hover:brightness-[1.02]"
            style={{
                background: 'var(--color-bg-1)',
                border: '1px solid var(--color-line-soft)',
                opacity: s.active ? 1 : 0.6,
            }}
        >
            <div
                className="w-9 h-9 rounded-[10px] bg-bg-card flex items-center justify-center flex-shrink-0 text-[17px]"
                style={{ border: '1px solid var(--color-line-soft)' }}
            >
                {s.emoji}
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate">
                    {s.label}
                    {!s.active && <span className="text-ink-2 font-normal"> · paused</span>}
                </div>
                <div className="text-[11px] text-ink-2 mono">
                    {s.recurring
                        ? `${formatMoney(s.monthlyAmount)}/mo · from ${MONTH_NAMES[s.month - 1].slice(0, 3)} ${s.year}`
                        : `${formatMoney(s.monthlyAmount)} · ${MONTH_NAMES[s.month - 1].slice(0, 3)} ${s.year} · one-off`}
                </div>
            </div>
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    onToggle();
                }}
                disabled={pending}
                className="h-7 px-2.5 rounded-full text-[11px] font-medium border border-line hover:border-ink-2 transition-all disabled:opacity-40 flex-shrink-0"
                aria-label={s.active ? 'Pause this source' : 'Resume this source'}
            >
                {s.active ? 'Pause' : 'Resume'}
            </button>
            <ChevronIcon direction="right" size={14} className="text-ink-3 flex-shrink-0" />
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
    // Two in-place views: the list, and a focused add/edit panel.
    const [mode, setMode] = useState<'list' | 'edit'>('list');
    const [editingId, setEditingId] = useState<number | null>(null);
    const [emoji, setEmoji] = useState('💰');
    const [label, setLabel] = useState('');
    const [amount, setAmount] = useState('');
    const [effYear, setEffYear] = useState(String(defaultYear));
    const [effMonth, setEffMonth] = useState('1');
    const [recurring, setRecurring] = useState(true);

    const activeTotal = sources
        .filter((s) => s.active)
        .reduce((a, s) => a + s.monthlyAmount, 0);
    // Active first, then by amount — matches the card ordering.
    const ordered = [...sources].sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return b.monthlyAmount - a.monthlyAmount;
    });

    const openAdd = () => {
        setEditingId(null);
        setEmoji('💰');
        setLabel('');
        setAmount('');
        setEffYear(String(defaultYear));
        setEffMonth('1');
        setRecurring(true);
        setMode('edit');
    };

    const openEdit = (s: UiIncomeSource) => {
        setEditingId(s.id);
        setEmoji(s.emoji || '💰');
        setLabel(s.label);
        setAmount(String(s.monthlyAmount || ''));
        setEffYear(String(s.year));
        setEffMonth(String(s.month));
        setRecurring(s.recurring);
        setMode('edit');
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
            recurring,
            active: true,
        });
        setMode('list');
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
                className="bg-bg-card rounded-t-[24px] md:rounded-[24px] shadow-2xl relative w-full md:w-[min(520px,100%)] flex flex-col"
                style={{ maxHeight: '88vh' }}
            >
                {/* ── Sticky header ── */}
                <div className="px-6 md:px-7 pt-6 pb-4 flex items-start gap-3" style={{ borderBottom: '1px solid var(--color-line-soft)' }}>
                    {mode === 'edit' && (
                        <button
                            onClick={() => setMode('list')}
                            type="button"
                            className="w-9 h-9 -ml-1.5 rounded-xl bg-bg-1 hover:bg-bg-2 flex items-center justify-center text-ink-1 transition-colors flex-shrink-0"
                            aria-label="Back to list"
                        >
                            <ChevronIcon direction="left" size={15} />
                        </button>
                    )}
                    <div className="flex-1 min-w-0">
                        <div className="text-[11px] text-on-soft uppercase tracking-[0.14em] font-semibold">
                            Other income
                        </div>
                        <h2 className="display mt-0.5" style={{ fontSize: 22, lineHeight: 1.1 }}>
                            {mode === 'edit'
                                ? editingId !== null
                                    ? 'Edit source'
                                    : 'Add income source'
                                : 'Income sources'}
                        </h2>
                    </div>
                    {/* Live total (list view only) */}
                    {mode === 'list' && sources.length > 0 && (
                        <div className="text-right flex-shrink-0">
                            <div className="mono font-semibold text-[16px]">{formatMoney(activeTotal)}</div>
                            <div className="text-[10px] text-ink-2 uppercase tracking-[0.06em]">/mo active</div>
                        </div>
                    )}
                    <button
                        onClick={onClose}
                        type="button"
                        className="w-9 h-9 rounded-xl bg-bg-1 hover:bg-bg-2 flex items-center justify-center text-ink-1 transition-colors flex-shrink-0"
                        aria-label="Close"
                    >
                        <CloseIcon size={14} />
                    </button>
                </div>

                {/* ── Swappable body ── */}
                <div className="flex-1 min-h-0 overflow-y-auto" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
                    <AnimatePresence mode="wait" initial={false}>
                        {mode === 'list' ? (
                            <motion.div
                                key="list"
                                initial={{ opacity: 0, x: -12 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -12 }}
                                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                                className="px-6 md:px-7 py-4 flex flex-col gap-2"
                            >
                                {sources.length === 0 ? (
                                    <div className="text-[13px] text-ink-2 py-6 text-center">
                                        No extra income yet.
                                        <br />
                                        Add your first stream below.
                                    </div>
                                ) : (
                                    ordered.map((s) => (
                                        <SourceRow
                                            key={s.id}
                                            s={s}
                                            pending={pending}
                                            onEdit={() => openEdit(s)}
                                            onToggle={() => onToggle(s.id, !s.active)}
                                        />
                                    ))
                                )}
                            </motion.div>
                        ) : (
                            <motion.div
                                key="edit"
                                initial={{ opacity: 0, x: 12 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 12 }}
                                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                                className="px-6 md:px-7 py-4 flex flex-col gap-3.5"
                            >
                                {/* Live preview of the row being built */}
                                <div
                                    className="flex items-center gap-3 p-3 rounded-[14px]"
                                    style={{ background: 'linear-gradient(135deg, var(--grad-soft-a), var(--grad-soft-b))', border: '1px solid oklch(0.88 0.07 88)' }}
                                >
                                    <div className="w-11 h-11 rounded-[12px] bg-bg-card flex items-center justify-center flex-shrink-0 text-[22px]" style={{ border: '1px solid var(--color-line-soft)' }}>
                                        {emoji}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[14px] font-semibold truncate">{label.trim() || 'New income source'}</div>
                                        <div className="text-[11px] text-ink-2 mono">
                                            {num(amount) > 0 ? formatMoney(num(amount)) : 'S$ —'}
                                            {recurring
                                                ? `/mo · from ${MONTH_NAMES[Math.min(12, Math.max(1, Math.round(num(effMonth)) || 1)) - 1].slice(0, 3)} ${Math.round(num(effYear)) || defaultYear}`
                                                : ` · ${MONTH_NAMES[Math.min(12, Math.max(1, Math.round(num(effMonth)) || 1)) - 1].slice(0, 3)} ${Math.round(num(effYear)) || defaultYear} · one-off`}
                                        </div>
                                    </div>
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
                                <MoneyField label={recurring ? 'Amount per month' : 'Amount'} value={amount} onChange={setAmount} />

                                {/* Recurring toggle — off = a single month's income (one-off) */}
                                <button
                                    type="button"
                                    onClick={() => setRecurring((r) => !r)}
                                    className="flex items-center gap-3 p-3 rounded-[14px] text-left transition-colors"
                                    style={{ background: 'var(--color-bg-1)', border: '1px solid var(--color-line-soft)' }}
                                    aria-pressed={recurring}
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[13px] font-medium">Recurring every month</div>
                                        <div className="text-[11px] text-ink-2 mt-0.5">
                                            {recurring ? 'Counts every month from its start' : 'Counts once, in the chosen month only'}
                                        </div>
                                    </div>
                                    <span
                                        className="relative w-11 h-6 rounded-full flex-shrink-0 transition-colors"
                                        style={{ background: recurring ? 'oklch(0.74 0.155 82)' : 'var(--color-line)' }}
                                    >
                                        <motion.span
                                            className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm"
                                            animate={{ left: recurring ? 22 : 2 }}
                                            transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                                        />
                                    </span>
                                </button>

                                <div className="grid grid-cols-2 gap-3">
                                    <MonthGridDropdown
                                        label={recurring ? 'Starts' : 'Month'}
                                        value={Math.min(12, Math.max(1, Math.round(num(effMonth)) || 1))}
                                        onChange={(m) => setEffMonth(String(m))}
                                    />
                                    <YearStepper value={effYear} onChange={setEffYear} />
                                </div>

                                {editingId !== null && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            onDelete(editingId);
                                            setMode('list');
                                        }}
                                        disabled={pending}
                                        className="self-start text-[12px] font-medium text-ink-2 hover:text-red-500 transition-colors disabled:opacity-40"
                                    >
                                        Delete this source
                                    </button>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* ── Sticky footer action ── */}
                <div className="px-6 md:px-7 py-4 flex items-center gap-2.5" style={{ borderTop: '1px solid var(--color-line-soft)', paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}>
                    {mode === 'list' ? (
                        <button
                            type="button"
                            onClick={openAdd}
                            className="w-full h-11 rounded-full text-sm font-semibold flex items-center justify-center gap-2 hover:brightness-[1.03] transition-all"
                            style={{
                                background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))',
                                color: '#1a120a',
                                boxShadow: 'var(--shadow-gold)',
                            }}
                        >
                            <PlusIcon size={16} /> Add income source
                        </button>
                    ) : (
                        <>
                            <button
                                type="button"
                                onClick={() => setMode('list')}
                                className="h-11 px-5 rounded-full border border-line bg-bg-card text-sm font-medium hover:border-ink-2 transition-all"
                            >
                                Cancel
                            </button>
                            <div className="flex-1" />
                            <button
                                type="button"
                                onClick={handleSave}
                                disabled={!canSave || pending}
                                className="h-11 px-6 rounded-full text-sm font-semibold flex items-center gap-2 hover:brightness-[1.03] transition-all disabled:opacity-40"
                                style={{
                                    background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))',
                                    color: '#1a120a',
                                    boxShadow: 'var(--shadow-gold)',
                                }}
                            >
                                <PlusIcon size={14} /> {editingId !== null ? 'Save' : 'Add'}
                            </button>
                        </>
                    )}
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
