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
import { useConfirm } from '@/components/shared';
import { createExpense, updateExpense, deleteExpense, reopenMonth } from '@/lib/actions';
import type { VoiceLog, CategoryKey, Currency } from '@/types';

/** A freshly captured entry (before id/time/day are assigned). */
export interface NewVoiceLog {
    lang: string;
    transcript: string;
    cat: CategoryKey;
    amt: number;
    currency: Currency;
    note: string;
    tags?: string[]; // ADDED (Voice AI): AI-suggested tags from the utterance
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
    const { voiceLogs, refresh, todayClosed } = useExpenses(); // server truth (voice-sourced expenses)
    const confirm = useConfirm();
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
                tags: entry.tags ?? [],
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

    // ADDED (Module 5): a single choke point — every mic trigger across the app
    // (bottom-tab orb, dashboard CTAs, /voice hero) calls this same openModal.
    // CHANGED (Module 5.1): blocked → "Reopen month?" decision; confirming
    // reopens the current month and continues straight into voice capture.
    const openModal = () => {
        if (todayClosed) {
            const now = new Date();
            const y = now.getFullYear();
            const m = now.getMonth() + 1;
            void (async () => {
                const ok = await confirm({
                    title: 'This month is closed',
                    message: (
                        <>Voice logs land in the <b>current month</b>, which is <b>closed</b>. <b>Reopen it</b> to keep logging — you can close it again afterwards.</>
                    ),
                    confirmLabel: 'Reopen month',
                    cancelLabel: 'Cancel',
                });
                if (!ok) return;
                await reopenMonth(y, m);
                refresh();
                setIsModalOpen(true);
            })();
            return;
        }
        setIsModalOpen(true);
    };
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
