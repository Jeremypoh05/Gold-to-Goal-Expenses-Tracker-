'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

// ─────────────────────────────────────────────────────────────
// Context type
// ─────────────────────────────────────────────────────────────
interface AddModalContextValue {
    isOpen: boolean;
    open: () => void;
    close: () => void;
}

const AddModalContext = createContext<AddModalContextValue | null>(null);

// ─────────────────────────────────────────────────────────────
// Provider — wraps the dashboard layout
// ─────────────────────────────────────────────────────────────
export function AddModalProvider({ children }: { children: ReactNode }) {
    const [isOpen, setIsOpen] = useState(false);

    const open = () => setIsOpen(true);
    const close = () => setIsOpen(false);

    return (
        <AddModalContext.Provider value={{ isOpen, open, close }}>
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