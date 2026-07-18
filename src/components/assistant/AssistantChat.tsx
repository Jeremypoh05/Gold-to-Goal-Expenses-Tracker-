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
    SparkleIcon,
    CategoryTile,
} from '@/components/icons';
import { useConfirm } from '@/components/shared';
import { useFixedEdit, useClosedMonthGuard } from '@/components/fixed';
import { cn } from '@/lib/utils';
import { CATEGORIES } from '@/data/categories';
import { notifyDataChanged, QUOTA_CHANGED_EVENT } from '@/lib/data-events';
import { VoiceEntryEditor, type VoiceEntryValue } from '@/components/voice/VoiceEntryEditor';
import { RecurringEntryEditor } from './RecurringEntryEditor';
import { BonusEntryEditor, SalaryEntryEditor, SavingsGoalEditor, IncomeSourceEntryEditor } from './IncomeEntryEditors';
import { useAssistant } from './AssistantContext';
import { QuotaStrip } from './QuotaStrip';
import {
    fetchAssistantSessions,
    fetchAssistantMessages,
    deleteAssistantSession,
    renameAssistantSession,
    setAssistantSessionPinned,
    transcribeChatAudio,
    executeAssistantAction,
    recordProposalOutcome,
    fetchQuotaStatus,
    type AssistantSessionSummary,
    type AssistantChatMessage,
} from '@/lib/assistant-actions';
import type { AiQuotaStatus } from '@/lib/ai-quota';
import type {
    Proposal,
    ExpenseFields,
    ProposalOutcome,
    BonusFields,
    SalaryFields,
    SavingsSettingsFields,
    IncomeSourceFields,
} from '@/lib/assistant/types';

/** A proposal as the client tracks it — the raw Proposal plus its resolved outcome
 *  (undefined = live/pending). Persisted ones (from history) already carry outcome. */
type ClientProposal = Proposal & { outcome?: ProposalOutcome; resultSummary?: string };

interface ChatMessage {
    key: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt: string; // ISO
    toolsUsed?: string[];
    streaming?: boolean; // reply is still arriving (show cursor / dots)
    stopped?: boolean; // user hit Stop mid-reply
    proposals?: ClientProposal[]; // ADDED (Slice 2): WRITE proposals → confirm cards under the reply
}

/** Map a persisted DB message (with its stored proposals + outcomes) to the client
 *  shape, so confirm cards AND their resolved status re-render after a reload. */
function persistedToChatMessage(m: AssistantChatMessage): ChatMessage {
    return {
        key: `db${m.id}`,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
        ...(m.data?.proposals?.length ? { proposals: m.data.proposals } : {}),
    };
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
// ADDED (Slice 2c): a tappable "do this next" chip — LABEL is both the button text
// AND the exact message auto-sent (as if the user typed it) when tapped. Reuses the
// normal send() pipeline, so every existing reliability guard (phantom-card check,
// language lock, live closed-month status) applies automatically to whatever it
// triggers — this is just a shortcut past typing, not a new code path.
const SUGGEST_RE = /\[\[suggest:([^\]]+)\]\]/g;

type Chip = { kind: 'nav'; target: NavTarget; label: string } | { kind: 'suggest'; label: string };

// ADDED (2026-07-17): plain email addresses in replies (e.g. the feedback contact in
// unsupported-feature declines) become tappable mailto links.
const EMAIL_RE = /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
function linkifyEmails(text: string, keyBase: string): React.ReactNode {
    const parts = text.split(EMAIL_RE);
    if (parts.length === 1) return text;
    return parts.map((p, i) =>
        i % 2 === 1 ? (
            <a
                key={`${keyBase}m${i}`}
                href={`mailto:${p}`}
                className="text-gold-700 underline decoration-dotted underline-offset-2 hover:opacity-80"
            >
                {p}
            </a>
        ) : (
            p
        ),
    );
}

/** Inline **bold** + mailto-linked emails within a plain-text run. */
function renderBold(text: string, keyBase: string): React.ReactNode {
    const parts = text.split(/\*\*(.+?)\*\*/g);
    return parts.map((p, i) =>
        i % 2 === 1 ? <b key={`${keyBase}b${i}`}>{p}</b> : <span key={`${keyBase}t${i}`}>{linkifyEmails(p, `${keyBase}t${i}`)}</span>,
    );
}

/** Renderer for assistant replies: **bold**, "-" bullets, line breaks, [[go:…]]
 *  navigation chips, and [[suggest:…]] tappable next-step chips. onNavigate lets a
 *  nav click close the surface; onSuggest fires the suggested message (= send()). */
export function AssistantText({
    text,
    onNavigate,
    onSuggest,
    disabled,
}: {
    text: string;
    onNavigate: (target: NavTarget) => void;
    onSuggest: (label: string) => void;
    disabled?: boolean;
}) {
    const lines = text.split('\n');
    // Decide the chip-label language from the reply's DOMINANT script — but only
    // over the prose, with the [[go:…]]/[[suggest:…]] tokens stripped first
    // (otherwise a Chinese label inside a token would skew the count and defeat the
    // fix). Dominant (count) rather than "contains any CJK" so an English reply that
    // quotes a Chinese merchant note still counts as English.
    const prose = text.replace(GO_RE, ' ').replace(SUGGEST_RE, ' ');
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
                // Pull out any nav/suggest tokens on this line into chips; keep the rest.
                const chips: Chip[] = [];
                const afterGo = line.replace(GO_RE, (_full, target: string, label: string) => {
                    chips.push({ kind: 'nav', target: target as NavTarget, label: resolveLabel(target as NavTarget, label) });
                    return '';
                });
                const stripped = afterGo.replace(SUGGEST_RE, (_full, label: string) => {
                    chips.push({ kind: 'suggest', label: label.trim() });
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
                                        if (c.kind === 'suggest') {
                                            // Outlined pill (matches the empty-state STARTERS style) so
                                            // it reads as "tap to ask" — distinct from the gold nav chips.
                                            return (
                                                <button
                                                    key={ci}
                                                    type="button"
                                                    disabled={disabled}
                                                    onClick={() => onSuggest(c.label)}
                                                    className="inline-flex items-center gap-1 text-[11.5px] font-medium px-2.5 py-1 rounded-full border border-line-soft bg-bg-card text-ink-1 hover:bg-bg-2 hover:text-ink-0 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default"
                                                >
                                                    {c.label}
                                                    <ChevronIcon size={12} className="opacity-60" />
                                                </button>
                                            );
                                        }
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
export function useChatMic(onText: (text: string) => void, onError: (msg: string) => void) {
    const [recording, setRecording] = useState(false);
    const [transcribing, setTranscribing] = useState(false);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const streamRef = useRef<MediaStream | null>(null);
    const cancelledRef = useRef(false); // set when the user discards a recording

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
                // Discarded via the ✕ — drop the audio, no transcription.
                if (cancelledRef.current) {
                    cancelledRef.current = false;
                    chunksRef.current = [];
                    return;
                }
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

    // Discard the in-progress recording (misspoke) — stop the recorder but skip
    // transcription so nothing lands in the input box.
    const cancel = () => {
        if (recorderRef.current && recorderRef.current.state !== 'inactive') {
            cancelledRef.current = true;
            recorderRef.current.stop();
        }
    };

    return { recording, transcribing, start, stop, cancel };
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

const catLabel = (c: string) => CATEGORIES[c as keyof typeof CATEGORIES]?.label ?? c;

/** A detailed, permanent "what you did here" line for a CONFIRMED proposal — built
 *  from the proposal itself so live + reloaded cards read identically (Slice 2b-part-2). */
function describeConfirmed(p: Proposal): string {
    if (p.kind === 'create_expense' && p.create)
        return `Added ${money(p.create.amount, p.create.currency)} · ${catLabel(p.create.category)}`;
    if (p.kind === 'update_expense' && p.before && p.after)
        return `Edited · ${money(p.before.amount, p.before.currency)} → ${money(p.after.amount, p.after.currency)} · ${catLabel(p.after.category)}`;
    if (p.kind === 'delete_expense' && p.target)
        return `Deleted ${money(p.target.amount, p.target.currency)} · ${catLabel(p.target.category)}`;
    if (p.kind === 'edit_recurring' && p.recurring)
        return `Recurring “${p.recurring.after.label}” · ${money(p.recurring.after.amount, p.recurring.after.currency)}/mo`;
    if (p.kind === 'create_recurring' && p.recurringCreate)
        return `Set up recurring "${p.recurringCreate.label}" · ${money(p.recurringCreate.amount, p.recurringCreate.currency)}/mo`;
    if (p.kind === 'set_preference' && p.preference)
        return `Saved preference · ${p.preference.key}`;
    if (p.kind === 'set_month_status' && p.monthStatus)
        return `${p.monthStatus.action === 'reopen' ? 'Reopened' : 'Closed'} ${p.monthStatus.monthLabel}`;
    // income management (Slice 2d)
    if (p.kind === 'set_savings_goal' && p.savingsGoal) {
        const { changes, currency } = p.savingsGoal;
        const parts: string[] = [];
        if (changes.savingsGoal != null) parts.push(`goal ${money(changes.savingsGoal, currency)}`);
        if (changes.saved != null) parts.push(`saved ${money(changes.saved, currency)}`);
        if (changes.monthlyBudget != null) parts.push(`budget ${money(changes.monthlyBudget, currency)}`);
        if (changes.payDay != null) parts.push(`pay day ${changes.payDay}`);
        if (changes.payFrequency != null) parts.push(changes.payFrequency);
        return `Updated ${parts.join(', ')}`;
    }
    if (p.kind === 'adjust_salary' && p.salary) {
        const f = p.salary.fields;
        return `Salary ${money(f.monthlySalary, p.salary.currency)}/mo from ${monthYearOf(f.effectiveYear, f.effectiveMonth)}`;
    }
    if ((p.kind === 'create_bonus' || p.kind === 'update_bonus' || p.kind === 'delete_bonus') && p.bonus) {
        const f = p.bonus.after ?? p.bonus.before;
        if (!f) return p.summary;
        const verb = p.kind === 'create_bonus' ? 'Added' : p.kind === 'update_bonus' ? 'Edited' : 'Deleted';
        return `${verb} bonus ${money(f.amount, p.bonus.currency)} · ${monthYearOf(f.year, f.month)}`;
    }
    if (p.kind === 'create_income_source' && p.incomeSourceCreate) {
        const f = p.incomeSourceCreate;
        return `Added income "${f.label}" · ${money(f.monthlyAmount, f.currency)}${f.recurring ? '/mo' : ''}`;
    }
    if (p.kind === 'edit_income_source' && p.incomeSourceEdit) {
        const e = p.incomeSourceEdit;
        if (e.mode === 'delete') return `Deleted income "${e.before.label}"`;
        return `Income "${e.after.label}" · ${money(e.after.monthlyAmount, e.currency)}${e.after.recurring ? '/mo' : ''}`;
    }
    return p.summary;
}

/** (2026, 7) → "Jul 2026" — for the income confirm cards + confirmed chips. */
function monthYearOf(y: number, m: number): string {
    return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/** Shared resolved-status chips shown once a card is confirmed or cancelled — these
 *  are what persist permanently in the chat history so the user always knows what
 *  they did (or didn't) here, even after navigating away and coming back. */
function ConfirmedChip({ text }: { text: string }) {
    return (
        <div className="flex items-center gap-1.5 text-[11.5px] text-emerald-600 dark:text-emerald-400 mt-1.5 px-1">
            <CheckMark size={13} />
            <span>{text}</span>
        </div>
    );
}
function CancelledChip({ text = 'Not saved' }: { text?: string }) {
    return <div className="text-[11px] text-ink-2 mt-1.5 px-1">✕ {text}</div>;
}

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
    initialOutcome,
    onResolve,
    origin,
}: {
    proposal: Proposal;
    onNavigate: (target: NavTarget) => void;
    onWritten: () => void;
    /** Seeds the card's resolved state when restored from history (Slice 2b-part-2). */
    initialOutcome?: ProposalOutcome;
    /** Persist the resolution so the status survives reload/navigation. */
    onResolve?: (outcome: ProposalOutcome, summary?: string) => void;
    /** Slice 3: 'voice' tags a mic-created expense source='voice' (ledger badge). */
    origin?: 'voice' | 'chat';
}) {
    const [status, setStatus] = useState<CardStatus>(
        initialOutcome === 'confirmed' ? 'done' : initialOutcome === 'cancelled' ? 'cancelled' : 'idle',
    );
    const [error, setError] = useState('');
    const doneDetail = describeConfirmed(proposal);
    const cancel = () => {
        setStatus('cancelled');
        onResolve?.('cancelled');
    };

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
                res = await executeAssistantAction(
                    {
                        kind: 'create_expense',
                        fields: finalFields ?? proposal.create!,
                        overrideClosed: !!closed,
                    },
                    origin,
                );
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
                setStatus('done');
                onWritten();
                onResolve?.('confirmed', doneDetail);
            } else {
                setError(res.error ?? 'Something went wrong.');
                setStatus('error');
            }
        } catch {
            setError('Something went wrong saving that.');
            setStatus('error');
        }
    };

    // Resolved: a compact, PERMANENT status chip in place of the card.
    if (status === 'done') return <ConfirmedChip text={doneDetail} />;
    if (status === 'cancelled') return <CancelledChip />;

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

            {/* possible duplicate caution (dedup restore — deterministic same-amount/same-day check) */}
            {isCreate && proposal.duplicate && (
                <div className="text-[10.5px] leading-relaxed rounded-lg px-2 py-1.5 text-amber-700 dark:text-amber-400 bg-amber-500/10">
                    ⚠ Looks similar to an entry you already have:{' '}
                    {money(proposal.duplicate.amount, proposal.duplicate.currency)} ·{' '}
                    {CATEGORIES[proposal.duplicate.category]?.label ?? proposal.duplicate.category}
                    {proposal.duplicate.note ? ` · ${proposal.duplicate.note}` : ''} on {proposal.duplicate.date}.
                    Confirm only if this is a separate spend.
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
                            onClick={cancel}
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
                            onClick={cancel}
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

// ── recurring-rule + preference confirm cards (Slice 2b) ─────
// edit_recurring routes (on Confirm) through the SAME machinery the Recurring page
// uses — changeFixedAmount (rate change, keeps history) / updateFixedExpense
// (redefine, rewrite all months) — so the change propagates across every affected
// month + ledger/calendar/dashboard/income. The visible page live-updates via
// notifyDataChanged() (onWritten). Closed months in range are resolved by the
// shared 3-way guard at Confirm time; "Edit" hands off to the full recurring modal.

/** "2026-07" → "Jul 2026". */
function ymLabel(ym: string): string {
    const [y, m] = ym.split('-').map(Number);
    if (!y || !m) return ym;
    return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
/** (2026, 7) → "2026-07", for building the ymLabel input from raw year/month. */
const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;

function RecurringProposalCard({
    proposal,
    onWritten,
    initialOutcome,
    onResolve,
}: {
    proposal: Proposal;
    onWritten: () => void;
    initialOutcome?: ProposalOutcome;
    onResolve?: (outcome: ProposalOutcome, summary?: string) => void;
}) {
    const guardClosedMonths = useClosedMonthGuard();
    const { openFixedEdit } = useFixedEdit();
    const [status, setStatus] = useState<CardStatus | 'handoff'>(
        initialOutcome === 'confirmed' ? 'done' : initialOutcome === 'cancelled' ? 'cancelled' : 'idle',
    );
    const [error, setError] = useState('');

    const r = proposal.recurring;
    if (!r) return null;

    const doneDetail = describeConfirmed(proposal);
    const cancel = () => {
        setStatus('cancelled');
        onResolve?.('cancelled');
    };

    const { before, after, mode, impact } = r;
    const amountMoved = before.amount !== after.amount;
    const span =
        impact.firstMonth === impact.lastMonth
            ? ymLabel(impact.firstMonth)
            : `${ymLabel(impact.firstMonth)} – ${ymLabel(impact.lastMonth)}`;

    // Non-amount field changes (a redefine can move label / category / note / due-day).
    const diffs: { label: string; from: string; to: string }[] = [];
    if (before.label !== after.label) diffs.push({ label: 'Name', from: before.label, to: after.label });
    if (before.category !== after.category)
        diffs.push({
            label: 'Category',
            from: CATEGORIES[before.category]?.label ?? before.category,
            to: CATEGORIES[after.category]?.label ?? after.category,
        });
    if (before.note !== after.note) diffs.push({ label: 'Note', from: before.note || '—', to: after.note || '—' });
    if (before.dueDay !== after.dueDay) diffs.push({ label: 'Due day', from: `${before.dueDay}`, to: `${after.dueDay}` });

    const run = async () => {
        setError('');
        setStatus('saving');
        try {
            // 3-way closed-month decision over the affected range (re-fetches live).
            const g = await guardClosedMonths(
                {
                    startYear: r.range.startYear,
                    startMonth: r.range.startMonth,
                    endYear: r.range.endYear,
                    endMonth: r.range.endMonth,
                },
                'edit',
            );
            if (!g.proceed) {
                setStatus('idle');
                return;
            }
            const res =
                mode === 'rate_change'
                    ? await executeAssistantAction({
                          kind: 'edit_recurring',
                          ruleId: r.ruleId,
                          mode: 'rate_change',
                          fromYear: r.fromYear!,
                          fromMonth: r.fromMonth!,
                          newAmount: r.newAmount!,
                          overrideClosed: g.overrideClosed,
                      })
                    : await executeAssistantAction({
                          kind: 'edit_recurring',
                          ruleId: r.ruleId,
                          mode: 'redefine',
                          changes: r.changes ?? {},
                          overrideClosed: g.overrideClosed,
                      });
            if (res.ok) {
                setStatus('done');
                onWritten();
                onResolve?.('confirmed', doneDetail);
            } else {
                setError(res.error ?? 'Something went wrong.');
                setStatus('error');
            }
        } catch {
            setError('Something went wrong applying that.');
            setStatus('error');
        }
    };

    // Manual-edit fallback: the full recurring modal (its own guard + refresh wired).
    // The modal's outcome is unknown here, so we DON'T persist an outcome — the card
    // just steps aside; on reload it stays actionable rather than falsely "not saved".
    const editManually = () => {
        openFixedEdit(r.ruleId);
        setStatus('handoff');
    };

    if (status === 'done') return <ConfirmedChip text={doneDetail} />;
    if (status === 'cancelled') return <CancelledChip />;
    if (status === 'handoff')
        return <div className="text-[11px] text-ink-2 mt-1.5 px-1">↗ Opened the recurring editor</div>;

    const saving = status === 'saving';

    return (
        <div className="mt-2 rounded-2xl border border-gold-500/40 p-3 flex flex-col gap-2.5" style={{ background: 'var(--color-bg-card)' }}>
            {/* Header */}
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-2">
                <RepeatIcon size={13} />
                Edit recurring
                <span className="ml-auto normal-case tracking-normal font-normal text-[10px] text-ink-3">Needs your OK</span>
            </div>

            {/* Rule + amount */}
            <div className="flex items-start gap-2.5">
                <div className="mt-0.5 flex-shrink-0">
                    <CategoryTile kind={after.category} size={26} variant="filled" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-ink-0 break-words">{after.label}</div>
                    <div className="flex items-baseline gap-2 flex-wrap mt-0.5">
                        {amountMoved ? (
                            <>
                                <span className="text-[12px] text-ink-2 line-through mono">{money(before.amount, before.currency)}</span>
                                <span className="text-[15px] font-semibold mono">{money(after.amount, after.currency)}</span>
                                <span className="text-[10px] text-ink-2">/mo</span>
                            </>
                        ) : (
                            <span className="text-[15px] font-semibold mono">
                                {money(after.amount, after.currency)}
                                <span className="text-[10px] text-ink-2"> /mo</span>
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* Impact line — the whole point: it reaches everywhere */}
            <div className="text-[10.5px] text-ink-1 leading-relaxed rounded-lg px-2 py-1.5 bg-bg-2">
                {mode === 'rate_change' ? (
                    <>
                        Applies from <b>{ymLabel(impact.firstMonth)}</b> onward
                        {impact.monthCount > 0 && <> ({impact.monthCount === 1 ? '1 month' : `${impact.monthCount} months`} so far)</>};
                        earlier months keep {money(before.amount, before.currency)}. Updates the ledger, calendar, dashboard &amp; income.
                    </>
                ) : (
                    <>
                        Rewrites the rule across <b>{impact.monthCount === 1 ? '1 month' : `${impact.monthCount} months`}</b> ({span})
                        and every future month. Updates the ledger, calendar, dashboard &amp; income.
                    </>
                )}
            </div>

            {/* Field diffs (redefine) */}
            {diffs.length > 0 && (
                <div className="flex flex-col gap-0.5 text-[10.5px] text-ink-2 border-t border-line-soft pt-1.5">
                    {diffs.map((d) => (
                        <div key={d.label}>
                            {d.label}: <span className="line-through">{d.from}</span> → <b className="text-ink-1">{d.to}</b>
                        </div>
                    ))}
                </div>
            )}

            {/* Closed-months heads-up — the guard makes the final call on Confirm */}
            {r.closedInRange.length > 0 && (
                <div className="text-[10.5px] leading-relaxed rounded-lg px-2 py-1.5 text-amber-700 dark:text-amber-400 bg-amber-500/10">
                    {r.closedInRange.map(ymLabel).join(', ')} {r.closedInRange.length === 1 ? 'is' : 'are'} closed — on Confirm
                    you can keep {r.closedInRange.length === 1 ? 'it' : 'them'} frozen or override.
                </div>
            )}

            {error && <div className="text-[10.5px] text-red-500">{error}</div>}

            {/* Actions */}
            <div className="flex items-center gap-2 pt-0.5">
                <button
                    type="button"
                    disabled={saving}
                    onClick={run}
                    className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3.5 py-1.5 rounded-full transition-all disabled:opacity-60 text-[#1a120a] cursor-pointer hover:brightness-[1.03]"
                    style={{ background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))' }}
                >
                    {saving ? 'Applying…' : (<><CheckMark size={13} /> Confirm</>)}
                </button>
                <button
                    type="button"
                    disabled={saving}
                    onClick={editManually}
                    className="inline-flex items-center gap-1 text-[11.5px] font-medium px-3 py-1.5 rounded-full border border-line text-ink-1 hover:border-ink-2 transition-all cursor-pointer disabled:opacity-60"
                >
                    <EditIcon size={12} /> Edit
                </button>
                <button
                    type="button"
                    disabled={saving}
                    onClick={cancel}
                    className="text-[11.5px] text-ink-2 hover:text-ink-0 transition-colors px-2 py-1.5 cursor-pointer disabled:opacity-60"
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}

/** A brand-new recurring rule the agent proposes (Slice 2c) — routes to
 *  addFixedExpense on Confirm. No "Edit" manual fallback (unlike the edit-existing
 *  card): there's no rule yet for openFixedEdit to open, so a wrong detail is best
 *  fixed by cancelling and re-describing, or a quick follow-up correction in chat. */
function CreateRecurringProposalCard({
    proposal,
    onWritten,
    initialOutcome,
    onResolve,
}: {
    proposal: Proposal;
    onWritten: () => void;
    initialOutcome?: ProposalOutcome;
    onResolve?: (outcome: ProposalOutcome, summary?: string) => void;
}) {
    const guardClosedMonths = useClosedMonthGuard();
    const [status, setStatus] = useState<'idle' | 'editing' | 'saving' | 'done' | 'cancelled' | 'error'>(
        initialOutcome === 'confirmed' ? 'done' : initialOutcome === 'cancelled' ? 'cancelled' : 'idle',
    );
    const [error, setError] = useState('');
    const f = proposal.recurringCreate;
    if (!f) return null;

    const doneDetail = describeConfirmed(proposal);
    const closedInRange = proposal.closedInRange ?? [];
    const cancel = () => {
        setStatus('cancelled');
        onResolve?.('cancelled');
    };

    const run = async (finalFields?: typeof f) => {
        const fields = finalFields ?? f;
        setStatus('saving');
        setError('');
        try {
            // If the new rule's [start, today] range spans any hard-closed month, ask
            // how to handle it (add into it anyway / skip / cancel) — re-checks live.
            const g = await guardClosedMonths(
                {
                    startYear: fields.startYear,
                    startMonth: fields.startMonth,
                    endYear: fields.endYear,
                    endMonth: fields.endMonth,
                },
                'create',
            );
            if (!g.proceed) {
                setStatus('idle');
                return;
            }
            const res = await executeAssistantAction({
                kind: 'create_recurring',
                fields,
                overrideClosed: g.overrideClosed,
            });
            if (res.ok) {
                setStatus('done');
                onWritten();
                onResolve?.('confirmed', doneDetail);
            } else {
                setError(res.error ?? 'Something went wrong.');
                setStatus('error');
            }
        } catch {
            setError('Something went wrong setting that up.');
            setStatus('error');
        }
    };

    if (status === 'done') return <ConfirmedChip text={doneDetail} />;
    if (status === 'cancelled') return <CancelledChip />;

    // Manual-edit fallback (user feedback): fix any field — category (incl.
    // "family"), amount/currency, due day, start/end month — without another AI
    // round-trip. Mirrors ProposalCard's "Edit" → VoiceEntryEditor pattern.
    if (status === 'editing') {
        return (
            <div className="mt-2">
                <RecurringEntryEditor
                    initial={f}
                    onCancel={() => setStatus('idle')}
                    onSave={(v) => run(v)}
                />
            </div>
        );
    }

    const saving = status === 'saving';
    return (
        <div className="mt-2 rounded-2xl border border-gold-500/40 p-3 flex flex-col gap-2.5" style={{ background: 'var(--color-bg-card)' }}>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-2">
                <RepeatIcon size={13} />
                New recurring
                <span className="ml-auto normal-case tracking-normal font-normal text-[10px] text-ink-3">Needs your OK</span>
            </div>

            <div className="flex items-start gap-2.5">
                <div className="mt-0.5 flex-shrink-0">
                    <CategoryTile kind={f.category} size={26} variant="filled" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-ink-0 break-words">{f.label}</div>
                    <div className="flex items-baseline gap-2 flex-wrap mt-0.5">
                        <span className="text-[15px] font-semibold mono">{money(f.amount, f.currency)}</span>
                        <span className="text-[10px] text-ink-2">/mo</span>
                    </div>
                    {f.note && <div className="text-[12px] text-ink-1 mt-0.5 break-words">{f.note}</div>}
                </div>
            </div>

            <div className="text-[10.5px] text-ink-1 leading-relaxed rounded-lg px-2 py-1.5 bg-bg-2">
                Starts <b>{ymLabel(ym(f.startYear, f.startMonth))}</b>
                {f.endYear != null && f.endMonth != null ? (
                    <>
                        {' '}until <b>{ymLabel(ym(f.endYear, f.endMonth))}</b>
                    </>
                ) : (
                    ', ongoing'
                )}{' '}
                · due on day {f.dueDay} each month. Generates a real expense every month automatically (already-due
                months get filled in right away).
            </div>

            {/* Closed-months heads-up — the guard makes the final call on Confirm */}
            {closedInRange.length > 0 && (
                <div className="text-[10.5px] leading-relaxed rounded-lg px-2 py-1.5 text-amber-700 dark:text-amber-400 bg-amber-500/10">
                    {closedInRange.map(ymLabel).join(', ')} {closedInRange.length === 1 ? 'is' : 'are'} closed — by
                    default no entry is added there; on Confirm you can add into {closedInRange.length === 1 ? 'it' : 'them'} anyway or skip.
                </div>
            )}

            {error && <div className="text-[10.5px] text-red-500">{error}</div>}

            <div className="flex items-center gap-2 pt-0.5">
                <button
                    type="button"
                    disabled={saving}
                    onClick={() => run()}
                    className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3.5 py-1.5 rounded-full transition-all disabled:opacity-60 text-[#1a120a] cursor-pointer hover:brightness-[1.03]"
                    style={{ background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))' }}
                >
                    {saving ? 'Setting up…' : (<><CheckMark size={13} /> Confirm</>)}
                </button>
                <button
                    type="button"
                    disabled={saving}
                    onClick={() => setStatus('editing')}
                    className="inline-flex items-center gap-1 text-[11.5px] font-medium px-3 py-1.5 rounded-full border border-line text-ink-1 hover:border-ink-2 transition-all cursor-pointer disabled:opacity-60"
                >
                    <EditIcon size={12} /> Edit
                </button>
                <button
                    type="button"
                    disabled={saving}
                    onClick={cancel}
                    className="text-[11.5px] text-ink-2 hover:text-ink-0 transition-colors px-2 py-1.5 cursor-pointer disabled:opacity-60"
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}

function PreferenceProposalCard({
    proposal,
    initialOutcome,
    onResolve,
}: {
    proposal: Proposal;
    initialOutcome?: ProposalOutcome;
    onResolve?: (outcome: ProposalOutcome, summary?: string) => void;
}) {
    const [status, setStatus] = useState<'idle' | 'saving' | 'done' | 'cancelled' | 'error'>(
        initialOutcome === 'confirmed' ? 'done' : initialOutcome === 'cancelled' ? 'cancelled' : 'idle',
    );
    const [error, setError] = useState('');
    const pref = proposal.preference;
    if (!pref) return null;

    const doneDetail = describeConfirmed(proposal);
    const cancel = () => {
        setStatus('cancelled');
        onResolve?.('cancelled');
    };

    const run = async () => {
        setStatus('saving');
        setError('');
        try {
            const res = await executeAssistantAction({ kind: 'set_preference', key: pref.key, value: pref.value });
            if (res.ok) {
                setStatus('done');
                onResolve?.('confirmed', doneDetail);
            } else {
                setError(res.error ?? 'Something went wrong.');
                setStatus('error');
            }
        } catch {
            setError('Something went wrong saving that.');
            setStatus('error');
        }
    };

    if (status === 'done') return <ConfirmedChip text={doneDetail} />;
    if (status === 'cancelled') return <CancelledChip />;

    const saving = status === 'saving';
    return (
        <div className="mt-2 rounded-2xl border border-gold-500/40 p-3 flex flex-col gap-2" style={{ background: 'var(--color-bg-card)' }}>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-2">
                <BotIcon size={13} />
                Remember this?
                <span className="ml-auto normal-case tracking-normal font-normal text-[10px] text-ink-3">Needs your OK</span>
            </div>
            <div className="text-[12.5px] text-ink-1 leading-relaxed">
                <span className="font-semibold text-ink-0 capitalize">{pref.key}</span> — {pref.value}
            </div>
            {error && <div className="text-[10.5px] text-red-500">{error}</div>}
            <div className="flex items-center gap-2 pt-0.5">
                <button
                    type="button"
                    disabled={saving}
                    onClick={run}
                    className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3.5 py-1.5 rounded-full transition-all disabled:opacity-60 text-[#1a120a] cursor-pointer hover:brightness-[1.03]"
                    style={{ background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))' }}
                >
                    {saving ? 'Saving…' : (<><CheckMark size={13} /> Save</>)}
                </button>
                <button
                    type="button"
                    disabled={saving}
                    onClick={cancel}
                    className="text-[11.5px] text-ink-2 hover:text-ink-0 transition-colors px-2 py-1.5 cursor-pointer disabled:opacity-60"
                >
                    Dismiss
                </button>
            </div>
        </div>
    );
}

/** Reopen / close a month's books (Slice 2b fix batch) — confirm-gated, with a
 *  clear impact explanation. On confirm it re-fetches the visible page (onWritten →
 *  notifyDataChanged) so the Ledger's closed banner updates immediately. */
function MonthStatusProposalCard({
    proposal,
    onWritten,
    initialOutcome,
    onResolve,
}: {
    proposal: Proposal;
    onWritten: () => void;
    initialOutcome?: ProposalOutcome;
    onResolve?: (outcome: ProposalOutcome, summary?: string) => void;
}) {
    const [status, setStatus] = useState<'idle' | 'saving' | 'done' | 'cancelled' | 'error'>(
        initialOutcome === 'confirmed' ? 'done' : initialOutcome === 'cancelled' ? 'cancelled' : 'idle',
    );
    const [error, setError] = useState('');
    const ms = proposal.monthStatus;
    if (!ms) return null;

    const isReopen = ms.action === 'reopen';
    const doneDetail = describeConfirmed(proposal);
    const cancel = () => {
        setStatus('cancelled');
        onResolve?.('cancelled');
    };

    const run = async () => {
        setStatus('saving');
        setError('');
        try {
            const res = await executeAssistantAction({
                kind: 'set_month_status',
                year: ms.year,
                month: ms.month,
                action: ms.action,
            });
            if (res.ok) {
                setStatus('done');
                onWritten();
                onResolve?.('confirmed', doneDetail);
            } else {
                setError(res.error ?? 'Something went wrong.');
                setStatus('error');
            }
        } catch {
            setError('Something went wrong.');
            setStatus('error');
        }
    };

    if (status === 'done') return <ConfirmedChip text={doneDetail} />;
    if (status === 'cancelled') return <CancelledChip />;

    const saving = status === 'saving';
    return (
        <div className="mt-2 rounded-2xl border border-gold-500/40 p-3 flex flex-col gap-2.5" style={{ background: 'var(--color-bg-card)' }}>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-2">
                <CalendarIcon size={13} />
                {isReopen ? 'Reopen month' : 'Close month'}
                <span className="ml-auto normal-case tracking-normal font-normal text-[10px] text-ink-3">Needs your OK</span>
            </div>
            <div className="text-[13px] font-semibold text-ink-0">{ms.monthLabel}</div>
            <div className="text-[10.5px] text-ink-1 leading-relaxed rounded-lg px-2 py-1.5 bg-bg-2">
                {isReopen ? (
                    <>
                        Reopening <b>{ms.monthLabel} </b> unlocks its books — you&apos;ll be able to add, edit and
                        delete its entries again.
                    </>
                ) : (
                    <>
                        Closing <b>{ms.monthLabel}</b> locks its books — no entries can be added, edited or deleted
                        until you reopen it.
                    </>
                )}
            </div>
            {error && <div className="text-[10.5px] text-red-500">{error}</div>}
            <div className="flex items-center gap-2 pt-0.5">
                <button
                    type="button"
                    disabled={saving}
                    onClick={run}
                    className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3.5 py-1.5 rounded-full transition-all disabled:opacity-60 text-[#1a120a] cursor-pointer hover:brightness-[1.03]"
                    style={{ background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))' }}
                >
                    {saving ? 'Working…' : (<><CheckMark size={13} /> {isReopen ? 'Reopen month' : 'Close month'}</>)}
                </button>
                <button
                    type="button"
                    disabled={saving}
                    onClick={cancel}
                    className="text-[11.5px] text-ink-2 hover:text-ink-0 transition-colors px-2 py-1.5 cursor-pointer disabled:opacity-60"
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}

// ── income-management confirm cards (Slice 2d) ───────────────
// Adjust salary, set the savings goal / budget / pay schedule, and CRUD bonuses. On
// Confirm each routes to the SAME server action the Income page uses (via
// executeAssistantAction), so the whole year rollup + dashboard move (onWritten →
// notifyDataChanged). Each has the "Edit" manual-edit fallback (IncomeEntryEditors),
// matching the expense/recurring cards.

// Shared action-row styles (match the gold/outline/text buttons on the other cards).
const GOLD_BTN =
    'inline-flex items-center gap-1.5 text-[12px] font-semibold px-3.5 py-1.5 rounded-full transition-all disabled:opacity-60 text-[#1a120a] cursor-pointer hover:brightness-[1.03]';
const GOLD_STYLE = { background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))' } as const;
const EDIT_BTN =
    'inline-flex items-center gap-1 text-[11.5px] font-medium px-3 py-1.5 rounded-full border border-line text-ink-1 hover:border-ink-2 transition-all cursor-pointer disabled:opacity-60';
const CANCEL_BTN =
    'text-[11.5px] text-ink-2 hover:text-ink-0 transition-colors px-2 py-1.5 cursor-pointer disabled:opacity-60';
const CARD_WRAP = 'mt-2 rounded-2xl border border-gold-500/40 p-3 flex flex-col gap-2.5';
const CARD_HEAD = 'flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-2';

const SAVINGS_FIELD_LABEL: Record<string, string> = {
    savingsGoal: 'Savings goal',
    saved: 'Saved so far',
    monthlyBudget: 'Monthly budget',
    payDay: 'Pay day',
    payFrequency: 'Frequency',
};

function CardHeadTag() {
    return <span className="ml-auto normal-case tracking-normal font-normal text-[10px] text-ink-3">Needs your OK</span>;
}

function SavingsGoalProposalCard({
    proposal,
    onWritten,
    initialOutcome,
    onResolve,
}: {
    proposal: Proposal;
    onWritten: () => void;
    initialOutcome?: ProposalOutcome;
    onResolve?: (outcome: ProposalOutcome, summary?: string) => void;
}) {
    const [status, setStatus] = useState<CardStatus>(
        initialOutcome === 'confirmed' ? 'done' : initialOutcome === 'cancelled' ? 'cancelled' : 'idle',
    );
    const [error, setError] = useState('');
    const s = proposal.savingsGoal;
    if (!s) return null;

    const doneDetail = describeConfirmed(proposal);
    const cancel = () => {
        setStatus('cancelled');
        onResolve?.('cancelled');
    };
    const fmtVal = (k: string, v: number | string | undefined) => {
        if (v == null || v === '') return '—';
        if (k === 'payDay' || k === 'payFrequency') return `${v}`;
        return money(Number(v), s.currency);
    };

    const run = async (finalChanges?: SavingsSettingsFields) => {
        setStatus('saving');
        setError('');
        try {
            const res = await executeAssistantAction({ kind: 'set_savings_goal', changes: finalChanges ?? s.changes });
            if (res.ok) {
                setStatus('done');
                onWritten();
                onResolve?.('confirmed', doneDetail);
            } else {
                setError(res.error ?? 'Something went wrong.');
                setStatus('error');
            }
        } catch {
            setError('Something went wrong saving that.');
            setStatus('error');
        }
    };

    if (status === 'done') return <ConfirmedChip text={doneDetail} />;
    if (status === 'cancelled') return <CancelledChip />;
    if (status === 'editing')
        return (
            <div className="mt-2">
                <SavingsGoalEditor initial={s.changes} currency={s.currency} onCancel={() => setStatus('idle')} onSave={(c) => run(c)} />
            </div>
        );

    const keys = Object.keys(s.changes) as (keyof SavingsSettingsFields)[];
    const saving = status === 'saving';
    return (
        <div className={CARD_WRAP} style={{ background: 'var(--color-bg-card)' }}>
            <div className={CARD_HEAD}>
                <WalletIcon size={13} /> Update savings
                <CardHeadTag />
            </div>
            <div className="flex flex-col gap-1 text-[12px]">
                {keys.map((k) => (
                    <div key={k} className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-ink-2 text-[11px] w-[88px] flex-shrink-0">{SAVINGS_FIELD_LABEL[k] ?? k}</span>
                        <span className="text-ink-2 line-through mono text-[11px]">{fmtVal(k, s.before[k])}</span>
                        <span className="text-ink-3">→</span>
                        <b className="mono text-ink-0">{fmtVal(k, s.changes[k])}</b>
                    </div>
                ))}
            </div>
            {error && <div className="text-[10.5px] text-red-500">{error}</div>}
            <div className="flex items-center gap-2 pt-0.5">
                <button type="button" disabled={saving} onClick={() => run()} className={GOLD_BTN} style={GOLD_STYLE}>
                    {saving ? 'Saving…' : (<><CheckMark size={13} /> Confirm</>)}
                </button>
                <button type="button" disabled={saving} onClick={() => setStatus('editing')} className={EDIT_BTN}>
                    <EditIcon size={12} /> Edit
                </button>
                <button type="button" disabled={saving} onClick={cancel} className={CANCEL_BTN}>
                    Cancel
                </button>
            </div>
        </div>
    );
}

function SalaryProposalCard({
    proposal,
    onWritten,
    initialOutcome,
    onResolve,
}: {
    proposal: Proposal;
    onWritten: () => void;
    initialOutcome?: ProposalOutcome;
    onResolve?: (outcome: ProposalOutcome, summary?: string) => void;
}) {
    const [status, setStatus] = useState<CardStatus>(
        initialOutcome === 'confirmed' ? 'done' : initialOutcome === 'cancelled' ? 'cancelled' : 'idle',
    );
    const [error, setError] = useState('');
    const sal = proposal.salary;
    if (!sal) return null;

    const doneDetail = describeConfirmed(proposal);
    const cancel = () => {
        setStatus('cancelled');
        onResolve?.('cancelled');
    };
    const f = sal.fields;
    const prev = sal.previousTakeHome;
    const amountMoved = prev != null && prev !== f.monthlySalary;
    const effLabel = monthYearOf(f.effectiveYear, f.effectiveMonth);

    const run = async (finalFields?: SalaryFields) => {
        setStatus('saving');
        setError('');
        try {
            const res = await executeAssistantAction({ kind: 'adjust_salary', fields: finalFields ?? f });
            if (res.ok) {
                setStatus('done');
                onWritten();
                onResolve?.('confirmed', doneDetail);
            } else {
                setError(res.error ?? 'Something went wrong.');
                setStatus('error');
            }
        } catch {
            setError('Something went wrong saving that.');
            setStatus('error');
        }
    };

    if (status === 'done') return <ConfirmedChip text={doneDetail} />;
    if (status === 'cancelled') return <CancelledChip />;
    if (status === 'editing')
        return (
            <div className="mt-2">
                <SalaryEntryEditor initial={f} currency={sal.currency} onCancel={() => setStatus('idle')} onSave={(v) => run(v)} />
            </div>
        );

    const saving = status === 'saving';
    return (
        <div className={CARD_WRAP} style={{ background: 'var(--color-bg-card)' }}>
            <div className={CARD_HEAD}>
                <WalletIcon size={13} /> Adjust salary
                <CardHeadTag />
            </div>
            <div className="flex items-baseline gap-2 flex-wrap">
                {amountMoved && <span className="text-[12px] text-ink-2 line-through mono">{money(prev!, sal.currency)}</span>}
                <span className="text-[15px] font-semibold mono">{money(f.monthlySalary, sal.currency)}</span>
                <span className="text-[10px] text-ink-2">/mo take-home</span>
            </div>
            <div className="text-[10.5px] text-ink-1 leading-relaxed rounded-lg px-2 py-1.5 bg-bg-2">
                {sal.overwritesExisting ? (
                    <>Corrects the salary period starting <b>{effLabel}</b>. Updates every month from then + the dashboard &amp; income.</>
                ) : (
                    <>Effective from <b>{effLabel}</b> onward; earlier months keep {prev != null ? money(prev, sal.currency) : 'their current salary'}. Updates the dashboard &amp; income.</>
                )}
            </div>
            {(f.grossSalary != null || f.deductions != null) && (
                <div className="text-[10.5px] text-ink-2">
                    {f.grossSalary != null && <>Gross {money(f.grossSalary, sal.currency)}</>}
                    {f.grossSalary != null && f.deductions != null && ' · '}
                    {f.deductions != null && <>CPF/deductions {money(f.deductions, sal.currency)}</>}
                </div>
            )}
            {error && <div className="text-[10.5px] text-red-500">{error}</div>}
            <div className="flex items-center gap-2 pt-0.5">
                <button type="button" disabled={saving} onClick={() => run()} className={GOLD_BTN} style={GOLD_STYLE}>
                    {saving ? 'Saving…' : (<><CheckMark size={13} /> Confirm</>)}
                </button>
                <button type="button" disabled={saving} onClick={() => setStatus('editing')} className={EDIT_BTN}>
                    <EditIcon size={12} /> Edit
                </button>
                <button type="button" disabled={saving} onClick={cancel} className={CANCEL_BTN}>
                    Cancel
                </button>
            </div>
        </div>
    );
}

function BonusProposalCard({
    proposal,
    onWritten,
    initialOutcome,
    onResolve,
}: {
    proposal: Proposal;
    onWritten: () => void;
    initialOutcome?: ProposalOutcome;
    onResolve?: (outcome: ProposalOutcome, summary?: string) => void;
}) {
    const [status, setStatus] = useState<CardStatus>(
        initialOutcome === 'confirmed' ? 'done' : initialOutcome === 'cancelled' ? 'cancelled' : 'idle',
    );
    const [error, setError] = useState('');
    const b = proposal.bonus;
    if (!b) return null;

    const isDelete = proposal.kind === 'delete_bonus';
    const isCreate = proposal.kind === 'create_bonus';
    const fields = b.after ?? b.before;
    if (!fields) return null;

    const doneDetail = describeConfirmed(proposal);
    const cancel = () => {
        setStatus('cancelled');
        onResolve?.('cancelled');
    };
    const amountMoved = !isCreate && b.before && b.after && b.before.amount !== b.after.amount;

    const run = async (finalFields?: BonusFields) => {
        setStatus('saving');
        setError('');
        try {
            let res;
            if (isCreate) {
                res = await executeAssistantAction({ kind: 'create_bonus', fields: finalFields ?? fields });
            } else if (proposal.kind === 'update_bonus') {
                res = await executeAssistantAction({ kind: 'update_bonus', bonusId: b.bonusId!, fields: finalFields ?? fields });
            } else {
                res = await executeAssistantAction({ kind: 'delete_bonus', bonusId: b.bonusId! });
            }
            if (res.ok) {
                setStatus('done');
                onWritten();
                onResolve?.('confirmed', doneDetail);
            } else {
                setError(res.error ?? 'Something went wrong.');
                setStatus('error');
            }
        } catch {
            setError('Something went wrong saving that.');
            setStatus('error');
        }
    };

    if (status === 'done') return <ConfirmedChip text={doneDetail} />;
    if (status === 'cancelled') return <CancelledChip />;
    if (status === 'editing')
        return (
            <div className="mt-2">
                <BonusEntryEditor
                    initial={fields}
                    currency={b.currency}
                    saveLabel={isCreate ? 'Add bonus' : 'Save changes'}
                    onCancel={() => setStatus('idle')}
                    onSave={(v) => run(v)}
                />
            </div>
        );

    const saving = status === 'saving';
    const heading = isCreate ? 'Add bonus' : isDelete ? 'Delete bonus' : 'Edit bonus';
    return (
        <div
            className={cn('mt-2 rounded-2xl border p-3 flex flex-col gap-2.5', isDelete ? 'border-red-500/40' : 'border-gold-500/40')}
            style={{ background: 'var(--color-bg-card)' }}
        >
            <div className={CARD_HEAD}>
                <SparkleIcon size={13} /> {heading}
                <CardHeadTag />
            </div>
            <div className="flex items-start gap-2.5">
                <div className="mt-0.5 flex-shrink-0 w-[26px] h-[26px] rounded-[8px] flex items-center justify-center" style={{ background: 'linear-gradient(135deg, var(--grad-soft-a), var(--grad-soft-b))', color: 'var(--color-gold-700)' }}>
                    <SparkleIcon size={15} />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-ink-0 break-words">{fields.label}</div>
                    <div className="flex items-baseline gap-2 flex-wrap mt-0.5">
                        {amountMoved && <span className="text-[12px] text-ink-2 line-through mono">{money(b.before!.amount, b.currency)}</span>}
                        <span className="text-[15px] font-semibold mono">{money(fields.amount, b.currency)}</span>
                        <span className="text-[11px] text-ink-2">{monthYearOf(fields.year, fields.month)}</span>
                    </div>
                </div>
            </div>
            {error && <div className="text-[10.5px] text-red-500">{error}</div>}
            <div className="flex items-center gap-2 pt-0.5">
                <button
                    type="button"
                    disabled={saving}
                    onClick={() => run()}
                    className={cn(
                        'inline-flex items-center gap-1.5 text-[12px] font-semibold px-3.5 py-1.5 rounded-full transition-all disabled:opacity-60',
                        isDelete ? 'bg-red-500 text-white hover:brightness-105 cursor-pointer' : 'text-[#1a120a] cursor-pointer hover:brightness-[1.03]',
                    )}
                    style={isDelete ? undefined : GOLD_STYLE}
                >
                    {saving ? (isDelete ? 'Deleting…' : 'Saving…') : isDelete ? (<><TrashIcon size={13} /> Delete</>) : (<><CheckMark size={13} /> Confirm</>)}
                </button>
                {!isDelete && (
                    <button type="button" disabled={saving} onClick={() => setStatus('editing')} className={EDIT_BTN}>
                        <EditIcon size={12} /> Edit
                    </button>
                )}
                <button type="button" disabled={saving} onClick={cancel} className={CANCEL_BTN}>
                    Cancel
                </button>
            </div>
        </div>
    );
}

/** Emoji tile used by the income-source cards. */
function EmojiTile({ emoji }: { emoji: string }) {
    return (
        <div
            className="mt-0.5 flex-shrink-0 w-[26px] h-[26px] rounded-[8px] flex items-center justify-center text-[15px]"
            style={{ background: 'linear-gradient(135deg, var(--grad-soft-a), var(--grad-soft-b))', border: '1px solid var(--color-line-soft)' }}
        >
            {emoji}
        </div>
    );
}

function CreateIncomeSourceProposalCard({
    proposal,
    onWritten,
    initialOutcome,
    onResolve,
}: {
    proposal: Proposal;
    onWritten: () => void;
    initialOutcome?: ProposalOutcome;
    onResolve?: (outcome: ProposalOutcome, summary?: string) => void;
}) {
    const [status, setStatus] = useState<CardStatus>(
        initialOutcome === 'confirmed' ? 'done' : initialOutcome === 'cancelled' ? 'cancelled' : 'idle',
    );
    const [error, setError] = useState('');
    const f = proposal.incomeSourceCreate;
    if (!f) return null;

    const doneDetail = describeConfirmed(proposal);
    const cancel = () => {
        setStatus('cancelled');
        onResolve?.('cancelled');
    };

    const run = async (finalFields?: IncomeSourceFields) => {
        setStatus('saving');
        setError('');
        try {
            const res = await executeAssistantAction({ kind: 'create_income_source', fields: finalFields ?? f });
            if (res.ok) {
                setStatus('done');
                onWritten();
                onResolve?.('confirmed', doneDetail);
            } else {
                setError(res.error ?? 'Something went wrong.');
                setStatus('error');
            }
        } catch {
            setError('Something went wrong setting that up.');
            setStatus('error');
        }
    };

    if (status === 'done') return <ConfirmedChip text={doneDetail} />;
    if (status === 'cancelled') return <CancelledChip />;
    if (status === 'editing')
        return (
            <div className="mt-2">
                <IncomeSourceEntryEditor initial={f} onCancel={() => setStatus('idle')} onSave={(v) => run(v)} />
            </div>
        );

    const rangeLabel = !f.recurring
        ? `one-off · ${monthYearOf(f.effectiveYear, f.effectiveMonth)}`
        : f.endYear != null && f.endMonth != null
          ? `${monthYearOf(f.effectiveYear, f.effectiveMonth)} – ${monthYearOf(f.endYear, f.endMonth)}`
          : `from ${monthYearOf(f.effectiveYear, f.effectiveMonth)}, ongoing`;
    const saving = status === 'saving';
    return (
        <div className={CARD_WRAP} style={{ background: 'var(--color-bg-card)' }}>
            <div className={CARD_HEAD}>
                <WalletIcon size={13} /> New income
                <CardHeadTag />
            </div>
            <div className="flex items-start gap-2.5">
                <EmojiTile emoji={f.emoji} />
                <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-ink-0 break-words">{f.label}</div>
                    <div className="flex items-baseline gap-2 flex-wrap mt-0.5">
                        <span className="text-[15px] font-semibold mono">{money(f.monthlyAmount, f.currency)}</span>
                        {f.recurring && <span className="text-[10px] text-ink-2">/mo</span>}
                    </div>
                </div>
            </div>
            <div className="text-[10.5px] text-ink-1 leading-relaxed rounded-lg px-2 py-1.5 bg-bg-2">
                {f.recurring ? (
                    <>Contributes every month · <b>{rangeLabel}</b>. Updates the dashboard &amp; income.</>
                ) : (
                    <>Counts once · <b>{rangeLabel}</b>. Updates the dashboard &amp; income.</>
                )}
            </div>
            {error && <div className="text-[10.5px] text-red-500">{error}</div>}
            <div className="flex items-center gap-2 pt-0.5">
                <button type="button" disabled={saving} onClick={() => run()} className={GOLD_BTN} style={GOLD_STYLE}>
                    {saving ? 'Setting up…' : (<><CheckMark size={13} /> Confirm</>)}
                </button>
                <button type="button" disabled={saving} onClick={() => setStatus('editing')} className={EDIT_BTN}>
                    <EditIcon size={12} /> Edit
                </button>
                <button type="button" disabled={saving} onClick={cancel} className={CANCEL_BTN}>
                    Cancel
                </button>
            </div>
        </div>
    );
}

function EditIncomeSourceProposalCard({
    proposal,
    onWritten,
    initialOutcome,
    onResolve,
}: {
    proposal: Proposal;
    onWritten: () => void;
    initialOutcome?: ProposalOutcome;
    onResolve?: (outcome: ProposalOutcome, summary?: string) => void;
}) {
    const [status, setStatus] = useState<CardStatus>(
        initialOutcome === 'confirmed' ? 'done' : initialOutcome === 'cancelled' ? 'cancelled' : 'idle',
    );
    const [error, setError] = useState('');
    const e = proposal.incomeSourceEdit;
    if (!e) return null;

    const isDelete = e.mode === 'delete';
    const doneDetail = describeConfirmed(proposal);
    const cancel = () => {
        setStatus('cancelled');
        onResolve?.('cancelled');
    };
    const { before, after } = e;
    const amountMoved = before.monthlyAmount !== after.monthlyAmount;

    const run = async () => {
        setStatus('saving');
        setError('');
        try {
            const res =
                e.mode === 'delete'
                    ? await executeAssistantAction({ kind: 'edit_income_source', sourceId: e.sourceId, mode: 'delete' })
                    : e.mode === 'rate_change'
                      ? await executeAssistantAction({
                            kind: 'edit_income_source',
                            sourceId: e.sourceId,
                            mode: 'rate_change',
                            fromYear: e.fromYear!,
                            fromMonth: e.fromMonth!,
                            newAmount: e.newAmount!,
                        })
                      : await executeAssistantAction({
                            kind: 'edit_income_source',
                            sourceId: e.sourceId,
                            mode: 'redefine',
                            changes: e.changes ?? {},
                        });
            if (res.ok) {
                setStatus('done');
                onWritten();
                onResolve?.('confirmed', doneDetail);
            } else {
                setError(res.error ?? 'Something went wrong.');
                setStatus('error');
            }
        } catch {
            setError('Something went wrong applying that.');
            setStatus('error');
        }
    };

    if (status === 'done') return <ConfirmedChip text={doneDetail} />;
    if (status === 'cancelled') return <CancelledChip />;

    const saving = status === 'saving';
    return (
        <div
            className={cn('mt-2 rounded-2xl border p-3 flex flex-col gap-2.5', isDelete ? 'border-red-500/40' : 'border-gold-500/40')}
            style={{ background: 'var(--color-bg-card)' }}
        >
            <div className={CARD_HEAD}>
                <WalletIcon size={13} /> {isDelete ? 'Delete income' : 'Edit income'}
                <CardHeadTag />
            </div>
            <div className="flex items-start gap-2.5">
                <EmojiTile emoji={after.emoji} />
                <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-ink-0 break-words">{after.label}</div>
                    <div className="flex items-baseline gap-2 flex-wrap mt-0.5">
                        {amountMoved && !isDelete && (
                            <span className="text-[12px] text-ink-2 line-through mono">{money(before.monthlyAmount, e.currency)}</span>
                        )}
                        <span className="text-[15px] font-semibold mono">{money(after.monthlyAmount, e.currency)}</span>
                        {after.recurring && <span className="text-[10px] text-ink-2">/mo</span>}
                    </div>
                </div>
            </div>
            {!isDelete && (
                <div className="text-[10.5px] text-ink-1 leading-relaxed rounded-lg px-2 py-1.5 bg-bg-2">
                    {e.mode === 'rate_change' ? (
                        <>Applies from <b>{ymLabel(ym(e.fromYear!, e.fromMonth!))}</b> onward; earlier months keep {money(before.monthlyAmount, e.currency)}. Updates the dashboard &amp; income.</>
                    ) : (
                        <>Rewrites the stream ({after.activeFrom === after.activeUntil ? after.activeFrom : `${after.activeFrom} → ${after.activeUntil}`}). Updates the dashboard &amp; income.</>
                    )}
                </div>
            )}
            {isDelete && (
                <div className="text-[10.5px] leading-relaxed rounded-lg px-2 py-1.5 text-amber-700 dark:text-amber-400 bg-amber-500/10">
                    Removes this income stream from every month it covered.
                </div>
            )}
            {error && <div className="text-[10.5px] text-red-500">{error}</div>}
            <div className="flex items-center gap-2 pt-0.5">
                <button
                    type="button"
                    disabled={saving}
                    onClick={run}
                    className={cn(
                        'inline-flex items-center gap-1.5 text-[12px] font-semibold px-3.5 py-1.5 rounded-full transition-all disabled:opacity-60',
                        isDelete ? 'bg-red-500 text-white hover:brightness-105 cursor-pointer' : 'text-[#1a120a] cursor-pointer hover:brightness-[1.03]',
                    )}
                    style={isDelete ? undefined : GOLD_STYLE}
                >
                    {saving ? (isDelete ? 'Deleting…' : 'Applying…') : isDelete ? (<><TrashIcon size={13} /> Delete</>) : (<><CheckMark size={13} /> Confirm</>)}
                </button>
                <button type="button" disabled={saving} onClick={cancel} className={CANCEL_BTN}>
                    Cancel
                </button>
            </div>
        </div>
    );
}

// ── the chat core ────────────────────────────────────────────

/** Renders the confirm cards for a message's proposals, dispatched by kind. Extracted
 *  (Slice 3) so BOTH the chat and the quick-mic surface render IDENTICAL cards from one
 *  place. The quick-mic passes origin='voice' so a mic-created expense keeps
 *  source='voice' (ledger badge + recent-voice-log). onResolve persists the outcome. */
export function ProposalCardList({
    proposals,
    onNavigate,
    onWritten,
    onResolve,
    origin,
}: {
    proposals: ClientProposal[];
    onNavigate: (target: NavTarget) => void;
    onWritten: () => void;
    onResolve: (proposalId: string, outcome: ProposalOutcome, summary?: string) => void;
    origin?: 'voice' | 'chat';
}) {
    if (!proposals || proposals.length === 0) return null;
    return (
        <div className="w-full flex flex-col gap-1">
            {proposals.map((p) =>
                p.kind === 'create_recurring' ? (
                    <CreateRecurringProposalCard key={p.id} proposal={p} onWritten={onWritten} initialOutcome={p.outcome} onResolve={(o, s) => onResolve(p.id, o, s)} />
                ) : p.kind === 'edit_recurring' ? (
                    <RecurringProposalCard key={p.id} proposal={p} onWritten={onWritten} initialOutcome={p.outcome} onResolve={(o, s) => onResolve(p.id, o, s)} />
                ) : p.kind === 'set_preference' ? (
                    <PreferenceProposalCard key={p.id} proposal={p} initialOutcome={p.outcome} onResolve={(o, s) => onResolve(p.id, o, s)} />
                ) : p.kind === 'set_month_status' ? (
                    <MonthStatusProposalCard key={p.id} proposal={p} onWritten={onWritten} initialOutcome={p.outcome} onResolve={(o, s) => onResolve(p.id, o, s)} />
                ) : p.kind === 'set_savings_goal' ? (
                    <SavingsGoalProposalCard key={p.id} proposal={p} onWritten={onWritten} initialOutcome={p.outcome} onResolve={(o, s) => onResolve(p.id, o, s)} />
                ) : p.kind === 'adjust_salary' ? (
                    <SalaryProposalCard key={p.id} proposal={p} onWritten={onWritten} initialOutcome={p.outcome} onResolve={(o, s) => onResolve(p.id, o, s)} />
                ) : p.kind === 'create_bonus' || p.kind === 'update_bonus' || p.kind === 'delete_bonus' ? (
                    <BonusProposalCard key={p.id} proposal={p} onWritten={onWritten} initialOutcome={p.outcome} onResolve={(o, s) => onResolve(p.id, o, s)} />
                ) : p.kind === 'create_income_source' ? (
                    <CreateIncomeSourceProposalCard key={p.id} proposal={p} onWritten={onWritten} initialOutcome={p.outcome} onResolve={(o, s) => onResolve(p.id, o, s)} />
                ) : p.kind === 'edit_income_source' ? (
                    <EditIncomeSourceProposalCard key={p.id} proposal={p} onWritten={onWritten} initialOutcome={p.outcome} onResolve={(o, s) => onResolve(p.id, o, s)} />
                ) : (
                    <ProposalCard key={p.id} proposal={p} origin={origin} onNavigate={onNavigate} onWritten={onWritten} initialOutcome={p.outcome} onResolve={(o, s) => onResolve(p.id, o, s)} />
                ),
            )}
        </div>
    );
}

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
    // Slice 3: the full chat picks up a hand-off left by the quick-mic (a session to
    // jump to, or a prompt to pre-fill / auto-send) and clears it via consumePending().
    const { pending, consumePending } = useAssistant();
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

    // ADDED (2026-07-17): AI-usage strip. Loaded on mount (so it shows even before
    // the first message this session), refreshed after every turn (the SSE `done`
    // event carries a post-turn snapshot), and kept in sync with OTHER surfaces
    // (Settings' overflow toggle, the quick mic) via the QUOTA_CHANGED event.
    const [quota, setQuota] = useState<AiQuotaStatus | null>(null);
    useEffect(() => {
        fetchQuotaStatus().then(setQuota).catch(() => {});
        const onChanged = () => fetchQuotaStatus().then(setQuota).catch(() => {});
        window.addEventListener(QUOTA_CHANGED_EVENT, onChanged);
        return () => window.removeEventListener(QUOTA_CHANGED_EVENT, onChanged);
    }, []);

    const handleNavigate = useCallback(
        (target: NavTarget) => {
            router.push(NAV_ROUTES[target]);
            onNavigate?.();
        },
        [router, onNavigate],
    );

    // ADDED (Slice 2b): after ANY confirmed write, tell the visible page to re-fetch
    // (notifyDataChanged → ExpensesProvider.refresh) so dashboard/ledger/calendar/
    // income/recurring reflect the change immediately — not just after a navigation.
    // router.refresh() additionally re-runs any server-rendered parts.
    const handleWritten = useCallback(() => {
        notifyDataChanged();
        router.refresh();
    }, [router]);

    // ADDED (Slice 2b-part-2): persist a card's resolution (confirmed / cancelled) so
    // the "what you did here" status survives reloads + navigation. Best-effort;
    // captures the current sessionId each render (cards resolve after the turn's
    // session id is known). Also updates the in-memory message so the same thread
    // reflects it without a refetch.
    const persistOutcome = (proposalId: string, outcome: ProposalOutcome, summary?: string) => {
        if (sessionId != null) recordProposalOutcome(sessionId, proposalId, outcome, summary).catch(() => {});
        setMessages((prev) =>
            prev.map((m) =>
                m.proposals?.some((p) => p.id === proposalId)
                    ? {
                          ...m,
                          proposals: m.proposals.map((p) =>
                              p.id === proposalId ? { ...p, outcome, ...(summary && { resultSummary: summary }) } : p,
                          ),
                      }
                    : m,
            ),
        );
    };

    // Restore the latest conversation the first time the surface becomes active.
    // Slice 3: a pending hand-off (from the quick-mic) takes priority over restore —
    // it's handled by its own effect below, so skip restore while one is queued.
    useEffect(() => {
        if (pending) return;
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
                    setMessages(msgs.map(persistedToChatMessage));
                }
            } catch {
                /* first-load hiccup — the user can still start a fresh chat */
            }
        })();
    }, [active, pending]);

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
                            quota?: AiQuotaStatus;
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
                        } else if (data.type === 'reset') {
                            // Pre-tool narration — drop it so it can't double up with the
                            // final answer (deterministic dedupe of the two-narration bug).
                            patch((m) => ({ ...m, content: '' }));
                        } else if (data.type === 'tool' && data.name) {
                            patch((m) => ({ ...m, toolsUsed: [...(m.toolsUsed ?? []), data.name!] }));
                        } else if (data.type === 'proposal' && data.proposal) {
                            const p = data.proposal;
                            patch((m) => ({ ...m, proposals: [...(m.proposals ?? []), p] }));
                        } else if (data.type === 'error') {
                            streamErrored = true;
                        } else if (data.type === 'done' && data.quota) {
                            setQuota(data.quota);
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

    // ADDED (Slice 3 — "one brain"): consume a hand-off from the quick-mic. When the
    // full chat opens with a pending session, jump straight to (and re-fetch) that
    // thread so the turn the user just did by voice is right there; a pending prompt
    // pre-fills or auto-sends. Priority over the plain restore above. Defined after
    // `send` so it can auto-send.
    useEffect(() => {
        if (!active || !pending) return;
        const p = pending;
        consumePending();
        initedRef.current = true; // a hand-off counts as "initialised" — don't also restore
        (async () => {
            try {
                if (p.sessionId != null) {
                    const msgs = await fetchAssistantMessages(p.sessionId);
                    setSessionId(p.sessionId);
                    setMessages(msgs.map(persistedToChatMessage));
                    fetchAssistantSessions().then(setSessions).catch(() => {});
                }
            } catch {
                /* couldn't load the handed-off thread — the user can still type */
            }
            if (p.prompt) {
                if (p.autoSend) void send(p.prompt);
                else setInput(p.prompt);
            }
        })();
    }, [active, pending, consumePending, send]);

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
            setMessages(msgs.map(persistedToChatMessage));
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
                                                <AssistantText
                                                    text={m.content}
                                                    onNavigate={handleNavigate}
                                                    onSuggest={send}
                                                    disabled={sending}
                                                />
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
                                {/* WRITE confirm cards (Slice 2/2b) — nothing saves until tapped.
                                    Dispatched by kind in the shared ProposalCardList (Slice 3),
                                    so the chat + quick-mic render identical cards. */}
                                {m.role === 'assistant' && m.proposals && m.proposals.length > 0 && (
                                    <ProposalCardList
                                        proposals={m.proposals}
                                        onNavigate={handleNavigate}
                                        onWritten={handleWritten}
                                        onResolve={persistOutcome}
                                    />
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
            <div className="px-4 pb-4 pt-2 border-t border-line-soft flex flex-col gap-2">
                <QuotaStrip quota={quota} onQuotaChange={setQuota} />
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
                    {/* While recording: ✕ discards the take (misspoke → redo), the mic
                        finishes & transcribes. */}
                    {mic.recording && (
                        <button
                            type="button"
                            onClick={mic.cancel}
                            aria-label="Cancel recording"
                            title="Cancel recording"
                            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-ink-2 hover:text-red-500 hover:bg-bg-2 transition-all cursor-pointer"
                        >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M6 6l12 12M18 6L6 18" />
                            </svg>
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={mic.recording ? mic.stop : mic.start}
                        disabled={sending || mic.transcribing}
                        aria-label={mic.recording ? 'Finish and use recording' : 'Speak your question'}
                        title={mic.recording ? 'Finish & transcribe' : undefined}
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
