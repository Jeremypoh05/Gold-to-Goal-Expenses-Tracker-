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
import { useConfirm, useChoice } from '@/components/shared';
import { createExpense, updateExpense, deleteExpense, reopenMonth, fetchClosedMonths } from '@/lib/actions';
import { MONTH_NAMES } from '@/lib/utils';
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
    // ADDED (AI Assistant · Phase A): resolved historical date (ISO) or null = now.
    // "bought a bag on July 2" → files the expense on July 2, not today.
    spentAt?: string | null;
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
    const confirm = useConfirm();
    const choose = useChoice(); // ADDED (Phase A follow-up): 3-way closed-month decision
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [toast, setToast] = useState<ToastData | null>(null);
    const [isPending, startTransition] = useTransition();
    // ADDED (Phase A): addLog now awaits createExpense so it can catch a
    // closed-month rejection (a historical date can land in a closed month).
    const [busy, setBusy] = useState(false);

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
        // Optimistic toast; if the write fails (closed month), we dismiss it below.
        showToast({ amt: entry.amt, currency: entry.currency });
        const payload = {
            amount: entry.amt,
            category: entry.cat,
            currency: entry.currency,
            note: entry.note,
            tags: entry.tags ?? [],
            source: 'voice' as const,
            transcript: entry.transcript,
            lang: entry.lang,
            voiceStatus: entry.status,
            ...(entry.spentAt ? { spentAt: entry.spentAt } : {}),
        };
        // The target month: a historical spentAt may differ from today.
        const target = entry.spentAt ? new Date(entry.spentAt) : new Date();
        const y = target.getFullYear();
        const m = target.getMonth() + 1;

        // Not wrapped in startTransition: on a closed-month rejection we surface a
        // confirm() decision, which must NOT run inside a transition (it would hold
        // `pending` true and jam the UI — the documented Module 5.1 anti-pattern).
        const genericError = () =>
            confirm({
                title: "Couldn't log that",
                message: 'Something went wrong logging the expense. Please try again.',
                confirmLabel: 'OK',
                hideCancel: true,
            });

        void (async () => {
            setBusy(true);
            try {
                await createExpense(payload);
            } catch {
                dismissToast();
                // Confirm the failure really is a closed month (not a transient error),
                // so we don't show the reopen/override dialog for an unrelated failure.
                let isClosed = false;
                try {
                    const closed = await fetchClosedMonths();
                    isClosed = closed.some((c) => c.year === y && c.month === m);
                } catch {
                    /* fall through to the generic error */
                }

                if (!isClosed) {
                    await genericError();
                } else {
                    const monthName = `${MONTH_NAMES[m - 1]} ${y}`;
                    // Richer decision: reopen the month, add straight into it (stays
                    // closed — an explicit override), or cancel.
                    const picked = await choose({
                        title: `${monthName} is closed`,
                        message: (
                            <>
                                This expense is dated{' '}
                                <b>{`${MONTH_NAMES[m - 1]} ${target.getDate()}, ${y}`}</b>, in a{' '}
                                <b>closed</b> month. You can <b>reopen</b> it and log normally (it stays
                                open until you close it again), or <b>add it straight into the closed
                                month</b> — it stays closed, but the amount still counts toward{' '}
                                <b>{monthName}</b>.
                            </>
                        ),
                        actions: [
                            { key: 'reopen', label: 'Reopen month & log', tone: 'primary' },
                            { key: 'add', label: `Add to ${monthName} (stays closed)`, tone: 'warn' },
                            { key: 'cancel', label: 'Cancel', tone: 'ghost' },
                        ],
                    });
                    try {
                        if (picked === 'reopen') {
                            await reopenMonth(y, m);
                            await createExpense(payload);
                            showToast({ amt: entry.amt, currency: entry.currency });
                        } else if (picked === 'add') {
                            await createExpense(payload, true); // override the closed-month freeze
                            showToast({ amt: entry.amt, currency: entry.currency });
                        }
                    } catch {
                        await genericError();
                    }
                }
            } finally {
                refresh();
                setBusy(false);
            }
        })();
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

    // CHANGED (AI Assistant · Phase A): openModal no longer pre-gates on
    // todayClosed. Now that a voice log can carry a HISTORICAL date, "is this
    // month closed?" must be checked against the ACTUAL target month at SAVE
    // time — which addLog does (it offers a "Reopen & log / Cancel" decision if
    // createExpense is rejected). The old pre-gate wrongly blocked the mic
    // whenever the CURRENT month was closed, even when the user was viewing an
    // open month or dictating an expense for one (the reported bug). The server
    // action still asserts the month is open, so this only moves the friendly
    // decision to the moment we know which month the expense actually lands in.
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
                isPending: isPending || busy,
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
