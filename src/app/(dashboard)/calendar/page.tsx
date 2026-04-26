'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
    MicIcon,
    CalendarIcon,
    ChevronIcon,
} from '@/components/icons';
import { AnimatedNumber } from '@/components/shared/AnimatedNumber';
import { CATEGORIES } from '@/data/categories';
import { SAMPLE_EXPENSES, CURRENT } from '@/data/sampleExpenses';
import { MONTH_NAMES, cn } from '@/lib/utils';
import type { CategoryKey } from '@/types';
import {
    CalendarMonthView,
    type CalendarViewMode,
} from '@/components/calendar/CalendarMonthView';
import { MonthSummary } from '@/components/calendar/MonthSummary';

type FilterId = 'all' | 'voice' | CategoryKey;

interface FilterDef {
    id: FilterId;
    label: string;
    count: number;
    icon?: React.ReactNode;
}

// Filter chips
function FilterChips({
    value,
    onChange,
    filters,
}: {
    value: FilterId;
    onChange: (v: FilterId) => void;
    filters: FilterDef[];
}) {
    return (
        <div className="flex gap-1.5 overflow-x-auto mobile-h-scroll pb-1">
            {filters.map((f) => {
                const isActive = value === f.id;
                const isDisabled = f.count === 0 && f.id !== 'all';

                return (
                    <button
                        key={f.id}
                        onClick={() => !isDisabled && onChange(f.id)}
                        disabled={isDisabled}
                        className={cn(
                            'h-8 px-3.5 rounded-full flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-medium transition-all',
                            isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'
                        )}
                        style={{
                            background: isActive
                                ? 'linear-gradient(135deg, oklch(0.96 0.06 92), oklch(0.88 0.12 88))'
                                : '#fff',
                            border: isActive
                                ? '1px solid oklch(0.80 0.12 88)'
                                : '1px solid var(--color-line-soft)',
                            color: isActive ? 'var(--color-gold-900)' : 'var(--color-ink-1)',
                            boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
                            opacity: isDisabled ? 0.4 : 1,
                        }}
                    >
                        {f.icon}
                        <span>{f.label}</span>
                        <span
                            className="mono text-[10px]"
                            style={{
                                color: isActive ? 'var(--color-gold-700)' : 'var(--color-ink-3)',
                            }}
                        >
                            {f.count}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

// View mode toggle (Heat / List)
function ViewModeToggle({
    value,
    onChange,
}: {
    value: CalendarViewMode;
    onChange: (v: CalendarViewMode) => void;
}) {
    const options: { key: CalendarViewMode; label: string; icon: React.ReactNode }[] = [
        {
            key: 'heat',
            label: 'Heat',
            icon: (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="3" y="3" width="8" height="8" rx="1.5" opacity="0.7" />
                    <rect x="13" y="3" width="8" height="8" rx="1.5" opacity="0.4" />
                    <rect x="3" y="13" width="8" height="8" rx="1.5" opacity="1" />
                    <rect x="13" y="13" width="8" height="8" rx="1.5" opacity="0.55" />
                </svg>
            ),
        },
        {
            key: 'list',
            label: 'List',
            icon: (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M3 6 H21 M3 12 H21 M3 18 H21" />
                </svg>
            ),
        },
    ];

    return (
        <div className="inline-flex bg-bg-2 p-[3px] rounded-full gap-[2px]">
            {options.map(({ key, label, icon }) => (
                <button
                    key={key}
                    onClick={() => onChange(key)}
                    className={cn(
                        'h-[30px] px-3 rounded-full text-xs font-medium cursor-pointer transition-all flex items-center gap-1.5',
                        value === key
                            ? 'bg-white text-ink-0 shadow-sm'
                            : 'bg-transparent text-ink-1 hover:text-ink-0'
                    )}
                >
                    {icon}
                    <span>{label}</span>
                </button>
            ))}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
// Main Calendar Page
// ═══════════════════════════════════════════════════════════════

export default function CalendarPage() {
    const [viewMode, setViewMode] = useState<CalendarViewMode>('heat');
    const [filter, setFilter] = useState<FilterId>('all');

    const monthName = MONTH_NAMES[CURRENT.month - 1];

    // Apply filter
    const filteredExpenses = useMemo(() => {
        if (filter === 'all') return SAMPLE_EXPENSES;
        if (filter === 'voice') return SAMPLE_EXPENSES.filter((t) => t.voice);
        return SAMPLE_EXPENSES.filter((t) => t.cat === filter);
    }, [filter]);

    // Filter definitions with dynamic counts
    const filters: FilterDef[] = useMemo(() => {
        const countCat = (cat: CategoryKey) =>
            SAMPLE_EXPENSES.filter((t) => t.cat === cat).length;

        return [
            { id: 'all', label: 'All', count: SAMPLE_EXPENSES.length },
            {
                id: 'voice',
                label: 'Voice',
                count: SAMPLE_EXPENSES.filter((t) => t.voice).length,
                icon: <MicIcon size={11} />,
            },
            { id: 'food', label: 'Food', count: countCat('food') },
            { id: 'shop', label: 'Shopping', count: countCat('shop') },
            { id: 'trans', label: 'Transport', count: countCat('trans') },
            { id: 'bills', label: 'Bills', count: countCat('bills') },
            { id: 'ent', label: 'Entertainment', count: countCat('ent') },
            { id: 'health', label: 'Health', count: countCat('health') },
        ];
    }, []);

    // Effective filter (fallback to 'all' if 0 count)
    const effectiveFilter: FilterId = useMemo(() => {
        if (filter === 'all') return 'all';
        const current = filters.find((f) => f.id === filter);
        if (current && current.count === 0) return 'all';
        return filter;
    }, [filter, filters]);

    const filteredTotal = filteredExpenses.reduce((a, b) => a + b.amt, 0);

    return (
        <div className="px-4 md:px-8 py-5 md:py-7 pb-16 max-w-[1320px] mx-auto flex flex-col gap-5 md:gap-6">
            {/* Header */}
            <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="flex flex-col md:flex-row md:items-end gap-3"
            >
                <div className="flex-1 min-w-0">
                    <div className="text-[10px] md:text-[11px] text-gold-900 uppercase tracking-[0.14em] font-semibold">
                        Calendar · {monthName} {CURRENT.year}
                    </div>
                    <h1
                        className="display mt-0.5 md:mt-1"
                        style={{ fontSize: 'clamp(28px, 5vw, 44px)', lineHeight: 1.05 }}
                    >
                        <AnimatedNumber value={filteredExpenses.length} format="integer" duration={1000} />{' '}
                        <span className="text-ink-2 font-medium">
                            {filteredExpenses.length === 1 ? 'entry' : 'entries'}
                        </span>
                        <span className="text-ink-3 font-light mx-2">/</span>
                        <span style={{ color: 'var(--color-gold-700)' }}>
                            −<AnimatedNumber value={filteredTotal} format="money" duration={1200} />
                        </span>
                    </h1>
                    <div className="text-[12px] md:text-[13px] text-ink-2 mt-1">
                        <span className="hidden md:inline">Hover any day to preview · click to view full breakdown</span>
                        <span className="md:hidden">Tap a day to preview · tap again to view full breakdown</span>
                    </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    <ViewModeToggle value={viewMode} onChange={setViewMode} />
                </div>
            </motion.div>

            {/* Filter chips */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.1 }}
            >
                <FilterChips value={effectiveFilter} onChange={setFilter} filters={filters} />
            </motion.div>

            {/* Main grid: Calendar + Side panel */}
            <div className="grid gap-5 md:gap-6 grid-cols-1 lg:[grid-template-columns:1.4fr_1fr]">
                {/* Calendar */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
                    className="rounded-3xl bg-white p-5 md:p-7"
                    style={{ border: '1px solid var(--color-line-soft)' }}
                >
                    <CalendarMonthView
                        viewMode={viewMode}
                        filter={effectiveFilter}
                        filteredExpenses={filteredExpenses}
                    />

                    {/* Legend (only for heat mode) */}
                    {viewMode === 'heat' && (
                        <div className="mt-5 flex items-center gap-3 text-[10px] text-ink-2 justify-center">
                            <span>Less spend</span>
                            <div className="flex gap-1">
                                {[0.1, 0.3, 0.55, 0.8, 1].map((i) => (
                                    <div
                                        key={i}
                                        className="w-4 h-4 rounded"
                                        style={{
                                            background: `oklch(${0.97 - i * 0.12} ${i * 0.14} 88)`,
                                            border: '1px solid var(--color-line-soft)',
                                        }}
                                    />
                                ))}
                            </div>
                            <span>More</span>
                        </div>
                    )}
                </motion.div>

                {/* Side panel - month summary */}
                <MonthSummary />
            </div>
        </div>
    );
}