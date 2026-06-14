'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { CategoryIcon } from '@/components/icons';
import { CATEGORIES } from '@/data/categories';
import { useExpenses } from '@/components/data/ExpensesContext';
import { getDayCategoryBreakdown } from '@/lib/expense-utils';
import { daysInMonth, cn } from '@/lib/utils';
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
// Day Cell
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
    isPreviewing,
    onTap,
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
    isPreviewing: boolean;
    onTap: (day: number, el: HTMLElement) => void;
    onHover: (day: number, el: HTMLElement) => void;
    onLeave: () => void;
}) {
    const cellRef = useRef<HTMLButtonElement>(null);

    // Background follows heat (no special today color)
    let background: string;
    if (viewMode === 'heat' && spent > 0) {
        background = `oklch(${0.97 - intensity * 0.12} ${intensity * 0.14} 88)`;
    } else {
        background = 'var(--color-bg-1)';
    }

    // Text color
    // FIX (dark mode): heat cells are LIGHT in both themes → fixed dark text;
    // list/empty cells use theme ink (which flips white in dark).
    let textColor: string;
    if (viewMode === 'heat' && spent > 0) textColor = '#3a2a14';
    else if (isFuture) textColor = 'var(--color-ink-3)';
    else textColor = 'var(--color-ink-0)';

    const topCat = topCategories[0]?.cat as CategoryKey | undefined;
    const otherCats = topCategories.slice(1, 4);

    return (
        <motion.button
            ref={cellRef}
            type="button"
            onClick={() => cellRef.current && onTap(day, cellRef.current)}
            onMouseEnter={() => cellRef.current && onHover(day, cellRef.current)}
            onMouseLeave={onLeave}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
                opacity: { duration: 0.4, delay: 0.02 * index, ease: [0.16, 1, 0.3, 1] },
                scale: { duration: 0.4, delay: 0.02 * index, ease: [0.16, 1, 0.3, 1] },
            }}
            className={cn(
                // FIX (dark mode): dropped `shine-wrap shine-wrap-gold` — the sweep
                // overflowed the cell (cell is overflow:visible for the today pin),
                // leaving light streaks in dark. The inset-ring + glow below is the
                // hover effect instead.
                "group relative aspect-square rounded-xl flex flex-col items-center justify-center transition-all cursor-pointer p-0 border-0",
                isToday && "z-10"
            )}
            style={{
                background,
                color: textColor,
                border: `1px solid ${isPreviewing
                        ? 'oklch(0.65 0.16 78)'
                        : spent > 0
                            ? 'transparent'
                            : 'var(--color-line-soft)'
                    }`,
                boxShadow: isPreviewing
                    ? '0 8px 20px -6px oklch(0.65 0.16 78 / 0.4), 0 0 0 2px oklch(0.82 0.155 88)'
                    : spent > 0
                        ? '0 1px 2px rgba(60,40,10,0.04)'
                        : 'none',
                outline: 'none',
                zIndex: isToday ? 10 : 1,   
                overflow: 'visible',  
            }}
        >
            
            {/* Static hover ring (subtle) */}
            <div
                className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                style={{
                    boxShadow:
                        'inset 0 0 0 2px oklch(0.65 0.16 78), 0 8px 20px -4px oklch(0.55 0.16 70 / 0.5)',
                }}
            />

            {/* ═══════ Day number ═══════ */}
            {isToday ? (
                <>
                    {/* Gold ring around entire cell */}
                    <div
                        className="absolute inset-0 rounded-xl pointer-events-none"
                        style={{
                            boxShadow:
                                'inset 0 0 0 1px oklch(0.65 0.16 78), 0 0 0 1px oklch(0.85 0.10 88)',
                        }}
                    />
                    {/* Day number with subtle gold underline */}
                    <div className="relative z-20 flex flex-col items-center">
                        <div
                            className="font-bold leading-none transition-all group-hover:scale-110"
                            style={{
                                fontSize: 'clamp(13px, 1.4vw, 16px)',
                                // FIX (dark mode): on heat (light cell) use dark gold;
                                // on list (cell flips dark) use theme ink so it stays visible.
                                color:
                                    viewMode === 'heat' && spent > 0
                                        ? 'oklch(0.40 0.10 60)'
                                        : 'var(--color-ink-0)',
                            }}
                        >
                            {day}
                        </div>
                        <div
                            className="rounded-full mt-0.5"
                            style={{
                                width: 4,
                                height: 4,
                                background: 'oklch(0.65 0.16 78)',
                            }}
                        />
                    </div>
                </>
            ) : (
                <div
                    className="font-semibold leading-none transition-all group-hover:scale-110 relative z-20"
                    style={{ fontSize: 'clamp(13px, 1.4vw, 16px)' }}
                >
                    {day}
                </div>
            )}

            {/* Today corner pin - sticks out on the border */}
            {isToday && (
                <motion.div
                    className="absolute pointer-events-none"
                    style={{
                        top: -7,
                        right: -3,
                        zIndex: 50,
                        transformOrigin: 'bottom center',
                        fontSize: 24,
                        lineHeight: 1,
                        filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3))',
                    }}
                    animate={{ rotate: [1, 25, 1] }}
                    transition={{
                        duration: 2.8,
                        repeat: Infinity,
                        ease: 'easeInOut',
                    }}
                >
                    📍
                </motion.div>
            )}

            {/* ═══════ HEAT VIEW ═══════ */}
            {viewMode === 'heat' && (
                <>
                    {spent > 0 && (
                        <div
                            className="mono mt-1 relative z-20"
                            style={{
                                fontSize: 'clamp(9px, 0.95vw, 11px)',
                                opacity: 0.8,
                                fontWeight: 500,
                            }}
                        >
                            {spent >= 1000
                                ? `${(spent / 1000).toFixed(1)}k`
                                : Math.round(spent)}
                        </div>
                    )}
                    {/* Category dots - now shown for ALL days including today */}
                    {spent > 0 && (
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
                                        opacity: 0.55,
                                    }}
                                />
                            ))}
                        </div>
                    )}
                </>
            )}

            {/* ═══════ LIST VIEW ═══════ */}
            {viewMode === 'list' && spent > 0 && topCat && (
                <>
                    <div
                        className="flex items-center justify-center rounded-lg mt-1.5 relative z-20"
                        style={{
                            width: 'clamp(22px, 2.4vw, 28px)',
                            height: 'clamp(22px, 2.4vw, 28px)',
                            background: `oklch(0.94 0.05 ${CATEGORIES[topCat].hue})`,
                        }}
                    >
                        <CategoryIcon kind={topCat} size={14} variant="filled" />
                    </div>
                    {otherCats.length > 0 && (
                        <div className="flex gap-[3px] mt-1 relative z-20">
                            {otherCats.map((c) => (
                                <div
                                    key={c.cat}
                                    className="rounded-full"
                                    style={{
                                        width: 'clamp(4px, 0.55vw, 5px)',
                                        height: 'clamp(4px, 0.55vw, 5px)',
                                        background: `oklch(0.72 0.13 ${CATEGORIES[c.cat as CategoryKey]?.hue ?? 80
                                            })`,
                                    }}
                                />
                            ))}
                        </div>
                    )}
                </>
            )}
        </motion.button>
    );
}

// ═══════════════════════════════════════════════════════════════
// Category Legend
// ═══════════════════════════════════════════════════════════════

function CategoryLegend() {
    const cats = ['food', 'shop', 'trans', 'ent', 'health', 'bills', 'other'] as CategoryKey[];

    return (
        <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 px-2"
        >
            {cats.map((k) => (
                <div key={k} className="flex items-center gap-1.5">
                    <div
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ background: `oklch(0.72 0.13 ${CATEGORIES[k].hue})` }}
                    />
                    <span className="text-[10px] md:text-[11px] text-ink-2">
                        {CATEGORIES[k].label}
                    </span>
                </div>
            ))}
        </motion.div>
    );
}

// ═══════════════════════════════════════════════════════════════
// Main Calendar View
// ═══════════════════════════════════════════════════════════════

export function CalendarMonthView({
    viewMode,
    filteredExpenses,
}: CalendarMonthViewProps) {
    const { current, expenses } = useExpenses();
    const router = useRouter();
    const containerRef = useRef<HTMLDivElement>(null);

    // Now state holds the actual DOM element (not just coords)
    const [hovered, setHovered] = useState<{ day: number; el: HTMLElement } | null>(null);
    const [pinned, setPinned] = useState<{ day: number; el: HTMLElement } | null>(null);

    // Click outside closes pinned
    useEffect(() => {
        if (!pinned) return;
        const handleClickOutside = (e: MouseEvent | TouchEvent) => {
            const target = e.target as Node;
            if (containerRef.current && !containerRef.current.contains(target)) {
                const previewEl = document.getElementById('day-preview-card');
                if (previewEl && previewEl.contains(target)) return;
                setPinned(null);
            }
        };
        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('touchstart', handleClickOutside);
        }, 100);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, [pinned]);

    useEffect(() => {
        if (!pinned) return;
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setPinned(null);
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [pinned]);

    const handleTap = (day: number, el: HTMLElement) => {
        const isDesktop =
            typeof window !== 'undefined' &&
            window.matchMedia('(hover: hover) and (pointer: fine)').matches;

        if (isDesktop) {
            router.push(`/ledger/${day}`);
            return;
        }

        if (pinned && pinned.day === day) {
            router.push(`/ledger/${day}`);
            setPinned(null);
            setHovered(null);
            return;
        }
        setPinned({ day, el });
        setHovered(null);
    };

    const handleHover = (day: number, el: HTMLElement) => {
        if (pinned) return;
        setHovered({ day, el });
    };

    const handleLeave = () => {
        if (pinned) return;
        setHovered(null);
    };

    const activePreview = pinned ?? hovered;

    const days = daysInMonth(current.year, current.month);
    const firstDow = new Date(current.year, current.month - 1, 1).getDay();

    const cells: (number | null)[] = useMemo(() => {
        const result: (number | null)[] = [];
        for (let i = 0; i < firstDow; i++) result.push(null);
        for (let d = 1; d <= days; d++) result.push(d);
        const totalRows = Math.ceil(result.length / 7);
        while (result.length < totalRows * 7) result.push(null);
        return result;
    }, [days, firstDow]);

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
        <div ref={containerRef} className="relative">
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

            <div className="grid grid-cols-7 gap-2 md:gap-2.5">
                {cells.map((d, i) => {
                    if (d === null) return <div key={i} />;
                    const spent = byDay[d] ?? 0;
                    const intensity = Math.min(1, spent / maxSpend);
                    const isToday = d === current.day;
                    const isFuture = d > current.day;
                    const topCategories = getDayCategoryBreakdown(expenses, d);
                    const isPreviewing = pinned?.day === d;

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
                            isPreviewing={isPreviewing}
                            onTap={handleTap}
                            onHover={handleHover}
                            onLeave={handleLeave}
                        />
                    );
                })}
            </div>

            <AnimatePresence>
                {viewMode === 'list' && <CategoryLegend />}
            </AnimatePresence>

            <AnimatePresence>
                {activePreview && (
                    <DayPreviewCard
                        key={activePreview.day}
                        day={activePreview.day}
                        referenceEl={activePreview.el}
                        isPinned={pinned !== null}
                        containerRef={containerRef}
                        onClose={() => {
                            setPinned(null);
                            setHovered(null);
                        }}
                        onNavigate={() => {
                            router.push(`/ledger/${activePreview.day}`);
                            setPinned(null);
                            setHovered(null);
                        }}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}