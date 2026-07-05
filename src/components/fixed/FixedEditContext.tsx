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
import { useExpenses } from '@/components/data/ExpensesContext';
import { useAddModal } from '@/components/dashboard/AddModalContext';
import {
    fetchFixedExpenses,
    updateFixedExpense,
    deleteFixedExpense,
    changeFixedAmount,
    suggestFixedMeta,
} from '@/lib/actions';
import type { UiFixedExpense } from '@/lib/expense-utils';
import type { Expense } from '@/types';

interface FixedEditContextValue {
    /** Open the recurring modal for the definition behind a generated row. */
    openFixedEdit: (sourceId: number, fallbackRow?: Expense) => void;
}

const FixedEditContext = createContext<FixedEditContextValue | null>(null);

export function FixedEditProvider({ children }: { children: ReactNode }) {
    const { current, refresh } = useExpenses();
    const { open: openManualEdit } = useAddModal();
    const [item, setItem] = useState<UiFixedExpense | null>(null);
    const [open, setOpen] = useState(false);
    const [pending, startTransition] = useTransition();

    const openFixedEdit = (sourceId: number, fallbackRow?: Expense) => {
        startTransition(async () => {
            const items = await fetchFixedExpenses();
            const target = items.find((f) => f.id === sourceId);
            if (target) {
                setItem(target);
                setOpen(true);
            } else if (fallbackRow) {
                // Definition was deleted → treat the row as a plain expense.
                openManualEdit(fallbackRow);
            }
        });
    };

    const close = () => setOpen(false);

    const handleSave = (v: FixedExpenseForm) => {
        if (v.id === undefined) return;
        startTransition(async () => {
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
            });
            setOpen(false);
            refresh();
        });
    };

    const handleDelete = (id: number) => {
        startTransition(async () => {
            await deleteFixedExpense(id);
            setOpen(false);
            refresh();
        });
    };

    const handleChangeAmount = (v: { id: number; fromYear: number; fromMonth: number; newAmount: number }) => {
        startTransition(async () => {
            await changeFixedAmount(v.id, { fromYear: v.fromYear, fromMonth: v.fromMonth, newAmount: v.newAmount });
            setOpen(false);
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
