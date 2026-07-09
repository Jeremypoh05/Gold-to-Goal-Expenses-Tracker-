'use client';

// ADDED (AI Suggest module): a compact "Suggested" card — a tappable category pill
// + tappable tag chips + "Apply all". Powers the manual add/edit modal AND (Phase A
// follow-up) the voice Edit view, so both share one component. Presentational only:
// the parent owns the suggestion state (debounced suggestExpenseMeta call) and the
// apply handlers. Hides itself when there's nothing useful to show.

import { motion } from 'framer-motion';
import { SparkleIcon, CategoryTile } from '@/components/icons';
import { TagChip } from './TagChip';
import { CATEGORIES } from '@/data/categories';
import { MAX_TAGS } from '@/lib/expense-utils';
import type { CategoryKey } from '@/types';

export interface AISuggestion {
    category: CategoryKey;
    tags: string[];
}

function CheckIcon({ size = 11 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12 L10 17 L19 7" />
        </svg>
    );
}

export function AISuggestCard({
    suggestion,
    loading,
    category,
    tags,
    onSetCategory,
    onAddTag,
    onApplyAll,
    isMobile,
}: {
    suggestion: AISuggestion | null;
    loading: boolean;
    category: CategoryKey;
    tags: string[];
    onSetCategory: (c: CategoryKey) => void;
    onAddTag: (t: string) => void;
    onApplyAll: () => void;
    isMobile?: boolean;
}) {
    // Nothing to show yet — keep the modal uncluttered.
    if (!loading && !suggestion) return null;

    // Which suggested tags aren't already picked (so tapped ones drop away).
    const freshTags = suggestion ? suggestion.tags.filter((t) => !tags.includes(t)) : [];
    const catMatches = suggestion ? category === suggestion.category : true;
    const atCap = tags.length >= MAX_TAGS;
    // Something left to apply? (either the category differs or there are new tags)
    const canApplyAll = !!suggestion && (!catMatches || freshTags.length > 0);

    return (
        <div
            className="rounded-xl p-3 flex items-start gap-2.5"
            style={{
                background: 'linear-gradient(135deg, var(--grad-soft-a), var(--grad-soft-b))',
                border: '1px dashed oklch(0.85 0.10 88)',
            }}
        >
            <motion.div
                animate={loading ? { scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] } : { scale: 1, opacity: 1 }}
                transition={loading ? { duration: 1.1, repeat: Infinity } : { duration: 0.2 }}
                className="flex-shrink-0 mt-0.5"
            >
                <SparkleIcon size={isMobile ? 14 : 16} className="text-gold-600" />
            </motion.div>

            <div className="flex-1 min-w-0 text-[11px] md:text-xs text-ink-1 leading-snug">
                {loading ? (
                    <span className="text-ink-2">Analyzing your note…</span>
                ) : suggestion ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                        <b className="mr-0.5">Suggested</b>
                        {/* Category pill — tap to apply the suggested category. */}
                        <button
                            type="button"
                            onClick={() => onSetCategory(suggestion.category)}
                            disabled={catMatches}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium transition-all disabled:opacity-60 disabled:cursor-default enabled:hover:brightness-[0.97] enabled:active:scale-95"
                            style={{
                                background: 'var(--color-bg-card)',
                                border: '1px solid var(--color-line)',
                                color: 'var(--color-ink-1)',
                            }}
                            title={catMatches ? 'Category applied' : `Set category to ${CATEGORIES[suggestion.category].label}`}
                        >
                            <CategoryTile kind={suggestion.category} size={14} variant="filled" />
                            {CATEGORIES[suggestion.category].label}
                            {catMatches && <CheckIcon size={11} />}
                        </button>
                        {/* Tag chips — tap each to add it (cap-aware). */}
                        {freshTags.map((t) => (
                            <TagChip
                                key={t}
                                label={t}
                                muted
                                onClick={atCap ? undefined : () => onAddTag(t)}
                            />
                        ))}
                        {!catMatches || freshTags.length > 0 ? (
                            <span className="text-ink-3">· tap to apply</span>
                        ) : (
                            <span className="text-ink-3">· all applied</span>
                        )}
                    </div>
                ) : null}
            </div>

            {canApplyAll && (
                <button
                    type="button"
                    onClick={onApplyAll}
                    className="px-3 h-7 rounded-full text-[10px] md:text-xs font-medium border border-line bg-bg-card hover:border-ink-2 hover:text-gold-700 transition-all flex-shrink-0"
                >
                    Apply all
                </button>
            )}
        </div>
    );
}
