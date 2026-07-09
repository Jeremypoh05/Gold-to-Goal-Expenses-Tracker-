'use client';

// ADDED (Phase 6.1): one editable form for a parsed voice entry —
// amount + currency + category + note. Reused by both the capture inline-edit
// and the history-row edit so there's a single editor to maintain. Self-contained
// (seeds its own state from `initial` on mount); mount fresh (keyed) per edit.
//
// CHANGED (AI Assistant · Phase A follow-up): the editor now optionally also edits
// DATE/TIME (via the shared DateTimeFields picker) and TAGS (same chip UX as the
// manual add/edit modal), so a voice log can be reviewed exactly like a typed one.
// These are opt-in via `showDateTime` / `showTags` so the history-row editor (which
// has no full date/tags context) keeps its original amount/category/note shape.

import { useEffect, useRef, useState } from 'react';
import { CategoryTile } from '@/components/icons';
import { TagChip, AISuggestCard, type AISuggestion } from '@/components/shared';
import { CATEGORIES } from '@/data/categories';
import { MAX_TAGS, normalizeTag, normalizeTags } from '@/lib/expense-utils';
import { DateTimeFields } from '@/components/dashboard/DateTimePicker';
import { suggestExpenseMeta } from '@/lib/actions';
import type { CategoryKey, Currency } from '@/types';

const CATEGORY_KEYS: CategoryKey[] = [
    'food',
    'shop',
    'ent',
    'trans',
    'health',
    'bills',
    'other',
];

const CURRENCY_OPTIONS: { code: Currency; label: string }[] = [
    { code: 'SGD', label: 'S$' },
    { code: 'MYR', label: 'RM' },
    { code: 'CNY', label: '¥' },
    { code: 'USD', label: '$' },
];

/** The value returned on save. `tags`/`spentAt` are always present but only edited
 *  when the parent opts into showTags / showDateTime (otherwise they pass through). */
export interface VoiceEntryValue {
    amt: number;
    currency: Currency;
    cat: CategoryKey;
    note: string;
    tags: string[];
    spentAt: string | null; // ISO, or null = leave as-is / now
}

/** Initial values — tags/spentAt optional so the history-row editor can omit them. */
export interface VoiceEntryInitial {
    amt: number;
    currency: Currency;
    cat: CategoryKey;
    note: string;
    tags?: string[];
    spentAt?: string | null;
}

function CheckIcon({ size = 14 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12 L10 17 L19 7" />
        </svg>
    );
}

/** Break an ISO string (or now) into the "YYYY-MM-DD" / "HH:MM" the picker wants. */
function isoToParts(iso: string | null | undefined): { date: string; time: string } {
    const d = iso ? new Date(iso) : new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return {
        date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
        time: `${p(d.getHours())}:${p(d.getMinutes())}`,
    };
}

export function VoiceEntryEditor({
    initial,
    onSave,
    onCancel,
    saveLabel = 'Save changes',
    showDateTime = false,
    showTags = false,
    suggestions = [],
}: {
    initial: VoiceEntryInitial;
    onSave: (value: VoiceEntryValue) => void;
    onCancel?: () => void;
    saveLabel?: string;
    showDateTime?: boolean;
    showTags?: boolean;
    suggestions?: string[];
}) {
    const [amt, setAmt] = useState(initial.amt.toFixed(2));
    const [currency, setCurrency] = useState<Currency>(initial.currency);
    const [cat, setCat] = useState<CategoryKey>(initial.cat);
    const [note, setNote] = useState(initial.note);

    // Date/time (only used when showDateTime); seeded from spentAt or now.
    const seed = isoToParts(initial.spentAt);
    const [date, setDate] = useState(seed.date);
    const [time, setTime] = useState(seed.time);

    // Tags (only used when showTags).
    const [tags, setTags] = useState<string[]>(initial.tags ?? []);
    const [draft, setDraft] = useState('');

    const symbol = CURRENCY_OPTIONS.find((c) => c.code === currency)?.label ?? 'S$';
    const atMax = tags.length >= MAX_TAGS;

    const addTag = (raw: string) => {
        const t = normalizeTag(raw);
        if (!t || tags.includes(t) || tags.length >= MAX_TAGS) {
            setDraft('');
            return;
        }
        setTags([...tags, t]);
        setDraft('');
    };
    const removeTag = (t: string) => setTags(tags.filter((x) => x !== t));

    const remaining = suggestions.filter((s) => !tags.includes(s)).slice(0, 8);

    // AI suggestions (only when showTags — the voice capture editor). Mirrors the
    // manual modal: debounced suggestExpenseMeta on the note; apply is explicit so
    // we never auto-overwrite the user's category/tags. Seeded from the initial note
    // so opening the editor with a prefilled (already-parsed) note doesn't re-query.
    const [aiSuggestion, setAiSuggestion] = useState<AISuggestion | null>(null);
    const [aiLoading, setAiLoading] = useState(false);
    const lastQueried = useRef((initial.note ?? '').trim());
    useEffect(() => {
        if (!showTags) return;
        const q = note.trim();
        if (q.length < 3 || q === lastQueried.current) return;
        const id = setTimeout(async () => {
            lastQueried.current = q;
            setAiLoading(true);
            try {
                const s = await suggestExpenseMeta(q);
                // Only surface a genuinely useful hint (a no-key fallback is other/[]).
                setAiSuggestion(s.tags.length > 0 || s.category !== 'other' ? s : null);
            } catch {
                setAiSuggestion(null);
            } finally {
                setAiLoading(false);
            }
        }, 600);
        return () => clearTimeout(id);
    }, [note, showTags]);

    const applySuggestion = () => {
        if (!aiSuggestion) return;
        setCat(aiSuggestion.category);
        setTags((prev) => {
            const merged = [...prev];
            for (const t of aiSuggestion.tags) {
                if (merged.length >= MAX_TAGS) break;
                if (!merged.includes(t)) merged.push(t);
            }
            return merged;
        });
        setAiSuggestion(null); // collapse once applied
    };

    const handleSave = () => {
        // Fold any typed-but-not-committed tag into the list before saving.
        const finalTags = showTags
            ? normalizeTags(draft.trim() ? [...tags, draft] : tags).slice(0, MAX_TAGS)
            : (initial.tags ?? []);
        const spentAt = showDateTime
            ? new Date(`${date}T${time}:00`).toISOString()
            : (initial.spentAt ?? null);
        onSave({ amt: parseFloat(amt) || 0, currency, cat, note, tags: finalTags, spentAt });
    };

    return (
        <div className="flex flex-col gap-3 p-3.5 rounded-[14px]" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-line-soft)' }}>
            {/* Amount + currency */}
            <div>
                <div className="text-[10px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1">Amount</div>
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-line bg-bg-1">
                    <span className="text-ink-2 text-sm w-7">{symbol}</span>
                    <input
                        type="text"
                        inputMode="decimal"
                        value={amt}
                        onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ''))}
                        className="flex-1 bg-transparent outline-none mono text-[15px] font-semibold min-w-0"
                        aria-label="Amount"
                    />
                </div>
                <div className="flex gap-1.5 mt-2">
                    {CURRENCY_OPTIONS.map((c) => (
                        <button
                            key={c.code}
                            type="button"
                            onClick={() => setCurrency(c.code)}
                            className="chip"
                            style={{
                                cursor: 'pointer',
                                background: c.code === currency ? 'oklch(0.96 0.06 92)' : 'var(--color-bg-2)',
                                color: c.code === currency ? 'var(--color-gold-900)' : 'var(--color-ink-1)',
                                border: c.code === currency ? '1px solid oklch(0.85 0.10 88)' : '1px solid var(--color-line-soft)',
                            }}
                        >
                            {c.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Category */}
            <div>
                <div className="text-[10px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1.5">Category</div>
                {/* CHANGED (Phase A follow-up): tiles now show the category NAME under
                    the icon (was icon-only, ambiguous). Mirrors the manual add modal. */}
                <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                    {CATEGORY_KEYS.map((k) => {
                        const isSelected = k === cat;
                        return (
                            <button
                                key={k}
                                type="button"
                                onClick={() => setCat(k)}
                                aria-label={CATEGORIES[k].label}
                                className="rounded-xl flex flex-col items-center gap-1 py-2 px-1 transition-all hover:scale-[1.03]"
                                style={{
                                    background: isSelected ? 'linear-gradient(135deg, oklch(0.96 0.06 92), oklch(0.88 0.12 88))' : 'var(--color-bg-1)',
                                    border: isSelected ? '1px solid oklch(0.80 0.12 88)' : '1px solid transparent',
                                    boxShadow: isSelected ? 'var(--shadow-gold)' : 'none',
                                }}
                            >
                                <CategoryTile kind={k} size={24} variant="filled" />
                                {/* Fixed dark ink when selected — theme ink turns white in
                                    dark mode and is unreadable on the bright gold tile. */}
                                <span
                                    className="text-[9px] font-medium leading-tight text-center"
                                    style={isSelected ? { color: '#2a1805' } : undefined}
                                >
                                    {CATEGORIES[k].label}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Date + time (ADDED Phase A follow-up) */}
            {showDateTime && (
                <div>
                    <div className="text-[10px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1.5">Date &amp; time</div>
                    <DateTimeFields date={date} setDate={setDate} time={time} setTime={setTime} />
                </div>
            )}

            {/* Note */}
            <div>
                <div className="text-[10px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1">Note</div>
                <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Add a note (optional)"
                    className="w-full px-3 py-2 border border-line rounded-xl bg-bg-1 text-[13px] outline-none focus:border-gold-400 focus:bg-bg-card transition-all"
                />
            </div>

            {/* AI suggest (ADDED Phase A follow-up) — same "Suggested" card as the
                manual modal; suggests a category + tags from the note, tap to apply. */}
            {showTags && (
                <AISuggestCard
                    suggestion={aiSuggestion}
                    loading={aiLoading}
                    category={cat}
                    tags={tags}
                    onSetCategory={setCat}
                    onAddTag={addTag}
                    onApplyAll={applySuggestion}
                />
            )}

            {/* Tags (ADDED Phase A follow-up) — same chip UX as the manual modal */}
            {showTags && (
                <div>
                    <div className="flex items-center justify-between mb-1.5">
                        <div className="text-[10px] text-ink-2 uppercase tracking-[0.06em] font-semibold">Tags</div>
                        <div className="text-[10px] text-ink-3">{tags.length}/{MAX_TAGS}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 px-2 py-2 border border-line rounded-xl bg-bg-1 focus-within:border-gold-400 transition-all">
                        {tags.map((t) => (
                            <TagChip key={t} label={t} onRemove={() => removeTag(t)} />
                        ))}
                        {atMax ? (
                            <span className="text-[10px] text-ink-3 px-1">Max {MAX_TAGS} tags</span>
                        ) : (
                            <input
                                type="text"
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ',') {
                                        e.preventDefault();
                                        addTag(draft);
                                    } else if (e.key === 'Backspace' && draft === '' && tags.length) {
                                        removeTag(tags[tags.length - 1]);
                                    }
                                }}
                                placeholder={tags.length ? 'Add tag…' : 'e.g. lunch, maxwell, work'}
                                className="flex-1 min-w-24 bg-transparent text-[12px] outline-none py-0.5"
                                aria-label="Add a tag"
                            />
                        )}
                    </div>
                    {!atMax && remaining.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2 items-center">
                            <span className="text-[10px] text-ink-3">Recent:</span>
                            {remaining.map((s) => (
                                <TagChip key={s} label={s} muted onClick={() => addTag(s)} />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Actions */}
            <div className="flex gap-2.5">
                <button
                    type="button"
                    onClick={handleSave}
                    className="flex-1 h-10 rounded-full text-sm font-semibold flex items-center justify-center gap-2 hover:brightness-[1.03] transition-all"
                    style={{
                        background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))',
                        color: '#1a120a',
                        boxShadow: 'var(--shadow-gold)',
                    }}
                >
                    <CheckIcon size={15} /> {saveLabel}
                </button>
                {onCancel && (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="h-10 px-5 rounded-full border border-line bg-bg-card text-sm font-medium hover:border-ink-2 transition-all"
                    >
                        Cancel
                    </button>
                )}
            </div>
        </div>
    );
}
