'use client';

// ADDED (Phase 6.1): single shared voice store + modal/toast state.
// The Voice modal (triggered from anywhere) and the /voice history page both
// read/write through this one provider, so capture / edit / delete stay
// consistent app-wide. This is the "single source of truth" shape — Phase 8
// swaps the in-memory list for DB queries (voice log = expense where
// source='voice'), at which point ledger ↔ voice are literally the same record.

import {
    createContext,
    useContext,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import { INITIAL_VOICE_LOGS } from '@/data/voiceSamples';
import { CURRENT } from '@/data/sampleExpenses';
import type { VoiceLog, CategoryKey, Currency } from '@/types';

/** A freshly captured entry (before id/time/day are assigned). */
export interface NewVoiceLog {
    lang: string;
    transcript: string;
    cat: CategoryKey;
    amt: number;
    currency: Currency;
    note: string;
    status: 'confirmed' | 'edited';
}

/** Editable fields of a stored log. */
export type VoiceLogPatch = Partial<Pick<VoiceLog, 'amt' | 'currency' | 'cat' | 'note'>>;

interface ToastData {
    amt: number;
    currency: Currency;
}

interface VoiceContextValue {
    logs: VoiceLog[];
    addLog: (entry: NewVoiceLog) => void;
    editLog: (id: number, patch: VoiceLogPatch) => void;
    deleteLog: (id: number) => void;
    isModalOpen: boolean;
    openModal: () => void;
    closeModal: () => void;
    toast: ToastData | null;
    dismissToast: () => void;
}

const VoiceContext = createContext<VoiceContextValue | null>(null);

const TOAST_MS = 5000;

export function VoiceProvider({ children }: { children: ReactNode }) {
    const [logs, setLogs] = useState<VoiceLog[]>(() => [...INITIAL_VOICE_LOGS]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [toast, setToast] = useState<ToastData | null>(null);

    const nextId = useRef(900); // local id source; DB assigns real ids in Phase 8
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showToast = (t: ToastData) => {
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setToast(t);
        // setState inside a timer callback is fine (not a synchronous effect body)
        toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
    };

    const dismissToast = () => {
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setToast(null);
    };

    const addLog = (entry: NewVoiceLog) => {
        const now = new Date();
        const time = `${String(now.getHours()).padStart(2, '0')}:${String(
            now.getMinutes()
        ).padStart(2, '0')}`;
        const log: VoiceLog = {
            id: (nextId.current += 1),
            lang: entry.lang,
            transcript: entry.transcript,
            cat: entry.cat,
            amt: entry.amt,
            currency: entry.currency,
            note: entry.note,
            time,
            day: CURRENT.day,
            status: entry.status,
        };
        setLogs((prev) => [log, ...prev]);
        showToast({ amt: entry.amt, currency: entry.currency });
    };

    const editLog = (id: number, patch: VoiceLogPatch) => {
        setLogs((prev) =>
            prev.map((l) => (l.id === id ? { ...l, ...patch, status: 'edited' } : l))
        );
    };

    const deleteLog = (id: number) => {
        setLogs((prev) => prev.filter((l) => l.id !== id));
    };

    const openModal = () => setIsModalOpen(true);
    const closeModal = () => setIsModalOpen(false);

    return (
        <VoiceContext.Provider
            value={{
                logs,
                addLog,
                editLog,
                deleteLog,
                isModalOpen,
                openModal,
                closeModal,
                toast,
                dismissToast,
            }}
        >
            {children}
        </VoiceContext.Provider>
    );
}

export function useVoice(): VoiceContextValue {
    const ctx = useContext(VoiceContext);
    if (!ctx) throw new Error('useVoice must be used within VoiceProvider');
    return ctx;
}
