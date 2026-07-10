'use client';

// ADDED (AI Assistant · Slice 1): the reusable chat core — message thread +
// composer (text + mic). Used by both the global slide-over panel and the
// /assistant page. The TEXT input doubles as the dev test harness: it feeds
// the exact same engine the mic will use, so the whole flow is verifiable
// without a microphone. Chat history persists in the DB (ChatSession/Message).
import { useCallback, useEffect, useRef, useState } from 'react';
import { MicIcon, SparkleIcon, PlusIcon, ChevronIcon, TrashIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import {
    sendAssistantMessage,
    fetchAssistantSessions,
    fetchAssistantMessages,
    deleteAssistantSession,
    transcribeChatAudio,
    type AssistantSessionSummary,
} from '@/lib/assistant-actions';

interface ChatMessage {
    key: string;
    role: 'user' | 'assistant';
    content: string;
    toolsUsed?: string[];
}

// Friendly labels for the "looked at your data" chips under a reply.
const TOOL_LABELS: Record<string, string> = {
    find_expenses: 'searched ledger',
    find_recurring: 'checked recurring',
    get_financial_overview: 'read overview',
    analyze_spending: 'analyzed spending',
    project_savings: 'ran projection',
    get_closed_months: 'checked closed months',
    get_preferences: 'read preferences',
};

const STARTERS = [
    '这个月我花最多的是什么？',
    'How much did I spend on food this month?',
    '我需要多久才能存到10万？',
    'Any gentle tips to save more?',
];

/** Minimal renderer for assistant replies: **bold**, "-" bullets, line breaks. */
function renderAssistantText(text: string): React.ReactNode {
    const renderInline = (line: string, key: number) => {
        const parts = line.split(/\*\*(.+?)\*\*/g);
        return (
            <span key={key}>
                {parts.map((p, i) => (i % 2 === 1 ? <b key={i}>{p}</b> : p))}
            </span>
        );
    };
    return text.split('\n').map((line, i) => {
        const bullet = line.match(/^\s*[-•]\s+(.*)$/);
        if (bullet) {
            return (
                <div key={i} className="flex gap-1.5 pl-1">
                    <span className="text-gold-700 flex-shrink-0">•</span>
                    <span>{renderInline(bullet[1], i)}</span>
                </div>
            );
        }
        if (!line.trim()) return <div key={i} className="h-2" />;
        return <div key={i}>{renderInline(line, i)}</div>;
    });
}

/** Tiny STT-only recorder for the chat mic — transcript lands in the input box
 *  (the user reviews before sending, unlike the quick mic's one-shot flow). */
function useChatMic(onText: (text: string) => void, onError: (msg: string) => void) {
    const [recording, setRecording] = useState(false);
    const [transcribing, setTranscribing] = useState(false);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const streamRef = useRef<MediaStream | null>(null);

    const stopStream = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
    };
    useEffect(() => stopStream, []);

    const start = async () => {
        if (!navigator.mediaDevices?.getUserMedia) {
            onError("This browser can't record audio.");
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(
                (c) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c),
            );
            const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
            chunksRef.current = [];
            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };
            recorder.onstop = async () => {
                stopStream();
                setRecording(false);
                const type = recorder.mimeType || 'audio/webm';
                const blob = new Blob(chunksRef.current, { type });
                if (blob.size === 0) return;
                setTranscribing(true);
                try {
                    const ext = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm';
                    const fd = new FormData();
                    fd.append('audio', blob, `voice.${ext}`);
                    const res = await transcribeChatAudio(fd);
                    if (res.ok) onText(res.text);
                    else onError("Couldn't hear that clearly — try again or just type.");
                } catch {
                    onError('Transcription failed — try again or just type.');
                } finally {
                    setTranscribing(false);
                }
            };
            recorder.start();
            recorderRef.current = recorder;
            setRecording(true);
        } catch {
            onError('Microphone access was blocked.');
        }
    };

    const stop = () => {
        if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    };

    return { recording, transcribing, start, stop };
}

export function AssistantChat({
    active,
    className,
}: {
    /** When false (panel closed), history fetch is deferred until first open. */
    active: boolean;
    className?: string;
}) {
    const [sessionId, setSessionId] = useState<number | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [sessions, setSessions] = useState<AssistantSessionSummary[]>([]);
    const [showHistory, setShowHistory] = useState(false);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const [initialized, setInitialized] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const keyCounter = useRef(0);
    const nextKey = () => `m${++keyCounter.current}`;

    // Restore the latest conversation the first time the surface becomes active.
    useEffect(() => {
        if (!active || initialized) return;
        setInitialized(true);
        (async () => {
            try {
                const list = await fetchAssistantSessions();
                setSessions(list);
                if (list.length > 0) {
                    const msgs = await fetchAssistantMessages(list[0].id);
                    setSessionId(list[0].id);
                    setMessages(
                        msgs.map((m) => ({ key: `db${m.id}`, role: m.role, content: m.content })),
                    );
                }
            } catch {
                /* first-load hiccup — the user can still start a fresh chat */
            }
        })();
    }, [active, initialized]);

    // Keep the thread pinned to the bottom as messages stream in.
    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [messages, sending]);

    const send = useCallback(
        async (text: string) => {
            const message = text.trim();
            if (!message || sending) return;
            setInput('');
            setShowHistory(false);
            setMessages((prev) => [...prev, { key: nextKey(), role: 'user', content: message }]);
            setSending(true);
            try {
                const res = await sendAssistantMessage({ sessionId, message });
                setSessionId(res.sessionId);
                setMessages((prev) => [
                    ...prev,
                    { key: nextKey(), role: 'assistant', content: res.reply, toolsUsed: res.toolsUsed },
                ]);
                // Refresh the session list quietly (new session / bumped order).
                fetchAssistantSessions().then(setSessions).catch(() => {});
            } catch {
                setMessages((prev) => [
                    ...prev,
                    {
                        key: nextKey(),
                        role: 'assistant',
                        content: 'Something went wrong sending that. Please try again.',
                    },
                ]);
            } finally {
                setSending(false);
            }
        },
        [sending, sessionId],
    );

    const mic = useChatMic(
        (text) => setInput((cur) => (cur ? `${cur} ${text}` : text)),
        (msg) =>
            setMessages((prev) => [...prev, { key: nextKey(), role: 'assistant', content: msg }]),
    );

    const newChat = () => {
        setSessionId(null);
        setMessages([]);
        setShowHistory(false);
    };

    const openSession = async (id: number) => {
        setShowHistory(false);
        if (id === sessionId) return;
        try {
            const msgs = await fetchAssistantMessages(id);
            setSessionId(id);
            setMessages(msgs.map((m) => ({ key: `db${m.id}`, role: m.role, content: m.content })));
        } catch {
            /* keep current thread */
        }
    };

    const removeSession = async (id: number) => {
        try {
            await deleteAssistantSession(id);
            setSessions((prev) => prev.filter((s) => s.id !== id));
            if (id === sessionId) newChat();
        } catch {
            /* non-fatal */
        }
    };

    return (
        <div className={cn('flex flex-col min-h-0', className)}>
            {/* History toggle row */}
            <div className="flex items-center gap-2 px-4 pt-3 pb-2">
                <button
                    type="button"
                    onClick={() => setShowHistory((v) => !v)}
                    className="flex items-center gap-1 text-[11px] font-medium text-ink-2 hover:text-ink-0 transition-colors"
                >
                    <ChevronIcon
                        size={12}
                        className={cn('transition-transform', showHistory ? 'rotate-90' : '')}
                    />
                    History
                </button>
                <div className="flex-1" />
                <button
                    type="button"
                    onClick={newChat}
                    className="flex items-center gap-1 text-[11px] font-medium text-ink-2 hover:text-ink-0 transition-colors"
                >
                    <PlusIcon size={12} />
                    New chat
                </button>
            </div>

            {showHistory && (
                <div className="mx-4 mb-2 rounded-xl border border-line-soft bg-bg-card max-h-44 overflow-y-auto">
                    {sessions.length === 0 && (
                        <div className="px-3 py-2.5 text-xs text-ink-2">No past chats yet.</div>
                    )}
                    {sessions.map((s) => (
                        <div
                            key={s.id}
                            className={cn(
                                'flex items-center gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-bg-2 transition-colors',
                                s.id === sessionId && 'bg-bg-2',
                            )}
                            onClick={() => openSession(s.id)}
                        >
                            <span className="flex-1 truncate text-ink-1">{s.title}</span>
                            <button
                                type="button"
                                aria-label="Delete chat"
                                className="text-ink-2 hover:text-red-500 transition-colors flex-shrink-0"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    removeSession(s.id);
                                }}
                            >
                                <TrashIcon size={12} />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Thread */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pb-3 flex flex-col gap-3 min-h-0">
                {messages.length === 0 && !sending && (
                    <div className="flex flex-col items-center justify-center flex-1 text-center px-4 gap-3">
                        <div
                            className="w-12 h-12 rounded-2xl flex items-center justify-center"
                            style={{
                                background:
                                    'linear-gradient(135deg, oklch(0.85 0.14 90), oklch(0.65 0.16 78))',
                            }}
                        >
                            <SparkleIcon size={22} className="text-[#1a120a]" />
                        </div>
                        <p className="text-[13px] text-ink-1 leading-relaxed m-0">
                            Ask me anything about your money — spending, recurring bills, savings
                            goals. 中文 or English, up to you 😊
                        </p>
                        <div className="flex flex-wrap justify-center gap-1.5">
                            {STARTERS.map((s) => (
                                <button
                                    key={s}
                                    type="button"
                                    onClick={() => send(s)}
                                    className="text-[11.5px] px-3 py-1.5 rounded-full border border-line-soft bg-bg-card text-ink-1 hover:bg-bg-2 hover:text-ink-0 transition-colors cursor-pointer"
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {messages.map((m) => (
                    <div key={m.key} className={cn('flex flex-col', m.role === 'user' ? 'items-end' : 'items-start')}>
                        <div
                            className={cn(
                                'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed',
                                m.role === 'user'
                                    ? 'rounded-br-md text-[#1a120a]'
                                    : 'rounded-bl-md bg-bg-card border border-line-soft text-ink-0',
                            )}
                            style={
                                m.role === 'user'
                                    ? {
                                          background:
                                              'linear-gradient(135deg, oklch(0.85 0.14 90), oklch(0.7 0.15 80))',
                                      }
                                    : undefined
                            }
                        >
                            {m.role === 'assistant' ? renderAssistantText(m.content) : m.content}
                        </div>
                        {m.role === 'assistant' && m.toolsUsed && m.toolsUsed.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1 px-1">
                                {[...new Set(m.toolsUsed)].map((t) => (
                                    <span
                                        key={t}
                                        className="text-[9.5px] uppercase tracking-[0.05em] text-ink-2 border border-line-soft rounded-full px-1.5 py-0.5"
                                    >
                                        ✓ {TOOL_LABELS[t] ?? t}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                ))}

                {sending && (
                    <div className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl rounded-bl-md bg-bg-card border border-line-soft w-fit">
                        <span className="w-1.5 h-1.5 rounded-full bg-gold-500 animate-bounce [animation-delay:0ms]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-gold-500 animate-bounce [animation-delay:150ms]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-gold-500 animate-bounce [animation-delay:300ms]" />
                    </div>
                )}
            </div>

            {/* Composer */}
            <div className="px-4 pb-4 pt-2 border-t border-line-soft">
                <div className="flex items-end gap-2 rounded-2xl border border-line-soft bg-bg-card px-3 py-2">
                    <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                send(input);
                            }
                        }}
                        placeholder={
                            mic.recording
                                ? 'Listening…'
                                : mic.transcribing
                                  ? 'Transcribing…'
                                  : 'Ask about your money…'
                        }
                        rows={1}
                        className="flex-1 resize-none bg-transparent outline-none text-[13px] text-ink-0 placeholder:text-ink-2 max-h-28 leading-relaxed py-1"
                        style={{ minHeight: '28px' }}
                        disabled={sending}
                    />
                    <button
                        type="button"
                        onClick={mic.recording ? mic.stop : mic.start}
                        disabled={sending || mic.transcribing}
                        aria-label={mic.recording ? 'Stop recording' : 'Speak your question'}
                        className={cn(
                            'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all cursor-pointer',
                            mic.recording
                                ? 'bg-red-500 text-white animate-pulse'
                                : 'text-ink-2 hover:text-ink-0 hover:bg-bg-2',
                        )}
                    >
                        <MicIcon size={16} />
                    </button>
                    <button
                        type="button"
                        onClick={() => send(input)}
                        disabled={sending || !input.trim()}
                        aria-label="Send"
                        className={cn(
                            'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all',
                            input.trim() && !sending
                                ? 'text-[#1a120a] cursor-pointer hover:scale-105'
                                : 'text-ink-2 bg-bg-2 cursor-default',
                        )}
                        style={
                            input.trim() && !sending
                                ? {
                                      background:
                                          'linear-gradient(135deg, oklch(0.85 0.14 90), oklch(0.65 0.16 78))',
                                  }
                                : undefined
                        }
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
}
