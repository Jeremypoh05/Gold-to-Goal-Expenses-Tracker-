'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { useExpenses } from '@/components/data/ExpensesContext';
import { useConfirm } from '@/components/shared';
import { reopenMonth } from '@/lib/actions';
import { MONTH_NAMES } from '@/lib/utils';
import type { Expense } from '@/types';

// ─────────────────────────────────────────────────────────────
// Context type
// CHANGED (Phase 8): `open` can carry an existing expense → the modal opens in
// edit mode (pre-filled, saves via updateExpense). No arg → fresh "new expense".
// ─────────────────────────────────────────────────────────────
interface AddModalContextValue {
    isOpen: boolean;
    editTarget: Expense | null;
    open: (expense?: Expense) => void;
    close: () => void;
}

const AddModalContext = createContext<AddModalContextValue | null>(null);

// ─────────────────────────────────────────────────────────────
// Provider — wraps the dashboard layout
// ─────────────────────────────────────────────────────────────
export function AddModalProvider({ children }: { children: ReactNode }) {
    const [isOpen, setIsOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<Expense | null>(null);
    // ADDED (Module 5): a single choke point for the monthly-close hard lock —
    // every "+"/"Add row" button and every row-edit action across the app calls
    // this same `open`, so gating it here covers all of them at once.
    // CHANGED (Module 5.1): the block is now a "Reopen month?" decision instead
    // of a dead-end notice — confirming reopens the month and continues straight
    // into the modal the user was trying to open.
    const { current, monthClosed, todayClosed, refresh } = useExpenses();
    const confirm = useConfirm();

    const open = (expense?: Expense) => {
        // New expenses always land on today (the manual modal has no date
        // picker); edits keep the row's existing month (the viewed month).
        const locked = expense ? monthClosed : todayClosed;
        if (locked) {
            const now = new Date();
            const y = expense ? current.year : now.getFullYear();
            const m = expense ? current.month : now.getMonth() + 1;
            void (async () => {
                const ok = await confirm({
                    title: `${MONTH_NAMES[m - 1]} ${y} is closed`,
                    message: expense ? (
                        <>Its entries are <b>locked</b>. <b>Reopen the month</b> to edit or delete this entry — you can close it again afterwards.</>
                    ) : (
                        <>New expenses land in <b>{MONTH_NAMES[m - 1]} {y}</b>, which is <b>closed</b>. <b>Reopen it</b> to keep logging — you can close it again afterwards.</>
                    ),
                    confirmLabel: 'Reopen month',
                    cancelLabel: 'Cancel',
                });
                if (!ok) return;
                await reopenMonth(y, m);
                refresh();
                setEditTarget(expense ?? null);
                setIsOpen(true);
            })();
            return;
        }
        setEditTarget(expense ?? null);
        setIsOpen(true);
    };
    const close = () => setIsOpen(false);

    return (
        <AddModalContext.Provider value={{ isOpen, editTarget, open, close }}>
            {children}
        </AddModalContext.Provider>
    );
}

// ─────────────────────────────────────────────────────────────
// Hook — any component can use this to control the modal
// ─────────────────────────────────────────────────────────────
export function useAddModal(): AddModalContextValue {
    const context = useContext(AddModalContext);
    if (!context) {
        throw new Error('useAddModal must be used within AddModalProvider');
    }
    return context;
}
