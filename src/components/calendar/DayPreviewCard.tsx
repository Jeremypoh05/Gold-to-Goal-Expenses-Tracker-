'use client';

import { motion } from 'framer-motion';
import {
    CategoryTile,
    MicIcon,
    ArrowIcon,
} from '@/components/icons';
import { CATEGORIES } from '@/data/categories';
import { getDayPreview, CURRENT } from '@/data/sampleExpenses';
import { formatMoney, WEEKDAYS_SHORT } from '@/lib/utils';

interface DayPreviewCardProps {
    day: number;
    /** Position relative to viewport (anchor point) */
    anchorX: number;
    anchorY: number;
}

export function DayPreviewCard({ day, anchorX, anchorY }: DayPreviewCardProps) {
    const preview = getDayPreview(day);
    const date = new Date(CURRENT.year, CURRENT.month - 1, day);
    const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getDay()];
    const isToday = day === CURRENT.day;

    // Empty state
    if (preview.count === 0) {
        return (
            <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.96 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="fixed pointer-events-none z-50"
                style={{
                    left: anchorX,
                    top: anchorY,
                    transform: 'translate(-50%, calc(-100% - 12px))',
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
                <DownArrow />
            </motion.div>
        );
    }

    // Show top 4 expenses (smaller items)
    const displayExpenses = preview.expenses.slice(0, 4);
    const remainingCount = preview.expenses.length - displayExpenses.length;

    return (
        <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="fixed pointer-events-none z-50"
            style={{
                left: anchorX,
                top: anchorY,
                transform: 'translate(-50%, calc(-100% - 12px))',
            }}
        >
            <div
                className="rounded-2xl overflow-hidden"
                style={{
                    background: 'oklch(0.20 0.015 75)',
                    color: '#fff',
                    boxShadow: '0 16px 40px -8px rgba(0,0,0,0.4)',
                    minWidth: 240,
                    maxWidth: 280,
                }}
            >
                {/* Header */}
                <div className="px-4 pt-3 pb-2.5">
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

                {/* Divider */}
                <div
                    className="h-px mx-4"
                    style={{ background: 'rgba(255,255,255,0.1)' }}
                />

                {/* Top expenses */}
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

                {/* Footer hint */}
                <div
                    className="px-4 py-2 flex items-center gap-1 text-[10px] opacity-60"
                    style={{ background: 'rgba(255,255,255,0.04)' }}
                >
                    <span>Click to view full day</span>
                    <ArrowIcon direction="right" size={10} />
                </div>
            </div>
            <DownArrow />
        </motion.div>
    );
}

// Tooltip arrow (down-pointing)
function DownArrow() {
    return (
        <svg
            width="12"
            height="7"
            viewBox="0 0 12 7"
            className="mx-auto"
            style={{ display: 'block', marginTop: -1 }}
        >
            <path d="M0 0 L6 7 L12 0 Z" fill="oklch(0.20 0.015 75)" />
        </svg>
    );
}