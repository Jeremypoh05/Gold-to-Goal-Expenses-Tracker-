'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { useExpenses } from '@/components/data/ExpensesContext';
import { useConfirm } from '@/components/shared';
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
    const { monthClosed, todayClosed } = useExpenses();
    const confirm = useConfirm();

    const open = (expense?: Expense) => {
        // New expenses always land on today (the manual modal has no date
        // picker); edits keep the row's existing month (the viewed month).
        const locked = expense ? monthClosed : todayClosed;
        if (locked) {
            void confirm({
                title: 'This month is closed',
                message: expense
                    ? 'Reopen this month on the Ledger page to edit or delete its entries.'
                    : 'Reopen the current month on the Ledger page to add new expenses.',
                confirmLabel: 'Got it',
                hideCancel: true,
            });
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
