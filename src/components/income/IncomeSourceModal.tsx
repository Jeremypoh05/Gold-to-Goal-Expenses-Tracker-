'use client';

// ADDED (Phase 9): manage custom recurring income beyond salary — freelance,
// dividends, rental, etc.
//
// CHANGED (Phase 9 · temporal model): income streams are now INTERVALS. A recurring
// stream contributes across [start, end] (null end = ongoing), so a raise is modelled
// as "old ends Mar" + "new starts Apr" WITHOUT erasing past months — the old bug where
// pausing a source removed it from every month. One-off streams contribute in a single
// month. The modal is master–detail with Active / Archived tabs, colour-coded status,
// an Ends control, and a guided "rate change" that caps the old stream and starts a new
// one in one step. Mirrors the app's modal shell + shared pickers.

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PlusIcon, ChevronIcon } from '@/components/icons';
import { formatMoney, MONTH_NAMES } from '@/lib/utils';
import { incomeSourceStatus, type UiIncomeSource } from '@/lib/expense-utils';
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
    endYear: number | null;
    endMonth: number | null;
    recurring: boolean;
    active: boolean;
}

export interface RateChange {
    id: number;
    fromYear: number;
    fromMonth: number;
    newAmount: number;
}

interface Props {
    open: boolean;
    sources: UiIncomeSource[];
    defaultYear: number;
    pending?: boolean;
    onClose: () => void;
    onSave: (v: IncomeSourceForm) => void;
    onDelete: (id: number) => void;
    /** Reopen an ended/paused stream: clears the end + un-pauses. */
    onReopen: (id: number) => void;
    /** Guided raise/cut: cap old at the month before, start new from the change month. */
    onChangeAmount: (v: RateChange) => void;
}

const mo = (m: number) => MONTH_NAMES[Math.min(12, Math.max(1, m)) - 1].slice(0, 3);
const clampM = (v: string) => Math.min(12, Math.max(1, Math.round(num(v)) || 1));

// ── status → colour + tag ─────────────────────────────────────────────────
type Display = 'ongoing' | 'upcoming' | 'oneoff' | 'ended' | 'oneoff-past' | 'paused';

function displayStatus(s: UiIncomeSource, nowY: number, nowM: number): Display {
    if (!s.active) return 'paused';
    return incomeSourceStatus(s, nowY, nowM);
}

function statusMeta(d: Display): { tag: string; color: string; muted: boolean } {
    switch (d) {
        case 'ongoing':
            return { tag: 'Ongoing', color: 'oklch(0.72 0.16 82)', muted: false };
        case 'upcoming':
            return { tag: 'Upcoming', color: 'oklch(0.62 0.13 250)', muted: false };
        case 'oneoff':
            return { tag: 'One-off', color: 'oklch(0.62 0.15 300)', muted: false };
        case 'ended':
            return { tag: 'Ended', color: 'var(--color-ink-3)', muted: true };
        case 'oneoff-past':
            return { tag: 'One-off', color: 'var(--color-ink-3)', muted: true };
        case 'paused':
            return { tag: 'Paused', color: 'var(--color-ink-3)', muted: true };
    }
}

function metaLine(s: UiIncomeSource): string {
    if (!s.recurring) return `${formatMoney(s.monthlyAmount)} · ${mo(s.month)} ${s.year} · one-off`;
    const start = `${mo(s.month)} ${s.year}`;
    if (s.endYear != null && s.endMonth != null) {
        return `${formatMoney(s.monthlyAmount)}/mo · ${start} – ${mo(s.endMonth)} ${s.endYear}`;
    }
    return `${formatMoney(s.monthlyAmount)}/mo · from ${start}`;
}

function TrashIcon({ size = 14 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18 M8 6V4h8v2 M19 6l-1 14H6L5 6 M10 11v6 M14 11v6" />
        </svg>
    );
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
                                    ? { background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))', boxShadow: 'var(--shadow-gold)' }
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

// ── One compact, colour-coded source row ───────────────────────────────────
function SourceRow({ s, nowY, nowM, onEdit }: { s: UiIncomeSource; nowY: number; nowM: number; onEdit: () => void }) {
    const d = displayStatus(s, nowY, nowM);
    const meta = statusMeta(d);
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
            className="group flex items-center gap-3 p-2.5 rounded-[14px] cursor-pointer transition-all hover:brightness-[1.02]"
            style={{
                background: 'var(--color-bg-1)',
                border: '1px solid var(--color-line-soft)',
                borderLeft: `3px solid ${meta.color}`,
                opacity: meta.muted ? 0.7 : 1,
            }}
        >
            <div className="w-9 h-9 rounded-[10px] bg-bg-card flex items-center justify-center flex-shrink-0 text-[17px]" style={{ border: '1px solid var(--color-line-soft)' }}>
                {s.emoji}
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate flex items-center gap-2">
                    {s.label}
                    <span
                        className="text-[9px] uppercase tracking-[0.06em] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0"
                        style={{ color: meta.color, background: 'color-mix(in oklch, currentColor 12%, transparent)' }}
                    >
                        {meta.tag}
                    </span>
                </div>
                <div className="text-[11px] text-ink-2 mono truncate">{metaLine(s)}</div>
            </div>
            <ChevronIcon direction="right" size={14} className="text-ink-3 flex-shrink-0" />
        </div>
    );
}

function Content({ sources, defaultYear, pending, onClose, onSave, onDelete, onReopen, onChangeAmount }: Omit<Props, 'open'>) {
    const now = new Date();
    const nowY = now.getFullYear();
    const nowM = now.getMonth() + 1;

    const [tab, setTab] = useState<'active' | 'archived'>('active');
    const [mode, setMode] = useState<'list' | 'edit' | 'change'>('list');
    const [editingId, setEditingId] = useState<number | null>(null);

    // edit fields
    const [emoji, setEmoji] = useState('💰');
    const [label, setLabel] = useState('');
    const [amount, setAmount] = useState('');
    const [effYear, setEffYear] = useState(String(defaultYear));
    const [effMonth, setEffMonth] = useState('1');
    const [recurring, setRecurring] = useState(true);
    const [endEnabled, setEndEnabled] = useState(false);
    const [endYear, setEndYear] = useState(String(nowY));
    const [endMonth, setEndMonth] = useState(String(nowM));

    // rate-change fields
    const [chFromYear, setChFromYear] = useState(String(nowY));
    const [chFromMonth, setChFromMonth] = useState(String(nowM));
    const [chAmount, setChAmount] = useState('');
    const editingLabel = sources.find((s) => s.id === editingId)?.label ?? '';

    // Delete needs an explicit confirm so a stray tap can't wipe a source.
    const [confirmDelete, setConfirmDelete] = useState(false);

    const partitioned = sources.reduce(
        (acc, s) => {
            const d = displayStatus(s, nowY, nowM);
            const archived = d === 'ended' || d === 'oneoff-past' || d === 'paused';
            (archived ? acc.archived : acc.active).push(s);
            return acc;
        },
        { active: [] as UiIncomeSource[], archived: [] as UiIncomeSource[] },
    );
    const order = (arr: UiIncomeSource[]) =>
        [...arr].sort((a, b) => b.monthlyAmount - a.monthlyAmount);
    const list = order(tab === 'active' ? partitioned.active : partitioned.archived);
    const ongoingTotal = partitioned.active
        .filter((s) => s.recurring && s.active)
        .reduce((a, s) => a + s.monthlyAmount, 0);

    const openAdd = () => {
        setEditingId(null);
        setEmoji('💰');
        setLabel('');
        setAmount('');
        setEffYear(String(defaultYear));
        setEffMonth('1');
        setRecurring(true);
        setEndEnabled(false);
        setEndYear(String(nowY));
        setEndMonth(String(nowM));
        setConfirmDelete(false);
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
        setEndEnabled(s.endYear != null);
        setEndYear(String(s.endYear ?? nowY));
        setEndMonth(String(s.endMonth ?? nowM));
        setConfirmDelete(false);
        setMode('edit');
    };

    const canSave = num(amount) > 0 && label.trim().length > 0;

    const handleSave = () => {
        if (!canSave) return;
        const useEnd = recurring && endEnabled;
        onSave({
            id: editingId ?? undefined,
            emoji,
            label: label.trim(),
            monthlyAmount: num(amount),
            effectiveYear: Math.round(num(effYear)) || defaultYear,
            effectiveMonth: clampM(effMonth),
            endYear: useEnd ? Math.round(num(endYear)) || nowY : null,
            endMonth: useEnd ? clampM(endMonth) : null,
            recurring,
            active: true,
        });
        setMode('list');
    };

    const openChange = () => {
        setChFromYear(String(nowY));
        setChFromMonth(String(nowM));
        setChAmount('');
        setMode('change');
    };

    const canApplyChange = num(chAmount) > 0 && editingId != null;
    const applyChange = () => {
        if (!canApplyChange || editingId == null) return;
        onChangeAmount({
            id: editingId,
            fromYear: Math.round(num(chFromYear)) || nowY,
            fromMonth: clampM(chFromMonth),
            newAmount: num(chAmount),
        });
        setMode('list');
    };

    const title = mode === 'change' ? 'Rate change' : mode === 'edit' ? (editingId !== null ? 'Edit source' : 'Add income source') : 'Income sources';

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
                className="bg-bg-card rounded-t-[24px] md:rounded-[24px] shadow-2xl relative w-full md:w-[min(540px,100%)] flex flex-col"
                style={{ maxHeight: '88vh' }}
            >
                {/* ── Header ── */}
                <div className="px-6 md:px-7 pt-6 pb-4 flex items-start gap-3" style={{ borderBottom: '1px solid var(--color-line-soft)' }}>
                    {mode !== 'list' && (
                        <button
                            onClick={() => setMode(mode === 'change' ? 'edit' : 'list')}
                            type="button"
                            className="w-9 h-9 -ml-1.5 rounded-xl bg-bg-1 hover:bg-bg-2 flex items-center justify-center text-ink-1 transition-colors flex-shrink-0"
                            aria-label="Back"
                        >
                            <ChevronIcon direction="left" size={15} />
                        </button>
                    )}
                    <div className="flex-1 min-w-0">
                        <div className="text-[11px] text-on-soft uppercase tracking-[0.14em] font-semibold">Other income</div>
                        <h2 className="display mt-0.5" style={{ fontSize: 22, lineHeight: 1.1 }}>{title}</h2>
                    </div>
                    {mode === 'list' && ongoingTotal > 0 && (
                        <div className="text-right flex-shrink-0">
                            <div className="mono font-semibold text-[16px]">{formatMoney(ongoingTotal)}</div>
                            <div className="text-[10px] text-ink-2 uppercase tracking-[0.06em]">/mo ongoing</div>
                        </div>
                    )}
                    <button onClick={onClose} type="button" className="w-9 h-9 rounded-xl bg-bg-1 hover:bg-bg-2 flex items-center justify-center text-ink-1 transition-colors flex-shrink-0" aria-label="Close">
                        <CloseIcon size={14} />
                    </button>
                </div>

                {/* ── Tabs (list only) ── */}
                {mode === 'list' && (
                    <div className="px-6 md:px-7 pt-3 flex gap-1.5">
                        {(['active', 'archived'] as const).map((t) => {
                            const n = t === 'active' ? partitioned.active.length : partitioned.archived.length;
                            const on = tab === t;
                            return (
                                <button
                                    key={t}
                                    type="button"
                                    onClick={() => setTab(t)}
                                    className="h-8 px-3.5 rounded-full text-[12px] font-medium capitalize transition-all"
                                    style={
                                        on
                                            ? { background: 'var(--color-ink-0)', color: 'var(--color-bg-card)' }
                                            : { background: 'var(--color-bg-1)', color: 'var(--color-ink-2)', border: '1px solid var(--color-line-soft)' }
                                    }
                                >
                                    {t} {n > 0 && <span className="opacity-60">· {n}</span>}
                                </button>
                            );
                        })}
                    </div>
                )}

                {/* ── Body ── */}
                <div className="flex-1 min-h-0 overflow-y-auto" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
                    <AnimatePresence mode="wait" initial={false}>
                        {mode === 'list' && (
                            <motion.div key="list" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.18 }} className="px-6 md:px-7 py-4 flex flex-col gap-2">
                                {list.length === 0 ? (
                                    <div className="text-[13px] text-ink-2 py-8 text-center">
                                        {tab === 'active' ? (<>No active income streams.<br />Add one below.</>) : 'Nothing archived yet.'}
                                    </div>
                                ) : (
                                    list.map((s) => <SourceRow key={s.id} s={s} nowY={nowY} nowM={nowM} onEdit={() => openEdit(s)} />)
                                )}
                            </motion.div>
                        )}

                        {mode === 'edit' && (
                            <motion.div key="edit" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} transition={{ duration: 0.18 }} className="px-6 md:px-7 py-4 flex flex-col gap-3.5">
                                {/* Live preview */}
                                <div className="flex items-center gap-3 p-3 rounded-[14px]" style={{ background: 'linear-gradient(135deg, var(--grad-soft-a), var(--grad-soft-b))', border: '1px solid oklch(0.88 0.07 88)' }}>
                                    <div className="w-11 h-11 rounded-[12px] bg-bg-card flex items-center justify-center flex-shrink-0 text-[22px]" style={{ border: '1px solid var(--color-line-soft)' }}>{emoji}</div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[14px] font-semibold truncate">{label.trim() || 'New income source'}</div>
                                        <div className="text-[11px] text-ink-2 mono">
                                            {num(amount) > 0 ? formatMoney(num(amount)) : 'S$ —'}
                                            {recurring
                                                ? `/mo · ${mo(clampM(effMonth))} ${Math.round(num(effYear)) || defaultYear}${endEnabled ? ` – ${mo(clampM(endMonth))} ${Math.round(num(endYear)) || nowY}` : ' → ongoing'}`
                                                : ` · ${mo(clampM(effMonth))} ${Math.round(num(effYear)) || defaultYear} · one-off`}
                                        </div>
                                    </div>
                                </div>

                                <EmojiPicker value={emoji} onChange={setEmoji} />
                                <div>
                                    <div className="text-[10px] md:text-[11px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1.5">Name</div>
                                    <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Freelance, Dividends, Rental" maxLength={40} className="w-full px-3 py-2.5 rounded-xl border border-line bg-bg-1 outline-none text-[14px] focus:border-gold-400" aria-label="Name" />
                                </div>
                                <MoneyField label={recurring ? 'Amount per month' : 'Amount'} value={amount} onChange={setAmount} />

                                {/* Recurring toggle */}
                                <ToggleRow
                                    on={recurring}
                                    onToggle={() => setRecurring((r) => !r)}
                                    title="Recurring every month"
                                    sub={recurring ? 'Counts each month across its date range' : 'Counts once, in the chosen month only'}
                                />

                                <div className="grid grid-cols-2 gap-3">
                                    <MonthGridDropdown label={recurring ? 'Starts' : 'Month'} value={clampM(effMonth)} onChange={(m) => setEffMonth(String(m))} />
                                    <YearStepper value={effYear} onChange={setEffYear} />
                                </div>

                                {/* Ends control (recurring only) */}
                                {recurring && (
                                    <>
                                        <ToggleRow
                                            on={endEnabled}
                                            onToggle={() => setEndEnabled((e) => !e)}
                                            title="Has an end month"
                                            sub={endEnabled ? 'Stops counting after the end month' : 'Ongoing — no end'}
                                        />
                                        {endEnabled && (
                                            <div className="grid grid-cols-2 gap-3">
                                                <MonthGridDropdown label="Ends" value={clampM(endMonth)} onChange={(m) => setEndMonth(String(m))} />
                                                <YearStepper value={endYear} onChange={setEndYear} />
                                            </div>
                                        )}
                                    </>
                                )}

                                {/* Guided rate change (existing recurring only) */}
                                {editingId !== null && recurring && (
                                    <button
                                        type="button"
                                        onClick={openChange}
                                        className="flex items-center gap-2.5 p-3 rounded-[14px] text-left transition-colors hover:brightness-[1.02]"
                                        style={{ background: 'var(--color-bg-1)', border: '1px dashed var(--color-line)' }}
                                    >
                                        <span className="text-[16px]">📈</span>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[13px] font-medium">Amount changed from a month?</div>
                                            <div className="text-[11px] text-ink-2 mt-0.5">Keep history: end this one and start a new rate</div>
                                        </div>
                                        <ChevronIcon direction="right" size={14} className="text-ink-3" />
                                    </button>
                                )}

                                {editingId !== null && (
                                    confirmDelete ? (
                                        <div className="flex items-center gap-2 p-2.5 rounded-[14px]" style={{ background: 'oklch(0.63 0.2 25 / 0.09)', border: '1px solid oklch(0.63 0.2 25 / 0.4)' }}>
                                            <span className="flex-1 text-[12px] font-medium" style={{ color: 'oklch(0.55 0.2 25)' }}>
                                                Delete permanently?
                                            </span>
                                            <button type="button" onClick={() => setConfirmDelete(false)} className="h-8 px-3 rounded-full border border-line bg-bg-card text-[12px] font-medium hover:border-ink-2 transition-all">
                                                Cancel
                                            </button>
                                            <button type="button" onClick={() => { onDelete(editingId); setMode('list'); }} disabled={pending} className="h-8 px-3.5 rounded-full text-[12px] font-semibold text-white transition-all disabled:opacity-40 hover:brightness-[1.05]" style={{ background: 'oklch(0.58 0.21 25)' }}>
                                                Delete
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => setConfirmDelete(true)}
                                            disabled={pending}
                                            className="self-start flex items-center gap-1.5 h-9 px-3.5 rounded-full text-[12px] font-semibold transition-all disabled:opacity-40 hover:brightness-[1.03]"
                                            style={{ color: 'oklch(0.55 0.2 25)', border: '1px solid oklch(0.63 0.2 25 / 0.4)', background: 'oklch(0.63 0.2 25 / 0.06)' }}
                                        >
                                            <TrashIcon size={13} /> Delete this source
                                        </button>
                                    )
                                )}
                            </motion.div>
                        )}

                        {mode === 'change' && (
                            <motion.div key="change" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} transition={{ duration: 0.18 }} className="px-6 md:px-7 py-4 flex flex-col gap-3.5">
                                <div className="text-[12px] text-ink-1 leading-snug p-3 rounded-[14px]" style={{ background: 'var(--color-bg-1)', border: '1px solid var(--color-line-soft)' }}>
                                    <b>{editingLabel || 'This stream'}</b> will end the month before the change, and a new stream starts at the new amount — so past months keep their old figure.
                                </div>
                                <MoneyField label="New amount per month" value={chAmount} onChange={setChAmount} />
                                <div className="grid grid-cols-2 gap-3">
                                    <MonthGridDropdown label="Changed from" value={clampM(chFromMonth)} onChange={(m) => setChFromMonth(String(m))} />
                                    <YearStepper value={chFromYear} onChange={setChFromYear} />
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* ── Footer ── */}
                <div className="px-6 md:px-7 py-4 flex items-center gap-2.5" style={{ borderTop: '1px solid var(--color-line-soft)', paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}>
                    {mode === 'list' && (
                        <button type="button" onClick={openAdd} className="w-full h-11 rounded-full text-sm font-semibold flex items-center justify-center gap-2 hover:brightness-[1.03] transition-all" style={{ background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))', color: '#1a120a', boxShadow: 'var(--shadow-gold)' }}>
                            <PlusIcon size={16} /> Add income source
                        </button>
                    )}
                    {mode === 'edit' && (
                        <>
                            <button type="button" onClick={() => setMode('list')} className="h-11 px-5 rounded-full border border-line bg-bg-card text-sm font-medium hover:border-ink-2 transition-all">Cancel</button>
                            <div className="flex-1" />
                            <button type="button" onClick={handleSave} disabled={!canSave || pending} className="h-11 px-6 rounded-full text-sm font-semibold flex items-center gap-2 hover:brightness-[1.03] transition-all disabled:opacity-40" style={{ background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))', color: '#1a120a', boxShadow: 'var(--shadow-gold)' }}>
                                <PlusIcon size={14} /> {editingId !== null ? 'Save' : 'Add'}
                            </button>
                        </>
                    )}
                    {mode === 'change' && (
                        <>
                            <button type="button" onClick={() => setMode('edit')} className="h-11 px-5 rounded-full border border-line bg-bg-card text-sm font-medium hover:border-ink-2 transition-all">Back</button>
                            <div className="flex-1" />
                            <button type="button" onClick={applyChange} disabled={!canApplyChange || pending} className="h-11 px-6 rounded-full text-sm font-semibold flex items-center gap-2 hover:brightness-[1.03] transition-all disabled:opacity-40" style={{ background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))', color: '#1a120a', boxShadow: 'var(--shadow-gold)' }}>
                                Apply change
                            </button>
                        </>
                    )}
                </div>

                {/* Reopen affordance for the archived tab (shown in list footer area is busy,
                    so we surface it inline on the row's edit view via the Ends toggle / recurring;
                    a quick Reopen is offered here when viewing an archived item's edit). */}
                {mode === 'edit' && editingId !== null && (() => {
                    const s = sources.find((x) => x.id === editingId);
                    if (!s) return null;
                    const d = displayStatus(s, nowY, nowM);
                    if (d !== 'ended' && d !== 'paused') return null;
                    return (
                        <div className="px-6 md:px-7 pb-4 -mt-1">
                            <button type="button" onClick={() => { onReopen(editingId); setMode('list'); }} disabled={pending} className="w-full h-10 rounded-full text-[13px] font-medium border border-line bg-bg-card hover:border-ink-2 transition-all disabled:opacity-40">
                                Reopen (make ongoing again)
                            </button>
                        </div>
                    );
                })()}
            </motion.div>
        </motion.div>
    );
}

// Small reusable toggle row (recurring / has-end).
function ToggleRow({ on, onToggle, title, sub }: { on: boolean; onToggle: () => void; title: string; sub: string }) {
    return (
        <button type="button" onClick={onToggle} className="flex items-center gap-3 p-3 rounded-[14px] text-left transition-colors" style={{ background: 'var(--color-bg-1)', border: '1px solid var(--color-line-soft)' }} aria-pressed={on}>
            <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium">{title}</div>
                <div className="text-[11px] text-ink-2 mt-0.5">{sub}</div>
            </div>
            <span className="relative w-11 h-6 rounded-full flex-shrink-0 transition-colors" style={{ background: on ? 'oklch(0.74 0.155 82)' : 'var(--color-line)' }}>
                <motion.span className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm" animate={{ left: on ? 22 : 2 }} transition={{ type: 'spring', stiffness: 500, damping: 32 }} />
            </span>
        </button>
    );
}

export function IncomeSourceModal({ open, sources, defaultYear, pending, onClose, onSave, onDelete, onReopen, onChangeAmount }: Props) {
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
                    onReopen={onReopen}
                    onChangeAmount={onChangeAmount}
                />
            )}
        </AnimatePresence>
    );
}
