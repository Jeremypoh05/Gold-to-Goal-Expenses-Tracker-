'use client';

// CHANGED (Phase 8): the voice store is now DB-backed. `logs` come from the
// server (ExpensesProvider → voice-sourced expenses); add/edit/delete call the
// server actions and then refresh() so the list reconciles to DB truth.
// A voice log IS an Expense with source='voice' — ledger ↔ voice are the same record.
// Modal + toast remain local UI state.
import {
    createContext,
    useContext,
    useRef,
    useState,
    useTransition,
    type ReactNode,
} from 'react';
import { useExpenses } from '@/components/data/ExpensesContext';
import { createExpense, updateExpense, deleteExpense } from '@/lib/actions';
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
    /** True while a mutation is in flight (server action + refresh). */
    isPending: boolean;
}

const VoiceContext = createContext<VoiceContextValue | null>(null);

const TOAST_MS = 5000;

export function VoiceProvider({ children }: { children: ReactNode }) {
    const { voiceLogs, refresh } = useExpenses(); // server truth (voice-sourced expenses)
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [toast, setToast] = useState<ToastData | null>(null);
    const [isPending, startTransition] = useTransition();

    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showToast = (t: ToastData) => {
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setToast(t);
        toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
    };

    const dismissToast = () => {
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setToast(null);
    };

    const addLog = (entry: NewVoiceLog) => {
        showToast({ amt: entry.amt, currency: entry.currency });
        startTransition(async () => {
            await createExpense({
                amount: entry.amt,
                category: entry.cat,
                currency: entry.currency,
                note: entry.note,
                source: 'voice',
                transcript: entry.transcript,
                lang: entry.lang,
                voiceStatus: entry.status,
            });
            refresh();
        });
    };

    const editLog = (id: number, patch: VoiceLogPatch) => {
        startTransition(async () => {
            await updateExpense(id, {
                ...(patch.amt !== undefined && { amount: patch.amt }),
                ...(patch.cat !== undefined && { category: patch.cat }),
                ...(patch.currency !== undefined && { currency: patch.currency }),
                ...(patch.note !== undefined && { note: patch.note }),
                voiceStatus: 'edited',
            });
            refresh();
        });
    };

    const deleteLog = (id: number) => {
        startTransition(async () => {
            await deleteExpense(id);
            refresh();
        });
    };

    const openModal = () => setIsModalOpen(true);
    const closeModal = () => setIsModalOpen(false);

    return (
        <VoiceContext.Provider
            value={{
                logs: voiceLogs,
                addLog,
                editLog,
                deleteLog,
                isModalOpen,
                openModal,
                closeModal,
                toast,
                dismissToast,
                isPending,
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
