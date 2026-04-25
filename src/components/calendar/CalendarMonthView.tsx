'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { CATEGORIES } from '@/data/categories';
import {
    SAMPLE_EXPENSES,
    CURRENT,
    getDayCategoryBreakdown,
} from '@/data/sampleExpenses';
import { daysInMonth } from '@/lib/utils';
import type { Expense, CategoryKey } from '@/types';
import { DayPreviewCard } from './DayPreviewCard';

export type CalendarViewMode = 'heat' | 'list';
type FilterId = 'all' | 'voice' | CategoryKey;

interface CalendarMonthViewProps {
    viewMode: CalendarViewMode;
    filter: FilterId;
    filteredExpenses: Expense[];
}

// ═══════════════════════════════════════════════════════════════
// Day cell
// ═══════════════════════════════════════════════════════════════

function DayCell({
    day,
    spent,
    intensity,
    isToday,
    isFuture,
    topCategories,
    viewMode,
    index,
    onHover,
    onLeave,
}: {
    day: number;
    spent: number;
    intensity: number;
    isToday: boolean;
    isFuture: boolean;
    topCategories: { cat: string; amount: number }[];
    viewMode: CalendarViewMode;
    index: number;
    onHover: (day: number, x: number, y: number) => void;
    onLeave: () => void;
}) {
    const cellRef = useRef<HTMLAnchorElement>(null);

    // Background based on view mode
    let background: string;
    if (isToday) {
        background =
            'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))';
    } else if (viewMode === 'heat' && spent > 0) {
        // Heat map: color intensity based on spending
        background = `oklch(${0.97 - intensity * 0.12} ${intensity * 0.14} 88)`;
    } else {
        background = 'var(--color-bg-1)';
    }

    // Text color
    let textColor: string;
    if (isToday) textColor = '#1a120a';
    else if (isFuture) textColor = 'var(--color-ink-3)';
    else textColor = 'var(--color-ink-0)';

    const handleMouseEnter = () => {
        if (cellRef.current) {
            const rect = cellRef.current.getBoundingClientRect();
            onHover(day, rect.left + rect.width / 2, rect.top);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
                duration: 0.4,
                delay: 0.02 * index, // Heat reveal stagger
                ease: [0.16, 1, 0.3, 1],
            }}
        >
            <Link
                href={`/ledger/${day}`}
                ref={cellRef}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={onLeave}
                className="relative aspect-square rounded-xl flex flex-col items-center justify-center transition-all hover:scale-[1.04] hover:z-10 group"
                style={{
                    background,
                    color: textColor,
                    border: isToday
                        ? 'none'
                        : `1px solid ${spent > 0 ? 'transparent' : 'var(--color-line-soft)'}`,
                    boxShadow: isToday
                        ? 'var(--shadow-gold)'
                        : spent > 0
                            ? '0 1px 2px rgba(60,40,10,0.04)'
                            : 'none',
                    cursor: 'pointer',
                    overflow: 'hidden',
                }}
            >
                {/* Day number */}
                <div
                    className="font-semibold leading-none"
                    style={{ fontSize: 'clamp(13px, 1.4vw, 16px)' }}
                >
                    {day}
                </div>

                {/* Amount (heat mode) or top category icon (list mode) */}
                {viewMode === 'heat' ? (
                    spent > 0 && (
                        <div
                            className="mono mt-1"
                            style={{
                                fontSize: 'clamp(9px, 0.95vw, 11px)',
                                opacity: 0.75,
                                fontWeight: isToday ? 600 : 500,
                            }}
                        >
                            {spent >= 1000 ? `${Math.round(spent / 100) / 10}k` : Math.round(spent)}
                        </div>
                    )
                ) : (
                    /* List mode: show category dots/icons */
                    spent > 0 && (
                        <div className="flex gap-0.5 mt-1.5 flex-wrap justify-center max-w-full px-1">
                            {topCategories.slice(0, 3).map((c) => (
                                <div
                                    key={c.cat}
                                    className="rounded-full"
                                    style={{
                                        width: 'clamp(4px, 0.5vw, 6px)',
                                        height: 'clamp(4px, 0.5vw, 6px)',
                                        background: `oklch(0.72 0.13 ${CATEGORIES[c.cat as CategoryKey]?.hue ?? 80
                                            })`,
                                    }}
                                />
                            ))}
                        </div>
                    )
                )}

                {/* Heat mode: category dots row at bottom (small, subtle) */}
                {viewMode === 'heat' && spent > 0 && !isToday && (
                    <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex gap-[2px]">
                        {topCategories.slice(0, 4).map((c) => (
                            <div
                                key={c.cat}
                                className="rounded-full"
                                style={{
                                    width: 3,
                                    height: 3,
                                    background: `oklch(0.65 0.12 ${CATEGORIES[c.cat as CategoryKey]?.hue ?? 80
                                        })`,
                                    opacity: 0.6,
                                }}
                            />
                        ))}
                    </div>
                )}
            </Link>
        </motion.div>
    );
}

// ═══════════════════════════════════════════════════════════════
// Main Calendar Month View
// ═══════════════════════════════════════════════════════════════

export function CalendarMonthView({
    viewMode,
    filter,
    filteredExpenses,
}: CalendarMonthViewProps) {
    const [hovered, setHovered] = useState<{
        day: number;
        x: number;
        y: number;
    } | null>(null);

    const days = daysInMonth(CURRENT.year, CURRENT.month);
    const firstDow = new Date(CURRENT.year, CURRENT.month - 1, 1).getDay();

    // Build cell list with leading nulls
    const cells: (number | null)[] = useMemo(() => {
        const result: (number | null)[] = [];
        for (let i = 0; i < firstDow; i++) result.push(null);
        for (let d = 1; d <= days; d++) result.push(d);
        const totalRows = Math.ceil(result.length / 7);
        while (result.length < totalRows * 7) result.push(null);
        return result;
    }, [days, firstDow]);

    // Compute spending per day FROM filtered expenses
    const byDay = useMemo(() => {
        const map: Record<number, number> = {};
        filteredExpenses.forEach((t) => {
            map[t.day] = (map[t.day] ?? 0) + t.amt;
        });
        return map;
    }, [filteredExpenses]);

    const maxSpend = Math.max(...Object.values(byDay), 1);

    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return (
        <div className="relative">
            {/* Day-of-week labels */}
            <div className="grid grid-cols-7 gap-2 md:gap-2.5 mb-2">
                {dayLabels.map((d) => (
                    <div
                        key={d}
                        className="text-center text-[10px] md:text-[11px] font-medium uppercase tracking-[0.1em] text-ink-3 py-1"
                    >
                        {d}
                    </div>
                ))}
            </div>

            {/* Cells grid */}
            <div className="grid grid-cols-7 gap-2 md:gap-2.5">
                {cells.map((d, i) => {
                    if (d === null) return <div key={i} />;

                    const spent = byDay[d] ?? 0;
                    const intensity = Math.min(1, spent / maxSpend);
                    const isToday = d === CURRENT.day;
                    const isFuture = d > CURRENT.day;
                    const topCategories = getDayCategoryBreakdown(d);

                    return (
                        <DayCell
                            key={i}
                            day={d}
                            spent={spent}
                            intensity={intensity}
                            isToday={isToday}
                            isFuture={isFuture}
                            topCategories={topCategories}
                            viewMode={viewMode}
                            index={i}
                            onHover={(day, x, y) => setHovered({ day, x, y })}
                            onLeave={() => setHovered(null)}
                        />
                    );
                })}
            </div>

            {/* Hover preview card */}
            <AnimatePresence>
                {hovered && (
                    <DayPreviewCard
                        key={hovered.day}
                        day={hovered.day}
                        anchorX={hovered.x}
                        anchorY={hovered.y}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}