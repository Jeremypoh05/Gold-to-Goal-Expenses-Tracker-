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
    CategoryTile,
} from '@/components/icons';
import { useConfirm } from '@/components/shared';
import { cn } from '@/lib/utils';
import { CATEGORIES } from '@/data/categories';
import { VoiceEntryEditor, type VoiceEntryValue } from '@/components/voice/VoiceEntryEditor';
import {
    fetchAssistantSessions,
    fetchAssistantMessages,
    deleteAssistantSession,
    renameAssistantSession,
    setAssistantSessionPinned,
    transcribeChatAudio,
    executeAssistantAction,
    type AssistantSessionSummary,
} from '@/lib/assistant-actions';
import type { Proposal, ExpenseFields } from '@/lib/assistant/types';

interface ChatMessage {
    key: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt: string; // ISO
    toolsUsed?: string[];
    streaming?: boolean; // reply is still arriving (show cursor / dots)
    stopped?: boolean; // user hit Stop mid-reply
    proposals?: Proposal[]; // ADDED (Slice 2): WRITE proposals → confirm cards under the reply
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
    // Decide the chip-label language from the reply's DOMINANT script — but only
    // over the prose, with the [[go:…]] tokens stripped first (otherwise a Chinese
    // label inside the token would make the reply look Chinese and defeat the fix).
    // Dominant (count) rather than "contains any CJK" so an English reply that
    // quotes a Chinese merchant note still counts as English.
    const prose = text.replace(GO_RE, ' ');
    const cjkCount = (prose.match(/[一-鿿]/g) ?? []).length;
    const latinCount = (prose.match(/[A-Za-z]/g) ?? []).length;
    const replyIsCJK = cjkCount > latinCount;
    const resolveLabel = (target: NavTarget, raw: string): string => {
        const clean = raw.trim();
        const labelHasCJK = CJK_RE.test(clean);
        // Keep the model's label only if it's non-empty AND its script matches the
        // reply (this also rejects bilingual "中文/English" labels). Else use the default.
        if (clean && labelHasCJK === replyIsCJK) return clean;
        return NAV_DEFAULT_LABELS[target][replyIsCJK ? 'zh' : 'en'];
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

                // A line that is ONLY nav chips (the model puts each [[go:…]] link on
                // its own line). Without text, hasText is false — so these lines need
                // their OWN vertical spacing, otherwise two stacked chips touch.
                const chipOnly = !hasText && chips.length > 0;

                return (
                    <div key={li} className={cn(bullet && hasText && 'flex gap-1.5 pl-1', chipOnly && 'mt-2')}>
                        {bullet && hasText && <span className="text-gold-700 flex-shrink-0">•</span>}
                        <span>
                            {hasText && renderBold(textPart, `l${li}`)}
                            {chips.length > 0 && (
                                // gap-y here also spaces the rare case of two chips wrapping
                                // within a single line; gap-x keeps side-by-side chips tight.
                                <span className={cn('flex flex-wrap gap-x-1.5 gap-y-2', hasText && 'mt-1.5')}>
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

// ── confirm cards (Slice 2) ──────────────────────────────────
// A WRITE the agent proposed. NOTHING is saved until the user taps Confirm here
// (→ executeAssistantAction). Create/edit offer "Edit manually" → the same
// VoiceEntryEditor the voice/manual flows use, pre-filled with the proposed values.

const CARD_CURRENCY_SYMBOL: Record<string, string> = { SGD: 'S$', MYR: 'RM', CNY: '¥', USD: '$' };
const money = (amount: number, currency: string) =>
    `${CARD_CURRENCY_SYMBOL[currency] ?? ''}${amount.toFixed(2)}`;

function proposalDate(iso: string | null): string {
    if (!iso) return 'today';
    const d = new Date(iso);
    const now = new Date();
    return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        ...(d.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
    });
}

/** The proposed expense at a glance — category tile + amount + note + date + tags. */
function ExpensePreview({ f }: { f: ExpenseFields }) {
    return (
        <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex-shrink-0">
                <CategoryTile kind={f.category} size={26} variant="filled" />
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-[15px] font-semibold mono">{money(f.amount, f.currency)}</span>
                    <span className="text-[11px] text-ink-2">{CATEGORIES[f.category]?.label ?? f.category}</span>
                </div>
                {f.note && <div className="text-[12px] text-ink-1 mt-0.5 break-words">{f.note}</div>}
                <div className="text-[10.5px] text-ink-2 mt-0.5">{proposalDate(f.spentAt)}</div>
                {f.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                        {f.tags.map((t) => (
                            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-2 text-ink-2">
                                #{t}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

type CardStatus = 'idle' | 'editing' | 'saving' | 'done' | 'cancelled' | 'error';

function ProposalCard({
    proposal,
    onNavigate,
    onWritten,
}: {
    proposal: Proposal;
    onNavigate: (target: NavTarget) => void;
    onWritten: () => void;
}) {
    const [status, setStatus] = useState<CardStatus>('idle');
    const [resultSummary, setResultSummary] = useState('');
    const [error, setError] = useState('');

    const kind = proposal.kind;
    const isDelete = kind === 'delete_expense';
    const isCreate = kind === 'create_expense';
    const closed = proposal.closedMonth ?? null;
    const deleteBlocked = isDelete && !!closed; // a closed month's rows can't be deleted

    // The final values written on confirm (create → create; update → after; delete → target).
    const fields: ExpenseFields | null = isCreate
        ? proposal.create ?? null
        : kind === 'update_expense'
          ? proposal.after ?? null
          : proposal.target ?? null;

    const run = async (finalFields?: ExpenseFields) => {
        setStatus('saving');
        setError('');
        try {
            let res;
            if (isCreate) {
                res = await executeAssistantAction({
                    kind: 'create_expense',
                    fields: finalFields ?? proposal.create!,
                    overrideClosed: !!closed,
                });
            } else if (kind === 'update_expense') {
                res = await executeAssistantAction({
                    kind: 'update_expense',
                    expenseId: proposal.expenseId!,
                    fields: finalFields ?? proposal.after!,
                    overrideClosed: !!closed,
                });
            } else {
                res = await executeAssistantAction({ kind: 'delete_expense', expenseId: proposal.expenseId! });
            }
            if (res.ok) {
                setResultSummary(res.summary ?? 'Done');
                setStatus('done');
                onWritten();
            } else {
                setError(res.error ?? 'Something went wrong.');
                setStatus('error');
            }
        } catch {
            setError('Something went wrong saving that.');
            setStatus('error');
        }
    };

    // Resolved: a compact one-line chip in place of the card.
    if (status === 'done') {
        return (
            <div className="flex items-center gap-1.5 text-[11.5px] text-emerald-600 dark:text-emerald-400 mt-1.5 px-1">
                <CheckMark size={13} />
                <span>{resultSummary}</span>
            </div>
        );
    }
    if (status === 'cancelled') {
        return <div className="text-[11px] text-ink-2 mt-1.5 px-1">✕ Dismissed</div>;
    }

    // Manual-edit fallback: the universal VoiceEntryEditor, pre-filled with the proposal.
    if (status === 'editing' && fields) {
        return (
            <div className="mt-2">
                <VoiceEntryEditor
                    initial={{
                        amt: fields.amount,
                        currency: fields.currency,
                        cat: fields.category,
                        note: fields.note,
                        tags: fields.tags,
                        spentAt: fields.spentAt,
                    }}
                    showDateTime
                    showTags
                    saveLabel={isCreate ? 'Add expense' : 'Save changes'}
                    onCancel={() => setStatus('idle')}
                    onSave={(v: VoiceEntryValue) =>
                        run({
                            amount: v.amt,
                            currency: v.currency,
                            category: v.cat,
                            note: v.note,
                            tags: v.tags,
                            spentAt: v.spentAt,
                        })
                    }
                />
            </div>
        );
    }

    const HeaderIcon = isCreate ? PlusIcon : isDelete ? TrashIcon : EditIcon;
    const heading = isCreate ? 'Add expense' : isDelete ? 'Delete expense' : 'Edit expense';
    const saving = status === 'saving';

    return (
        <div
            className={cn(
                'mt-2 rounded-2xl border p-3 flex flex-col gap-2.5',
                isDelete ? 'border-red-500/40' : 'border-gold-500/40',
            )}
            style={{ background: 'var(--color-bg-card)' }}
        >
            {/* Header */}
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-2">
                <HeaderIcon size={13} />
                {heading}
                <span className="ml-auto normal-case tracking-normal font-normal text-[10px] text-ink-3">
                    Needs your OK
                </span>
            </div>

            {/* Body */}
            {fields && <ExpensePreview f={fields} />}

            {/* before → after context for edits */}
            {kind === 'update_expense' && proposal.before && (
                <div className="text-[10.5px] text-ink-2 border-t border-line-soft pt-1.5">
                    Was {money(proposal.before.amount, proposal.before.currency)} ·{' '}
                    {CATEGORIES[proposal.before.category]?.label ?? proposal.before.category}
                    {proposal.before.note ? ` · ${proposal.before.note}` : ''}
                </div>
            )}

            {/* recurring caution */}
            {proposal.recurringWarning && (
                <div className="text-[10.5px] text-ink-2 leading-relaxed rounded-lg px-2 py-1.5 bg-bg-2">
                    ↻ This is a recurring entry — {isDelete ? 'deleting' : 'editing'} affects only this month.
                    To change the rule across months, use the Recurring page.
                </div>
            )}

            {/* closed-month caution */}
            {closed && (
                <div className="text-[10.5px] leading-relaxed rounded-lg px-2 py-1.5 text-amber-700 dark:text-amber-400 bg-amber-500/10">
                    {deleteBlocked
                        ? `${closed} is closed — reopen it on the Ledger page to delete this.`
                        : `${closed} is closed. Confirming will write into it (the month stays closed).`}
                </div>
            )}

            {error && <div className="text-[10.5px] text-red-500">{error}</div>}

            {/* Actions */}
            <div className="flex items-center gap-2 pt-0.5">
                {deleteBlocked ? (
                    <>
                        <button
                            type="button"
                            onClick={() => onNavigate('ledger')}
                            className="inline-flex items-center gap-1.5 text-[11.5px] font-medium px-3 py-1.5 rounded-full border border-gold-500/60 text-on-soft cursor-pointer hover:brightness-[1.03] transition-all"
                            style={{ background: 'linear-gradient(135deg, var(--grad-soft-a), var(--grad-soft-b))' }}
                        >
                            <GridIcon size={13} /> Open Ledger
                        </button>
                        <button
                            type="button"
                            onClick={() => setStatus('cancelled')}
                            className="text-[11.5px] text-ink-2 hover:text-ink-0 transition-colors px-2 py-1.5 cursor-pointer"
                        >
                            Dismiss
                        </button>
                    </>
                ) : (
                    <>
                        <button
                            type="button"
                            disabled={saving}
                            onClick={() => run()}
                            className={cn(
                                'inline-flex items-center gap-1.5 text-[12px] font-semibold px-3.5 py-1.5 rounded-full transition-all disabled:opacity-60',
                                isDelete
                                    ? 'bg-red-500 text-white hover:brightness-105 cursor-pointer'
                                    : 'text-[#1a120a] cursor-pointer hover:brightness-[1.03]',
                            )}
                            style={
                                isDelete
                                    ? undefined
                                    : { background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))' }
                            }
                        >
                            {saving ? (
                                'Saving…'
                            ) : isDelete ? (
                                <>
                                    <TrashIcon size={13} /> Delete
                                </>
                            ) : (
                                <>
                                    <CheckMark size={13} /> {closed ? (isCreate ? 'Add anyway' : 'Save anyway') : 'Confirm'}
                                </>
                            )}
                        </button>
                        {!isDelete && (
                            <button
                                type="button"
                                disabled={saving}
                                onClick={() => setStatus('editing')}
                                className="inline-flex items-center gap-1 text-[11.5px] font-medium px-3 py-1.5 rounded-full border border-line text-ink-1 hover:border-ink-2 transition-all cursor-pointer disabled:opacity-60"
                            >
                                <EditIcon size={12} /> Edit
                            </button>
                        )}
                        <button
                            type="button"
                            disabled={saving}
                            onClick={() => setStatus('cancelled')}
                            className="text-[11.5px] text-ink-2 hover:text-ink-0 transition-colors px-2 py-1.5 cursor-pointer disabled:opacity-60"
                        >
                            Cancel
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}

/** Small check glyph for confirm buttons / done chips. */
function CheckMark({ size = 13 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12 L10 17 L19 7" />
        </svg>
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
    const abortRef = useRef<AbortController | null>(null);
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

    // Streams the reply from /api/assistant (SSE): text arrives token-by-token so
    // the user reads it as it's written and can Stop early. Falls back to a plain
    // error bubble if the stream fails.
    const send = useCallback(
        async (text: string) => {
            const message = text.trim();
            if (!message || sending) return;
            setInput('');
            setShowHistory(false);

            const asstKey = nextKey();
            setMessages((prev) => [
                ...prev,
                { key: nextKey(), role: 'user', content: message, createdAt: new Date().toISOString() },
                {
                    key: asstKey,
                    role: 'assistant',
                    content: '',
                    createdAt: new Date().toISOString(),
                    toolsUsed: [],
                    streaming: true,
                },
            ]);
            setSending(true);

            const patch = (fn: (m: ChatMessage) => ChatMessage) =>
                setMessages((prev) => prev.map((m) => (m.key === asstKey ? fn(m) : m)));

            const ctrl = new AbortController();
            abortRef.current = ctrl;
            try {
                const res = await fetch('/api/assistant', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId, message }),
                    signal: ctrl.signal,
                });
                if (!res.ok || !res.body) throw new Error('stream failed');

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buf = '';
                let streamErrored = false;
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buf += decoder.decode(value, { stream: true });
                    const parts = buf.split('\n\n');
                    buf = parts.pop() ?? '';
                    for (const part of parts) {
                        const line = part.trim();
                        if (!line.startsWith('data:')) continue;
                        let data: {
                            type: string;
                            text?: string;
                            name?: string;
                            sessionId?: number;
                            proposal?: Proposal;
                        };
                        try {
                            data = JSON.parse(line.slice(5).trim());
                        } catch {
                            continue;
                        }
                        if (data.type === 'session' && typeof data.sessionId === 'number') {
                            setSessionId(data.sessionId);
                        } else if (data.type === 'text' && data.text) {
                            patch((m) => ({ ...m, content: m.content + data.text }));
                        } else if (data.type === 'tool' && data.name) {
                            patch((m) => ({ ...m, toolsUsed: [...(m.toolsUsed ?? []), data.name!] }));
                        } else if (data.type === 'proposal' && data.proposal) {
                            const p = data.proposal;
                            patch((m) => ({ ...m, proposals: [...(m.proposals ?? []), p] }));
                        } else if (data.type === 'error') {
                            streamErrored = true;
                        }
                    }
                }
                patch((m) => ({
                    ...m,
                    streaming: false,
                    content:
                        m.content ||
                        (streamErrored
                            ? 'Something went wrong reaching the assistant. Please try again.'
                            : m.content),
                }));
                fetchAssistantSessions().then(setSessions).catch(() => {});
            } catch (e) {
                const aborted = e instanceof DOMException && e.name === 'AbortError';
                patch((m) => ({
                    ...m,
                    streaming: false,
                    stopped: aborted && !!m.content,
                    content:
                        m.content ||
                        (aborted ? 'Stopped.' : 'Something went wrong sending that. Please try again.'),
                }));
                // A stopped turn still persisted server-side — refresh the list.
                fetchAssistantSessions().then(setSessions).catch(() => {});
            } finally {
                setSending(false);
                abortRef.current = null;
            }
        },
        [sending, sessionId],
    );

    /** Stop the in-flight reply (aborts the fetch → the route aborts upstream). */
    const stop = useCallback(() => abortRef.current?.abort(), []);

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

            {/* Thread — messages anchor to the BOTTOM (mt-auto on the list) so a
                short conversation sits just above the composer instead of leaving
                a big gap; when it overflows, mt-auto collapses and it scrolls from
                the top normally. */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pb-3 flex flex-col min-h-0">
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

                {messages.length > 0 && (
                <div className="mt-auto flex flex-col gap-3 pt-3">
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
                                        m.streaming && !m.content ? (
                                            // Pre-first-token: typing dots inside the bubble.
                                            <span className="flex items-center gap-1.5 py-0.5">
                                                <span className="w-1.5 h-1.5 rounded-full bg-gold-500 animate-bounce [animation-delay:0ms]" />
                                                <span className="w-1.5 h-1.5 rounded-full bg-gold-500 animate-bounce [animation-delay:150ms]" />
                                                <span className="w-1.5 h-1.5 rounded-full bg-gold-500 animate-bounce [animation-delay:300ms]" />
                                            </span>
                                        ) : (
                                            <>
                                                <AssistantText text={m.content} onNavigate={handleNavigate} />
                                                {m.streaming && (
                                                    // Live cursor while tokens keep arriving.
                                                    <span className="inline-block w-[2px] h-[0.95em] align-[-0.15em] bg-ink-1 ml-0.5 animate-pulse" />
                                                )}
                                                {m.stopped && (
                                                    <span className="block text-[10px] text-ink-2 mt-1">— stopped</span>
                                                )}
                                            </>
                                        )
                                    ) : (
                                        m.content
                                    )}
                                </div>
                                {/* Timestamp + copy + tool chips under the bubble. Tool chips
                                    show live (tools run before text); timestamp/copy wait until
                                    the reply is complete so a streaming bubble stays clean. */}
                                <div
                                    className={cn(
                                        'flex flex-wrap items-center gap-1.5 mt-1 px-1',
                                        m.role === 'user' && 'flex-row-reverse',
                                    )}
                                >
                                    {!m.streaming && (
                                        <span className="text-[9.5px] text-ink-2">{timeLabel(m.createdAt)}</span>
                                    )}
                                    {m.role === 'assistant' && !m.streaming && m.content && (
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
                                {/* WRITE confirm cards (Slice 2) — nothing saves until tapped. */}
                                {m.role === 'assistant' && m.proposals && m.proposals.length > 0 && (
                                    <div className="w-full flex flex-col gap-1">
                                        {m.proposals.map((p) => (
                                            <ProposalCard
                                                key={p.id}
                                                proposal={p}
                                                onNavigate={handleNavigate}
                                                onWritten={() => router.refresh()}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    );
                })}
                </div>
                )}
                {/* (typing dots + live cursor now render inside the streaming bubble) */}
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
                    {sending ? (
                        // While a reply streams, the send button becomes Stop.
                        <button
                            type="button"
                            onClick={stop}
                            aria-label="Stop generating"
                            title="Stop"
                            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-bg-2 text-ink-1 hover:text-ink-0 transition-all cursor-pointer"
                        >
                            <span className="w-3 h-3 rounded-[3px] bg-current" />
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={() => send(input)}
                            disabled={!input.trim()}
                            aria-label="Send"
                            className={cn(
                                'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all',
                                input.trim()
                                    ? 'text-[#1a120a] cursor-pointer hover:scale-105'
                                    : 'text-ink-2 bg-bg-2 cursor-default',
                            )}
                            style={
                                input.trim()
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
                    )}
                </div>
            </div>
        </div>
    );
}
