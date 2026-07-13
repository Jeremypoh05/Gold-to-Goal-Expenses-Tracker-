'use client';

// ADDED (AI Assistant · Slice 1): global open/close state for the assistant
// slide-over panel, so any surface (floating button, sidebar, future mic
// hand-off) can open it. The chat state itself lives in AssistantChat, which
// stays mounted inside the panel — closing the panel never loses the thread.
//
// CHANGED (Slice 3 — "one brain"): openPanel now optionally carries a HANDOFF
// payload so the quick-mic can escalate into the full chat WITH context —
// either the exact session it just started (sessionId), or a pre-filled /
// auto-sent prompt. The full-chat AssistantChat consumes `pending` on open and
// clears it via consumePending(). Plain openPanel() (launcher/dock) is unchanged.
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

/** What a hand-off carries into the full chat. All fields optional:
 *  - sessionId: jump straight to (and re-fetch) this thread — the quick-mic's turn
 *  - prompt: pre-fill the composer with this text
 *  - autoSend: if a prompt is given, send it immediately instead of just filling it */
export interface AssistantHandoff {
    sessionId?: number;
    prompt?: string;
    autoSend?: boolean;
}

interface AssistantContextValue {
    open: boolean;
    openPanel: (handoff?: AssistantHandoff) => void;
    closePanel: () => void;
    togglePanel: () => void;
    /** Pending hand-off for the full-chat surface to pick up on its next open. */
    pending: AssistantHandoff | null;
    /** Called by the full chat once it has consumed `pending`. */
    consumePending: () => void;
    /** ADDED (Slice 3c): the quick-mic's last session id, kept HERE (not in QuickVoice's
     *  own state) because QuickVoice fully unmounts/remounts every time the voice modal
     *  closes/reopens — without lifting this up, each reopen minted a brand-new
     *  ChatSession row even for a casual "open → say one thing → close" flow. This
     *  provider persists for the whole tab session, so a fresh QuickVoice mount picks
     *  up where the last one left off and keeps appending to the SAME session. */
    quickSessionId: number | null;
    setQuickSessionId: (id: number | null) => void;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function AssistantProvider({ children }: { children: React.ReactNode }) {
    const [open, setOpen] = useState(false);
    const [pending, setPending] = useState<AssistantHandoff | null>(null);
    const [quickSessionId, setQuickSessionId] = useState<number | null>(null);
    const openPanel = useCallback((handoff?: AssistantHandoff) => {
        // Only stash a hand-off if it actually carries something; a bare
        // openPanel() (Ask-Honey button, sidebar) just opens the panel as before.
        if (handoff && (handoff.sessionId != null || handoff.prompt)) setPending(handoff);
        setOpen(true);
    }, []);
    const closePanel = useCallback(() => setOpen(false), []);
    const togglePanel = useCallback(() => setOpen((o) => !o), []);
    const consumePending = useCallback(() => setPending(null), []);
    const value = useMemo(
        () => ({ open, openPanel, closePanel, togglePanel, pending, consumePending, quickSessionId, setQuickSessionId }),
        [open, openPanel, closePanel, togglePanel, pending, consumePending, quickSessionId],
    );
    return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAssistant() {
    const ctx = useContext(AssistantContext);
    if (!ctx) throw new Error('useAssistant must be used within AssistantProvider');
    return ctx;
}
