'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
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

    const open = (expense?: Expense) => {
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
