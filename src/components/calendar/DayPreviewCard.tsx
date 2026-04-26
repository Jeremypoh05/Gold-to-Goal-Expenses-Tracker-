'use client';

import { motion } from 'framer-motion';
import { ArrowIcon } from '@/components/icons';
import { CATEGORIES } from '@/data/categories';
import { getDayPreview, CURRENT } from '@/data/sampleExpenses';
import { formatMoney, WEEKDAYS_SHORT } from '@/lib/utils';

interface DayPreviewCardProps {
    day: number;
    anchorX: number;
    anchorY: number;
    isPinned?: boolean;
    onClose?: () => void;
    onNavigate?: () => void;
}

export function DayPreviewCard({
    day,
    anchorX,
    anchorY,
    isPinned = false,
    onClose,
    onNavigate,
}: DayPreviewCardProps) {
    const preview = getDayPreview(day);
    const date = new Date(CURRENT.year, CURRENT.month - 1, day);
    const weekday = [
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
    ][date.getDay()];
    const isToday = day === CURRENT.day;

    // ═══════════════════════════════════════════════════════════
    // Smart positioning
    // ═══════════════════════════════════════════════════════════
    const cardWidth = 280;
    const cardHeight = preview.count === 0 ? 70 : 280;
    const margin = 12;

    // Vertical: flip below if too close to top
    const flipBelow = anchorY < cardHeight + 20;

    // Horizontal: how much to shift card left/right to stay in viewport
    let cardShiftX = 0;
    if (typeof window !== 'undefined') {
        const halfCard = cardWidth / 2;
        if (anchorX - halfCard < margin) {
            // Too close to left → push card right
            cardShiftX = margin - (anchorX - halfCard);
        } else if (anchorX + halfCard > window.innerWidth - margin) {
            // Too close to right → push card left
            cardShiftX = -(anchorX + halfCard - (window.innerWidth - margin));
        }
    }

    // Card final position
    const cardLeft = anchorX + cardShiftX;
    const cardTransform = flipBelow
        ? 'translate(-50%, calc(0% + 12px))'
        : 'translate(-50%, calc(-100% - 12px))';

    // Arrow position — independent of card shift, always anchored to day cell
    const arrowLeft = anchorX;

    // ═══════════════════════════════════════════════════════════
    // Empty state
    // ═══════════════════════════════════════════════════════════
    if (preview.count === 0) {
        return (
            <motion.div
                id="day-preview-card"
                initial={{ opacity: 0, y: flipBelow ? -8 : 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: flipBelow ? -4 : 4, scale: 0.96 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="fixed z-50 pointer-events-none"
                style={{ inset: 0 }}
            >
                {/* Card */}
                <div
                    style={{
                        position: 'absolute',
                        left: cardLeft,
                        top: anchorY,
                        transform: cardTransform,
                        pointerEvents: isPinned ? 'auto' : 'none',
                    }}
                >
                    <div
                        className="rounded-xl px-3.5 py-2.5"
                        style={{
                            background: 'oklch(0.20 0.015 75)',
                            color: '#fff',
                            boxShadow: '0 12px 32px -8px rgba(0,0,0,0.35)',
                            minWidth: 180,
                        }}
                    >
                        <div className="text-[11px] mono opacity-60">
                            Apr {day} · {WEEKDAYS_SHORT[date.getDay()]}
                        </div>
                        <div className="text-xs mt-0.5 opacity-80">No expenses logged</div>
                    </div>
                </div>

                {/* Arrow — independently positioned to anchor */}
                <div
                    style={{
                        position: 'absolute',
                        left: arrowLeft,
                        top: flipBelow ? anchorY + 12 - 6 : anchorY - 12,
                        transform: 'translate(-50%, -50%)',
                    }}
                >
                    {flipBelow ? <UpArrow /> : <DownArrow />}
                </div>
            </motion.div>
        );
    }

    // ═══════════════════════════════════════════════════════════
    // Filled state
    // ═══════════════════════════════════════════════════════════
    const displayExpenses = preview.expenses.slice(0, 4);
    const remainingCount = preview.expenses.length - displayExpenses.length;

    return (
        <motion.div
            id="day-preview-card"
            initial={{ opacity: 0, y: flipBelow ? -8 : 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: flipBelow ? -4 : 4, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="fixed z-50 pointer-events-none"
            style={{ inset: 0 }}
        >
            {/* Card */}
            <div
                style={{
                    position: 'absolute',
                    left: cardLeft,
                    top: anchorY,
                    transform: cardTransform,
                    pointerEvents: isPinned ? 'auto' : 'none',
                }}
            >
                <div
                    className="rounded-2xl overflow-hidden"
                    style={{
                        background: 'oklch(0.20 0.015 75)',
                        color: '#fff',
                        boxShadow: '0 16px 40px -8px rgba(0,0,0,0.4)',
                        minWidth: 240,
                        maxWidth: cardWidth,
                    }}
                >
                    {/* Header */}
                    <div className="px-4 pt-3 pb-2.5 relative">
                        {isPinned && onClose && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    onClose();
                                }}
                                onMouseDown={(e) => e.stopPropagation()}
                                className="absolute top-2 right-2 w-7 h-7 rounded-md flex items-center justify-center opacity-50 hover:opacity-100 hover:bg-white/10 transition-all cursor-pointer border-0 bg-transparent"
                                aria-label="Close preview"
                                type="button"
                            >
                                <svg
                                    width="11"
                                    height="11"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                >
                                    <path d="M6 6 L18 18 M18 6 L6 18" />
                                </svg>
                            </button>
                        )}

                        <div className="text-[11px] mono opacity-60">
                            Apr {day} · {weekday}
                        </div>
                        <div className="flex items-baseline gap-2 mt-0.5">
                            <span className="text-base font-semibold mono">
                                −{formatMoney(preview.total)}
                            </span>
                            {isToday && (
                                <span
                                    className="text-[10px] font-medium uppercase tracking-[0.05em]"
                                    style={{ color: 'oklch(0.85 0.14 88)' }}
                                >
                                    Today
                                </span>
                            )}
                        </div>
                        <div className="text-[11px] opacity-60 mt-0.5">
                            {preview.count} {preview.count === 1 ? 'expense' : 'expenses'}
                            {preview.voiceCount > 0 && (
                                <>
                                    {' '}·{' '}
                                    <span style={{ color: 'oklch(0.85 0.14 88)' }}>
                                        {preview.voiceCount} voice
                                    </span>
                                </>
                            )}
                        </div>
                    </div>

                    <div
                        className="h-px mx-4"
                        style={{ background: 'rgba(255,255,255,0.1)' }}
                    />

                    {/* Expenses */}
                    <div className="px-4 py-2">
                        {displayExpenses.map((t) => (
                            <div key={t.id} className="flex items-center gap-2 py-1">
                                <div
                                    className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
                                    style={{
                                        background: `oklch(0.78 0.12 ${CATEGORIES[t.cat].hue} / 0.25)`,
                                    }}
                                >
                                    <div
                                        className="w-2 h-2 rounded-full"
                                        style={{
                                            background: `oklch(0.78 0.12 ${CATEGORIES[t.cat].hue})`,
                                        }}
                                    />
                                </div>
                                <div className="flex-1 min-w-0 text-[11px] truncate">
                                    {t.note}
                                </div>
                                <div className="mono text-[11px] font-medium opacity-90 whitespace-nowrap">
                                    −{formatMoney(t.amt)}
                                </div>
                            </div>
                        ))}
                        {remainingCount > 0 && (
                            <div className="text-[10px] opacity-50 mt-1">
                                + {remainingCount} more
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    {isPinned && onNavigate ? (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onNavigate();
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            className="w-full px-4 py-2.5 flex items-center justify-center gap-1.5 text-[11px] font-medium border-0 cursor-pointer transition-colors hover:brightness-110"
                            style={{
                                background: 'oklch(0.30 0.02 75)',
                                color: '#fff',
                                pointerEvents: 'auto',
                            }}
                            type="button"
                        >
                            <span>View full day</span>
                            <ArrowIcon direction="right" size={12} />
                        </button>
                    ) : (
                        <div
                            className="px-4 py-2 flex items-center justify-center gap-1 text-[10px] opacity-60"
                            style={{ background: 'rgba(255,255,255,0.04)' }}
                        >
                            <span>Click to view full day</span>
                            <ArrowIcon direction="right" size={10} />
                        </div>
                    )}
                </div>
            </div>

            {/* Arrow — independent position, always anchored to day cell center */}
            <div
                style={{
                    position: 'absolute',
                    left: arrowLeft,
                    top: flipBelow ? anchorY + 12 - 6 : anchorY - 12,
                    transform: 'translate(-50%, -50%)',
                }}
            >
                {flipBelow ? <UpArrow /> : <DownArrow />}
            </div>
        </motion.div>
    );
}

function DownArrow() {
    return (
        <svg width="12" height="7" viewBox="0 0 12 7">
            <path d="M0 0 L6 7 L12 0 Z" fill="oklch(0.20 0.015 75)" />
        </svg>
    );
}

function UpArrow() {
    return (
        <svg width="12" height="7" viewBox="0 0 12 7">
            <path d="M0 7 L6 0 L12 7 Z" fill="oklch(0.20 0.015 75)" />
        </svg>
    );
}