'use client';

// ADDED (AI Assistant · Slice 1): the reusable chat core — message thread +
// composer (text + mic). Used by both the global slide-over panel and the
// /assistant page. The TEXT input doubles as the dev test harness: it feeds
// the exact same engine the mic will use, so the whole flow is verifiable
// without a microphone. Chat history persists in the DB (ChatSession/Message).
//
// CHANGED (Slice 1 polish, user feedback): date separators + per-message
// timestamps, session search / pin / rename, delete now confirms via the
// global ConfirmDialog, copy-reply button.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
    MicIcon,
    BotIcon,
    PlusIcon,
    ChevronIcon,
    TrashIcon,
    EditIcon,
    SearchIcon,
    PinIcon,
    GridIcon,
    CalendarIcon,
    WalletIcon,
    RepeatIcon,
    HomeIcon,
} from '@/components/icons';
import { useConfirm } from '@/components/shared';
import { cn } from '@/lib/utils';
import {
    sendAssistantMessage,
    fetchAssistantSessions,
    fetchAssistantMessages,
    deleteAssistantSession,
    renameAssistantSession,
    setAssistantSessionPinned,
    transcribeChatAudio,
    type AssistantSessionSummary,
} from '@/lib/assistant-actions';

interface ChatMessage {
    key: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt: string; // ISO
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

// English starter prompts (the assistant still replies in whatever language the
// user writes in). Chosen to show the engine's range: search, breakdown,
// projection, and gentle preference-aware suggestions.
const STARTERS = [
    'What did I spend most on this month?',
    'Break down last month by category',
    'How am I tracking toward my savings goal?',
    'Any painless ways I could save more?',
];

// ── time helpers ─────────────────────────────────────────────

/** "Today" / "Yesterday" / "Jul 8" / "Jul 8, 2025" for the thread separators. */
function dayLabel(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        ...(d.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
    });
}

const timeLabel = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/** Compact "2m · 3h · 5d ago" for the history rows. */
function relativeTime(iso: string): string {
    const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── navigation links ─────────────────────────────────────────
// The assistant may emit [[go:TARGET|label]] tokens; we render them as clickable
// chips that route to the matching page (and close the panel via onNavigate).
type NavTarget = 'dashboard' | 'ledger' | 'calendar' | 'income' | 'recurring';
const NAV_ROUTES: Record<NavTarget, string> = {
    dashboard: '/dashboard',
    ledger: '/ledger',
    calendar: '/calendar',
    income: '/income',
    recurring: '/fixed',
};
const NAV_ICONS: Record<NavTarget, React.ComponentType<{ size?: number; className?: string }>> = {
    dashboard: HomeIcon,
    ledger: GridIcon,
    calendar: CalendarIcon,
    income: WalletIcon,
    recurring: RepeatIcon,
};
// Deterministic fallback labels per target, per script. The model is *supposed*
// to write the chip label in the reply's language, but it's unreliable (the
// Chinese-flavored persona biases labels toward 中文 even on English replies).
// So we script-match in code: if a label's script ≠ the reply's script, we swap
// in the correct-language default here — the guarantee, not the prompt.
const NAV_DEFAULT_LABELS: Record<NavTarget, { en: string; zh: string }> = {
    dashboard: { en: 'Open dashboard', zh: '打开首页' },
    ledger: { en: 'View ledger', zh: '查看账本' },
    calendar: { en: 'Open calendar', zh: '打开日历' },
    income: { en: 'Open income page', zh: '查看收入' },
    recurring: { en: 'View recurring', zh: '查看经常性支出' },
};
const CJK_RE = /[一-鿿]/;
const GO_RE = /\[\[go:(dashboard|ledger|calendar|income|recurring)\|([^\]|]+)\]\]/g;

/** Inline **bold** within a plain-text run. */
function renderBold(text: string, keyBase: string): React.ReactNode {
    const parts = text.split(/\*\*(.+?)\*\*/g);
    return parts.map((p, i) => (i % 2 === 1 ? <b key={`${keyBase}b${i}`}>{p}</b> : <span key={`${keyBase}t${i}`}>{p}</span>));
}

/** Renderer for assistant replies: **bold**, "-" bullets, line breaks, and
 *  [[go:…]] navigation chips. onNavigate lets a click close the surface. */
function AssistantText({ text, onNavigate }: { text: string; onNavigate: (target: NavTarget) => void }) {
    const lines = text.split('\n');
    // The reply's dominant script decides the chip-label language (see NAV_DEFAULT_LABELS).
    const replyHasCJK = CJK_RE.test(text);
    const resolveLabel = (target: NavTarget, raw: string): string => {
        const clean = raw.trim();
        const labelHasCJK = CJK_RE.test(clean);
        // Keep the model's label only if it's non-empty AND its script matches the
        // reply (this also rejects bilingual "中文/English" labels). Else use the default.
        if (clean && labelHasCJK === replyHasCJK) return clean;
        return NAV_DEFAULT_LABELS[target][replyHasCJK ? 'zh' : 'en'];
    };
    return (
        <>
            {lines.map((line, li) => {
                // Pull out any nav tokens on this line into chips; keep surrounding text.
                const chips: { target: NavTarget; label: string }[] = [];
                const stripped = line.replace(GO_RE, (_full, target: string, label: string) => {
                    chips.push({ target: target as NavTarget, label: resolveLabel(target as NavTarget, label) });
                    return '';
                });
                const bullet = stripped.match(/^\s*[-•]\s+(.*)$/);
                const textPart = bullet ? bullet[1] : stripped;
                const hasText = textPart.trim().length > 0;

                if (!hasText && chips.length === 0) return <div key={li} className="h-2" />;

                return (
                    <div key={li} className={cn(bullet && hasText && 'flex gap-1.5 pl-1')}>
                        {bullet && hasText && <span className="text-gold-700 flex-shrink-0">•</span>}
                        <span>
                            {hasText && renderBold(textPart, `l${li}`)}
                            {chips.length > 0 && (
                                <span className={cn('flex flex-wrap gap-1.5', hasText && 'mt-1.5')}>
                                    {chips.map((c, ci) => {
                                        const Icon = NAV_ICONS[c.target];
                                        return (
                                            <button
                                                key={ci}
                                                type="button"
                                                onClick={() => onNavigate(c.target)}
                                                className="inline-flex items-center gap-1.5 text-[11.5px] font-medium px-2.5 py-1 rounded-full border border-gold-500/60 text-on-soft hover:brightness-[1.03] transition-all cursor-pointer"
                                                style={{
                                                    background:
                                                        'linear-gradient(135deg, var(--grad-soft-a), var(--grad-soft-b))',
                                                }}
                                            >
                                                <Icon size={13} />
                                                {c.label}
                                                <ChevronIcon size={12} className="opacity-70" />
                                            </button>
                                        );
                                    })}
                                </span>
                            )}
                        </span>
                    </div>
                );
            })}
        </>
    );
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

// ── history row (search / pin / rename / delete) ─────────────

function SessionRow({
    session,
    active,
    onOpen,
    onPin,
    onRename,
    onDelete,
}: {
    session: AssistantSessionSummary;
    active: boolean;
    onOpen: () => void;
    onPin: () => void;
    onRename: (title: string) => void;
    onDelete: () => void;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(session.title);

    const commit = () => {
        setEditing(false);
        const clean = draft.trim();
        if (clean && clean !== session.title) onRename(clean);
        else setDraft(session.title);
    };

    return (
        <div
            className={cn(
                'group flex items-center gap-1.5 px-3 py-2 text-xs cursor-pointer hover:bg-bg-2 transition-colors',
                active && 'bg-bg-2',
            )}
            onClick={() => !editing && onOpen()}
        >
            {session.pinned && (
                <PinIcon size={11} filled className="text-gold-700 flex-shrink-0" />
            )}
            {editing ? (
                <input
                    autoFocus
                    value={draft}
                    maxLength={60}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') commit();
                        if (e.key === 'Escape') {
                            setDraft(session.title);
                            setEditing(false);
                        }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 min-w-0 bg-transparent outline-none border-b border-gold-500 text-ink-0 pb-0.5"
                />
            ) : (
                <span className="flex-1 min-w-0 truncate text-ink-1">{session.title}</span>
            )}
            <span className="text-[9.5px] text-ink-2 flex-shrink-0 group-hover:hidden">
                {relativeTime(session.updatedAt)}
            </span>
            {/* Row actions — revealed on hover (always tappable on touch: hover
                styles don't gate pointer events, just visibility on desktop). */}
            <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
                <button
                    type="button"
                    aria-label={session.pinned ? 'Unpin chat' : 'Pin chat'}
                    title={session.pinned ? 'Unpin' : 'Pin'}
                    className={cn(
                        'w-6 h-6 rounded-md flex items-center justify-center transition-colors',
                        session.pinned ? 'text-gold-700' : 'text-ink-2 hover:text-gold-700',
                    )}
                    onClick={(e) => {
                        e.stopPropagation();
                        onPin();
                    }}
                >
                    <PinIcon size={12} filled={session.pinned} />
                </button>
                <button
                    type="button"
                    aria-label="Rename chat"
                    title="Rename"
                    className="w-6 h-6 rounded-md flex items-center justify-center text-ink-2 hover:text-ink-0 transition-colors"
                    onClick={(e) => {
                        e.stopPropagation();
                        setDraft(session.title);
                        setEditing(true);
                    }}
                >
                    <EditIcon size={12} />
                </button>
                <button
                    type="button"
                    aria-label="Delete chat"
                    title="Delete"
                    className="w-6 h-6 rounded-md flex items-center justify-center text-ink-2 hover:text-red-500 transition-colors"
                    onClick={(e) => {
                        e.stopPropagation();
                        onDelete();
                    }}
                >
                    <TrashIcon size={12} />
                </button>
            </div>
        </div>
    );
}

// ── the chat core ────────────────────────────────────────────

export function AssistantChat({
    active,
    className,
    onNavigate,
}: {
    /** When false (panel closed), history fetch is deferred until first open. */
    active: boolean;
    className?: string;
    /** Called after a nav-link click routes away — lets the panel close itself. */
    onNavigate?: () => void;
}) {
    const confirm = useConfirm();
    const router = useRouter();
    const [sessionId, setSessionId] = useState<number | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [sessions, setSessions] = useState<AssistantSessionSummary[]>([]);
    const [showHistory, setShowHistory] = useState(false);
    const [search, setSearch] = useState('');
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const initedRef = useRef(false);
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const keyCounter = useRef(0);
    const nextKey = () => `m${++keyCounter.current}`;

    const handleNavigate = useCallback(
        (target: NavTarget) => {
            router.push(NAV_ROUTES[target]);
            onNavigate?.();
        },
        [router, onNavigate],
    );

    // Restore the latest conversation the first time the surface becomes active.
    useEffect(() => {
        if (!active || initedRef.current) return;
        initedRef.current = true;
        (async () => {
            try {
                const list = await fetchAssistantSessions();
                setSessions(list);
                // Most recently ACTIVE chat (not a pinned old one) restores.
                const latest = [...list].sort(
                    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
                )[0];
                if (latest) {
                    const msgs = await fetchAssistantMessages(latest.id);
                    setSessionId(latest.id);
                    setMessages(
                        msgs.map((m) => ({
                            key: `db${m.id}`,
                            role: m.role,
                            content: m.content,
                            createdAt: m.createdAt,
                        })),
                    );
                }
            } catch {
                /* first-load hiccup — the user can still start a fresh chat */
            }
        })();
    }, [active]);

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
            setMessages((prev) => [
                ...prev,
                { key: nextKey(), role: 'user', content: message, createdAt: new Date().toISOString() },
            ]);
            setSending(true);
            try {
                const res = await sendAssistantMessage({ sessionId, message });
                setSessionId(res.sessionId);
                setMessages((prev) => [
                    ...prev,
                    {
                        key: nextKey(),
                        role: 'assistant',
                        content: res.reply,
                        createdAt: new Date().toISOString(),
                        toolsUsed: res.toolsUsed,
                    },
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
                        createdAt: new Date().toISOString(),
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
            setMessages((prev) => [
                ...prev,
                { key: nextKey(), role: 'assistant', content: msg, createdAt: new Date().toISOString() },
            ]),
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
            setMessages(
                msgs.map((m) => ({
                    key: `db${m.id}`,
                    role: m.role,
                    content: m.content,
                    createdAt: m.createdAt,
                })),
            );
        } catch {
            /* keep current thread */
        }
    };

    // CHANGED (Slice 1 polish): destructive → always confirm first (global dialog).
    const removeSession = async (s: AssistantSessionSummary) => {
        const ok = await confirm({
            title: 'Delete this chat?',
            message: (
                <>
                    <b>“{s.title}”</b> and its messages will be gone for good.
                </>
            ),
            confirmLabel: 'Delete',
            danger: true,
        });
        if (!ok) return;
        try {
            await deleteAssistantSession(s.id);
            setSessions((prev) => prev.filter((x) => x.id !== s.id));
            if (s.id === sessionId) newChat();
        } catch {
            /* non-fatal */
        }
    };

    const togglePin = async (s: AssistantSessionSummary) => {
        // Optimistic flip + local re-sort; server order is authoritative on next fetch.
        setSessions((prev) =>
            [...prev]
                .map((x) => (x.id === s.id ? { ...x, pinned: !x.pinned } : x))
                .sort(
                    (a, b) =>
                        Number(b.pinned) - Number(a.pinned) ||
                        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
                ),
        );
        try {
            await setAssistantSessionPinned(s.id, !s.pinned);
        } catch {
            fetchAssistantSessions().then(setSessions).catch(() => {});
        }
    };

    const renameSession = async (s: AssistantSessionSummary, title: string) => {
        setSessions((prev) => prev.map((x) => (x.id === s.id ? { ...x, title } : x)));
        try {
            await renameAssistantSession(s.id, title);
        } catch {
            fetchAssistantSessions().then(setSessions).catch(() => {});
        }
    };

    const copyReply = async (m: ChatMessage) => {
        try {
            await navigator.clipboard.writeText(m.content);
            setCopiedKey(m.key);
            setTimeout(() => setCopiedKey((k) => (k === m.key ? null : k)), 1500);
        } catch {
            /* clipboard unavailable */
        }
    };

    const filteredSessions = search.trim()
        ? sessions.filter((s) => s.title.toLowerCase().includes(search.trim().toLowerCase()))
        : sessions;

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
                <div className="mx-4 mb-2 rounded-xl border border-line-soft bg-bg-card overflow-hidden">
                    {/* Search — filters by title as you type */}
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-line-soft">
                        <SearchIcon size={12} className="text-ink-2 flex-shrink-0" />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search chats…"
                            className="flex-1 min-w-0 bg-transparent outline-none text-xs text-ink-0 placeholder:text-ink-2"
                        />
                        {search && (
                            <button
                                type="button"
                                aria-label="Clear search"
                                className="text-ink-2 hover:text-ink-0 text-[11px]"
                                onClick={() => setSearch('')}
                            >
                                ✕
                            </button>
                        )}
                    </div>
                    <div className="max-h-44 overflow-y-auto">
                        {filteredSessions.length === 0 && (
                            <div className="px-3 py-2.5 text-xs text-ink-2">
                                {search ? 'No chats match that.' : 'No past chats yet.'}
                            </div>
                        )}
                        {filteredSessions.map((s) => (
                            <SessionRow
                                key={s.id}
                                session={s}
                                active={s.id === sessionId}
                                onOpen={() => openSession(s.id)}
                                onPin={() => togglePin(s)}
                                onRename={(t) => renameSession(s, t)}
                                onDelete={() => removeSession(s)}
                            />
                        ))}
                    </div>
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
                            <BotIcon size={24} className="text-[#1a120a]" />
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

                {messages.map((m, i) => {
                    // ADDED (Slice 1 polish): date separator whenever the calendar
                    // day changes between consecutive messages — the "timeline".
                    const prev = messages[i - 1];
                    const showDay =
                        !prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt);
                    // Only freshly-sent messages animate in; restored history
                    // (db-keyed) mounts instantly so a reopen doesn't flash.
                    const isNew = !m.key.startsWith('db');
                    return (
                        <motion.div
                            key={m.key}
                            className="flex flex-col gap-3"
                            initial={isNew ? { opacity: 0, y: 10 } : false}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                        >
                            {showDay && (
                                <div className="flex items-center gap-3 my-1">
                                    <div className="flex-1 h-px bg-line-soft" />
                                    <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-ink-2">
                                        {dayLabel(m.createdAt)}
                                    </span>
                                    <div className="flex-1 h-px bg-line-soft" />
                                </div>
                            )}
                            <div className={cn('flex flex-col', m.role === 'user' ? 'items-end' : 'items-start')}>
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
                                    {m.role === 'assistant' ? (
                                        <AssistantText text={m.content} onNavigate={handleNavigate} />
                                    ) : (
                                        m.content
                                    )}
                                </div>
                                {/* Timestamp + copy + tool chips under the bubble */}
                                <div
                                    className={cn(
                                        'flex flex-wrap items-center gap-1.5 mt-1 px-1',
                                        m.role === 'user' && 'flex-row-reverse',
                                    )}
                                >
                                    <span className="text-[9.5px] text-ink-2">{timeLabel(m.createdAt)}</span>
                                    {m.role === 'assistant' && (
                                        <button
                                            type="button"
                                            aria-label="Copy reply"
                                            title="Copy"
                                            onClick={() => copyReply(m)}
                                            className="text-[9.5px] text-ink-2 hover:text-ink-0 transition-colors cursor-pointer"
                                        >
                                            {copiedKey === m.key ? '✓ copied' : 'copy'}
                                        </button>
                                    )}
                                    {m.role === 'assistant' &&
                                        m.toolsUsed &&
                                        [...new Set(m.toolsUsed)].map((t) => (
                                            <span
                                                key={t}
                                                className="text-[9.5px] uppercase tracking-[0.05em] text-ink-2 border border-line-soft rounded-full px-1.5 py-0.5"
                                            >
                                                ✓ {TOOL_LABELS[t] ?? t}
                                            </span>
                                        ))}
                                </div>
                            </div>
                        </motion.div>
                    );
                })}

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
