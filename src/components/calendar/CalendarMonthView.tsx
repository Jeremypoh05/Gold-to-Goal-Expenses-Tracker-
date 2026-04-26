'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { CategoryIcon, CategoryTile } from '@/components/icons';
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
    onTap: (day: number, x: number, y: number) => void;
    onHover: (day: number, x: number, y: number) => void;
    onLeave: () => void;
}) {
    const cellRef = useRef<HTMLButtonElement>(null);

    // Background based on view mode
    let background: string;
    if (isToday) {
        background =
            'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))';
    } else if (viewMode === 'heat' && spent > 0) {
        background = `oklch(${0.97 - intensity * 0.12} ${intensity * 0.14} 88)`;
    } else {
        background = 'var(--color-bg-1)';
    }

    // Text color
    let textColor: string;
    if (isToday) textColor = '#1a120a';
    else if (isFuture) textColor = 'var(--color-ink-3)';
    else textColor = 'var(--color-ink-0)';

    // Top category for List view
    const topCat = topCategories[0]?.cat as CategoryKey | undefined;
    const otherCats = topCategories.slice(1, 4);

    const handleTap = () => {
        if (cellRef.current) {
            const rect = cellRef.current.getBoundingClientRect();
            onTap(day, rect.left + rect.width / 2, rect.top);
        }
    };

    const handleMouseEnter = () => {
        if (cellRef.current) {
            const rect = cellRef.current.getBoundingClientRect();
            onHover(day, rect.left + rect.width / 2, rect.top);
        }
    };

    return (
        <motion.button
            ref={cellRef}
            type="button"
            onClick={handleTap}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={onLeave}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{
                opacity: 1,
                scale: isPreviewing ? 1.05 : 1,
            }}
            transition={{
                opacity: { duration: 0.4, delay: 0.02 * index, ease: [0.16, 1, 0.3, 1] },
                scale: { duration: 0.2, delay: 0, ease: [0.16, 1, 0.3, 1] },
            }}
            className="relative aspect-square rounded-xl flex flex-col items-center justify-center transition-all hover:scale-[1.04] hover:z-10 cursor-pointer p-0 border-0"
            style={{
                background,
                color: textColor,
                border: isToday
                    ? 'none'
                    : `1px solid ${isPreviewing
                        ? 'oklch(0.65 0.16 78)'
                        : spent > 0
                            ? 'transparent'
                            : 'var(--color-line-soft)'
                    }`,
                boxShadow: isToday
                    ? 'var(--shadow-gold)'
                    : isPreviewing
                        ? '0 8px 20px -6px oklch(0.65 0.16 78 / 0.4), 0 0 0 2px oklch(0.82 0.155 88)'
                        : spent > 0
                            ? '0 1px 2px rgba(60,40,10,0.04)'
                            : 'none',
                overflow: 'hidden',
                outline: 'none',
            }}
        >
            {/* Day number */}
            <div
                className="font-semibold leading-none"
                style={{ fontSize: 'clamp(13px, 1.4vw, 16px)' }}
            >
                {day}
            </div>

            {/* ═══════ HEAT VIEW ═══════ */}
            {viewMode === 'heat' && (
                <>
                    {spent > 0 && (
                        <div
                            className="mono mt-1"
                            style={{
                                fontSize: 'clamp(9px, 0.95vw, 11px)',
                                opacity: 0.8,
                                fontWeight: isToday ? 600 : 500,
                            }}
                        >
                            {spent >= 1000
                                ? `${(spent / 1000).toFixed(1)}k`
                                : Math.round(spent)}
                        </div>
                    )}
                    {/* Subtle category dots at bottom */}
                    {spent > 0 && !isToday && (
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
                    {/* Main category icon */}
                    <div
                        className="flex items-center justify-center rounded-lg mt-1.5"
                        style={{
                            width: 'clamp(22px, 2.4vw, 28px)',
                            height: 'clamp(22px, 2.4vw, 28px)',
                            background: `oklch(0.94 0.05 ${CATEGORIES[topCat].hue})`,
                        }}
                    >
                        <CategoryIcon
                            kind={topCat}
                            size={14}
                            variant="filled"
                        />
                    </div>

                    {/* Sub-category dots (if more than 1 category) */}
                    {otherCats.length > 0 && (
                        <div className="flex gap-[3px] mt-1">
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
// Category Legend (shown in List mode)
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
                        style={{
                            background: `oklch(0.72 0.13 ${CATEGORIES[k].hue})`,
                        }}
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
    filter,
    filteredExpenses,
}: CalendarMonthViewProps) {
    const router = useRouter();
    const containerRef = useRef<HTMLDivElement>(null);

    // ═══════════════════════════════════════════════════════════
    // State
    // ═══════════════════════════════════════════════════════════
    // Hover state — desktop only (mouse events)
    const [hovered, setHovered] = useState<{
        day: number;
        x: number;
        y: number;
    } | null>(null);

    // "Sticky" preview state — mobile (and persistent on desktop tap)
    const [pinned, setPinned] = useState<{
        day: number;
        x: number;
        y: number;
    } | null>(null);

    // ═══════════════════════════════════════════════════════════
    // Click-outside-to-close (for pinned preview)
    // ═══════════════════════════════════════════════════════════
    useEffect(() => {
        if (!pinned) return;

        const handleClickOutside = (e: MouseEvent | TouchEvent) => {
            const target = e.target as Node;
            // Don't close if click is inside calendar grid OR inside the preview card
            if (containerRef.current && !containerRef.current.contains(target)) {
                // Check if it's the preview card (it's outside the grid)
                const previewEl = document.getElementById('day-preview-card');
                if (previewEl && previewEl.contains(target)) return;
                setPinned(null);
            }
        };

        // Delay attach so the click that opened it doesn't immediately close it
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

    // ═══════════════════════════════════════════════════════════
    // ESC to close pinned
    // ═══════════════════════════════════════════════════════════
    useEffect(() => {
        if (!pinned) return;
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setPinned(null);
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [pinned]);

    // ═══════════════════════════════════════════════════════════
    // Tap handler: behavior depends on device
    //   Desktop (has hover): tap = navigate immediately
    //   Mobile (no hover):   first tap = pin preview, second = navigate
    // ═══════════════════════════════════════════════════════════
    const handleTap = (day: number, x: number, y: number) => {
        // Detect if device has fine pointer (mouse) — desktop
        const isDesktop =
            typeof window !== 'undefined' &&
            window.matchMedia('(hover: hover) and (pointer: fine)').matches;

        if (isDesktop) {
            // Desktop: click = navigate immediately (intuitive)
            router.push(`/ledger/${day}`);
            return;
        }

        // Mobile: two-step
        if (pinned && pinned.day === day) {
            // Second tap on same day → navigate
            router.push(`/ledger/${day}`);
            setPinned(null);
            setHovered(null);
            return;
        }
        // First tap → pin preview
        setPinned({ day, x, y });
        setHovered(null);
    };

    const handleHover = (day: number, x: number, y: number) => {
        // Don't change hover if pinned (pinned takes priority)
        if (pinned) return;
        setHovered({ day, x, y });
    };

    const handleLeave = () => {
        if (pinned) return;
        setHovered(null);
    };

    // Active preview = pinned (priority) OR hovered (desktop)
    const activePreview = pinned ?? hovered;

    // ═══════════════════════════════════════════════════════════
    // Calendar grid math
    // ═══════════════════════════════════════════════════════════
    const days = daysInMonth(CURRENT.year, CURRENT.month);
    const firstDow = new Date(CURRENT.year, CURRENT.month - 1, 1).getDay();

    const cells: (number | null)[] = useMemo(() => {
        const result: (number | null)[] = [];
        for (let i = 0; i < firstDow; i++) result.push(null);
        for (let d = 1; d <= days; d++) result.push(d);
        const totalRows = Math.ceil(result.length / 7);
        while (result.length < totalRows * 7) result.push(null);
        return result;
    }, [days, firstDow]);

    // Spending per day from FILTERED expenses
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

            {/* Calendar cells */}
            <div className="grid grid-cols-7 gap-2 md:gap-2.5">
                {cells.map((d, i) => {
                    if (d === null) return <div key={i} />;

                    const spent = byDay[d] ?? 0;
                    const intensity = Math.min(1, spent / maxSpend);
                    const isToday = d === CURRENT.day;
                    const isFuture = d > CURRENT.day;
                    const topCategories = getDayCategoryBreakdown(d);
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

            {/* Category Legend (List mode only) */}
            <AnimatePresence>
                {viewMode === 'list' && <CategoryLegend />}
            </AnimatePresence>

            {/* Preview Card */}
            <AnimatePresence>
                {activePreview && (
                    <DayPreviewCard
                        key={activePreview.day}
                        day={activePreview.day}
                        anchorX={activePreview.x}
                        anchorY={activePreview.y}
                        isPinned={pinned !== null}
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