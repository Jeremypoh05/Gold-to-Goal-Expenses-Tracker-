'use client';

// ADDED (Module 4 · UX): a global promise-based confirm dialog so destructive
// actions (deleting an expense / a recurring rule) always ask first. Usage:
//   const confirm = useConfirm();
//   if (await confirm({ title, message, confirmLabel, danger: true })) { …delete… }
// Provider is mounted once in DashboardShell.
//
// ADDED (Module 5.1 · override): the same provider now also exposes a multi-choice
// dialog via useChoice() — for decisions with more than yes/no (e.g. "update open
// months only" / "also update the closed month" / "cancel"). It returns the chosen
// action key, or null when dismissed (ESC / backdrop).

import {
    createContext,
    useContext,
    useState,
    useCallback,
    useRef,
    useEffect,
    type ReactNode,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface ConfirmOptions {
    title: string;
    /** Plain string or JSX (so callers can bold key words like the month name). */
    message?: React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    /** Single-button "info" mode (no Cancel) — for messages that just need an
     *  acknowledgement rather than a yes/no decision (e.g. "month is closed"). */
    hideCancel?: boolean;
}

// ADDED (Module 5.1): visual tone for a button. `warn` = amber "caution" for a
// deliberate override that isn't destructive but shouldn't read as the default.
type Tone = 'primary' | 'danger' | 'ghost' | 'warn';

export interface ChoiceAction {
    /** Returned to the caller when this action is chosen. */
    key: string;
    label: string;
    tone?: Tone;
}

export interface ChoiceOptions {
    title: string;
    message?: React.ReactNode;
    /** Rendered top-to-bottom; the first one is autofocused. */
    actions: ChoiceAction[];
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;
type ChooseFn = (opts: ChoiceOptions) => Promise<string | null>;

// ── Internal, normalized dialog state shared by both APIs ──────────────
interface DialogButton {
    label: string;
    value: unknown; // boolean for confirm, key string for choose
    tone: Tone;
    autoFocus?: boolean;
}
interface DialogState {
    title: string;
    message?: ReactNode;
    buttons: DialogButton[];
    layout: 'row' | 'stack';
    dismissValue: unknown; // resolved on ESC / backdrop
}

interface DialogApi {
    confirm: ConfirmFn;
    choose: ChooseFn;
}

const DialogContext = createContext<DialogApi | null>(null);

// tone → button style
function toneStyle(tone: Tone): React.CSSProperties {
    switch (tone) {
        case 'danger':
            return { background: 'oklch(0.58 0.21 25)', color: '#fff' };
        case 'warn':
            return {
                background: 'color-mix(in oklch, oklch(0.78 0.16 70) 16%, transparent)',
                color: 'var(--color-ink-0)',
                border: '1px solid oklch(0.78 0.16 70)',
            };
        case 'ghost':
            return { background: 'var(--color-bg-card)', color: 'var(--color-ink-1)', border: '1px solid var(--color-line)' };
        case 'primary':
        default:
            return { background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))', color: '#1a120a' };
    }
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<DialogState | null>(null);
    const resolver = useRef<((v: unknown) => void) | null>(null);

    const settle = useCallback((v: unknown) => {
        resolver.current?.(v);
        resolver.current = null;
        setState(null);
    }, []);

    const confirm = useCallback<ConfirmFn>((o) => {
        return new Promise<boolean>((resolve) => {
            resolver.current = resolve as (v: unknown) => void;
            const buttons: DialogButton[] = [];
            if (!o.hideCancel) {
                buttons.push({ label: o.cancelLabel ?? 'Cancel', value: false, tone: 'ghost' });
            }
            buttons.push({
                label: o.confirmLabel ?? 'Confirm',
                value: true,
                tone: o.danger ? 'danger' : 'primary',
                autoFocus: true,
            });
            setState({ title: o.title, message: o.message, buttons, layout: 'row', dismissValue: false });
        });
    }, []);

    const choose = useCallback<ChooseFn>((o) => {
        return new Promise<string | null>((resolve) => {
            resolver.current = resolve as (v: unknown) => void;
            const buttons: DialogButton[] = o.actions.map((a, i) => ({
                label: a.label,
                value: a.key,
                tone: a.tone ?? (i === 0 ? 'primary' : 'ghost'),
                autoFocus: i === 0,
            }));
            setState({ title: o.title, message: o.message, buttons, layout: 'stack', dismissValue: null });
        });
    }, []);

    // ESC dismisses (resolves the dialog's dismiss value).
    useEffect(() => {
        if (!state) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') settle(state.dismissValue);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [state, settle]);

    return (
        <DialogContext.Provider value={{ confirm, choose }}>
            {children}
            <AnimatePresence>
                {state && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        onClick={() => settle(state.dismissValue)}
                        className="fixed inset-0 z-[60] flex items-center justify-center p-5"
                        style={{ background: 'rgba(30, 20, 5, 0.45)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}
                    >
                        <motion.div
                            initial={{ opacity: 0, y: 16, scale: 0.97 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 16, scale: 0.97 }}
                            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                            onClick={(e) => e.stopPropagation()}
                            className="bg-bg-card rounded-[22px] shadow-2xl w-full max-w-[380px] p-6"
                            style={{ border: '1px solid var(--color-line)' }}
                            role="alertdialog"
                            aria-modal="true"
                        >
                            <div className="display" style={{ fontSize: 20, lineHeight: 1.15 }}>{state.title}</div>
                            {state.message && (
                                <div className="text-[13px] text-ink-2 mt-2 leading-relaxed">{state.message}</div>
                            )}
                            {state.layout === 'row' ? (
                                <div className="flex items-center gap-2.5 mt-6">
                                    <div className="flex-1" />
                                    {state.buttons.map((b, i) => (
                                        <button
                                            key={i}
                                            type="button"
                                            autoFocus={b.autoFocus}
                                            onClick={() => settle(b.value)}
                                            className="h-10 px-5 rounded-full text-sm font-semibold transition-all hover:brightness-[1.05]"
                                            style={toneStyle(b.tone)}
                                        >
                                            {b.label}
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                // Stacked (multi-choice) layout — full-width buttons, top-to-bottom.
                                <div className="flex flex-col gap-2 mt-6">
                                    {state.buttons.map((b, i) => (
                                        <button
                                            key={i}
                                            type="button"
                                            autoFocus={b.autoFocus}
                                            onClick={() => settle(b.value)}
                                            className="h-11 px-4 rounded-2xl text-sm font-semibold transition-all hover:brightness-[1.04]"
                                            style={toneStyle(b.tone)}
                                        >
                                            {b.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </DialogContext.Provider>
    );
}

export function useConfirm(): ConfirmFn {
    const ctx = useContext(DialogContext);
    if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
    return ctx.confirm;
}

// ADDED (Module 5.1): multi-choice sibling of useConfirm.
export function useChoice(): ChooseFn {
    const ctx = useContext(DialogContext);
    if (!ctx) throw new Error('useChoice must be used within ConfirmProvider');
    return ctx.choose;
}
