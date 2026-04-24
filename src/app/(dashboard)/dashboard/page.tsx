'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
    CategoryTile,
    SparkleIcon,
    MicIcon,
    ArrowIcon,
    ChevronIcon,
    BellIcon,
} from '@/components/icons';
import { MonthBars, Donut, CalendarGrid } from '@/components/shared';
import {
    AnimatedNumber,
    AnimatedHeroAmount,
} from '@/components/shared/AnimatedNumber';
import { CATEGORIES } from '@/data/categories';
import {
    SAMPLE_EXPENSES,
    EXPENSES_BY_CATEGORY,
    TOTAL_SPENT,
    CURRENT,
} from '@/data/sampleExpenses';
import { formatMoney, MONTH_NAMES, cn } from '@/lib/utils';
import { useGreeting } from '@/hooks/useGreeting';
import type { CategoryKey } from '@/types';

// ═══════════════════════════════════════════════════════════════
// Mobile Tab type
// ═══════════════════════════════════════════════════════════════

type MobileSection = 'overview' | 'categories' | 'calendar' | 'savings';

const MOBILE_TABS: { key: MobileSection; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'categories', label: 'Categories' },
    { key: 'calendar', label: 'Calendar' },
    { key: 'savings', label: 'Savings' },
];

// ═══════════════════════════════════════════════════════════════
// Helper components
// ═══════════════════════════════════════════════════════════════

function CardHeader({
    title,
    subtitle,
    right,
}: {
    title: string;
    subtitle?: string;
    right?: React.ReactNode;
}) {
    return (
        <div className="flex items-start gap-3">
            <div className="flex-1">
                <div className="display text-[20px]">{title}</div>
                {subtitle && (
                    <div className="text-xs text-ink-2 mt-0.5">{subtitle}</div>
                )}
            </div>
            {right}
        </div>
    );
}

function MiniStat({
    label,
    value,
    sub,
    accent = false,
    delay = 0,
}: {
    label: string;
    value: number;
    sub: string;
    accent?: boolean;
    delay?: number;
}) {
    return (
        <div
            className="flex items-center gap-3 px-3 py-2 rounded-xl"
            style={{
                background: accent
                    ? 'linear-gradient(135deg, oklch(0.96 0.05 92), oklch(0.90 0.10 88))'
                    : 'var(--color-bg-1)',
                border: accent ? '1px solid oklch(0.86 0.08 88)' : 'none',
            }}
        >
            <div className="flex-1">
                <div className="text-[11px] text-ink-2 uppercase tracking-[0.06em]">
                    {label}
                </div>
                <div className="mono text-sm font-semibold mt-0.5">
                    <AnimatedNumber value={value} format="money" duration={1800} delay={delay} />
                </div>
            </div>
            <div className="text-[10px] text-ink-2">{sub}</div>
        </div>
    );
}

type FilterMode = 'all' | 'voice' | 'manual';

function SegmentedControl({
    value,
    onChange,
}: {
    value: FilterMode;
    onChange: (v: FilterMode) => void;
}) {
    const options: { key: FilterMode; label: string }[] = [
        { key: 'all', label: 'All' },
        { key: 'voice', label: 'Voice' },
        { key: 'manual', label: 'Manual' },
    ];

    return (
        <div className="inline-flex bg-bg-2 p-[3px] rounded-full gap-[2px]">
            {options.map(({ key, label }) => (
                <button
                    key={key}
                    onClick={() => onChange(key)}
                    className={cn(
                        'h-[30px] px-[14px] rounded-full text-xs font-medium cursor-pointer transition-all',
                        value === key
                            ? 'bg-white text-ink-0 shadow-sm'
                            : 'bg-transparent text-ink-1 hover:text-ink-0'
                    )}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}

function MobileTabs({
    value,
    onChange,
}: {
    value: MobileSection;
    onChange: (v: MobileSection) => void;
}) {
    return (
        <div className="flex gap-2 overflow-x-auto mobile-h-scroll px-1 -mx-1">
            {MOBILE_TABS.map(({ key, label }) => (
                <button
                    key={key}
                    onClick={() => onChange(key)}
                    className={cn(
                        'flex-shrink-0 px-4 h-9 rounded-full text-sm font-medium cursor-pointer transition-all',
                        value === key
                            ? 'bg-ink-0 text-white shadow-sm'
                            : 'bg-bg-2 text-ink-1 hover:bg-bg-card'
                    )}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}

function FloatingVoiceButton() {
    return (
        <button
            className="hidden md:flex fixed bottom-8 right-8 z-30 w-14 h-14 rounded-full items-center justify-center cursor-pointer transition-all hover:scale-105 pulse"
            style={{
                background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.64 0.155 75))',
                boxShadow: '0 12px 32px -6px oklch(0.65 0.16 78 / 0.55), 0 0 0 4px rgba(255,255,255,0.4)',
                border: 'none',
            }}
            aria-label="Quick voice log"
        >
            <MicIcon size={24} className="text-[#1a120a]" />
        </button>
    );
}

// ═══════════════════════════════════════════════════════════════
// Mobile Greeting Header
// ═══════════════════════════════════════════════════════════════

// function MobileGreetingHeader() {
//     const greeting = useGreeting('Amelia');

//     return (
//         <motion.header
//             initial={{ opacity: 0, y: -10 }}
//             animate={{ opacity: 1, y: 0 }}
//             transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
//             className="flex items-center gap-3 mb-4"
//         >
//             <div
//                 className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-semibold flex-shrink-0"
//                 style={{
//                     background: 'oklch(0.85 0.10 40)',
//                     color: '#5a2a10',
//                 }}
//             >
//                 AC
//             </div>
//             <div className="flex-1 min-w-0">
//                 <div className="text-[11px] text-ink-2">{greeting.emoji} {greeting.text.split(',')[0]}</div>
//                 <div className="font-semibold text-ink-0 truncate">Amelia</div>
//             </div>
//             <button
//                 className="w-10 h-10 rounded-xl border border-line-soft bg-white flex items-center justify-center flex-shrink-0 relative"
//                 aria-label="Notifications"
//             >
//                 <BellIcon size={18} className="text-ink-1" />
//                 <div
//                     className="absolute top-2 right-2 w-2 h-2 rounded-full bg-gold-500"
//                     style={{ border: '2px solid white' }}
//                 />
//             </button>
//         </motion.header>
//     );
// }

// ═══════════════════════════════════════════════════════════════
// Hero Spend Card (responsive: padding/sizes change)
// ═══════════════════════════════════════════════════════════════

function HeroSpendCard() {
    const monthName = MONTH_NAMES[CURRENT.month - 1];
    const spentLeft = 3500 - TOTAL_SPENT;
    const dailyAvg = TOTAL_SPENT / CURRENT.day;
    const budgetPct = (TOTAL_SPENT / 3500) * 100;

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-[24px] md:rounded-[32px] px-5 md:px-8 py-6 md:py-7 relative overflow-hidden"
            style={{
                // ═══════ Layered gradient for premium depth ═══════
                background: `
          radial-gradient(ellipse at top right, oklch(0.92 0.13 92) 0%, transparent 50%),
          radial-gradient(ellipse at bottom left, oklch(0.88 0.10 78) 0%, transparent 60%),
          linear-gradient(135deg,
            oklch(0.96 0.06 92) 0%,
            oklch(0.88 0.13 88) 50%,
            oklch(0.78 0.16 80) 100%
          )
        `,
                boxShadow: `
          0 1px 0 rgba(255, 255, 255, 0.5) inset,
          0 24px 48px -12px oklch(0.65 0.16 75 / 0.35),
          0 8px 16px -4px oklch(0.65 0.16 75 / 0.18)
        `,
                border: '1px solid oklch(0.88 0.10 88 / 0.6)',
            }}
        >
            {/* ═══════ Decorative orbs (the "wow" circles) ═══════ */}
            <div
                className="absolute pointer-events-none"
                style={{
                    right: -80,
                    top: -80,
                    width: 240,
                    height: 240,
                    borderRadius: '50%',
                    background: 'oklch(0.95 0.08 90)',
                    opacity: 0.55,
                    filter: 'blur(2px)',
                }}
            />
            <div
                className="absolute pointer-events-none"
                style={{
                    right: -120,
                    bottom: -140,
                    width: 320,
                    height: 320,
                    borderRadius: '50%',
                    background: 'oklch(0.85 0.12 80)',
                    opacity: 0.4,
                    filter: 'blur(4px)',
                }}
            />
            {/* Subtle inner shine */}
            <div
                className="absolute pointer-events-none"
                style={{
                    left: '20%',
                    top: -40,
                    width: 200,
                    height: 100,
                    borderRadius: '50%',
                    background: 'oklch(0.99 0.02 92)',
                    opacity: 0.5,
                    filter: 'blur(40px)',
                }}
            />

            {/* ═══════ Content (z-index above orbs) ═══════ */}
            <div className="relative z-10">
                <div className="flex items-baseline gap-2 md:gap-3 flex-wrap">
                    <div className="text-[10px] md:text-[11px] text-gold-900 uppercase tracking-[0.14em] font-semibold">
                        {monthName} spend
                    </div>
                    <div
                        className="chip"
                        style={{
                            background: 'rgba(255,255,255,0.7)',
                            color: 'var(--color-gold-900)',
                            backdropFilter: 'blur(8px)',
                        }}
                    >
                        <ArrowIcon direction="down" size={12} className="text-gold-700" />
                        <span className="mono">12.4%</span>
                        <span className="ml-1">vs Mar</span>
                    </div>
                </div>

                {/* Big animated number */}
                <div
                    className="display-number mt-2.5"
                    style={{
                        fontSize: 'clamp(44px, 9vw, 72px)',
                        color: '#2a1805',
                        textShadow: '0 1px 0 rgba(255, 255, 255, 0.4)',
                    }}
                >
                    <AnimatedHeroAmount
                        value={TOTAL_SPENT}
                        duration={1800}
                        delay={300}
                        symbolSize="0.45em"
                        numberSize="1em"
                    />
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-1 md:gap-6 mt-2.5 text-xs" style={{ color: 'var(--color-gold-900)' }}>
                    <div>
                        <b className="mono">{formatMoney(spentLeft)}</b> left · budget S$3,500
                    </div>
                    <div className="mono opacity-60 hidden md:inline">—</div>
                    <div>
                        Daily avg <b className="mono">{formatMoney(dailyAvg)}</b>
                    </div>
                </div>

                {/* 30-day chart */}
                <div className="mt-5 md:mt-6 text-gold-700 mobile-h-scroll">
                    <MonthBars width={680} height={96} />
                </div>
            </div>

            {/* Budget ring (top right) */}
            <div className="absolute top-4 md:top-6 right-4 md:right-6 flex flex-col items-end gap-1.5 z-10">
                <div
                    className="w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center"
                    style={{
                        background: 'rgba(255, 255, 255, 0.85)',
                        backdropFilter: 'blur(8px)',
                        boxShadow: '0 4px 12px -2px oklch(0.65 0.16 75 / 0.25)',
                    }}
                >
                    <svg width="28" height="28" viewBox="0 0 60 60">
                        <circle
                            cx="30"
                            cy="30"
                            r="26"
                            fill="none"
                            stroke="rgba(255,255,255,0.5)"
                            strokeWidth="5"
                        />
                        <motion.circle
                            cx="30"
                            cy="30"
                            r="26"
                            fill="none"
                            stroke="oklch(0.55 0.16 70)"
                            strokeWidth="5"
                            strokeDasharray="999 999"
                            strokeDashoffset={999}
                            transform="rotate(-90 30 30)"
                            strokeLinecap="round"
                            initial={{ strokeDashoffset: 999 }}
                            animate={{
                                strokeDashoffset: 999 - (budgetPct / 100) * 163.4,
                            }}
                            transition={{ duration: 1.5, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
                        />
                    </svg>
                </div>
                <div className="mono text-[10px] font-semibold" style={{ color: 'var(--color-gold-900)' }}>
                    {Math.round(budgetPct)}% used
                </div>
            </div>
        </motion.div>
    );
}

// ═══════════════════════════════════════════════════════════════
// Voice CTA Card
// ═══════════════════════════════════════════════════════════════

function VoiceCTACard() {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-[24px] md:rounded-[32px] p-5 md:p-7 relative overflow-hidden flex flex-col justify-between"
            style={{
                background: `
          radial-gradient(ellipse at top left, rgba(255, 255, 255, 0.95) 0%, transparent 50%),
          linear-gradient(160deg,
            #ffffff 0%,
            oklch(0.98 0.015 80) 100%
          )
        `,
                border: '1px solid var(--color-line)',
                boxShadow: `
          0 1px 0 rgba(255, 255, 255, 0.8) inset,
          0 16px 40px -12px rgba(60, 40, 10, 0.12),
          0 4px 12px -4px rgba(60, 40, 10, 0.06)
        `,
            }}
        >
            {/* Subtle decorative blob */}
            <div
                className="absolute pointer-events-none"
                style={{
                    right: -60,
                    bottom: -60,
                    width: 180,
                    height: 180,
                    borderRadius: '50%',
                    background: 'oklch(0.93 0.07 88)',
                    opacity: 0.5,
                    filter: 'blur(20px)',
                }}
            />

            <div className="relative z-10">
                <div className="flex items-center gap-1.5 text-gold-700 text-[10px] md:text-[11px] uppercase tracking-[0.14em] font-semibold">
                    <SparkleIcon size={12} className="text-gold-600" />
                    AI logging
                </div>
                <div
                    className="display mt-2.5"
                    style={{
                        fontSize: 'clamp(22px, 4vw, 28px)',
                        lineHeight: 1.1,
                    }}
                >
                    Just say it.
                    <br />
                    <span className="text-ink-2">I&apos;ll write it down.</span>
                </div>
                <p className="text-xs leading-[1.55] text-ink-1 mt-3">
                    &ldquo;早餐吃了5块&rdquo; · &ldquo;Grab 到机场 28&rdquo; · &ldquo;Shopping at Uniqlo 148&rdquo; — I categorize, amount, and remember your style.
                </p>
            </div>

            <button
                className="relative z-10 flex items-center gap-3 md:gap-3.5 border-0 py-3 md:py-4 px-3 md:px-4 rounded-[18px] md:rounded-[20px] w-full cursor-pointer mt-4 md:mt-5 transition-all hover:brightness-[1.02] hover:scale-[1.01]"
                style={{
                    background: 'linear-gradient(135deg, oklch(0.94 0.08 92), oklch(0.82 0.15 85))',
                    boxShadow: `
            0 1px 0 rgba(255, 255, 255, 0.5) inset,
            0 8px 24px -6px oklch(0.65 0.16 75 / 0.45)
          `,
                }}
            >
                <div
                    className="pulse w-10 h-10 md:w-11 md:h-11 rounded-full flex items-center justify-center relative flex-shrink-0"
                    style={{
                        background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.55 0.16 70))',
                        boxShadow: '0 4px 8px -2px oklch(0.55 0.16 70 / 0.4)',
                    }}
                >
                    <MicIcon size={20} className="text-[#1a120a]" />
                </div>
                <div className="text-left flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-[#1a120a]">
                        Start voice logging
                    </div>
                    <div className="text-[11px] text-gold-900" style={{ opacity: 0.7 }}>
                        ⌘ + space · from anywhere
                    </div>
                </div>
                <ArrowIcon direction="right" size={18} className="text-[#1a120a] flex-shrink-0" />
            </button>
        </motion.div>
    );
}

// ═══════════════════════════════════════════════════════════════
// Categories Card
// ═══════════════════════════════════════════════════════════════

function CategoriesCard({ delay = 0.15 }: { delay?: number }) {
    const monthName = MONTH_NAMES[CURRENT.month - 1];

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
            className="glass rounded-3xl p-5 md:p-6 bg-white"
            style={{ border: '1px solid var(--color-line-soft)' }}
        >
            <CardHeader title="Categories" subtitle={`Where ${monthName} went`} />
            <div className="flex flex-col sm:flex-row md:flex-col lg:flex-row gap-4 items-center mt-4">                <Donut size={160} thickness={20} />
                <div className="flex-1 w-full flex flex-col gap-2.5 min-w-0">
                    {(Object.entries(EXPENSES_BY_CATEGORY) as [CategoryKey, number][])
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 5)
                        .map(([k, v], i) => {
                            const pct = (v / TOTAL_SPENT) * 100;
                            return (
                                <motion.div
                                    key={k}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ duration: 0.4, delay: delay + 0.4 + i * 0.08 }}
                                    className="flex items-center gap-2.5"
                                >
                                    <CategoryTile kind={k} size={30} variant="filled" />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between text-xs">
                                            <span className="font-medium">
                                                {CATEGORIES[k].label}
                                            </span>
                                            <span className="mono">{formatMoney(v)}</span>
                                        </div>
                                        <div className="h-[3px] bg-bg-2 rounded-[3px] mt-1 overflow-hidden">
                                            <motion.div
                                                className="h-full"
                                                initial={{ width: 0 }}
                                                animate={{ width: `${pct}%` }}
                                                transition={{
                                                    duration: 1,
                                                    delay: delay + 0.5 + i * 0.08,
                                                    ease: [0.16, 1, 0.3, 1],
                                                }}
                                                style={{
                                                    background: `oklch(0.78 0.12 ${CATEGORIES[k].hue})`,
                                                }}
                                            />
                                        </div>
                                    </div>
                                </motion.div>
                            );
                        })}
                </div>
            </div>
        </motion.div>
    );
}

// ═══════════════════════════════════════════════════════════════
// Calendar Card
// ═══════════════════════════════════════════════════════════════

function CalendarCard({ delay = 0.2 }: { delay?: number }) {
    const monthName = MONTH_NAMES[CURRENT.month - 1];

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
            className="glass rounded-3xl p-5 md:p-6 bg-white"
            style={{ border: '1px solid var(--color-line-soft)' }}
        >
            <CardHeader
                title={`${monthName} at a glance`}
                subtitle="30-day grid · tap a day to edit"
                right={<span className="chip">S$ heat</span>}
            />
            <div className="mt-4">
                <CalendarGrid />
            </div>
        </motion.div>
    );
}

// ═══════════════════════════════════════════════════════════════
// Net Savings Card
// ═══════════════════════════════════════════════════════════════

function NetSavingsCard({
    delay = 0.25,
    spanFull = false,
}: {
    delay?: number;
    spanFull?: boolean;
}) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
                'glass rounded-3xl p-5 md:p-6',
                spanFull && 'md:col-span-2 lg:col-span-1'
            )}
            style={{
                border: '1px solid var(--color-line-soft)',
                background: 'linear-gradient(160deg, #fff, oklch(0.97 0.02 92))',
            }}
        >
            <CardHeader title="Net savings" subtitle="Year to date" />
            <div className="display-number mt-4" style={{ fontSize: 44 }}>
                <span
                    style={{
                        fontSize: 20,
                        verticalAlign: '0.4em',
                        color: 'var(--color-ink-2)',
                        marginRight: 4,
                    }}
                >
                    S$
                </span>
                <AnimatedNumber value={42360} format="integer" duration={2000} delay={delay * 1000} />
            </div>
            <div className="text-xs text-ink-1 mt-1.5">
                <span className="text-gold-700 font-semibold">+ S$4,680</span> vs last year
            </div>
            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
                <MiniStat label="Income" value={86400} sub="salary × 12" delay={500} />
                <MiniStat label="Bonuses" value={10000} sub="2 × Q1, Q2" delay={650} />
                <MiniStat label="Expenses" value={44040} sub="YTD total" delay={800} />
                <MiniStat label="Goal" value={60000} sub="year-end" accent delay={950} />
            </div>
        </motion.div>
    );
}

// ═══════════════════════════════════════════════════════════════
// Recent Transactions
// ═══════════════════════════════════════════════════════════════

function RecentTransactions({ filter, setFilter }: {
    filter: FilterMode;
    setFilter: (v: FilterMode) => void;
}) {
    const filteredExpenses = SAMPLE_EXPENSES.filter((t) => {
        if (filter === 'voice') return t.voice === true;
        if (filter === 'manual') return !t.voice;
        return true;
    }).slice(0, 8);

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="glass rounded-3xl bg-white overflow-hidden"
            style={{ border: '1px solid var(--color-line-soft)' }}
        >
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 md:p-5 md:px-6">
                <div>
                    <div className="display text-[20px] md:text-[22px]">Recent</div>
                    <div className="text-xs text-ink-2">{filteredExpenses.length} entries</div>
                </div>
                <div className="hidden sm:block flex-1" />
                <div className="flex items-center gap-2 flex-wrap">
                    <SegmentedControl value={filter} onChange={setFilter} />
                    <button className="flex items-center gap-1.5 border border-line bg-white py-2 px-3 md:px-4 rounded-full text-sm hover:border-ink-2 transition-all">
                        <span className="hidden sm:inline">View ledger</span>
                        <span className="sm:hidden">All</span>
                        <ChevronIcon direction="right" size={14} />
                    </button>
                </div>
            </div>

            {/* Desktop table */}
            <div className="hidden md:block">
                <table className="tbl w-full">
                    <thead>
                        <tr>
                            <th>Note</th>
                            <th className="hidden lg:table-cell" style={{ width: 140 }}>Category</th>
                            <th style={{ width: 80, whiteSpace: 'nowrap' }}>Date</th>
                            <th className="hidden lg:table-cell" style={{ width: 110 }}>Source</th>
                            <th style={{ width: 120, textAlign: 'right' }}>Amount</th>
                            <th style={{ width: 36 }}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredExpenses.map((t) => (
                            <tr key={t.id} className="cursor-pointer">
                                <td>
                                    <div className="flex items-center gap-3">
                                        <CategoryTile kind={t.cat} size={36} variant="filled" />
                                        <div className="min-w-0">
                                            <div className="font-medium text-ink-0 truncate">{t.note}</div>
                                            {/* On tablet, show category + voice inline below */}
                                            <div className="text-[11px] text-ink-2 mt-0.5 flex items-center gap-1.5 lg:hidden">
                                                <span
                                                    className="dot"
                                                    style={{
                                                        background: `oklch(0.78 0.12 ${CATEGORIES[t.cat].hue})`,
                                                        width: 6,
                                                        height: 6,
                                                    }}
                                                />
                                                <span>{CATEGORIES[t.cat].label}</span>
                                                <span>·</span>
                                                {t.voice ? (
                                                    <span className="text-gold-700 inline-flex items-center gap-0.5">
                                                        <MicIcon size={10} className="text-gold-700" />
                                                        voice
                                                    </span>
                                                ) : (
                                                    <span>manual</span>
                                                )}
                                                <span>·</span>
                                                <span className="mono">{t.time}</span>
                                            </div>
                                            {/* Desktop only: just the time */}
                                            <div className="text-[11px] text-ink-2 mt-0.5 mono hidden lg:block">{t.time}</div>
                                        </div>
                                    </div>
                                </td>
                                <td className="hidden lg:table-cell">
                                    <span className="chip">
                                        <span className="dot" style={{ background: `oklch(0.78 0.12 ${CATEGORIES[t.cat].hue})` }} />
                                        {CATEGORIES[t.cat].label}
                                    </span>
                                </td>
                                <td className="mono text-sm text-ink-2" style={{ whiteSpace: 'nowrap' }}>
                                    Apr {String(t.day).padStart(2, '0')}
                                </td>
                                <td className="hidden lg:table-cell">
                                    {t.voice ? (
                                        <span className="chip" style={{ background: 'oklch(0.96 0.05 88)', color: 'var(--color-gold-900)' }}>
                                            <MicIcon size={10} className="text-gold-700" />
                                            Voice
                                        </span>
                                    ) : (
                                        <span className="text-xs text-ink-2">Manual</span>
                                    )}
                                </td>
                                <td className="mono text-right font-semibold" style={{ whiteSpace: 'nowrap' }}>
                                    −{formatMoney(t.amt)}
                                </td>
                                <td><ChevronIcon direction="right" size={14} className="text-ink-3" /></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Mobile card list */}
            <div className="md:hidden divide-y divide-line-soft">
                {filteredExpenses.map((t, i) => (
                    <motion.div
                        key={t.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3, delay: 0.4 + i * 0.04 }}
                        className="flex items-center gap-3 px-4 py-3 active:bg-bg-1 cursor-pointer"
                    >
                        <CategoryTile kind={t.cat} size={36} variant="filled" />
                        <div className="flex-1 min-w-0">
                            <div className="font-medium text-ink-0 truncate text-sm">{t.note}</div>
                            <div className="text-[11px] text-ink-2 mt-0.5 flex items-center gap-1.5">
                                {t.voice && (
                                    <span className="text-gold-700 inline-flex items-center gap-0.5">
                                        <MicIcon size={10} className="text-gold-700" />
                                        voice
                                    </span>
                                )}
                                {t.voice && <span>·</span>}
                                <span>Apr {String(t.day).padStart(2, '0')}</span>
                                <span>·</span>
                                <span className="mono">{t.time}</span>
                            </div>
                        </div>
                        <div className="mono text-right font-semibold text-sm whitespace-nowrap">−{formatMoney(t.amt)}</div>
                    </motion.div>
                ))}
            </div>
        </motion.div>
    );
}

// ═══════════════════════════════════════════════════════════════
// Main Dashboard Page
// ═══════════════════════════════════════════════════════════════

export default function DashboardPage() {
    const [filter, setFilter] = useState<FilterMode>('all');
    const [mobileSection, setMobileSection] = useState<MobileSection>('overview');

    return (
        <>
            <div className="px-4 md:px-8 py-5 md:py-7 pb-16 max-w-[1320px] mx-auto flex flex-col gap-4 md:gap-6">
                {/* ───────── Mobile-only greeting ───────── */}
                {/* <div className="md:hidden">
                    <MobileGreetingHeader />
                </div> */}

                {/* ═══════════════════════════════════════════════════
            DESKTOP / TABLET LAYOUT (md+)
            ═══════════════════════════════════════════════════ */}
                <div className="hidden md:flex md:flex-col md:gap-6">
                    {/* Row 1: Hero + Voice CTA */}
                    <div className="grid gap-6 grid-cols-1 lg:[grid-template-columns:1.6fr_1fr]">
                        <HeroSpendCard />
                        <VoiceCTACard />
                    </div>

                    {/* Row 2: Categories + Calendar + Net savings */}
                    <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:[grid-template-columns:1.1fr_1.2fr_1fr]">
                        <CategoriesCard delay={0.15} />
                        <CalendarCard delay={0.2} />
                        <NetSavingsCard delay={0.25} spanFull />
                    </div>

                    {/* Row 3: Recent */}
                    <RecentTransactions filter={filter} setFilter={setFilter} />
                </div>

                {/* ═══════════════════════════════════════════════════
            MOBILE LAYOUT (< md): Compact Hero + Tabs
            ═══════════════════════════════════════════════════ */}
                <div className="md:hidden flex flex-col gap-4">
                    {/* Always shown: Hero + Voice CTA */}
                    <HeroSpendCard />
                    <VoiceCTACard />

                    {/* Section tabs */}
                    <div className="mt-2">
                        <MobileTabs value={mobileSection} onChange={setMobileSection} />
                    </div>

                    {/* Tab content - only one shown at a time */}
                    <div className="min-h-[400px]">
                        {mobileSection === 'overview' && (
                            <RecentTransactions filter={filter} setFilter={setFilter} />
                        )}
                        {mobileSection === 'categories' && <CategoriesCard delay={0} />}
                        {mobileSection === 'calendar' && <CalendarCard delay={0} />}
                        {mobileSection === 'savings' && <NetSavingsCard delay={0} />}
                    </div>
                </div>
            </div>

            <FloatingVoiceButton />
        </>
    );
}