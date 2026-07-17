'use client';

// ADDED (Module 4): Fixed / recurring expenses manager. Define rent, bills, 家用,
// subscriptions, etc. — each auto-generates a real expense on its due day from its
// start month forward (no retroactive backfill). Generated rows appear in the
// ledger/calendar and are individually editable/deletable there. This page manages
// the definitions; a monthly-commitment hero + Active/Archived tabs keep it scannable.

import { useState, useEffect, useCallback, useTransition, useMemo } from 'react';
import { motion } from 'framer-motion';
import { PlusIcon, RepeatIcon } from '@/components/icons';
import { AnimatedNumber } from '@/components/shared/AnimatedNumber';
import { FixedExpenseModal, FixedTile, useClosedMonthGuard, type FixedExpenseForm } from '@/components/fixed';
import {
    fetchFixedExpenses,
    addFixedExpense,
    updateFixedExpense,
    deleteFixedExpense,
    changeFixedAmount,
    suggestFixedMeta,
} from '@/lib/actions';
import { fixedExpenseStatus, type UiFixedExpense, type FixedStatus } from '@/lib/expense-utils';
import { CATEGORIES } from '@/data/categories';
import { formatMoney, MONTH_NAMES } from '@/lib/utils';
import { useExpenses } from '@/components/data/ExpensesContext';

const STATUS_META: Record<FixedStatus, { tag: string; color: string; muted: boolean }> = {
    active: { tag: 'Active', color: 'oklch(0.72 0.16 82)', muted: false },
    upcoming: { tag: 'Upcoming', color: 'oklch(0.62 0.13 250)', muted: false },
    ended: { tag: 'Ended', color: 'var(--color-ink-3)', muted: true },
    paused: { tag: 'Paused', color: 'var(--color-ink-3)', muted: true },
};

function ordinal(n: number): string {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function metaLine(f: UiFixedExpense): string {
    const start = `${MONTH_NAMES[f.startMonth - 1]} ${f.startYear}`;
    const range = f.endYear != null && f.endMonth != null
        ? `${start} – ${MONTH_NAMES[f.endMonth - 1]} ${f.endYear}`
        : `from ${start}`;
    return `${CATEGORIES[f.category].label} · ${ordinal(f.dueDay)} · ${range}`;
}

export default function FixedExpensesPage() {
    const { current, refresh } = useExpenses();
    const guardClosedMonths = useClosedMonthGuard();
    const [pending, startTransition] = useTransition();
    const [items, setItems] = useState<UiFixedExpense[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [tab, setTab] = useState<'active' | 'archived'>('active');
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<UiFixedExpense | null>(null);

    const now = new Date();
    const nowY = now.getFullYear();
    const nowM = now.getMonth() + 1;

    const load = useCallback(() => {
        startTransition(async () => {
            setItems(await fetchFixedExpenses());
            setLoaded(true);
        });
    }, []);
    useEffect(() => {
        load();
    }, [load]);

    // ADDED (Module 4): deep link from a generated ledger/dashboard row —
    // /fixed?edit=<id> auto-opens that item's modal, then cleans the URL.
    // The setState here is a deliberate ONE-SHOT (guarded by the ?edit param,
    // which is removed in the same tick): it fires once after the list loads,
    // not on every render — the "cascading renders" the lint rule guards
    // against can't occur. Reading window.location keeps it an effect.
    useEffect(() => {
        if (!loaded || items.length === 0) return;
        const editId = Number(new URLSearchParams(window.location.search).get('edit'));
        if (!editId) return;
        const target = items.find((f) => f.id === editId);
        if (target) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot deep-link consumption, see above
            setEditing(target);
            setModalOpen(true);
        }
        window.history.replaceState(null, '', '/fixed');
    }, [loaded, items]);

    const { active, archived, monthlyTotal } = useMemo(() => {
        const active: UiFixedExpense[] = [];
        const archived: UiFixedExpense[] = [];
        let monthlyTotal = 0;
        for (const f of items) {
            const st = fixedExpenseStatus(f, nowY, nowM);
            if (st === 'ended' || st === 'paused') archived.push(f);
            else {
                active.push(f);
                if (st === 'active') monthlyTotal += f.amount;
            }
        }
        active.sort((a, b) => b.amount - a.amount);
        archived.sort((a, b) => b.amount - a.amount);
        return { active, archived, monthlyTotal };
    }, [items, nowY, nowM]);

    const list = tab === 'active' ? active : archived;

    const refreshAll = () => {
        load();
        refresh(); // keep the ledger/dashboard in sync (generated rows)
    };

    const openAdd = () => {
        setEditing(null);
        setModalOpen(true);
    };
    const openEdit = (f: UiFixedExpense) => {
        setEditing(f);
        setModalOpen(true);
    };

    const handleSave = (v: FixedExpenseForm) => {
        startTransition(async () => {
            if (v.id !== undefined) {
                // Ask how to handle any closed months this edit spans.
                const g = await guardClosedMonths({
                    startYear: v.startYear,
                    startMonth: v.startMonth,
                    endYear: v.endYear,
                    endMonth: v.endMonth,
                });
                if (!g.proceed) return;
                await updateFixedExpense(v.id, {
                    label: v.label,
                    note: v.note,
                    emoji: v.emoji,
                    category: v.category,
                    amount: v.monthlyAmount,
                    dueDay: v.dueDay,
                    startYear: v.startYear,
                    startMonth: v.startMonth,
                    endYear: v.endYear,
                    endMonth: v.endMonth,
                }, g.overrideClosed);
            } else {
                await addFixedExpense({
                    label: v.label,
                    note: v.note,
                    emoji: v.emoji,
                    category: v.category,
                    amount: v.monthlyAmount,
                    dueDay: v.dueDay,
                    startYear: v.startYear,
                    startMonth: v.startMonth,
                    endYear: v.endYear,
                    endMonth: v.endMonth,
                });
            }
            setModalOpen(false);
            refreshAll();
        });
    };

    const handleDelete = (id: number) => {
        startTransition(async () => {
            // Warn if the rule has entries in closed months (kept by default).
            const g = await guardClosedMonths(
                {
                    startYear: editing?.startYear ?? nowY,
                    startMonth: editing?.startMonth ?? 1,
                    endYear: editing?.endYear ?? null,
                    endMonth: editing?.endMonth ?? null,
                },
                'delete',
            );
            if (!g.proceed) return;
            await deleteFixedExpense(id, g.overrideClosed);
            setModalOpen(false);
            refreshAll();
        });
    };

    const handleChangeAmount = (v: { id: number; fromYear: number; fromMonth: number; newAmount: number }) => {
        startTransition(async () => {
            // A rate change only touches months from the change point forward.
            const g = await guardClosedMonths({
                startYear: v.fromYear,
                startMonth: v.fromMonth,
                endYear: editing?.endYear ?? null,
                endMonth: editing?.endMonth ?? null,
            });
            if (!g.proceed) return;
            await changeFixedAmount(v.id, { fromYear: v.fromYear, fromMonth: v.fromMonth, newAmount: v.newAmount }, g.overrideClosed);
            setModalOpen(false);
            refreshAll();
        });
    };

    return (
        <>
            <div className="px-4 md:px-8 py-5 md:py-7 pb-24 md:pb-16 max-w-[1100px] mx-auto flex flex-col gap-5 md:gap-6">
                {/* Header */}
                <motion.div
                    initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    className="flex items-end justify-between gap-4 flex-wrap"
                >
                    <div>
                        <div className="text-[10px] md:text-[11px] text-on-soft uppercase tracking-[0.14em] font-semibold">Recurring</div>
                        <h1
                            className="display mt-0.5 md:mt-1"
                            style={{
                                fontSize: 'clamp(30px, 5.5vw, 46px)',
                                lineHeight: 1.02,
                                width: 'fit-content',
                                backgroundImage: 'linear-gradient(100deg, var(--color-ink-0) 32%, oklch(0.74 0.17 80) 92%)',
                                WebkitBackgroundClip: 'text',
                                backgroundClip: 'text',
                                color: 'transparent',
                                letterSpacing: '-0.01em',
                            }}
                        >
                            Fixed expenses
                        </h1>
                        <div className="text-[13px] text-ink-2 mt-1">Rent, bills, family support, subscriptions — auto-logged each month</div>
                    </div>
                    <button
                        type="button"
                        onClick={openAdd}
                        className="flex items-center gap-2 h-10 px-4 rounded-full text-sm font-semibold hover:brightness-[1.03] transition-all"
                        style={{ background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))', color: '#1a120a', boxShadow: 'var(--shadow-gold)' }}
                    >
                        <PlusIcon size={16} /> Add fixed
                    </button>
                </motion.div>

                {/* Monthly commitment hero */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
                    className="glass grad-gold-soft rounded-3xl p-6 md:p-7 relative overflow-hidden"
                    style={{ border: '1px solid oklch(0.88 0.08 88)' }}
                >
                    {/* Faint watermark to fill the space */}
                    <div className="absolute -right-6 -bottom-8 opacity-[0.07] pointer-events-none" style={{ color: 'var(--color-gold-700)' }}>
                        <RepeatIcon size={180} />
                    </div>
                    <div className="flex items-center gap-4 relative">
                        <div
                            className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
                            style={{ background: 'linear-gradient(135deg, oklch(0.86 0.14 90), oklch(0.72 0.16 78))', color: '#3a2708', boxShadow: 'var(--shadow-gold)' }}
                        >
                            <RepeatIcon size={26} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-[11px] uppercase tracking-[0.1em] font-semibold text-on-soft">Monthly commitment</div>
                            <div className="display-number mt-0.5" style={{ fontSize: 'clamp(28px, 6vw, 38px)', lineHeight: 1 }}>
                                <span style={{ fontSize: '0.5em', color: 'var(--color-ink-2)', marginRight: 4 }}>S$</span>
                                <AnimatedNumber value={monthlyTotal} format="integer" duration={1400} delay={300} />
                                <span className="text-[13px] text-ink-2 font-normal" style={{ marginLeft: 4 }}>/mo</span>
                            </div>
                            <div className="text-[11px] text-ink-2 mt-1">
                                {active.length} active {active.length === 1 ? 'item' : 'items'} · auto-logged in {MONTH_NAMES[current.month - 1]} {current.year}
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* Tabs */}
                <div className="flex gap-1.5">
                    {(['active', 'archived'] as const).map((t) => {
                        const n = t === 'active' ? active.length : archived.length;
                        const on = tab === t;
                        return (
                            <button key={t} type="button" onClick={() => setTab(t)}
                                className="h-8 px-3.5 rounded-full text-[12px] font-medium capitalize transition-all"
                                style={on ? { background: 'var(--color-ink-0)', color: 'var(--color-bg-card)' } : { background: 'var(--color-bg-1)', color: 'var(--color-ink-2)', border: '1px solid var(--color-line-soft)' }}>
                                {t} {n > 0 && <span className="opacity-60">· {n}</span>}
                            </button>
                        );
                    })}
                </div>

                {/* List */}
                <div className="flex flex-col gap-2.5">
                    {!loaded ? (
                        <div className="text-[13px] text-ink-2 py-10 text-center">Loading…</div>
                    ) : list.length === 0 ? (
                        tab === 'active' ? (
                            <button
                                type="button" onClick={openAdd}
                                className="w-full rounded-3xl py-10 text-center transition-all hover:brightness-[1.02]"
                                style={{ border: '1.5px dashed var(--color-line)', background: 'var(--color-bg-1)' }}
                            >
                                <div className="text-[14px] font-medium text-ink-1">Add your first fixed expense</div>
                                <div className="text-[12px] text-ink-2 mt-1">Rent, phone, transport, family support, subscriptions…</div>
                            </button>
                        ) : (
                            <div className="text-[13px] text-ink-2 py-10 text-center">Nothing archived yet.</div>
                        )
                    ) : (
                        list.map((f, i) => {
                            const st = fixedExpenseStatus(f, nowY, nowM);
                            const meta = STATUS_META[st];
                            return (
                                <motion.div
                                    key={f.id}
                                    initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05 + i * 0.04 }}
                                    role="button" tabIndex={0}
                                    onClick={() => openEdit(f)}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEdit(f); } }}
                                    className="glass rounded-2xl p-3.5 md:p-4 bg-bg-card flex items-center gap-3.5 cursor-pointer transition-all hover:brightness-[1.02]"
                                    style={{ border: '1px solid var(--color-line-soft)', borderLeft: `3px solid ${meta.color}`, opacity: meta.muted ? 0.72 : 1 }}
                                >
                                    <FixedTile emoji={f.emoji} cat={f.category} size={44} />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[14px] font-semibold truncate flex items-center gap-2">
                                            {f.label}
                                            <span className="text-[9px] uppercase tracking-[0.06em] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ color: meta.color, background: 'color-mix(in oklch, currentColor 12%, transparent)' }}>{meta.tag}</span>
                                        </div>
                                        <div className="text-[11px] text-ink-2 mono truncate mt-0.5">{metaLine(f)}</div>
                                    </div>
                                    <div className="mono text-[15px] font-semibold flex-shrink-0">
                                        {formatMoney(f.amount)}<span className="text-[11px] text-ink-2 font-normal">/mo</span>
                                    </div>
                                </motion.div>
                            );
                        })
                    )}
                </div>

                <div className="text-[11px] text-ink-3 leading-snug">
                    Fixed expenses auto-generate a real entry each month on their due day and show up in your Ledger, Calendar and spending totals. Deleting a month&rsquo;s entry in the ledger won&rsquo;t bring it back; editing a definition here only affects future months.
                </div>
            </div>

            <FixedExpenseModal
                open={modalOpen}
                item={editing}
                defaultYear={current.year}
                pending={pending}
                onClose={() => setModalOpen(false)}
                onSave={handleSave}
                onDelete={handleDelete}
                onSuggest={suggestFixedMeta}
                onChangeAmount={handleChangeAmount}
            />
        </>
    );
}
