'use client';

// ADDED (AI Assistant · Slice 1): global open/close state for the assistant
// slide-over panel, so any surface (floating button, sidebar, future mic
// hand-off) can open it. The chat state itself lives in AssistantChat, which
// stays mounted inside the panel — closing the panel never loses the thread.
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

interface AssistantContextValue {
    open: boolean;
    openPanel: () => void;
    closePanel: () => void;
    togglePanel: () => void;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function AssistantProvider({ children }: { children: React.ReactNode }) {
    const [open, setOpen] = useState(false);
    const openPanel = useCallback(() => setOpen(true), []);
    const closePanel = useCallback(() => setOpen(false), []);
    const togglePanel = useCallback(() => setOpen((o) => !o), []);
    const value = useMemo(
        () => ({ open, openPanel, closePanel, togglePanel }),
        [open, openPanel, closePanel, togglePanel],
    );
    return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAssistant() {
    const ctx = useContext(AssistantContext);
    if (!ctx) throw new Error('useAssistant must be used within AssistantProvider');
    return ctx;
}
