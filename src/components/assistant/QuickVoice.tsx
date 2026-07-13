'use client';

// ADDED (Slice 3 — "one brain"): the quick-mic surface, rebuilt. It is deliberately
// NOT a chat box (that's the assistant's job) — it's VOICE-FIRST: a big animated
// "tap to talk" mic is the hero; results render as the SAME confirm cards the chat
// uses (via the shared ProposalCardList) or a brief spoken-style answer. One brain
// underneath (the assistant engine, quick mode = terse replies), but a distinct,
// voice-only UI so users never confuse it with the full chat.
//
// Distinctions preserved on purpose:
//  • mic-created expenses keep source='voice' (origin="voice" → ledger badge +
//    recent-voice-log), so you can still tell a record was made by voice.
//  • anything deep / multi-turn → one tap "Continue in assistant" carries the SAME
//    session over (no re-run, no duplicate) so the conversation just continues there.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { MicIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import { notifyDataChanged } from '@/lib/data-events';
import { sendAssistantMessage, recordProposalOutcome } from '@/lib/assistant-actions';
import type { Proposal, ProposalOutcome } from '@/lib/assistant/types';
import { AssistantText, ProposalCardList, useChatMic } from './AssistantChat';
import { useAssistant } from './AssistantContext';

// recurring → /fixed (matches the chat's NAV_ROUTES). Only reached by a card's
// "Open Ledger" fallback (closed-month delete); nav chips are suppressed in quick mode.
const NAV_ROUTES: Record<string, string> = {
    dashboard: '/dashboard',
    ledger: '/ledger',
    calendar: '/calendar',
    income: '/income',
    recurring: '/fixed',
};

interface Turn {
    key: string;
    transcript: string;
    reply: string;
    proposals: Proposal[];
    pending: boolean;
    error?: boolean;
}

function Spinner({ size = 22 }: { size?: number }) {
    return (
        <span
            className="inline-block rounded-full border-2 border-current border-t-transparent animate-spin"
            style={{ width: size, height: size }}
            aria-hidden
        />
    );
}

function ThinkingDots() {
    return (
        <span className="flex items-center gap-1.5 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-gold-500 animate-bounce [animation-delay:0ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-gold-500 animate-bounce [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-gold-500 animate-bounce [animation-delay:300ms]" />
        </span>
    );
}

/** The hero control — a big, alive "tap to talk" mic. Idle: gold, gentle breathing +
 *  the app's sonar `.pulse` rings. Recording: coral, faster pulse + expanding rings.
 *  Busy (transcribing / thinking): a spinner, disabled. */
function TalkButton({
    recording,
    busy,
    onClick,
    big,
}: {
    recording: boolean;
    busy: boolean;
    onClick: () => void;
    big?: boolean;
}) {
    const size = big ? 108 : 60;
    return (
        <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
            {/* expanding rings while recording (layered under the button) */}
            {recording &&
                [0, 1, 2].map((i) => (
                    <motion.span
                        key={i}
                        className="absolute rounded-full pointer-events-none"
                        style={{ width: size, height: size, border: '2px solid oklch(0.62 0.2 25 / 0.55)' }}
                        initial={{ scale: 1, opacity: 0.55 }}
                        animate={{ scale: 1.9, opacity: 0 }}
                        transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.5, ease: 'easeOut' }}
                    />
                ))}
            <motion.button
                type="button"
                onClick={onClick}
                disabled={busy}
                aria-label={recording ? 'Stop and send' : 'Tap to talk'}
                className={cn(
                    'relative rounded-full flex items-center justify-center cursor-pointer disabled:cursor-default',
                    !recording && !busy && 'pulse',
                )}
                style={{
                    width: size,
                    height: size,
                    background: recording
                        ? 'linear-gradient(135deg, oklch(0.76 0.16 35), oklch(0.56 0.2 22))'
                        : 'linear-gradient(135deg, oklch(0.85 0.14 90), oklch(0.64 0.16 78))',
                    color: recording ? '#fff' : '#1a120a',
                    boxShadow: recording
                        ? '0 14px 36px -6px oklch(0.58 0.2 22 / 0.6), 0 0 0 4px rgba(255,255,255,0.35)'
                        : '0 12px 32px -6px oklch(0.65 0.16 78 / 0.55), 0 0 0 4px rgba(255,255,255,0.4)',
                    border: 'none',
                }}
                animate={busy ? { scale: 1 } : recording ? { scale: [1, 1.08, 1] } : { scale: [1, 1.04, 1] }}
                transition={
                    busy
                        ? { duration: 0.2 }
                        : { duration: recording ? 1 : 2.6, repeat: Infinity, ease: 'easeInOut' }
                }
                whileTap={{ scale: 0.92 }}
            >
                {busy ? <Spinner size={big ? 34 : 22} /> : <MicIcon size={big ? 40 : 24} />}
            </motion.button>
        </div>
    );
}

export function QuickVoice({
    onHandoff,
    onClose,
}: {
    /** Escalate the whole voice session into the full chat (carries the session id). */
    onHandoff: (sessionId: number | null) => void;
    /** Close the hosting modal (used when a card routes to a page). */
    onClose: () => void;
}) {
    const router = useRouter();
    const { quickSessionId, setQuickSessionId } = useAssistant();
    const [turns, setTurns] = useState<Turn[]>([]);
    const [thinking, setThinking] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    // Seeded from the context's last-known quick session (see AssistantContext) so
    // reopening the modal continues the SAME session instead of minting a new one.
    const [sessionId, setSessionId] = useState<number | null>(quickSessionId);
    const sessionIdRef = useRef<number | null>(quickSessionId);
    const keyRef = useRef(0);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        sessionIdRef.current = sessionId;
        setQuickSessionId(sessionId);
    }, [sessionId, setQuickSessionId]);

    // Keep the results pinned to the bottom as new turns land.
    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [turns, thinking]);

    const runQuickTurn = async (text: string) => {
        const message = text.trim();
        if (!message || thinking) return;
        setErrorMsg('');
        const key = `t${++keyRef.current}`;
        setTurns((prev) => [...prev, { key, transcript: message, reply: '', proposals: [], pending: true }]);
        setThinking(true);
        try {
            const res = await sendAssistantMessage({ sessionId: sessionIdRef.current, message, mode: 'quick' });
            if (res.sessionId) {
                sessionIdRef.current = res.sessionId;
                setSessionId(res.sessionId);
            }
            setTurns((prev) =>
                prev.map((t) =>
                    t.key === key
                        ? { ...t, reply: res.reply, proposals: res.proposals, pending: false, error: !res.ok }
                        : t,
                ),
            );
        } catch {
            setTurns((prev) => prev.map((t) => (t.key === key ? { ...t, pending: false, error: true } : t)));
        } finally {
            setThinking(false);
        }
    };

    const mic = useChatMic(
        (text) => void runQuickTurn(text),
        (msg) => setErrorMsg(msg),
    );

    const busy = mic.transcribing || thinking;
    const toggleMic = () => {
        if (busy) return;
        setErrorMsg('');
        if (mic.recording) mic.stop();
        else mic.start();
    };

    // After a confirmed write: refresh the visible pages so the ledger voice badge +
    // recent-voice-log + dashboard reflect it immediately (same as the chat).
    const handleWritten = () => {
        notifyDataChanged();
        router.refresh();
    };
    const handleResolve = (proposalId: string, outcome: ProposalOutcome, summary?: string) => {
        if (sessionIdRef.current != null)
            recordProposalOutcome(sessionIdRef.current, proposalId, outcome, summary).catch(() => {});
    };
    const handleNavigate = (target: string) => {
        router.push(NAV_ROUTES[target] ?? '/dashboard');
        onClose();
    };

    const statusLabel = mic.recording
        ? 'Listening… tap to send'
        : mic.transcribing
          ? 'Got it — reading…'
          : thinking
            ? 'Thinking…'
            : 'Tap to talk';

    // Empty state — the big mic is the hero.
    if (turns.length === 0) {
        return (
            <div className="flex flex-col flex-1 min-h-0 items-center justify-center gap-6 px-6 text-center">
                <TalkButton big recording={mic.recording} busy={busy} onClick={toggleMic} />
                <div>
                    <div className="text-[15px] font-semibold text-ink-0">{statusLabel}</div>
                    <p className="text-[12.5px] text-ink-2 mt-2 leading-relaxed max-w-[290px]">
                        Say what you spent — “coffee 4.50”, “changed rent to 1300” — or ask how you&apos;re
                        tracking. English or Mandarin, up to you.
                    </p>
                </div>
                {mic.recording && (
                    <button
                        type="button"
                        onClick={mic.cancel}
                        className="text-[11.5px] text-ink-2 hover:text-red-500 transition-colors cursor-pointer"
                    >
                        Cancel
                    </button>
                )}
                {errorMsg && <div className="text-[12px] text-red-500 max-w-[290px]">{errorMsg}</div>}
            </div>
        );
    }

    // After the first take — results scroll above, the mic stays as a compact,
    // still-animated control at the bottom, plus the hand-off to the full chat.
    return (
        <div className="flex flex-col flex-1 min-h-0">
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">
                {turns.map((t) => (
                    <div key={t.key} className="flex flex-col gap-1.5">
                        {/* what we heard — a subtle voice note, not a chat bubble */}
                        <div className="flex items-center gap-1.5 text-[11.5px] text-ink-2">
                            <MicIcon size={12} className="flex-shrink-0" />
                            <span className="italic break-words">“{t.transcript}”</span>
                        </div>
                        {t.pending ? (
                            <ThinkingDots />
                        ) : (
                            <>
                                {t.reply && (
                                    <div className="text-[13px] text-ink-0 leading-relaxed">
                                        <AssistantText
                                            text={t.reply}
                                            onNavigate={handleNavigate}
                                            onSuggest={(label) => void runQuickTurn(label)}
                                            disabled={busy}
                                        />
                                    </div>
                                )}
                                {t.error && (
                                    <div className="text-[12px] text-red-500">
                                        Something went wrong — try again or use the full assistant.
                                    </div>
                                )}
                                {t.proposals.length > 0 && (
                                    <ProposalCardList
                                        proposals={t.proposals}
                                        origin="voice"
                                        onNavigate={handleNavigate}
                                        onWritten={handleWritten}
                                        onResolve={handleResolve}
                                    />
                                )}
                            </>
                        )}
                    </div>
                ))}
            </div>

            <div className="border-t border-line-soft px-4 pt-3 pb-4 flex flex-col items-center gap-2">
                <TalkButton recording={mic.recording} busy={busy} onClick={toggleMic} />
                <div className="text-[11px] text-ink-2 h-4">{statusLabel}</div>
                {mic.recording && (
                    <button
                        type="button"
                        onClick={mic.cancel}
                        className="text-[11px] text-ink-2 hover:text-red-500 transition-colors cursor-pointer"
                    >
                        Cancel
                    </button>
                )}
                {errorMsg && <div className="text-[11px] text-red-500 text-center">{errorMsg}</div>}
                <button
                    type="button"
                    onClick={() => onHandoff(sessionIdRef.current)}
                    className="mt-0.5 inline-flex items-center gap-1.5 text-[11.5px] font-medium text-ink-2 hover:text-ink-0 transition-colors cursor-pointer"
                >
                    Continue in assistant
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                </button>
            </div>
        </div>
    );
}
