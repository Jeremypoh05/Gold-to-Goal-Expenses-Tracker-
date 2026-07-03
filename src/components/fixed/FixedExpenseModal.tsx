'use client';

// ADDED (Module 4): add/edit a fixed/recurring expense. Label auto-suggests an
// emoji + best-fit category (local keyword map now; Claude Haiku when configured),
// both overridable. Amount + due-day + start month + optional end. Mirrors the
// app's modal shell + shared pickers; delete is red with an explicit confirm.

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PlusIcon, ChevronIcon } from '@/components/icons';
import { formatMoney, MONTH_NAMES } from '@/lib/utils';
import { CATEGORIES } from '@/data/categories';
import { suggestFixedMetaLocal, type UiFixedExpense } from '@/lib/expense-utils';
import type { CategoryKey } from '@/types';
import { CloseIcon, MoneyField, MonthGridDropdown, YearStepper, num } from '@/components/income/pickers';

const EMOJI_CHOICES = [
    '🏠', '🛡️', '👨‍👩‍👧', '🚌', '🚗', '📱', '🌐', '💡',
    '🚰', '💳', '🎬', '🏋️', '💊', '🍽️', '📚', '📌',
];
const CAT_KEYS: CategoryKey[] = ['bills', 'trans', 'food', 'health', 'ent', 'shop', 'other'];

export interface FixedExpenseForm {
    id?: number;
    label: string;
    note: string | null;
    emoji: string;
    category: CategoryKey;
    monthlyAmount: number;
    dueDay: number;
    startYear: number;
    startMonth: number;
    endYear: number | null;
    endMonth: number | null;
}

interface Props {
    open: boolean;
    item: UiFixedExpense | null; // null = add
    defaultYear: number;
    pending?: boolean;
    onClose: () => void;
    onSave: (v: FixedExpenseForm) => void;
    onDelete: (id: number) => void;
    /** AI (Claude Haiku) emoji + category suggester; label-only. */
    onSuggest: (label: string) => Promise<{ emoji: string; category: CategoryKey }>;
    /** Guided rate change: cap old at month-before, start new from the change month. */
    onChangeAmount: (v: { id: number; fromYear: number; fromMonth: number; newAmount: number }) => void;
}

function hue(cat: CategoryKey) {
    return CATEGORIES[cat]?.hue ?? 80;
}

/** Emoji on a category-hued tile (theme-safe: neutral fill + coloured ring). */
export function FixedTile({ emoji, cat, size = 40 }: { emoji: string; cat: CategoryKey; size?: number }) {
    return (
        <div
            className="flex items-center justify-center flex-shrink-0"
            style={{
                width: size,
                height: size,
                borderRadius: size * 0.3,
                background: `oklch(0.72 0.14 ${hue(cat)} / 0.14)`,
                border: `1px solid oklch(0.7 0.14 ${hue(cat)} / 0.4)`,
                fontSize: size * 0.5,
            }}
        >
            {emoji}
        </div>
    );
}

function DayStepper({ value, onChange }: { value: number; onChange: (d: number) => void }) {
    const set = (d: number) => onChange(Math.min(31, Math.max(1, d)));
    return (
        <div>
            <div className="text-[10px] md:text-[11px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1.5">
                Due day
            </div>
            <div className="flex items-center rounded-xl border border-line bg-bg-1 overflow-hidden h-[44px]">
                <button type="button" onClick={() => set(value - 1)} className="px-3.5 h-full text-ink-1 hover:bg-bg-2 transition-colors text-lg leading-none" aria-label="Earlier day">−</button>
                <span className="flex-1 text-center mono text-[15px] font-semibold">{value}</span>
                <button type="button" onClick={() => set(value + 1)} className="px-3.5 h-full text-ink-1 hover:bg-bg-2 transition-colors text-lg leading-none" aria-label="Later day">+</button>
            </div>
        </div>
    );
}

function Content({ item, defaultYear, pending, onClose, onSave, onDelete, onSuggest, onChangeAmount }: Omit<Props, 'open'>) {
    const editing = item != null;
    const nowY = new Date().getFullYear();
    const nowM = new Date().getMonth() + 1;
    const [mode, setMode] = useState<'form' | 'change'>('form');
    // Rate-change sub-form
    const [chAmount, setChAmount] = useState('');
    const [chFromYear, setChFromYear] = useState(String(nowY));
    const [chFromMonth, setChFromMonth] = useState(String(nowM));
    const initSuggest = suggestFixedMetaLocal(item?.label ?? '');

    const [label, setLabel] = useState(item?.label ?? '');
    const [note, setNote] = useState(item?.note ?? '');
    const [emoji, setEmoji] = useState(item?.emoji ?? initSuggest.emoji);
    const [category, setCategory] = useState<CategoryKey>(item?.category ?? initSuggest.category);
    const [amount, setAmount] = useState(item ? String(item.amount) : '');
    const [dueDay, setDueDay] = useState(item?.dueDay ?? 1);
    const [startYear, setStartYear] = useState(String(item?.startYear ?? defaultYear));
    const [startMonth, setStartMonth] = useState(String(item?.startMonth ?? (new Date().getMonth() + 1)));
    const [endEnabled, setEndEnabled] = useState(item?.endYear != null);
    const [endYear, setEndYear] = useState(String(item?.endYear ?? defaultYear));
    const [endMonth, setEndMonth] = useState(String(item?.endMonth ?? 12));
    // Track manual overrides so auto-suggest doesn't clobber a user's choice.
    const [emojiTouched, setEmojiTouched] = useState(editing);
    const [catTouched, setCatTouched] = useState(editing);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const clampM = (v: string) => Math.min(12, Math.max(1, Math.round(num(v)) || 1));

    const onLabelChange = (v: string) => {
        setLabel(v);
        // Instant local suggestion while the user types, unless they've overridden.
        const s = suggestFixedMetaLocal(v);
        if (!emojiTouched) setEmoji(s.emoji);
        if (!catTouched) setCategory(s.category);
    };

    // Refine the local guess with the AI suggester (debounced), unless the user has
    // manually picked an emoji + category. Races are avoided by re-checking the label.
    useEffect(() => {
        const l = label.trim();
        if (!l || (emojiTouched && catTouched)) return;
        const t = setTimeout(async () => {
            try {
                const s = await onSuggest(l);
                if (label.trim() !== l) return; // stale
                if (!emojiTouched) setEmoji(s.emoji);
                if (!catTouched) setCategory(s.category);
            } catch {
                /* keep local guess */
            }
        }, 500);
        return () => clearTimeout(t);
    }, [label, emojiTouched, catTouched, onSuggest]);

    const canSave = num(amount) > 0 && label.trim().length > 0;

    const handleSave = () => {
        if (!canSave) return;
        onSave({
            id: item?.id,
            label: label.trim(),
            note: note.trim() || null,
            emoji,
            category,
            monthlyAmount: num(amount),
            dueDay,
            startYear: Math.round(num(startYear)) || defaultYear,
            startMonth: clampM(startMonth),
            endYear: endEnabled ? Math.round(num(endYear)) || defaultYear : null,
            endMonth: endEnabled ? clampM(endMonth) : null,
        });
    };

    const canApplyChange = num(chAmount) > 0 && item != null;
    const applyChange = () => {
        if (!canApplyChange || !item) return;
        onChangeAmount({
            id: item.id,
            fromYear: Math.round(num(chFromYear)) || nowY,
            fromMonth: clampM(chFromMonth),
            newAmount: num(chAmount),
        });
    };

    return (
        <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}
            onClick={onClose}
            className="fixed inset-0 z-50 flex items-end md:items-center justify-center md:p-6"
            style={{ background: 'rgba(30, 20, 5, 0.4)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
        >
            <motion.div
                initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 24, scale: 0.98 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                onClick={(e) => e.stopPropagation()}
                className="bg-bg-card rounded-t-[24px] md:rounded-[24px] shadow-2xl relative w-full md:w-[min(540px,100%)] flex flex-col"
                style={{ maxHeight: '90vh' }}
            >
                {/* Header */}
                <div className="px-6 md:px-7 pt-6 pb-4 flex items-start gap-3" style={{ borderBottom: '1px solid var(--color-line-soft)' }}>
                    {mode === 'change' && (
                        <button onClick={() => setMode('form')} type="button" className="w-9 h-9 -ml-1.5 rounded-xl bg-bg-1 hover:bg-bg-2 flex items-center justify-center text-ink-1 transition-colors flex-shrink-0" aria-label="Back">
                            <ChevronIcon direction="left" size={15} />
                        </button>
                    )}
                    <div className="flex-1 min-w-0">
                        <div className="text-[11px] text-on-soft uppercase tracking-[0.14em] font-semibold">Fixed expense</div>
                        <h2 className="display mt-0.5" style={{ fontSize: 22, lineHeight: 1.1 }}>{mode === 'change' ? 'Rate change' : editing ? 'Edit fixed expense' : 'Add fixed expense'}</h2>
                    </div>
                    <button onClick={onClose} type="button" className="w-9 h-9 rounded-xl bg-bg-1 hover:bg-bg-2 flex items-center justify-center text-ink-1 transition-colors flex-shrink-0" aria-label="Close">
                        <CloseIcon size={14} />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 min-h-0 overflow-y-auto px-6 md:px-7 py-4 flex flex-col gap-3.5" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
                  {mode === 'change' && item ? (
                    <>
                        <div className="text-[12px] text-ink-1 leading-snug p-3 rounded-[14px]" style={{ background: 'var(--color-bg-1)', border: '1px solid var(--color-line-soft)' }}>
                            <b>{item.label}</b> will keep its current amount up to the month before the change, then a new rate applies from the chosen month onward. Past entries stay as they were.
                        </div>
                        <MoneyField label="New amount per month" value={chAmount} onChange={setChAmount} />
                        <div className="grid grid-cols-2 gap-3">
                            <MonthGridDropdown label="Changed from" value={clampM(chFromMonth)} onChange={(m) => setChFromMonth(String(m))} />
                            <YearStepper value={chFromYear} onChange={setChFromYear} />
                        </div>
                    </>
                  ) : (<>
                    {/* Live preview */}
                    <div className="flex items-center gap-3 p-3 rounded-[14px]" style={{ background: 'var(--color-bg-1)', border: '1px solid var(--color-line-soft)' }}>
                        <FixedTile emoji={emoji} cat={category} size={44} />
                        <div className="flex-1 min-w-0">
                            <div className="text-[14px] font-semibold truncate">{label.trim() || 'New fixed expense'}</div>
                            <div className="text-[11px] text-ink-2 mono">
                                {num(amount) > 0 ? formatMoney(num(amount)) : 'S$ —'}/mo · {CATEGORIES[category].label} · day {dueDay}
                            </div>
                        </div>
                    </div>

                    <div>
                        <div className="text-[10px] md:text-[11px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1.5">Name</div>
                        <input type="text" value={label} onChange={(e) => onLabelChange(e.target.value)} placeholder="e.g. Rent, Phone bill, Family support, Netflix" maxLength={40} className="w-full px-3 py-2.5 rounded-xl border border-line bg-bg-1 outline-none text-[14px] focus:border-gold-400" aria-label="Name" autoFocus={!editing} />
                        <div className="text-[10px] text-ink-3 mt-1">Icon &amp; category are auto-picked from the name — tap to override.</div>
                    </div>

                    {/* Emoji picker */}
                    <div>
                        <div className="text-[10px] md:text-[11px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1.5">Icon</div>
                        <div className="grid grid-cols-8 gap-1.5">
                            {EMOJI_CHOICES.map((e) => {
                                const sel = emoji === e;
                                return (
                                    <button key={e} type="button" onClick={() => { setEmoji(e); setEmojiTouched(true); }}
                                        className="aspect-square rounded-xl text-[18px] flex items-center justify-center transition-all hover:brightness-[1.05]"
                                        style={sel ? { background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))', boxShadow: 'var(--shadow-gold)' } : { background: 'var(--color-bg-1)', border: '1px solid var(--color-line-soft)' }}
                                        aria-pressed={sel}>
                                        {e}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Category picker */}
                    <div>
                        <div className="text-[10px] md:text-[11px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1.5">Category</div>
                        <div className="flex flex-wrap gap-1.5">
                            {CAT_KEYS.map((k) => {
                                const sel = category === k;
                                return (
                                    <button key={k} type="button" onClick={() => { setCategory(k); setCatTouched(true); }}
                                        className="h-8 px-3 rounded-full text-[12px] font-medium transition-all"
                                        style={sel
                                            ? { background: `oklch(0.72 0.14 ${hue(k)} / 0.16)`, border: `1px solid oklch(0.7 0.14 ${hue(k)} / 0.6)`, color: `oklch(0.5 0.13 ${hue(k)})` }
                                            : { background: 'var(--color-bg-1)', border: '1px solid var(--color-line-soft)', color: 'var(--color-ink-2)' }}>
                                        {CATEGORIES[k].label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div>
                        <div className="text-[10px] md:text-[11px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1.5">Note <span className="text-ink-3 normal-case tracking-normal">· optional</span></div>
                        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. electric + phone bill" maxLength={80} className="w-full px-3 py-2.5 rounded-xl border border-line bg-bg-1 outline-none text-[14px] focus:border-gold-400" aria-label="Note" />
                    </div>

                    <MoneyField label="Amount per month" value={amount} onChange={setAmount} />
                    <DayStepper value={dueDay} onChange={setDueDay} />

                    <div className="grid grid-cols-2 gap-3">
                        <MonthGridDropdown label="Starts" value={clampM(startMonth)} onChange={(m) => setStartMonth(String(m))} />
                        <YearStepper value={startYear} onChange={setStartYear} />
                    </div>

                    {/* End control */}
                    <button type="button" onClick={() => setEndEnabled((e) => !e)} className="flex items-center gap-3 p-3 rounded-[14px] text-left transition-colors" style={{ background: 'var(--color-bg-1)', border: '1px solid var(--color-line-soft)' }} aria-pressed={endEnabled}>
                        <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-medium">Has an end month</div>
                            <div className="text-[11px] text-ink-2 mt-0.5">{endEnabled ? 'Stops generating after the end month' : 'Ongoing — no end'}</div>
                        </div>
                        <span className="relative w-11 h-6 rounded-full flex-shrink-0 transition-colors" style={{ background: endEnabled ? 'oklch(0.74 0.155 82)' : 'var(--color-line)' }}>
                            <motion.span className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm" animate={{ left: endEnabled ? 22 : 2 }} transition={{ type: 'spring', stiffness: 500, damping: 32 }} />
                        </span>
                    </button>
                    {endEnabled && (
                        <div className="grid grid-cols-2 gap-3">
                            <MonthGridDropdown label="Ends" value={clampM(endMonth)} onChange={(m) => setEndMonth(String(m))} />
                            <YearStepper value={endYear} onChange={setEndYear} />
                        </div>
                    )}

                    {editing && (
                        <button
                            type="button"
                            onClick={() => { setChAmount(''); setChFromYear(String(nowY)); setChFromMonth(String(nowM)); setMode('change'); }}
                            className="flex items-center gap-2.5 p-3 rounded-[14px] text-left transition-colors hover:brightness-[1.02]"
                            style={{ background: 'var(--color-bg-1)', border: '1px dashed var(--color-line)' }}
                        >
                            <span className="text-[16px]">📈</span>
                            <div className="flex-1 min-w-0">
                                <div className="text-[13px] font-medium">Amount changed from a month?</div>
                                <div className="text-[11px] text-ink-2 mt-0.5">e.g. rent went up — keep past months, apply the new rate onward</div>
                            </div>
                            <ChevronIcon direction="right" size={14} className="text-ink-3" />
                        </button>
                    )}

                    {editing && (
                        confirmDelete ? (
                            <div className="flex items-center gap-2 p-2.5 rounded-[14px]" style={{ background: 'oklch(0.63 0.2 25 / 0.09)', border: '1px solid oklch(0.63 0.2 25 / 0.4)' }}>
                                <span className="flex-1 text-[12px] font-medium" style={{ color: 'oklch(0.55 0.2 25)' }}>Delete this fixed expense?</span>
                                <button type="button" onClick={() => setConfirmDelete(false)} className="h-8 px-3 rounded-full border border-line bg-bg-card text-[12px] font-medium hover:border-ink-2 transition-all">Cancel</button>
                                <button type="button" onClick={() => item && onDelete(item.id)} disabled={pending} className="h-8 px-3.5 rounded-full text-[12px] font-semibold text-white transition-all disabled:opacity-40 hover:brightness-[1.05]" style={{ background: 'oklch(0.58 0.21 25)' }}>Delete</button>
                            </div>
                        ) : (
                            <button type="button" onClick={() => setConfirmDelete(true)} disabled={pending} className="self-start h-9 px-3.5 rounded-full text-[12px] font-semibold transition-all disabled:opacity-40 hover:brightness-[1.03]" style={{ color: 'oklch(0.55 0.2 25)', border: '1px solid oklch(0.63 0.2 25 / 0.4)', background: 'oklch(0.63 0.2 25 / 0.06)' }}>
                                Delete this fixed expense
                            </button>
                        )
                    )}

                    <div className="text-[11px] text-ink-3 leading-snug">
                        Generates a real expense on day {dueDay} each month from {MONTH_NAMES[clampM(startMonth) - 1]} {Math.round(num(startYear)) || defaultYear}. Past months aren&rsquo;t back-filled; you can edit or delete any month&rsquo;s entry in the ledger.
                    </div>
                  </>)}
                </div>

                {/* Footer */}
                <div className="px-6 md:px-7 py-4 flex items-center gap-2.5" style={{ borderTop: '1px solid var(--color-line-soft)', paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}>
                    {mode === 'change' ? (
                        <>
                            <button type="button" onClick={() => setMode('form')} className="h-11 px-5 rounded-full border border-line bg-bg-card text-sm font-medium hover:border-ink-2 transition-all">Back</button>
                            <div className="flex-1" />
                            <button type="button" onClick={applyChange} disabled={!canApplyChange || pending} className="h-11 px-6 rounded-full text-sm font-semibold flex items-center gap-2 hover:brightness-[1.03] transition-all disabled:opacity-40" style={{ background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))', color: '#1a120a', boxShadow: 'var(--shadow-gold)' }}>
                                Apply change
                            </button>
                        </>
                    ) : (
                        <>
                            <button type="button" onClick={onClose} className="h-11 px-5 rounded-full border border-line bg-bg-card text-sm font-medium hover:border-ink-2 transition-all">Cancel</button>
                            <div className="flex-1" />
                            <button type="button" onClick={handleSave} disabled={!canSave || pending} className="h-11 px-6 rounded-full text-sm font-semibold flex items-center gap-2 hover:brightness-[1.03] transition-all disabled:opacity-40" style={{ background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))', color: '#1a120a', boxShadow: 'var(--shadow-gold)' }}>
                                <PlusIcon size={14} /> {editing ? 'Save' : 'Add'}
                            </button>
                        </>
                    )}
                </div>
            </motion.div>
        </motion.div>
    );
}

export function FixedExpenseModal({ open, item, defaultYear, pending, onClose, onSave, onDelete, onSuggest, onChangeAmount }: Props) {
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
                    key={item ? `edit-${item.id}` : 'add'}
                    item={item}
                    defaultYear={defaultYear}
                    pending={pending}
                    onClose={onClose}
                    onSave={onSave}
                    onDelete={onDelete}
                    onSuggest={onSuggest}
                    onChangeAmount={onChangeAmount}
                />
            )}
        </AnimatePresence>
    );
}
