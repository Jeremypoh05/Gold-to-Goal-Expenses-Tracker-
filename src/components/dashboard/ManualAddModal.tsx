'use client';

import { useState, useEffect, useRef, useTransition } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    CategoryTile,
    CalendarIcon,
    WalletIcon,
    SparkleIcon,
    TrashIcon,
} from '@/components/icons';
import { CATEGORIES } from '@/data/categories';
import { createExpense, updateExpense, deleteExpense } from '@/lib/actions';
import { currencyFromSymbol } from '@/lib/utils';
import { useExpenses } from '@/components/data/ExpensesContext';
import { useConfirm } from '@/components/shared';
import { useAddModal } from './AddModalContext';
import type { CategoryKey, Currency as CurrencyEnum, Expense } from '@/types';

const CATEGORY_KEYS: CategoryKey[] = [
    'food',
    'shop',
    'ent',
    'trans',
    'health',
    'bills',
    'other',
];

const CURRENCIES = ['S$', 'MYR', '¥'] as const;
type Currency = (typeof CURRENCIES)[number];

// ═══════════════════════════════════════════════════════════════
// Small icon helpers
// ═══════════════════════════════════════════════════════════════

function CloseIcon({ size = 14 }: { size?: number }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
        >
            <path d="M6 6 L18 18 M18 6 L6 18" />
        </svg>
    );
}

function CheckIcon({ size = 16 }: { size?: number }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M5 12 L10 17 L19 7" />
        </svg>
    );
}

function ClockIcon({ size = 16 }: { size?: number }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7 V12 L15 14" />
        </svg>
    );
}

function ChevronDownIcon({ size = 12 }: { size?: number }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M6 9 L12 15 L18 9" />
        </svg>
    );
}

// ═══════════════════════════════════════════════════════════════
// Field row (label + input-like display)
// ═══════════════════════════════════════════════════════════════

function FieldRow({
    label,
    value,
    icon,
    mono = false,
}: {
    label: string;
    value: string;
    icon: React.ReactNode;
    mono?: boolean;
}) {
    return (
        <div>
            <div className="text-[10px] md:text-[11px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1.5">
                {label}
            </div>
            <button
                className="w-full px-3 py-2.5 border border-line rounded-xl bg-bg-1 flex items-center gap-2 hover:bg-bg-card transition-colors cursor-pointer text-left"
                type="button"
            >
                <span className="text-ink-1 flex-shrink-0">{icon}</span>
                <span
                    className={`flex-1 text-[12px] md:text-[13px] font-medium truncate ${mono ? 'mono' : ''
                        }`}
                >
                    {value}
                </span>
                <span className="text-ink-3 flex-shrink-0">
                    <ChevronDownIcon size={12} />
                </span>
            </button>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
// Date + Time — CHANGED (Module 5.1): real editable inputs (were static
// display rows). Native date/time pickers keep it dependency-free and give a
// good mobile keyboard. This is what lets you backfill a past month's entry.
// ═══════════════════════════════════════════════════════════════

function DateTimeFields({
    date,
    setDate,
    time,
    setTime,
}: {
    date: string;
    setDate: (v: string) => void;
    time: string;
    setTime: (v: string) => void;
}) {
    const inputCls =
        'w-full px-3 py-2.5 border border-line rounded-xl bg-bg-1 text-[12px] md:text-[13px] outline-none focus:border-gold-400 focus:bg-bg-card transition-all mono';
    return (
        <div className="grid grid-cols-2 gap-3">
            <div>
                <label className="text-[10px] md:text-[11px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1.5 flex items-center gap-1.5">
                    <CalendarIcon size={12} /> Date
                </label>
                <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className={inputCls}
                    aria-label="Date"
                />
            </div>
            <div>
                <label className="text-[10px] md:text-[11px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1.5 flex items-center gap-1.5">
                    <ClockIcon size={12} /> Time
                </label>
                <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className={inputCls}
                    aria-label="Time"
                />
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
// Modal Body (shared between desktop + mobile)
// ═══════════════════════════════════════════════════════════════

interface ModalBodyProps {
    amount: string;
    setAmount: (v: string) => void;
    category: CategoryKey;
    setCategory: (c: CategoryKey) => void;
    currency: Currency;
    setCurrency: (c: Currency) => void;
    note: string;
    setNote: (v: string) => void;
    isMobile?: boolean;
}

function AmountSection({
    amount,
    setAmount,
    currency,
    setCurrency,
    isMobile,
}: Pick<ModalBodyProps, 'amount' | 'setAmount' | 'currency' | 'setCurrency' | 'isMobile'>) {
    const inputRef = useRef<HTMLInputElement>(null);

    // Auto-focus on mount (so native keyboard appears on mobile)
    useEffect(() => {
        const timer = setTimeout(() => {
            inputRef.current?.focus();
        }, 250);
        return () => clearTimeout(timer);
    }, []);

    // Format the displayed amount with separated decimal styling
    const [intPart, decPart] = amount.split('.');
    const formattedInt = intPart || '0';
    const formattedDec = decPart !== undefined ? decPart.padEnd(2, '0').slice(0, 2) : '00';

    return (
        <div
            className="rounded-[20px] md:rounded-[22px] py-5 md:py-6 px-4 md:px-6 text-center relative overflow-hidden cursor-text"
            style={{
                background:
                    'linear-gradient(145deg, oklch(0.97 0.05 92), oklch(0.92 0.09 88))',
                border: '1px solid oklch(0.88 0.08 88)',
            }}
            onClick={() => inputRef.current?.focus()}
        >
            {/* Hidden input that captures keystrokes (no numpad needed) */}
            <input
                ref={inputRef}
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                    // Only allow numbers and one decimal point
                    const v = e.target.value.replace(/[^0-9.]/g, '');
                    // Prevent multiple decimals
                    const parts = v.split('.');
                    const cleaned = parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : v;
                    // Limit to 2 decimal places
                    const [int, dec] = cleaned.split('.');
                    const final = dec !== undefined ? `${int}.${dec.slice(0, 2)}` : cleaned;
                    setAmount(final);
                }}
                className="absolute opacity-0 pointer-events-none"
                aria-label="Amount"
            />

            <div className="text-[10px] text-gold-900 uppercase tracking-[0.14em] font-semibold">
                Amount
            </div>

            {/* Big visual display - tap to focus the hidden input */}
            <div
                className="display-number mt-1 select-none"
                style={{
                    fontSize: isMobile ? 'clamp(40px, 12vw, 56px)' : 64,
                    lineHeight: 1,
                    // FIX (dark mode): the amount card stays light gold in both themes, so the
                    // integer must be a fixed dark — theme ink would turn white & vanish here.
                    color: '#2a1805',
                }}
            >
                <span
                    style={{
                        fontSize: '0.4em',
                        color: 'var(--color-gold-700)',
                        marginRight: 4,
                    }}
                >
                    {currency}
                </span>
                {formattedInt}
                <span style={{ color: 'var(--color-gold-700)' }}>.{formattedDec}</span>
                {/* Cursor blink effect */}
                {/* FIX: caret was a layout character on the right, so `text-center` centered
                    "S$12.80|" as a whole and pushed the visible amount slightly left. Rendering
                    it as a zero-width inline-block keeps the glyph but removes its layout width,
                    so "S$12.80" now centers as a unit (mobile + desktop). */}
                <motion.span
                    animate={{ opacity: [1, 0, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                    style={{
                        color: 'var(--color-gold-500)',
                        display: 'inline-block',
                        width: 0,
                    }}
                >
                    |
                </motion.span>
            </div>

            {/* Currency pills */}
            <div className="mt-3 flex justify-center gap-1.5">
                {CURRENCIES.map((c) => (
                    <button
                        key={c}
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            setCurrency(c);
                        }}
                        className="chip transition-all"
                        style={{
                            background: c === currency ? '#fff' : 'transparent',
                            fontSize: isMobile ? 10 : 12,
                            cursor: 'pointer',
                        }}
                    >
                        {c}
                    </button>
                ))}
            </div>

            {/* Helper hint */}
            <div className="mt-2 text-[10px] text-gold-900 opacity-60">
                Type to enter amount
            </div>
        </div>
    );
}

function CategoryGrid({
    category,
    setCategory,
    isMobile,
}: Pick<ModalBodyProps, 'category' | 'setCategory' | 'isMobile'>) {
    return (
        <div>
            <div className="text-[10px] md:text-[11px] text-ink-2 uppercase tracking-[0.08em] font-semibold mb-2">
                Category
            </div>
            <div
                className="grid gap-1.5"
                style={{
                    gridTemplateColumns: isMobile ? 'repeat(4, 1fr)' : 'repeat(7, 1fr)',
                }}
            >
                {CATEGORY_KEYS.map((k) => {
                    const isSelected = k === category;
                    return (
                        <button
                            key={k}
                            type="button"
                            onClick={() => setCategory(k)}
                            className="rounded-xl flex flex-col items-center gap-1 transition-all hover:scale-[1.03]"
                            style={{
                                padding: isMobile ? '10px 4px' : '12px 8px',
                                background: isSelected
                                    ? 'linear-gradient(135deg, oklch(0.96 0.06 92), oklch(0.88 0.12 88))'
                                    : 'var(--color-bg-1)',
                                border: isSelected
                                    ? '1px solid oklch(0.80 0.12 88)'
                                    : '1px solid transparent',
                                boxShadow: isSelected ? 'var(--shadow-gold)' : 'none',
                            }}
                        >
                            <CategoryTile
                                kind={k}
                                size={isMobile ? 28 : 32}
                                variant="filled"
                            />
                            {/* CHANGED (Module 5.1): the selected tile's background is a bright
                                gold, so its label must use a fixed dark ink — theme ink turns
                                white in dark mode and became unreadable on the gold. */}
                            <span
                                className="text-[9px] md:text-[10px] font-medium"
                                style={isSelected ? { color: '#2a1805' } : undefined}
                            >
                                {CATEGORIES[k].label}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function NoteSection({ note, setNote }: Pick<ModalBodyProps, 'note' | 'setNote'>) {
    return (
        <div>
            <div className="text-[10px] md:text-[11px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1.5">
                Note
            </div>
            <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What was this expense for?"
                className="w-full px-3 py-2.5 border border-line rounded-xl bg-bg-1 text-[12px] md:text-[13px] outline-none focus:border-gold-400 focus:bg-bg-card transition-all"
            />
            {/* Tag suggestions */}
            <div className="flex gap-1.5 mt-2 flex-wrap">
                <button
                    type="button"
                    className="chip cursor-pointer hover:bg-bg-card transition-colors"
                    style={{ fontSize: 10 }}
                >
                    + tag
                </button>
                <button
                    type="button"
                    className="chip cursor-pointer hover:bg-bg-card transition-colors"
                    style={{ fontSize: 10 }}
                >
                    @Maxwell
                </button>
                <button
                    type="button"
                    className="chip cursor-pointer hover:bg-bg-card transition-colors"
                    style={{ fontSize: 10 }}
                >
                    w/ Joyce
                </button>
                <button
                    type="button"
                    className="chip cursor-pointer hover:bg-bg-card transition-colors"
                    style={{ fontSize: 10 }}
                >
                    #work-lunch
                </button>
            </div>
        </div>
    );
}

function AISuggestCard({ isMobile }: { isMobile?: boolean }) {
    return (
        <div
            className="rounded-xl p-3 flex items-center gap-2.5"
            style={{
                background:
                    'linear-gradient(135deg, var(--grad-soft-a), var(--grad-soft-b))',
                border: '1px dashed oklch(0.85 0.10 88)',
            }}
        >
            <SparkleIcon
                size={isMobile ? 14 : 16}
                className="text-gold-600 flex-shrink-0"
            />
            <div className="flex-1 text-[11px] md:text-xs text-ink-1 leading-snug">
                <b>AI suggests</b> · Similar entry from Apr 16 was tagged{' '}
                <b>#maxwell #lunch</b>. Apply tags?
            </div>
            <button
                type="button"
                className="px-3 h-7 rounded-full text-[10px] md:text-xs font-medium border border-line bg-bg-card hover:border-ink-2 transition-all flex-shrink-0"
            >
                Apply
            </button>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
// Shared form state + submit (ADDED Phase 8) — used by both Desktop & Mobile
// so the two layouts never drift. `save` persists via the createExpense server
// action, then closes the modal and refreshes so the new row shows immediately.
// ═══════════════════════════════════════════════════════════════

function symbolFromCurrency(c: CurrencyEnum): Currency {
    switch (c) {
        case 'MYR':
            return 'MYR';
        case 'CNY':
            return '¥';
        default:
            return 'S$'; // SGD/USD → S$ (manual modal offers S$/MYR/¥)
    }
}

// ADDED (Module 5.1): <input type="date"/"time"> value helpers.
function toDateValue(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function toTimeValue(d: Date): string {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function useManualExpenseForm(onClose: () => void, editTarget: Expense | null) {
    const { current, refresh } = useExpenses();
    const confirm = useConfirm();
    const [amount, setAmount] = useState(editTarget ? String(editTarget.amt) : '');
    const [category, setCategory] = useState<CategoryKey>(editTarget?.cat ?? 'food');
    const [currency, setCurrency] = useState<Currency>(
        editTarget?.currency ? symbolFromCurrency(editTarget.currency) : 'S$',
    );
    const [note, setNote] = useState(editTarget?.note ?? '');
    const [fixed, setFixed] = useState(editTarget?.fixed ?? false);
    // ADDED (Module 5.1): editable date + time (was static display). New expenses
    // default to today; edits default to the row's own date — reconstructed from the
    // VIEWED month + the row's day (the UI Expense only carries day + "HH:MM"). This
    // is what unblocks backfilling a past month's missed entry.
    const initialDate = editTarget
        ? new Date(current.year, current.month - 1, editTarget.day)
        : new Date();
    const [date, setDate] = useState(toDateValue(initialDate));
    const [time, setTime] = useState(editTarget?.time || toTimeValue(new Date()));
    const [pending, startTransition] = useTransition();

    const amt = parseFloat(amount);
    const canSave = Number.isFinite(amt) && amt > 0 && !!date && !pending;

    const save = () => {
        if (!canSave) return;
        // Build the timestamp from the picked date + time (local wall-clock).
        const spentAt = new Date(`${date}T${(time || '09:00')}:00`).toISOString();
        startTransition(async () => {
            const fields = {
                amount: amt,
                category,
                currency: currencyFromSymbol(currency),
                note: note.trim(),
                fixed,
                spentAt,
            };
            try {
                if (editTarget) {
                    await updateExpense(editTarget.id, fields);
                } else {
                    await createExpense({ ...fields, source: 'manual' });
                }
                onClose();
                refresh();
            } catch (err) {
                // Most likely a closed target month (assertMonthOpen). Surface it
                // rather than failing silently — the date picker can now land on
                // any month, including closed ones.
                await confirm({
                    title: 'Could not save',
                    message: err instanceof Error && /closed/i.test(err.message)
                        ? <>That date falls in a <b>closed month</b>. Reopen it on the Ledger page first, then try again.</>
                        : 'Something went wrong saving this expense. Please try again.',
                    confirmLabel: 'Got it',
                    hideCancel: true,
                });
            }
        });
    };

    // ADDED (Module 4 · UX): delete from within the edit modal (the mobile delete path).
    const remove = () => {
        if (!editTarget) return;
        startTransition(async () => {
            await deleteExpense(editTarget.id);
            onClose();
            refresh();
        });
    };

    return {
        amount, setAmount, category, setCategory, currency, setCurrency,
        note, setNote, fixed, setFixed, date, setDate, time, setTime,
        pending, canSave, save, remove,
    };
}

// ═══════════════════════════════════════════════════════════════
// Desktop Modal (centered, fixed width)
// ═══════════════════════════════════════════════════════════════

function DesktopModal({ onClose, editTarget }: { onClose: () => void; editTarget: Expense | null }) {
    const {
        amount, setAmount, category, setCategory, currency, setCurrency,
        note, setNote, fixed, setFixed, date, setDate, time, setTime,
        pending, canSave, save, remove,
    } = useManualExpenseForm(onClose, editTarget);
    const isEdit = editTarget !== null;
    const confirm = useConfirm();
    const handleDelete = async () => {
        if (await confirm({ title: 'Delete this expense?', message: 'This permanently removes the entry.', confirmLabel: 'Delete', danger: true })) remove();
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
            className="fixed inset-0 z-50 flex items-center justify-center p-6"
            style={{
                background: 'rgba(30, 20, 5, 0.4)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
            }}
        >
            <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.96 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                onClick={(e) => e.stopPropagation()}
                className="bg-bg-card rounded-[24px] shadow-2xl relative overflow-hidden"
                style={{
                    width: 'min(680px, 100%)',
                    maxHeight: '92vh',
                    overflowY: 'auto',
                }}
            >
                {/* Close button */}
                <button
                    onClick={onClose}
                    type="button"
                    className="absolute top-4 right-4 w-9 h-9 rounded-xl bg-bg-1 hover:bg-bg-2 flex items-center justify-center text-ink-1 transition-colors z-10"
                    aria-label="Close"
                >
                    <CloseIcon size={14} />
                </button>

                {/* Header */}
                <div className="px-7 pt-7 pb-4">
                    <div className="text-[11px] text-on-soft uppercase tracking-[0.14em] font-semibold">
                        {isEdit ? 'Edit expense' : 'New expense'}
                    </div>
                    <h2
                        className="display mt-1"
                        style={{ fontSize: 30, lineHeight: 1.1 }}
                    >
                        {isEdit ? 'Update this entry' : 'Log something by hand'}
                    </h2>
                    <div className="text-[12px] text-ink-2 mt-1">
                        Or press{' '}
                        <kbd className="px-1.5 py-0.5 bg-bg-1 rounded text-[10px] mono">
                            ⌘ + M
                        </kbd>{' '}
                        to talk instead
                    </div>
                </div>

                {/* Amount */}
                <div className="px-7">
                    <AmountSection
                        amount={amount}
                        setAmount={setAmount}
                        currency={currency}
                        setCurrency={setCurrency}
                    />
                </div>

                {/* Category */}
                <div className="px-7 pt-5">
                    <CategoryGrid category={category} setCategory={setCategory} />
                </div>

                {/* Fields grid — CHANGED (Module 5.1): Date/Time are now real inputs. */}
                <div className="px-7 pt-5 flex flex-col gap-3">
                    <DateTimeFields date={date} setDate={setDate} time={time} setTime={setTime} />
                    <FieldRow
                        label="Payment method"
                        value="DBS · ••3421"
                        icon={<WalletIcon size={14} />}
                    />
                </div>

                {/* Note */}
                <div className="px-7 pt-5">
                    <NoteSection note={note} setNote={setNote} />
                </div>

                {/* AI suggest */}
                <div className="px-7 pt-4">
                    <AISuggestCard />
                </div>

                {/* Footer */}
                <div
                    className="px-7 py-4 mt-5 flex items-center gap-2.5"
                    style={{
                        background: 'var(--color-bg-1)',
                        borderTop: '1px solid var(--color-line-soft)',
                    }}
                >
                    <label className="flex items-center gap-2 text-[12px] text-ink-1 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={fixed}
                            onChange={(e) => setFixed(e.target.checked)}
                            className="w-4 h-4 cursor-pointer accent-gold-500"
                        />
                        Recurring
                    </label>
                    {isEdit && (
                        <button
                            type="button"
                            onClick={handleDelete}
                            disabled={pending}
                            className="h-10 px-4 rounded-full border border-red-500/30 text-sm font-medium flex items-center gap-1.5 hover:bg-red-500/10 transition-all disabled:opacity-40"
                            style={{ color: 'oklch(0.58 0.21 25)' }}
                        >
                            <TrashIcon size={14} /> Delete
                        </button>
                    )}
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
                        onClick={save}
                        disabled={!canSave}
                        className="h-10 px-5 rounded-full text-sm font-semibold flex items-center gap-2 hover:brightness-[1.03] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                            background:
                                'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))',
                            color: '#1a120a',
                            boxShadow: 'var(--shadow-gold)',
                        }}
                    >
                        <CheckIcon size={14} />
                        {pending ? 'Saving…' : 'Save expense'}
                    </button>
                </div>
            </motion.div>
        </motion.div>
    );
}

// ═══════════════════════════════════════════════════════════════
// Mobile Modal (bottom sheet)
// ═══════════════════════════════════════════════════════════════

function MobileModal({ onClose, editTarget }: { onClose: () => void; editTarget: Expense | null }) {
    const {
        amount, setAmount, category, setCategory, currency, setCurrency,
        note, setNote, fixed, setFixed, date, setDate, time, setTime,
        pending, canSave, save, remove,
    } = useManualExpenseForm(onClose, editTarget);
    const isEdit = editTarget !== null;
    const confirm = useConfirm();
    const handleDelete = async () => {
        if (await confirm({ title: 'Delete this expense?', message: 'This permanently removes the entry.', confirmLabel: 'Delete', danger: true })) remove();
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-50 flex items-end justify-center"
            style={{
                background: 'rgba(30, 20, 5, 0.4)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
            }}
        >
            <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                drag="y"
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={0.2}
                onDragEnd={(_, info) => {
                    if (info.offset.y > 100 || info.velocity.y > 500) {
                        onClose();
                    }
                }}
                onClick={(e) => e.stopPropagation()}
                className="bg-bg-card w-full rounded-t-[24px] relative overflow-hidden"
                style={{
                    maxHeight: '92vh',
                    overflowY: 'auto',
                    paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
                    boxShadow: '0 -20px 60px -10px rgba(60, 40, 10, 0.3)',
                }}
            >
                {/* Drag handle */}
                <div className="flex justify-center pt-2.5 pb-1 sticky top-0 bg-bg-card z-10">
                    <div className="w-10 h-1 rounded-full bg-line" />
                </div>

                {/* Header */}
                <div className="px-5 pb-3 pt-1 flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                        <div className="text-[10px] text-on-soft uppercase tracking-[0.14em] font-semibold">
                            {isEdit ? 'Edit expense' : 'New expense'}
                        </div>
                        <h2
                            className="display mt-0.5"
                            style={{ fontSize: 24, lineHeight: 1.1 }}
                        >
                            {isEdit ? 'Update entry' : 'Log by hand'}
                        </h2>
                        <div className="text-[11px] text-ink-2 mt-0.5">
                            Or tap the orb to talk instead
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        type="button"
                        className="w-8 h-8 rounded-lg bg-bg-1 hover:bg-bg-2 flex items-center justify-center text-ink-1 flex-shrink-0 transition-colors"
                        aria-label="Close"
                    >
                        <CloseIcon size={12} />
                    </button>
                </div>

                {/* Amount */}
                <div className="px-4">
                    <AmountSection
                        amount={amount}
                        setAmount={setAmount}
                        currency={currency}
                        setCurrency={setCurrency}
                        isMobile
                    />
                </div>

                {/* Category */}
                <div className="px-4 pt-4">
                    <CategoryGrid category={category} setCategory={setCategory} isMobile />
                </div>

                {/* Fields stacked — CHANGED (Module 5.1): Date/Time are now real inputs. */}
                <div className="px-4 pt-4 flex flex-col gap-2.5">
                    <DateTimeFields date={date} setDate={setDate} time={time} setTime={setTime} />
                    <FieldRow
                        label="Payment method"
                        value="DBS · ••3421"
                        icon={<WalletIcon size={14} />}
                    />
                </div>

                {/* Note */}
                <div className="px-4 pt-4">
                    <NoteSection note={note} setNote={setNote} />
                </div>

                {/* AI suggest */}
                <div className="px-4 pt-3">
                    <AISuggestCard isMobile />
                </div>

                {/* Footer */}
                <div className="px-4 pt-4 flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-[11px] text-ink-1 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={fixed}
                            onChange={(e) => setFixed(e.target.checked)}
                            className="w-4 h-4 cursor-pointer accent-gold-500"
                        />
                        Recurring
                    </label>
                    {isEdit && (
                        <button
                            type="button"
                            onClick={handleDelete}
                            disabled={pending}
                            className="w-10 h-10 flex items-center justify-center rounded-full border border-red-500/30 hover:bg-red-500/10 transition-all disabled:opacity-40"
                            style={{ color: 'oklch(0.58 0.21 25)' }}
                            aria-label="Delete expense"
                        >
                            <TrashIcon size={15} />
                        </button>
                    )}
                    <div className="flex-1" />
                    <button
                        type="button"
                        onClick={onClose}
                        className="h-10 px-4 rounded-full border border-line bg-bg-card text-[13px] font-medium hover:border-ink-2 transition-all"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={save}
                        disabled={!canSave}
                        className="h-10 px-4 rounded-full text-[13px] font-semibold flex items-center gap-1.5 hover:brightness-[1.03] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                            background:
                                'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))',
                            color: '#1a120a',
                            boxShadow: 'var(--shadow-gold)',
                        }}
                    >
                        <CheckIcon size={14} />
                        {pending ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </motion.div>
        </motion.div>
    );
}

// ═══════════════════════════════════════════════════════════════
// Main Modal — picks Desktop or Mobile based on viewport
// ═══════════════════════════════════════════════════════════════

export function ManualAddModal() {
    const { isOpen, close, editTarget } = useAddModal();

    // ESC key closes the modal
    useEffect(() => {
        if (!isOpen) return;
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') close();
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [isOpen, close]);

    // Lock body scroll when open
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [isOpen]);

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Mobile version (< md) */}
                    <div className="md:hidden">
                        <MobileModal onClose={close} editTarget={editTarget} />
                    </div>
                    {/* Desktop version (md+) */}
                    <div className="hidden md:block">
                        <DesktopModal onClose={close} editTarget={editTarget} />
                    </div>
                </>
            )}
        </AnimatePresence>
    );
}