'use client';

// CHANGED (Voice AI module): this is now REAL voice capture. The mic records
// audio (useVoiceRecorder → MediaRecorder), which is transcribed by OpenAI and
// parsed into an expense by Claude Haiku (transcribeExpense server action).
// The scripted useVoiceCapture / VOICE_SAMPLES engine is retired from this flow.
// Bonus features baked in:
//  • auto language detection (Claude returns lang)
//  • confirm-before-save (nothing is logged until you tap Save)
//  • AI-suggested tags shown + saved
//  • Module 6 dedup — warns when the entry matches an existing/auto-logged expense
//  • re-record without leaving the modal
//  • live waveform while listening

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MicIcon, SparkleIcon, EditIcon, CategoryTile } from '@/components/icons';
import { AnimatedNumber } from '@/components/shared/AnimatedNumber';
import { TagChip } from '@/components/shared';
import { Waveform } from './Waveform';
import { VoiceEntryEditor, type VoiceEntryValue } from './VoiceEntryEditor';
import { CATEGORIES } from '@/data/categories';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { useExpenses } from '@/components/data/ExpensesContext';
import { fetchTagSuggestions } from '@/lib/actions';
import type { VoiceEditTarget, VoiceEditChanges } from '@/lib/actions';
import { MONTH_NAMES } from '@/lib/utils';
import type { NewVoiceLog } from './VoiceContext';
import type { Expense } from '@/types';

// Currency symbols for the edit before→after diff (matches the editor's options).
const CUR_SYMBOL: Record<string, string> = { SGD: 'S$', MYR: 'RM', CNY: '¥', USD: '$' };
const money = (amt: number, cur: string) => `${CUR_SYMBOL[cur] ?? 'S$'}${amt.toFixed(2)}`;

// ADDED (Phase B): one before→after row in the edit confirm card.
function DiffRow({ label, before, after }: { label: string; before: string; after: string }) {
    return (
        <div className="flex items-center gap-2 text-[13px] min-w-0">
            <span className="text-[10px] text-ink-3 uppercase tracking-[0.06em] w-16 flex-shrink-0">{label}</span>
            <span className="text-ink-2 line-through truncate">{before}</span>
            <span className="text-ink-3 flex-shrink-0">→</span>
            <span className="font-semibold text-ink-0 truncate">{after}</span>
        </div>
    );
}

function CheckIcon({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12 L10 17 L19 7" />
        </svg>
    );
}

// ADDED (AI Assistant · Phase A): small calendar glyph for the date row.
function CalendarIcon({ size = 14 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
            <path d="M3 9h18M8 2.5v4M16 2.5v4" />
        </svg>
    );
}

function StopIcon({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2.5" />
        </svg>
    );
}

function Spinner({ size = 20 }: { size?: number }) {
    return (
        <motion.svg
            width={size} height={size} viewBox="0 0 24 24" fill="none"
            animate={{ rotate: 360 }}
            transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
        >
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.25" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </motion.svg>
    );
}

export function VoiceCapture({
    onSave,
    onEdit,
}: {
    onSave: (entry: NewVoiceLog) => void;
    onEdit: (target: VoiceEditTarget, changes: VoiceEditChanges) => void;
}) {
    const { status, result, errorMsg, start, stop, reset } = useVoiceRecorder();
    const { expenses, current } = useExpenses();
    const [editing, setEditing] = useState(false);
    // ADDED (Phase A follow-up): persistent tag suggestions for the editor's
    // "Recent:" chips — same source as the manual add/edit modal.
    const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
    useEffect(() => {
        fetchTagSuggestions().then(setTagSuggestions).catch(() => {});
    }, []);

    const parsed = result?.parsed ?? null;
    const lang = result?.lang ?? 'en';
    const transcript = result?.transcript ?? '';
    // ADDED (Phase A): the classified intent. CREATE + EDIT (Phase B) are wired;
    // RECURRING still gets an acknowledged "coming soon" card (Phase C).
    const intent = result?.intent ?? 'create';

    // ── Phase B: edit-by-voice — the AI-matched target + the fields it changes ──
    const edit = result?.edit ?? null;
    const editTarget = edit?.target ?? null;
    const editChanges = edit?.changes ?? {};
    const editHasChanges = Object.keys(editChanges).length > 0;
    // The resulting (after) values + which fields changed, for the before→after diff.
    const editAfter = editTarget
        ? {
            amt: editChanges.amount ?? editTarget.amt,
            currency: editChanges.currency ?? editTarget.currency,
            cat: editChanges.category ?? editTarget.cat,
            note: editChanges.note ?? editTarget.note,
        }
        : null;
    const editAmountChanged = editChanges.amount !== undefined || editChanges.currency !== undefined;
    const editCategoryChanged = editChanges.category !== undefined;
    const editNoteChanged = editChanges.note !== undefined;
    const editDateLabel = editTarget
        ? (() => {
            const d = new Date(editTarget.spentAt);
            const base = `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
            return d.getFullYear() === new Date().getFullYear() ? base : `${base}, ${d.getFullYear()}`;
        })()
        : '';
    const confirmEdit = () => {
        if (!editTarget || !editHasChanges) return;
        onEdit(editTarget, editChanges);
    };

    // ADDED (Phase A): the resolved expense date. null spentAt = today.
    const spentAt = parsed?.spentAt ?? null;
    const backdated = !!spentAt;
    const dateLabel = useMemo(() => {
        if (!spentAt) return 'Today';
        const d = new Date(spentAt);
        const base = `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
        return d.getFullYear() === new Date().getFullYear() ? base : `${base}, ${d.getFullYear()}`;
    }, [spentAt]);

    const isRecording = status === 'listening';
    const isParsing = status === 'parsing';

    // ── Module 6: dedup — does this match something already in the ledger? ──
    // Prefer a recurring/auto-generated row with the same amount (the classic
    // "rent was auto-logged on the 1st" case), else any same amount+category.
    const dup = useMemo<Expense | null>(() => {
        if (!parsed) return null;
        const sameAmt = expenses.filter((e) => Math.abs(e.amt - parsed.amount) < 0.01);
        return sameAmt.find((e) => e.fixed) ?? sameAmt.find((e) => e.cat === parsed.category) ?? null;
    }, [expenses, parsed]);

    const title =
        status === 'idle' ? 'Tap to talk'
            : status === 'listening' ? 'Listening…'
                : status === 'parsing' ? 'Understanding…'
                    : status === 'error' ? 'Hmm…'
                        : 'Got it ✨';

    const saveWith = (v: VoiceEntryValue, edited: boolean) => {
        onSave({
            lang,
            transcript,
            cat: v.cat,
            amt: v.amt,
            currency: v.currency,
            note: v.note,
            tags: v.tags, // CHANGED (Phase A follow-up): tags now editable in the editor
            spentAt: v.spentAt, // CHANGED (Phase A follow-up): date/time now editable too
            status: edited ? 'edited' : 'confirmed',
        });
        setEditing(false);
        reset();
    };

    const confirm = () => {
        if (!parsed) return;
        saveWith(
            { amt: parsed.amount, currency: parsed.currency, cat: parsed.category, note: parsed.note, tags: parsed.tags, spentAt: parsed.spentAt },
            false,
        );
    };

    return (
        <div className="flex flex-col items-center text-center">
            {/* Header */}
            <div className="flex items-center gap-2 text-gold-700 text-[11px] uppercase tracking-[0.14em] font-semibold">
                <SparkleIcon size={12} className="text-gold-600" />
                Voice logging · live
            </div>
            <h1 className="display mt-2.5" style={{ fontSize: 'clamp(28px, 5vw, 38px)' }}>
                {title.split('…')[0]}
                {title.includes('…') && <span className="text-gold-500">…</span>}
            </h1>

            {/* Mic orb — tap to start, tap again to stop */}
            <button
                type="button"
                onClick={status === 'idle' || status === 'error' ? start : isRecording ? stop : undefined}
                aria-label={isRecording ? 'Stop recording' : 'Start voice logging'}
                className={`${isRecording ? 'pulse' : ''} mt-6 w-28 h-28 rounded-full flex items-center justify-center relative transition-transform ${status === 'idle' || status === 'error' || isRecording ? 'cursor-pointer hover:scale-105' : 'cursor-default'}`}
                style={{
                    background: 'linear-gradient(135deg, oklch(0.94 0.09 92), oklch(0.72 0.155 80))',
                    boxShadow: 'var(--shadow-gold)',
                    opacity: status === 'parsed' || isParsing ? 0.75 : 1,
                }}
            >
                <span className="text-[#1a120a]">
                    {isParsing ? <Spinner size={40} /> : isRecording ? <StopIcon size={40} /> : <MicIcon size={44} />}
                </span>
            </button>

            {/* Waveform */}
            <div className="mt-5 mb-1 text-gold-600" style={{ minHeight: 36 }}>
                <Waveform bars={28} height={32} active={isRecording} />
            </div>

            {/* Idle hint */}
            {status === 'idle' && (
                <div className="mt-2 max-w-[460px]">
                    <p className="text-[15px] text-ink-1 leading-snug">
                        Say what you spent out loud — for example{' '}
                        <span className="text-ink-0 font-medium">&ldquo;Lunch twelve dollars at Maxwell food court&rdquo;</span>.
                        English, Mandarin, Malay, or a mix all work. Tap the mic again to stop.
                    </p>
                </div>
            )}

            {/* Recording / parsing status line */}
            {(isRecording || isParsing) && (
                <div className="mt-2 text-[13px] text-ink-2">
                    {isRecording ? 'Recording — tap the mic to stop' : 'Transcribing and understanding…'}
                </div>
            )}

            {/* Error */}
            {status === 'error' && (
                <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-4 w-full max-w-[520px] rounded-[16px] p-4 text-left"
                    style={{ border: '1px solid color-mix(in oklch, oklch(0.64 0.19 25) 40%, transparent)', background: 'color-mix(in oklch, oklch(0.64 0.19 25) 8%, transparent)' }}
                >
                    <div className="text-[13px] text-ink-0">{errorMsg || 'Something went wrong. Please try again.'}</div>
                    <button
                        type="button"
                        onClick={start}
                        className="mt-3 h-9 px-4 rounded-full text-[13px] font-semibold flex items-center gap-1.5 hover:brightness-[1.03] transition-all"
                        style={{ background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))', color: '#1a120a', boxShadow: 'var(--shadow-gold)' }}
                    >
                        <MicIcon size={14} /> Try again
                    </button>
                </motion.div>
            )}

            {/* Transcript bubble */}
            {status === 'parsed' && transcript && (
                <div className="mt-4 w-full max-w-[560px] rounded-[20px] p-5 text-left" style={{ background: 'var(--color-bg-1)' }}>
                    <div className="text-[11px] text-ink-2 uppercase tracking-[0.08em] mb-2">
                        You said · {lang}
                    </div>
                    <div className="text-[17px] leading-relaxed">&ldquo;{transcript}&rdquo;</div>
                </div>
            )}

            {/* Parsed result */}
            <AnimatePresence>
                {status === 'parsed' && parsed && (
                    <motion.div
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                        className="mt-4 w-full max-w-[560px] rounded-[20px] p-5 text-left"
                        style={{ border: '1px solid oklch(0.88 0.08 88)', background: 'linear-gradient(135deg, var(--grad-soft-a), var(--grad-soft-b))' }}
                    >
                        {/* AI header */}
                        <div className="flex items-center gap-2.5 mb-3.5">
                            <div className="w-7 h-7 rounded-[9px] flex items-center justify-center" style={{ background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.65 0.155 78))' }}>
                                <SparkleIcon size={13} className="text-[#1a120a]" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-[13px] font-semibold">
                                    {editing ? 'Edit the details' : 'Here’s what I heard — confirm to save'}
                                </div>
                                <div className="text-[11px] text-ink-2">Review, then tap save · nothing is logged yet</div>
                            </div>
                        </div>

                        {editing ? (
                            <VoiceEntryEditor
                                initial={{ amt: parsed.amount, currency: parsed.currency, cat: parsed.category, note: parsed.note, tags: parsed.tags, spentAt: parsed.spentAt }}
                                onSave={(v) => saveWith(v, true)}
                                onCancel={() => setEditing(false)}
                                saveLabel="Save"
                                showDateTime
                                showTags
                                suggestions={tagSuggestions}
                            />
                        ) : (
                            <>
                                {/* Result row */}
                                <div className="grid items-center gap-3.5 p-3.5 rounded-[14px]" style={{ gridTemplateColumns: 'auto 1fr auto', background: 'var(--color-bg-card)', border: '1px solid var(--color-line-soft)' }}>
                                    <CategoryTile kind={parsed.category} size={48} variant="filled" />
                                    <div className="min-w-0">
                                        <div className="text-[15px] font-medium">{CATEGORIES[parsed.category].label}</div>
                                        <div className="text-[11px] text-ink-2 mt-0.5 truncate">
                                            {parsed.note || <span className="italic text-ink-3">no note</span>}
                                        </div>
                                    </div>
                                    <div className="display-number" style={{ fontSize: 26 }}>
                                        <AnimatedNumber value={parsed.amount} format="money" currency={parsed.currency} duration={900} />
                                    </div>
                                </div>

                                {/* ADDED (Phase A): resolved date — highlighted when back-dated */}
                                <div className="flex items-center gap-2 mt-3">
                                    <span className="text-[10px] text-ink-3 uppercase tracking-[0.08em]">When</span>
                                    <span
                                        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12px] font-medium"
                                        style={
                                            backdated
                                                ? { background: 'color-mix(in oklch, oklch(0.72 0.155 80) 16%, transparent)', color: 'var(--color-on-soft)', border: '1px solid color-mix(in oklch, oklch(0.72 0.155 80) 42%, transparent)' }
                                                : { background: 'var(--color-bg-1)', color: 'var(--color-ink-1)', border: '1px solid var(--color-line-soft)' }
                                        }
                                    >
                                        <CalendarIcon size={13} />
                                        {dateLabel}
                                    </span>
                                    {backdated && <span className="text-[11px] text-ink-3">back-dated from your voice note</span>}
                                </div>

                                {/* AI tags */}
                                {parsed.tags.length > 0 && (
                                    <div className="flex gap-1.5 flex-wrap mt-3 items-center">
                                        <span className="text-[10px] text-ink-3 uppercase tracking-[0.08em]">Tags</span>
                                        {parsed.tags.map((t) => (
                                            <TagChip key={t} label={t} dense />
                                        ))}
                                    </div>
                                )}

                                {/* Module 6 dedup warning */}
                                {dup && (
                                    <div
                                        className="mt-3.5 rounded-[12px] px-3.5 py-2.5 text-[12px] leading-snug"
                                        style={{
                                            background: 'color-mix(in oklch, oklch(0.75 0.15 68) 14%, transparent)',
                                            color: 'var(--color-ink-0)',
                                            border: '1px solid color-mix(in oklch, oklch(0.75 0.15 68) 42%, transparent)',
                                        }}
                                    >
                                        ⚠️ Possible duplicate — <b>{dup.note || CATEGORIES[dup.cat].label}</b>{' '}
                                        ({parsed.currency} {parsed.amount.toFixed(2)}) was already logged on{' '}
                                        <b>{MONTH_NAMES[current.month - 1]} {dup.day}</b>
                                        {dup.fixed && ' (auto from a recurring rule)'}. Log it again?
                                    </div>
                                )}

                                {/* Actions */}
                                <div className="mt-4 flex flex-col sm:flex-row gap-2.5">
                                    <button
                                        type="button"
                                        onClick={confirm}
                                        className="w-full sm:flex-1 h-11 rounded-full text-sm font-semibold flex items-center justify-center gap-2 hover:brightness-[1.03] transition-all"
                                        style={{ background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))', color: '#1a120a', boxShadow: 'var(--shadow-gold)' }}
                                    >
                                        <CheckIcon size={16} /> {dup ? 'Log anyway' : 'Looks good, save'}
                                    </button>
                                    <div className="flex gap-2.5">
                                        <button
                                            type="button"
                                            onClick={() => setEditing(true)}
                                            className="flex-1 sm:flex-none h-11 px-4 rounded-full border border-line bg-bg-card text-sm font-medium flex items-center justify-center gap-1.5 hover:border-ink-2 transition-all"
                                        >
                                            <EditIcon size={14} /> Edit
                                        </button>
                                        <button
                                            type="button"
                                            onClick={start}
                                            className="flex-1 sm:flex-none h-11 px-4 rounded-full border border-line bg-bg-card text-sm font-medium flex items-center justify-center gap-1.5 hover:border-ink-2 transition-all"
                                        >
                                            <MicIcon size={14} /> Record again
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ADDED (Phase B): EDIT by voice — before→after confirm, or a graceful
                "couldn't find it" / "no change heard" card. */}
            {status === 'parsed' && intent === 'edit' && (
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    className="mt-4 w-full max-w-[560px] rounded-[20px] p-5 text-left"
                    style={{ border: '1px solid oklch(0.88 0.08 88)', background: 'linear-gradient(135deg, var(--grad-soft-a), var(--grad-soft-b))' }}
                >
                    <div className="flex items-center gap-2.5 mb-3.5">
                        <div className="w-7 h-7 rounded-[9px] flex items-center justify-center" style={{ background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.65 0.155 78))' }}>
                            <SparkleIcon size={13} className="text-[#1a120a]" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-semibold">
                                {editTarget && editHasChanges ? 'Update this expense — confirm to save'
                                    : editTarget ? 'I found the expense'
                                        : "Couldn't find that expense"}
                            </div>
                            <div className="text-[11px] text-ink-2">Review, then tap update · nothing changes yet</div>
                        </div>
                    </div>

                    {editTarget && editAfter ? (
                        <>
                            {/* Which expense */}
                            <div className="grid items-center gap-3 p-3 rounded-[14px] mb-3" style={{ gridTemplateColumns: 'auto 1fr auto', background: 'var(--color-bg-card)', border: '1px solid var(--color-line-soft)' }}>
                                <CategoryTile kind={editAfter.cat} size={40} variant="filled" />
                                <div className="min-w-0">
                                    <div className="text-[14px] font-medium truncate">{editTarget.note || CATEGORIES[editTarget.cat].label}</div>
                                    <div className="text-[11px] text-ink-2 mt-0.5">{editDateLabel}</div>
                                </div>
                            </div>

                            {editHasChanges ? (
                                <div className="flex flex-col gap-2">
                                    {editAmountChanged && (
                                        <DiffRow label="Amount"
                                            before={money(editTarget.amt, editTarget.currency)}
                                            after={money(editAfter.amt, editAfter.currency)} />
                                    )}
                                    {editCategoryChanged && (
                                        <DiffRow label="Category"
                                            before={CATEGORIES[editTarget.cat].label}
                                            after={CATEGORIES[editAfter.cat].label} />
                                    )}
                                    {editNoteChanged && (
                                        <DiffRow label="Note"
                                            before={editTarget.note || '—'}
                                            after={editAfter.note || '—'} />
                                    )}
                                </div>
                            ) : (
                                <p className="text-[12px] text-ink-2 leading-snug">
                                    I matched this entry but didn&apos;t catch <b>what to change</b>. Try again — e.g. &ldquo;change it to fifteen dollars&rdquo;.
                                </p>
                            )}

                            {/* Actions */}
                            <div className="mt-4 flex flex-col sm:flex-row gap-2.5">
                                {editHasChanges && (
                                    <button
                                        type="button"
                                        onClick={confirmEdit}
                                        className="w-full sm:flex-1 h-11 rounded-full text-sm font-semibold flex items-center justify-center gap-2 hover:brightness-[1.03] transition-all"
                                        style={{ background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))', color: '#1a120a', boxShadow: 'var(--shadow-gold)' }}
                                    >
                                        <CheckIcon size={16} /> Update
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={start}
                                    className="flex-1 sm:flex-none h-11 px-4 rounded-full border border-line bg-bg-card text-sm font-medium flex items-center justify-center gap-1.5 hover:border-ink-2 transition-all"
                                >
                                    <MicIcon size={14} /> Record again
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <p className="text-[13px] text-ink-1 leading-relaxed">
                                I couldn&apos;t match that to one of your recent expenses. Try naming the item and roughly when — e.g. <span className="text-ink-0 font-medium">&ldquo;my fried chicken on July 7&rdquo;</span>.
                            </p>
                            <button
                                type="button"
                                onClick={start}
                                className="mt-4 h-10 px-4 rounded-full text-[13px] font-semibold flex items-center gap-1.5 hover:brightness-[1.03] transition-all"
                                style={{ background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))', color: '#1a120a', boxShadow: 'var(--shadow-gold)' }}
                            >
                                <MicIcon size={14} /> Record again
                            </button>
                        </>
                    )}
                </motion.div>
            )}

            {/* ADDED (Phase A): RECURRING is classified but its apply lands in Phase C. */}
            {status === 'parsed' && intent === 'recurring' && (
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                    className="mt-4 w-full max-w-[560px] rounded-[20px] p-5 text-left"
                    style={{ border: '1px solid oklch(0.88 0.08 88)', background: 'linear-gradient(135deg, var(--grad-soft-a), var(--grad-soft-b))' }}
                >
                    <div className="flex items-center gap-2.5 mb-2.5">
                        <div className="w-7 h-7 rounded-[9px] flex items-center justify-center" style={{ background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.65 0.155 78))' }}>
                            <SparkleIcon size={13} className="text-[#1a120a]" />
                        </div>
                        <div className="text-[13px] font-semibold">Sounds like a recurring expense</div>
                    </div>
                    <p className="text-[13px] text-ink-1 leading-relaxed">
                        I heard a request to <b>set up a recurring expense</b>. Creating recurring items by voice is coming in the next update — for now, add it on the <b>Recurring</b> page, or record a one-off expense to log.
                    </p>
                    <button
                        type="button"
                        onClick={start}
                        className="mt-4 h-10 px-4 rounded-full text-[13px] font-semibold flex items-center gap-1.5 hover:brightness-[1.03] transition-all"
                        style={{ background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))', color: '#1a120a', boxShadow: 'var(--shadow-gold)' }}
                    >
                        <MicIcon size={14} /> Record again
                    </button>
                </motion.div>
            )}

            {/* Cancel back to idle while recording */}
            {isRecording && (
                <button type="button" onClick={reset} className="mt-4 text-xs text-ink-2 hover:text-ink-0 transition-colors">
                    Cancel
                </button>
            )}
        </div>
    );
}
