'use client';

// ADDED (Module 4 · UX): global "edit recurring" modal. Any page (dashboard Recent,
// ledger, calendar) can open a generated row's recurring definition in a modal
// IN PLACE — no navigation to /fixed. Mirrors AddModalContext: the provider is
// mounted once in DashboardShell and renders the FixedExpenseModal itself; pages
// call openFixedEdit(sourceId, fallbackRow?). If the definition no longer exists
// (orphaned row from an old delete), it falls back to the manual edit modal so the
// row can still be corrected or removed.

import { createContext, useContext, useState, useTransition, type ReactNode } from 'react';
import { FixedExpenseModal, type FixedExpenseForm } from './FixedExpenseModal';
import { useClosedMonthGuard } from './useClosedMonthGuard';
import { useExpenses } from '@/components/data/ExpensesContext';
import { useAddModal } from '@/components/dashboard/AddModalContext';
import { useConfirm } from '@/components/shared';
import {
    fetchFixedExpenses,
    updateFixedExpense,
    deleteFixedExpense,
    changeFixedAmount,
    suggestFixedMeta,
    reopenMonth,
} from '@/lib/actions';
import { MONTH_NAMES } from '@/lib/utils';
import type { UiFixedExpense } from '@/lib/expense-utils';
import type { Expense } from '@/types';

interface FixedEditContextValue {
    /** Open the recurring modal for the definition behind a generated row. */
    openFixedEdit: (sourceId: number, fallbackRow?: Expense) => void;
}

const FixedEditContext = createContext<FixedEditContextValue | null>(null);

export function FixedEditProvider({ children }: { children: ReactNode }) {
    const { current, monthClosed, refresh } = useExpenses();
    const { open: openManualEdit } = useAddModal();
    const confirm = useConfirm();
    const guardClosedMonths = useClosedMonthGuard();
    const [item, setItem] = useState<UiFixedExpense | null>(null);
    const [open, setOpen] = useState(false);
    const [pending, startTransition] = useTransition();

    const openFixedEdit = (sourceId: number, fallbackRow?: Expense) => {
        // ADDED (Module 5.1): openFixedEdit is only ever invoked from a row inside
        // the VIEWED month (ledger / dashboard Recent) — the Recurring page has its
        // own modal and is deliberately NOT gated (rule administration is month-
        // agnostic; the server freezes closed months' rows on its own). So if the
        // viewed month is closed, offer to reopen it and then continue.
        // CHANGED (Module 5.1 · fix): the closed-month confirm is awaited OUTSIDE
        // startTransition. Awaiting a user dialog *inside* the transition kept
        // `pending` true for the whole time it was open — and because the modal's
        // Save/Delete are disabled while `pending`, they could come up stuck. Only
        // the actual server work (reopen + fetch defs) belongs in the transition.
        void (async () => {
            if (monthClosed) {
                const ok = await confirm({
                    title: `${MONTH_NAMES[current.month - 1]} ${current.year} is closed`,
                    message: (
                        <>Its entries are <b>locked</b>. <b>Reopen the month</b> to manage this recurring entry — or edit the rule from the <b>Recurring page</b> (closed months keep their recorded amounts).</>
                    ),
                    confirmLabel: 'Reopen month',
                    cancelLabel: 'Cancel',
                });
                if (!ok) return;
            }
            startTransition(async () => {
                try {
                    if (monthClosed) {
                        await reopenMonth(current.year, current.month);
                        refresh();
                    }
                    const items = await fetchFixedExpenses();
                    const target = items.find((f) => f.id === sourceId);
                    if (target) {
                        setItem(target);
                        setOpen(true);
                    } else if (fallbackRow) {
                        // Definition was deleted → treat the row as a plain expense.
                        openManualEdit(fallbackRow);
                    }
                } catch {
                    // Couldn't load the definition — fall back to the plain editor if we
                    // have the row, so the entry is still fixable. Never strand silently.
                    if (fallbackRow) openManualEdit(fallbackRow);
                }
            });
        })();
    };

    const close = () => setOpen(false);

    const handleSave = (v: FixedExpenseForm) => {
        if (v.id === undefined) return;
        startTransition(async () => {
            // Ask how to handle any closed months this edit spans.
            const g = await guardClosedMonths({
                startYear: v.startYear,
                startMonth: v.startMonth,
                endYear: v.endYear,
                endMonth: v.endMonth,
            });
            if (!g.proceed) return;
            // CHANGED (Module 5.1 · robustness): try/catch so a server-side throw
            // (e.g. a race where the month closes mid-edit) can't strand the modal
            // in a stuck "Rendering" state — surface it and still resync the view.
            try {
                await updateFixedExpense(v.id!, {
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
                setOpen(false);
            } catch {
                await confirm({
                    title: 'Couldn’t save',
                    message: <>Something went wrong updating this recurring entry. Please try again.</>,
                    confirmLabel: 'OK',
                    hideCancel: true,
                });
            }
            refresh();
        });
    };

    const handleDelete = (id: number) => {
        startTransition(async () => {
            // Warn if the rule has entries in closed months (kept by default).
            const g = await guardClosedMonths(
                {
                    startYear: item?.startYear ?? new Date().getFullYear(),
                    startMonth: item?.startMonth ?? 1,
                    endYear: item?.endYear ?? null,
                    endMonth: item?.endMonth ?? null,
                },
                'delete',
            );
            if (!g.proceed) return;
            try {
                await deleteFixedExpense(id, g.overrideClosed);
                setOpen(false);
            } catch {
                await confirm({
                    title: 'Couldn’t delete',
                    message: <>Something went wrong removing this recurring entry. Please try again.</>,
                    confirmLabel: 'OK',
                    hideCancel: true,
                });
            }
            refresh();
        });
    };

    const handleChangeAmount = (v: { id: number; fromYear: number; fromMonth: number; newAmount: number }) => {
        startTransition(async () => {
            // A rate change only touches months from the change point forward.
            const g = await guardClosedMonths({
                startYear: v.fromYear,
                startMonth: v.fromMonth,
                endYear: item?.endYear ?? null,
                endMonth: item?.endMonth ?? null,
            });
            if (!g.proceed) return;
            try {
                await changeFixedAmount(v.id, { fromYear: v.fromYear, fromMonth: v.fromMonth, newAmount: v.newAmount }, g.overrideClosed);
                setOpen(false);
            } catch {
                await confirm({
                    title: 'Couldn’t apply the change',
                    message: <>Something went wrong applying the new amount. Please try again.</>,
                    confirmLabel: 'OK',
                    hideCancel: true,
                });
            }
            refresh();
        });
    };

    return (
        <FixedEditContext.Provider value={{ openFixedEdit }}>
            {children}
            <FixedExpenseModal
                open={open}
                item={item}
                defaultYear={current.year}
                pending={pending}
                onClose={close}
                onSave={handleSave}
                onDelete={handleDelete}
                onSuggest={suggestFixedMeta}
                onChangeAmount={handleChangeAmount}
            />
        </FixedEditContext.Provider>
    );
}

export function useFixedEdit(): FixedEditContextValue {
    const ctx = useContext(FixedEditContext);
    if (!ctx) throw new Error('useFixedEdit must be used within FixedEditProvider');
    return ctx;
}
