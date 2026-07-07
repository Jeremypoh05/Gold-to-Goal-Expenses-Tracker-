"use client";

import { useState, useMemo, useTransition } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
    CategoryTile,
    PlusIcon,
    MicIcon,
    EditIcon,
    TrashIcon,
    SearchIcon,
    DownloadIcon,
    SortIcon,
    ChevronIcon,
    LockIcon,
    UnlockIcon,
    RepeatIcon,
} from "@/components/icons";
import { AnimatedNumber } from "@/components/shared/AnimatedNumber";
import { CATEGORIES } from "@/data/categories";
import { useExpenses } from "@/components/data/ExpensesContext";
import { formatMoney, MONTH_NAMES, WEEKDAYS_SHORT, cn } from "@/lib/utils";
import type { Expense, CategoryKey } from "@/types";
import { useAddModal } from '@/components/dashboard/AddModalContext';
import { useFixedEdit } from '@/components/fixed';
import { useConfirm, TagChip } from '@/components/shared';
import { deleteExpense, deleteFixedExpense, closeMonth, reopenMonth } from '@/lib/actions';


// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

type TimeRange = "day" | "week" | "month";
// CHANGED (Tags module): filter can now also be a specific tag ("tag:<name>").
type FilterId = "all" | "voice" | "fixed" | CategoryKey | `tag:${string}`;

interface FilterDef {
    id: FilterId;
    label: string;
    count: number;
    icon?: React.ReactNode;
}

// ADDED (Tags fix batch): the ledger sort is now real (was a dead "Date ↓" stub).
type SortKey = "date-desc" | "date-asc" | "amt-desc" | "amt-asc";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
    { key: "date-desc", label: "Newest first" },
    { key: "date-asc", label: "Oldest first" },
    { key: "amt-desc", label: "Amount: high → low" },
    { key: "amt-asc", label: "Amount: low → high" },
];
const SORT_SHORT: Record<SortKey, string> = {
    "date-desc": "Newest",
    "date-asc": "Oldest",
    "amt-desc": "Amount ↓",
    "amt-asc": "Amount ↑",
};

// ═══════════════════════════════════════════════════════════════
// Sort menu — a small dropdown (click-outside to dismiss). Sorting by date
// reorders the day cards; sorting by amount reorders entries WITHIN each day
// (day cards stay newest-first) so the day grouping stays meaningful.
// ═══════════════════════════════════════════════════════════════

function SortMenu({ sort, onChange }: { sort: SortKey; onChange: (s: SortKey) => void }) {
    const [open, setOpen] = useState(false);
    return (
        <div className="relative flex-shrink-0">
            <button
                onClick={() => setOpen((o) => !o)}
                className="h-10 px-3 md:px-3.5 rounded-full text-xs font-medium text-ink-1 border border-line bg-bg-card hover:border-ink-2 inline-flex items-center gap-1.5 transition-colors"
                aria-label="Sort entries"
                aria-expanded={open}
            >
                <SortIcon size={13} />
                <span className="hidden sm:inline">{SORT_SHORT[sort]}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={cn("transition-transform", open && "rotate-180")}>
                    <path d="M6 9 L12 15 L18 9" />
                </svg>
            </button>
            {open && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                    <div
                        className="absolute right-0 mt-2 z-50 w-56 rounded-2xl bg-bg-card p-1 shadow-xl"
                        style={{ border: "1px solid var(--color-line-soft)" }}
                    >
                        {SORT_OPTIONS.map((o) => {
                            const active = o.key === sort;
                            return (
                                <button
                                    key={o.key}
                                    onClick={() => {
                                        onChange(o.key);
                                        setOpen(false);
                                    }}
                                    className={cn(
                                        "w-full text-left px-3 py-2 rounded-xl text-[13px] flex items-center justify-between transition-colors hover:bg-bg-1",
                                        active ? "font-semibold" : "text-ink-1",
                                    )}
                                    style={active ? { color: "var(--color-gold-700)" } : undefined}
                                >
                                    {o.label}
                                    {active && (
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M5 12 L10 17 L19 7" />
                                        </svg>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
// Search box — filters entries by note text, category label, or tag.
// ═══════════════════════════════════════════════════════════════

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <div className="relative flex-1 md:max-w-[380px]">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-2 pointer-events-none">
                <SearchIcon size={14} />
            </div>
            <input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="Search notes, categories, #tags…"
                className="w-full h-10 border border-line bg-bg-card rounded-full pl-9 pr-9 text-[13px] outline-none focus:border-gold-400 transition-colors"
                aria-label="Search entries"
            />
            {value && (
                <button
                    onClick={() => onChange("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-2 hover:text-ink-0 transition-colors"
                    aria-label="Clear search"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                        <path d="M6 6 L18 18 M18 6 L6 18" />
                    </svg>
                </button>
            )}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
// Time Range Segmented Control
// ═══════════════════════════════════════════════════════════════

function TimeRangeSegment({
    value,
    onChange,
    isCurrentMonth,
}: {
    value: TimeRange;
    onChange: (v: TimeRange) => void;
    isCurrentMonth: boolean;
}) {
    // Past months: only "Month" makes sense (no "today" or "this week")
    const options: { key: TimeRange; label: string }[] = isCurrentMonth
        ? [
            { key: "day", label: "Day" },
            { key: "week", label: "Week" },
            { key: "month", label: "Month" },
        ]
        : [{ key: "month", label: "Month" }];

    return (
        <div className="inline-flex bg-bg-2 p-[3px] rounded-full gap-[2px]">
            {options.map(({ key, label }) => (
                <button
                    key={key}
                    onClick={() => onChange(key)}
                    className={cn(
                        "h-[30px] px-[14px] rounded-full text-xs font-medium cursor-pointer transition-all",
                        value === key
                            ? "bg-bg-card text-ink-0 shadow-sm"
                            : "bg-transparent text-ink-1 hover:text-ink-0",
                    )}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
// Filter Chips with dynamic counts
// ═══════════════════════════════════════════════════════════════

function FilterChips({
    value,
    onChange,
    filters,
}: {
    value: FilterId;
    onChange: (v: FilterId) => void;
    filters: FilterDef[];
}) {
    return (
        // ADDED (Tags fix batch): mask-image right-edge fade so overflowing chips
        // dissolve softly (hints the row scrolls; the scrollbar is hidden). The mask
        // is over empty space when nothing overflows, so it stays invisible then.
        <div
            className="flex gap-1.5 overflow-x-auto mobile-h-scroll pb-1"
            style={{
                maskImage:
                    "linear-gradient(to right, #000 calc(100% - 28px), transparent)",
                WebkitMaskImage:
                    "linear-gradient(to right, #000 calc(100% - 28px), transparent)",
            }}
        >
            {filters.map((f) => {
                const isActive = value === f.id;
                const isDisabled = f.count === 0 && f.id !== "all";

                return (
                    <button
                        key={f.id}
                        onClick={() => !isDisabled && onChange(f.id)}
                        disabled={isDisabled}
                        className={cn(
                            "h-8 px-3.5 rounded-full flex-shrink-0",
                            "inline-flex items-center gap-1.5",
                            "text-xs font-medium transition-all",
                            isDisabled ? "cursor-not-allowed" : "cursor-pointer",
                        )}
                        style={{
                            background: isActive
                                ? "linear-gradient(135deg, oklch(0.96 0.06 92), oklch(0.88 0.12 88))"
                                : "var(--color-bg-card)",
                            border: isActive
                                ? "1px solid oklch(0.80 0.12 88)"
                                : "1px solid var(--color-line-soft)",
                            color: isActive ? "var(--color-gold-900)" : "var(--color-ink-1)",
                            boxShadow: isActive ? "var(--shadow-sm)" : "none",
                            opacity: isDisabled ? 0.4 : 1,
                        }}
                    >
                        {f.icon}
                        <span>{f.label}</span>
                        <span
                            className="mono text-[10px]"
                            style={{
                                color: isActive
                                    ? "var(--color-gold-700)"
                                    : "var(--color-ink-3)",
                            }}
                        >
                            {f.count}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
// Stale-rule hint — ADDED (Module 5.1): a generated recurring row whose amount
// no longer matches its rule's current amount. Happens when the rule was edited
// "open months only" while THIS row's month was closed, so the row kept its old
// figure. Purely informational (doesn't touch the name); title explains + how to
// align. Amber so it reads as "heads-up", legible in light + dark.
// ═══════════════════════════════════════════════════════════════

function StaleRuleHint({ amt, ruleAmount }: { amt: number; ruleAmount: number }) {
    return (
        <span
            title={`This recurring's amount is now ${formatMoney(ruleAmount)}, but this entry kept ${formatMoney(amt)} because the month was closed when the rule changed. Reopen the month and re-save the rule to align it.`}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold whitespace-nowrap cursor-help"
            style={{
                background: 'color-mix(in oklch, oklch(0.75 0.15 68) 16%, transparent)',
                color: 'oklch(0.72 0.15 66)',
                border: '1px solid color-mix(in oklch, oklch(0.75 0.15 68) 42%, transparent)',
            }}
        >
            <RepeatIcon size={9} /> rule now {formatMoney(ruleAmount)}
        </span>
    );
}

const isStaleRule = (t: Expense) =>
    !!t.fixed && t.ruleAmount != null && t.ruleAmount !== t.amt;

// ═══════════════════════════════════════════════════════════════
// Day Card
// ═══════════════════════════════════════════════════════════════

function DayCard({
    day,
    entries,
    index,
}: {
    day: number;
    entries: Expense[];
    index: number;
}) {
    const { current, monthClosed, refresh } = useExpenses();
    const { open: openEdit } = useAddModal();
    const { openFixedEdit } = useFixedEdit();
    const confirm = useConfirm();
    const [pendingId, startTransition] = useTransition();

    // CHANGED (Module 4 · UX): recurring rows open their recurring modal IN PLACE
    // (global FixedEditProvider) — no navigation. Manual/voice rows open the add
    // modal in edit mode. Orphaned recurring rows fall back to the manual editor.
    const editRow = (t: Expense) => {
        if (t.fixed && t.fixedSourceId) openFixedEdit(t.fixedSourceId, t);
        else openEdit(t);
    };
    const dayTotal = entries.reduce((a, b) => a + b.amt, 0);
    const voiceCount = entries.filter((e) => e.voice).length;
    const date = new Date(current.year, current.month - 1, day);
    const weekday = WEEKDAYS_SHORT[date.getDay()];
    const isToday = day === current.day;

    // Recurring rows delete the whole rule (+ all entries, everywhere); others delete
    // just the entry. Always confirm first.
    const handleDelete = async (t: Expense) => {
        const isRecurring = !!(t.fixed && t.fixedSourceId);
        // CHANGED (Module 5.1): NO row in a closed month can be deleted — recurring
        // included. Confirming reopens the month and continues into the delete flow.
        if (monthClosed) {
            const ok = await confirm({
                title: `${MONTH_NAMES[current.month - 1]} ${current.year} is closed`,
                message: (
                    <>Its entries are <b>locked</b>. <b>Reopen the month</b> to delete this entry — you can close it again afterwards.</>
                ),
                confirmLabel: 'Reopen month',
                cancelLabel: 'Cancel',
            });
            if (!ok) return;
            await reopenMonth(current.year, current.month);
            refresh();
        }
        const ok = await confirm(
            isRecurring
                ? {
                      title: `Delete recurring “${t.note}”?`,
                      message: 'This removes the recurring rule and every entry it has generated across open months. Entries in closed months are kept.',
                      confirmLabel: 'Delete rule',
                      danger: true,
                  }
                : { title: 'Delete this expense?', message: 'This permanently removes the entry.', confirmLabel: 'Delete', danger: true },
        );
        if (!ok) return;
        startTransition(async () => {
            if (isRecurring && t.fixedSourceId) await deleteFixedExpense(t.fixedSourceId);
            await deleteExpense(t.id);
            refresh();
        });
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
                duration: 0.5,
                delay: 0.15 + index * 0.04,
                ease: [0.16, 1, 0.3, 1],
            }}
            className="rounded-[20px] bg-bg-card overflow-hidden"
            style={{ border: "1px solid var(--color-line-soft)" }}
        >
            {/* Day header (clickable → Daily Detail) */}
            <Link
                href={`/ledger/${day}`}
                className="block"
                style={{
                    background: isToday
                        ? "linear-gradient(90deg, var(--grad-soft-a), var(--color-bg-card) 50%)"
                        : "var(--color-bg-1)",
                    borderBottom: "1px solid var(--color-line-soft)",
                }}
            >
                <div className="flex items-center gap-3 md:gap-4 px-4 md:px-5 py-3 md:py-3.5 hover:bg-black/[0.02] transition-colors cursor-pointer">
                    <div className="flex items-baseline gap-2 md:gap-3 flex-wrap">
                        <div
                            className="display"
                            style={{ fontSize: "clamp(20px, 2.5vw, 26px)", lineHeight: 1 }}
                        >
                            {MONTH_NAMES[current.month - 1]} {day}
                        </div>
                        <div className="text-[11px] md:text-xs text-ink-2 uppercase tracking-[0.08em] font-medium">
                            {weekday}
                        </div>
                        {isToday && (
                            <span
                                className="chip"
                                style={{
                                    background: "oklch(0.96 0.06 92)",
                                    color: "var(--color-gold-900)",
                                    borderColor: "oklch(0.85 0.10 88)",
                                }}
                            >
                                Today
                            </span>
                        )}
                    </div>

                    <div className="flex-1" />

                    <div className="hidden sm:flex gap-3 text-[11px] text-ink-2">
                        <span>{entries.length} entries</span>
                        {voiceCount > 0 && (
                            <span className="text-gold-700 inline-flex items-center gap-1">
                                <MicIcon size={10} className="text-gold-700" />
                                {voiceCount} voice
                            </span>
                        )}
                    </div>

                    <div className="mono text-sm md:text-base font-semibold whitespace-nowrap">
                        −{formatMoney(dayTotal)}
                    </div>

                    <ChevronIcon
                        direction="right"
                        size={14}
                        className="text-ink-3 hidden md:block"
                    />
                </div>
            </Link>

            {/* Desktop table */}
            <div className="hidden md:block">
                <table className="tbl w-full" style={{ tableLayout: "fixed" }}>
                    <colgroup>
                        <col style={{ width: 80 }} />
                        <col style={{ width: 180 }} />
                        <col />
                        <col style={{ width: 150 }} />
                        <col style={{ width: 120 }} />
                        <col style={{ width: 80 }} />
                    </colgroup>
                    <tbody>
                        {entries.map((t) => (
                            <tr key={t.id} className="group cursor-pointer" onClick={() => editRow(t)}>
                                <td className="mono text-xs text-ink-2">{t.time}</td>
                                <td>
                                    <div className="flex items-center gap-2.5">
                                        <CategoryTile kind={t.cat} size={28} variant="filled" />
                                        <span className="font-medium text-[13px]">
                                            {CATEGORIES[t.cat].label}
                                        </span>
                                    </div>
                                </td>
                                <td className="text-[13px]">
                                    <span className="truncate block">{t.note}</span>
                                    {isStaleRule(t) && (
                                        <span className="mt-1 inline-block">
                                            <StaleRuleHint amt={t.amt} ruleAmount={t.ruleAmount!} />
                                        </span>
                                    )}
                                    {/* ADDED (Tags module) */}
                                    {t.tags && t.tags.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mt-1">
                                            {t.tags.map((tag) => (
                                                <TagChip key={tag} label={tag} dense />
                                            ))}
                                        </div>
                                    )}
                                </td>
                                <td>
                                    <div className="flex gap-1 flex-wrap">
                                        {t.voice && (
                                            <span
                                                className="chip"
                                                style={{
                                                    background: "oklch(0.96 0.04 92)",
                                                    color: "var(--color-gold-900)",
                                                    height: 22,
                                                    fontSize: 10,
                                                }}
                                            >
                                                <MicIcon size={9} className="text-gold-700" />
                                                voice
                                            </span>
                                        )}
                                        {t.fixed && (
                                            <span
                                                className="chip"
                                                style={{ height: 22, fontSize: 10 }}
                                            >
                                                fixed
                                            </span>
                                        )}
                                    </div>
                                </td>
                                <td
                                    className="mono text-right font-semibold text-sm"
                                    style={{ whiteSpace: "nowrap" }}
                                >
                                    −{formatMoney(t.amt)}
                                </td>
                                <td>
                                    {/* CHANGED (Module 4 · UX): always-visible (muted→bright), not group-hover gated.
                                        CHANGED (Module 5.1): dimmed while the month is closed — clicking
                                        still works and offers to reopen. */}
                                    <div className={cn('flex gap-1.5 justify-end', monthClosed && 'opacity-35')}>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); editRow(t); }}
                                            className="w-9 h-9 flex items-center justify-center rounded-lg text-ink-2 border border-transparent hover:border-line hover:bg-bg-2 hover:text-gold-700 hover:scale-105 active:scale-95 transition-all"
                                            aria-label={t.fixed ? 'Open recurring' : 'Edit'}
                                        >
                                            <EditIcon size={16} />
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleDelete(t); }}
                                            disabled={pendingId}
                                            className="w-9 h-9 flex items-center justify-center rounded-lg text-ink-2 border border-transparent hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-500 hover:scale-105 active:scale-95 transition-all disabled:opacity-40"
                                            aria-label="Delete"
                                        >
                                            <TrashIcon size={16} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Mobile list */}
            <div className="md:hidden divide-y divide-line-soft">
                {entries.map((t) => (
                    <div
                        key={t.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => editRow(t)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); editRow(t); } }}
                        className="flex items-center gap-2.5 px-4 py-3 active:bg-bg-1 cursor-pointer"
                    >
                        <CategoryTile kind={t.cat} size={32} variant="filled" />
                        <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-medium truncate">{t.note}</div>
                            <div className="text-[10px] text-ink-2 mt-0.5 flex items-center gap-1">
                                {t.voice && (
                                    <>
                                        <span className="text-gold-700 inline-flex items-center gap-0.5">
                                            <MicIcon size={9} className="text-gold-700" />
                                            voice
                                        </span>
                                        <span>·</span>
                                    </>
                                )}
                                {t.fixed && (
                                    <>
                                        <span>recurring</span>
                                        <span>·</span>
                                    </>
                                )}
                                <span className="mono">{t.time}</span>
                            </div>
                            {isStaleRule(t) && (
                                <div className="mt-1">
                                    <StaleRuleHint amt={t.amt} ruleAmount={t.ruleAmount!} />
                                </div>
                            )}
                            {/* ADDED (Tags module) */}
                            {t.tags && t.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                    {t.tags.map((tag) => (
                                        <TagChip key={tag} label={tag} dense />
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="mono text-[13px] font-semibold whitespace-nowrap">
                            −{formatMoney(t.amt)}
                        </div>
                    </div>
                ))}
            </div>
        </motion.div>
    );
}

// ═══════════════════════════════════════════════════════════════
// Period Total Card
// ═══════════════════════════════════════════════════════════════

function PeriodTotalCard({
    filter,
    range,
    total,
    filterLabel,
}: {
    filter: FilterId;
    range: TimeRange;
    total: number;
    filterLabel: string;
}) {
    const { current } = useExpenses();
    const rangeLabel =
        range === "day"
            ? "today"
            : range === "week"
                ? "this week"
                : `${MONTH_NAMES[current.month - 1]} ${current.year}`;

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-[16px] px-5 py-4 flex items-center gap-4"
            style={{
                background: "linear-gradient(135deg, var(--grad-soft-a), var(--grad-soft-b))",
                border: "1px solid oklch(0.88 0.08 88)",
            }}
        >
            <div className="min-w-0 flex-1">
                <div
                    className="text-[11px] uppercase tracking-[0.14em] font-semibold"
                    style={{ color: 'var(--color-on-soft)' }}
                >
                    Period total
                </div>
                <div className="text-[11px] md:text-xs text-ink-2 mt-0.5 truncate">
                    {filter === "all" ? "All categories" : filterLabel} · {rangeLabel}
                </div>
            </div>
            <div
                className="mono font-semibold text-ink-0 whitespace-nowrap"
                style={{ fontSize: "clamp(16px, 2vw, 20px)" }}
            >
                −<AnimatedNumber value={total} format="money" duration={1200} />
            </div>
        </motion.div>
    );
}

// ═══════════════════════════════════════════════════════════════
// Main Ledger Page
// ═══════════════════════════════════════════════════════════════

export default function LedgerPage() {
    const [range, setRange] = useState<TimeRange>("month");
    const [filter, setFilter] = useState<FilterId>("all");
    const [search, setSearch] = useState(""); // ADDED (Tags fix batch)
    const [sort, setSort] = useState<SortKey>("date-desc"); // ADDED (Tags fix batch)
    const { open: openAddModal } = useAddModal();
    const { current, expenses, monthClosed, refresh } = useExpenses();
    const confirm = useConfirm();
    const [closePending, startCloseTransition] = useTransition();

    const monthName = MONTH_NAMES[current.month - 1];

    // ADDED (Module 5): the actual close/reopen control for this feature — lives
    // on the Ledger page since it's the month-scoped ledger view.
    const handleToggleClose = () => {
        if (monthClosed) {
            startCloseTransition(async () => {
                await reopenMonth(current.year, current.month);
                refresh();
            });
            return;
        }
        void (async () => {
            const ok = await confirm({
                title: `Close ${monthName} ${current.year}?`,
                message:
                    'No expenses can be added, edited, or deleted for this month (manual or voice) until you reopen it. Income stays editable.',
                confirmLabel: 'Close month',
            });
            if (!ok) return;
            startCloseTransition(async () => {
                await closeMonth(current.year, current.month);
                refresh();
            });
        })();
    };

    // For now, we always view current month.
    // TODO Phase 4: This will become URL-based and respect TopBar month selection.
    const isCurrentMonth = true;

    // ═══════════════════════════════════════════════════════════
    // QUICK FIX 1: Filter expenses by time range first (base set)
    // The filter chips will count from THIS base set
    // ═══════════════════════════════════════════════════════════
    const baseExpensesForRange = useMemo(() => {
        let result = expenses;

        if (range === "day") {
            result = result.filter((t) => t.day === current.day);
        } else if (range === "week") {
            const todayDate = new Date(current.year, current.month - 1, current.day);
            const todayDow = todayDate.getDay();
            const weekStart = current.day - todayDow;
            const weekEnd = weekStart + 6;
            result = result.filter((t) => t.day >= weekStart && t.day <= weekEnd);
        }
        // 'month' - no time filter

        return result;
    }, [range, expenses, current]);

    // ═══════════════════════════════════════════════════════════
    // QUICK FIX 1: Counts now reflect the time-range base
    // ═══════════════════════════════════════════════════════════
    const filters: FilterDef[] = useMemo(() => {
        const countCat = (cat: CategoryKey) =>
            baseExpensesForRange.filter((t) => t.cat === cat).length;

        // ADDED (Tags module): one filter chip per distinct tag present in the
        // current range, most-used first, so the ledger can slice by tag.
        const tagFreq = new Map<string, number>();
        for (const t of baseExpensesForRange)
            for (const tag of t.tags ?? [])
                tagFreq.set(tag, (tagFreq.get(tag) ?? 0) + 1);
        const tagFilters: FilterDef[] = [...tagFreq.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([tag, count]) => ({
                id: `tag:${tag}` as FilterId,
                label: `#${tag}`,
                count,
            }));

        return [
            { id: "all", label: "All", count: baseExpensesForRange.length },
            {
                id: "voice",
                label: "Voice",
                count: baseExpensesForRange.filter((t) => t.voice).length,
                icon: <MicIcon size={11} />,
            },
            {
                id: "fixed",
                label: "Fixed",
                count: baseExpensesForRange.filter((t) => t.fixed).length,
            },
            { id: "food", label: "Food", count: countCat("food") },
            { id: "shop", label: "Shopping", count: countCat("shop") },
            { id: "trans", label: "Transport", count: countCat("trans") },
            { id: "bills", label: "Bills", count: countCat("bills") },
            { id: "ent", label: "Entertainment", count: countCat("ent") },
            { id: "health", label: "Health", count: countCat("health") },
            ...tagFilters,
        ];
    }, [baseExpensesForRange]);

    // ═══════════════════════════════════════════════════════════
    // QUICK FIX 3: Derive the *effective* filter — if user-selected
    // filter has 0 count in current range, fall back to 'all' for display.
    // No useEffect needed (no cascading renders, React 19 best practice).
    // ═══════════════════════════════════════════════════════════
    const effectiveFilter: FilterId = useMemo(() => {
        if (filter === "all") return "all";
        const currentFilter = filters.find((f) => f.id === filter);
        if (currentFilter && currentFilter.count === 0) {
            return "all"; // Fallback — but don't mutate user's actual choice
        }
        return filter;
    }, [filter, filters]);

    // Apply filter on top of base (use effectiveFilter, not raw filter), then the
    // free-text search (note / category label / tag). ADDED (Tags fix batch): search.
    const filteredExpenses = useMemo(() => {
        let result: Expense[];
        if (effectiveFilter === "all") result = baseExpensesForRange;
        else if (effectiveFilter === "voice")
            result = baseExpensesForRange.filter((t) => t.voice);
        else if (effectiveFilter === "fixed")
            result = baseExpensesForRange.filter((t) => t.fixed);
        else if (effectiveFilter.startsWith("tag:")) {
            const tag = effectiveFilter.slice(4);
            result = baseExpensesForRange.filter((t) => t.tags?.includes(tag));
        } else result = baseExpensesForRange.filter((t) => t.cat === effectiveFilter);

        const q = search.trim().toLowerCase();
        if (q) {
            result = result.filter(
                (t) =>
                    t.note.toLowerCase().includes(q) ||
                    CATEGORIES[t.cat].label.toLowerCase().includes(q) ||
                    (t.tags ?? []).some((tag) => tag.includes(q)),
            );
        }
        return result;
    }, [baseExpensesForRange, effectiveFilter, search]);

    // Group by day, then order entries within each day by the chosen sort.
    // ADDED (Tags fix batch): sort is now real.
    const expensesByDay = useMemo(() => {
        const map: Record<number, Expense[]> = {};
        filteredExpenses.forEach((t) => {
            if (!map[t.day]) map[t.day] = [];
            map[t.day].push(t);
        });
        const cmp = (a: Expense, b: Expense) => {
            switch (sort) {
                case "date-asc":
                    return a.time.localeCompare(b.time);
                case "amt-desc":
                    return b.amt - a.amt;
                case "amt-asc":
                    return a.amt - b.amt;
                default:
                    return b.time.localeCompare(a.time); // date-desc
            }
        };
        Object.keys(map).forEach((d) => map[Number(d)].sort(cmp));
        return map;
    }, [filteredExpenses, sort]);

    // Day-card order: date sorts flip it; amount sorts keep newest-day-first.
    const sortedDays = Object.keys(expensesByDay)
        .map(Number)
        .sort((a, b) => (sort === "date-asc" ? a - b : b - a));

    const rangeTotal = filteredExpenses.reduce((a, b) => a + b.amt, 0);
    const filterLabel =
        filters.find((f) => f.id === effectiveFilter)?.label ?? "All";

    const rangeDisplay =
        range === "day"
            ? "Today"
            : range === "week"
                ? "This week"
                : `${monthName} ${current.year}`;

    return (
        <div className="px-4 md:px-8 py-5 md:py-7 pb-16 max-w-[1320px] mx-auto flex flex-col gap-5 md:gap-6">
            {/* Header — CHANGED (Module 5.1): the heading + amount now own their row
                (the controls dropped to a right-aligned row below), and the amount is
                nowrap + tabular so the counting AnimatedNumber can't make the line
                wrap/unwrap and jump between one and two rows as it grows. */}
            <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="flex flex-col gap-4"
            >
                <div className="min-w-0">
                    <div className="text-[10px] md:text-[11px] text-on-soft uppercase tracking-[0.14em] font-semibold">
                        Ledger · {rangeDisplay}
                    </div>
                    {/* CHANGED (Tags fix batch): was a single whitespace-nowrap line,
                        which overflowed the mobile viewport and pushed the title out of
                        view. Now a flex-wrap row — the count and the amount are each
                        their own nowrap + tabular-nums unit, so on a narrow screen the
                        amount drops to a second line cleanly (never clipped) and neither
                        number can wrap/unwrap mid-count. */}
                    <h1
                        className="display mt-0.5 md:mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
                        style={{ fontSize: "clamp(24px, 5vw, 44px)", lineHeight: 1.15 }}
                    >
                        <span className="whitespace-nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {filteredExpenses.length}{' '}
                            <span className="text-ink-2 font-medium">
                                {filteredExpenses.length === 1 ? 'entry' : 'entries'}
                            </span>
                        </span>
                        <span className="text-ink-3 font-light">•</span>
                        <span className="text-gradient-amount whitespace-nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>
                            −<AnimatedNumber value={rangeTotal} format="money" duration={1200} />
                        </span>
                    </h1>
                    <div className="text-[12px] md:text-[13px] text-ink-2 mt-1">
                        Exports to .xlsx / .csv · bulk edit supported
                    </div>
                </div>

                {/* CHANGED (Tags fix batch): Day/Week/Month moved OUT of this button
                    row (Export/Close/Add) down to the Search+Sort row per user request. */}
                <div className="flex items-center gap-2 flex-wrap md:justify-end">
                    <button
                        className="shine-wrap shine-wrap-light h-10 px-3 md:px-4 rounded-full text-sm font-medium hover:scale-[1.02] transition-all flex items-center gap-2"
                        style={{
                            background:
                                'linear-gradient(135deg, oklch(0.30 0.05 260), oklch(0.20 0.04 260))',
                            color: '#fff',
                            boxShadow:
                                '0 8px 20px -6px oklch(0.30 0.05 260 / 0.5), 0 1px 0 rgba(255,255,255,0.15) inset',
                            border: '1px solid oklch(0.40 0.05 260)',
                        }}
                        aria-label="Export"
                    >
                        <DownloadIcon size={14} />
                        <span className="hidden sm:inline">Export</span>
                    </button>

                    {/* ADDED (Module 5): the close/reopen control for this month's ledger. */}
                    <button
                        onClick={handleToggleClose}
                        disabled={closePending}
                        className={cn(
                            "h-10 px-3 md:px-4 rounded-full text-sm font-medium flex items-center gap-2 transition-all border disabled:opacity-50",
                            monthClosed
                                ? "border-line hover:border-ink-2 bg-bg-card text-ink-1"
                                : "border-line hover:border-ink-2 bg-bg-card text-ink-1 hover:text-red-500",
                        )}
                        aria-label={monthClosed ? "Reopen month" : "Close month"}
                    >
                        {monthClosed ? <UnlockIcon size={14} /> : <LockIcon size={14} />}
                        <span className="hidden sm:inline">{monthClosed ? "Reopen" : "Close month"}</span>
                    </button>

                    <button
                        onClick={() => openAddModal()}
                        className="shine-wrap h-10 px-4 md:px-5 rounded-full text-sm font-semibold flex items-center gap-2 transition-all hover:scale-[1.02]"
                        style={{
                            background:
                                'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))',
                            color: '#1a120a',
                            boxShadow:
                                'var(--shadow-gold), 0 1px 0 rgba(255, 255, 255, 0.5) inset',
                            border: '1px solid oklch(0.85 0.14 88)',
                        }}
                    >
                        <PlusIcon size={16} />
                        <span>Add row</span>
                    </button>
                </div>
            </motion.div>

            {/* ADDED (Module 5): closed-month notice.
                CHANGED (Module 5.1): theme-aware surface (the old hardcoded light
                gray made the copy unreadable in dark mode) + stronger ink + a
                prominent gold Reopen button. */}
            {monthClosed && (
                <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                    className="rounded-2xl px-4 py-3 flex items-center gap-3"
                    style={{
                        background: 'linear-gradient(135deg, var(--grad-soft-a), var(--grad-soft-b))',
                        border: '1px solid oklch(0.88 0.07 88)',
                    }}
                >
                    <div
                        className="w-9 h-9 rounded-[10px] bg-bg-card flex items-center justify-center flex-shrink-0"
                        style={{ color: 'var(--color-gold-700)' }}
                    >
                        <LockIcon size={16} />
                    </div>
                    <div className="flex-1 text-[13px] text-ink-0">
                        <b>{monthName} {current.year} is closed.</b>{' '}
                        <span className="text-ink-1">Its entries are locked — reopen to add, edit, or delete.</span>
                    </div>
                    <button
                        onClick={handleToggleClose}
                        disabled={closePending}
                        className="h-9 px-4 rounded-full text-xs font-semibold transition-all hover:brightness-[1.03] disabled:opacity-50 flex-shrink-0 flex items-center gap-1.5"
                        style={{
                            background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))',
                            color: '#1a120a',
                            boxShadow: 'var(--shadow-gold)',
                            border: '1px solid oklch(0.85 0.14 88)',
                        }}
                    >
                        <UnlockIcon size={13} />
                        Reopen
                    </button>
                </motion.div>
            )}

            {/* Controls: real Search + Sort, with Day/Week/Month at the END.
                CHANGED (Tags fix batch): Search/Sort were dead stubs squeezing the
                chips; now they own this row and work. Day/Week/Month was moved here
                (from the Export/Add button row) and pinned right. On mobile it stacks
                below the search+sort pair and right-aligns. */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="flex flex-col sm:flex-row sm:items-center gap-2"
            >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <SearchBox value={search} onChange={setSearch} />
                    <SortMenu sort={sort} onChange={setSort} />
                </div>
                <div className="flex justify-end">
                    <TimeRangeSegment
                        value={range}
                        onChange={setRange}
                        isCurrentMonth={isCurrentMonth}
                    />
                </div>
            </motion.div>

            {/* Filter chips — full-width row. CHANGED (Tags fix batch): the earlier
                right-edge fade DIV read as a shadow/box over the last chip. Replaced
                with a mask-image on the scroll container itself (fades trailing chips
                softly to transparent, no colored box, and self-hides when nothing
                overflows) — a cleaner "there's more →" hint. */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.15 }}
                className="-mt-1"
            >
                <FilterChips
                    value={effectiveFilter}
                    onChange={setFilter}
                    filters={filters}
                />
            </motion.div>

            {/* Day-grouped list */}
            {sortedDays.length > 0 ? (
                <div className="flex flex-col gap-3 md:gap-3.5">
                    {sortedDays.map((day, i) => (
                        <DayCard
                            key={day}
                            day={day}
                            entries={expensesByDay[day]}
                            index={i}
                        />
                    ))}
                </div>
            ) : (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="rounded-[20px] bg-bg-card p-12 text-center"
                    style={{ border: "1px solid var(--color-line-soft)" }}
                >
                    <div className="text-ink-2 text-sm">
                        {search.trim()
                            ? `No entries match “${search.trim()}”.`
                            : "No entries match this filter."}
                    </div>
                    <button
                        onClick={() => {
                            setFilter("all");
                            setRange("month");
                            setSearch("");
                        }}
                        className="mt-3 text-gold-700 text-sm font-medium hover:text-gold-900 transition-colors"
                    >
                        Clear filters
                    </button>
                </motion.div>
            )}

            {/* Period Total */}
            {sortedDays.length > 0 && (
                <PeriodTotalCard
                    filter={effectiveFilter}
                    range={range}
                    total={rangeTotal}
                    filterLabel={filterLabel}
                />
            )}
        </div>
    );
}
