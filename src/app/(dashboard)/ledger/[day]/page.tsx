'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
    CategoryTile,
    MicIcon,
    ChevronIcon,
    CalendarIcon,
    SparkleIcon,
    ArrowIcon,
} from '@/components/icons';
import { AnimatedNumber } from '@/components/shared/AnimatedNumber';
import { CATEGORIES } from '@/data/categories';
import {
    CURRENT,
    getExpensesForDay,
    getAllExpenseDays,
    getHourlyBuckets,
} from '@/data/sampleExpenses';
import { formatMoney, MONTH_NAMES, cn } from '@/lib/utils';
import type { CategoryKey } from '@/types';

// ═══════════════════════════════════════════════════════════════
// Day Switcher (← Yesterday | Today | Jump)
// ═══════════════════════════════════════════════════════════════

function DaySwitcher({
    day,
    prevDay,
    nextDay,
}: {
    day: number;
    prevDay: number | null;
    nextDay: number | null;
}) {
    const isToday = day === CURRENT.day;

    return (
        <div className="flex bg-bg-2 p-[3px] rounded-full gap-[2px]">
            {prevDay !== null ? (
                <Link
                    href={`/ledger/${prevDay}`}
                    className="h-[30px] px-[12px] rounded-full text-xs font-medium text-ink-1 hover:text-ink-0 inline-flex items-center gap-1 transition-colors"
                >
                    <ChevronIcon direction="left" size={12} />
                    <span className="hidden sm:inline">Apr {prevDay}</span>
                </Link>
            ) : (
                <span className="h-[30px] px-[12px] rounded-full text-xs font-medium text-ink-3 inline-flex items-center gap-1 cursor-not-allowed opacity-40">
                    <ChevronIcon direction="left" size={12} />
                    <span className="hidden sm:inline">—</span>
                </span>
            )}

            <span
                className={cn(
                    'h-[30px] px-[14px] rounded-full text-xs font-medium inline-flex items-center',
                    isToday ? 'bg-white text-ink-0 shadow-sm' : 'text-ink-1'
                )}
            >
                {isToday ? 'Today' : `Apr ${day}`}
            </span>

            {nextDay !== null ? (
                <Link
                    href={`/ledger/${nextDay}`}
                    className="h-[30px] px-[12px] rounded-full text-xs font-medium text-ink-1 hover:text-ink-0 inline-flex items-center gap-1 transition-colors"
                >
                    <span className="hidden sm:inline">Apr {nextDay}</span>
                    <ChevronIcon direction="right" size={12} />
                </Link>
            ) : (
                <span className="h-[30px] px-[12px] rounded-full text-xs font-medium text-ink-3 inline-flex items-center gap-1 cursor-not-allowed opacity-40">
                    <span className="hidden sm:inline">—</span>
                    <ChevronIcon direction="right" size={12} />
                </span>
            )}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
// Hour Timeline Bars (24h)
// ═══════════════════════════════════════════════════════════════

function HourTimeline({ buckets }: { buckets: number[] }) {
    const maxHr = Math.max(...buckets, 1);

    return (
        <div>
            {/* Bars */}
            <div className="flex items-end gap-[2px] h-[60px]">
                {buckets.map((v, h) => (
                    <div
                        key={h}
                        className="flex-1 flex flex-col items-center"
                        title={v > 0 ? `${String(h).padStart(2, '0')}:00 — ${formatMoney(v)}` : `${String(h).padStart(2, '0')}:00 — no spending`}
                    >
                        <motion.div
                            initial={{ height: 0 }}
                            animate={{ height: Math.max(2, (v / maxHr) * 54) }}
                            transition={{ duration: 0.6, delay: h * 0.015, ease: [0.16, 1, 0.3, 1] }}
                            style={{
                                width: '80%',
                                background:
                                    v > 0
                                        ? 'linear-gradient(180deg, oklch(0.82 0.155 88), oklch(0.65 0.145 78))'
                                        : 'var(--color-bg-2)',
                                borderRadius: 4,
                                opacity: v > 0 ? 1 : 0.4,
                            }}
                        />
                    </div>
                ))}
            </div>

            {/* Hour labels (0, 6, 12, 18, 23) */}
            <div className="flex mt-1.5 text-[9px] text-ink-3 mono">
                {[0, 6, 12, 18, 23].map((h, i) => (
                    <div
                        key={h}
                        style={{ flex: i === 4 ? 0 : 1 }}
                    >
                        {String(h).padStart(2, '0')}:00
                    </div>
                ))}
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
// Today Stats Card (gold gradient hero)
// ═══════════════════════════════════════════════════════════════

function TodayStatsCard({
    total,
    entriesCount,
    voiceCount,
    dailyBudget = 116,
    dailyAvg = 68.8,
}: {
    total: number;
    entriesCount: number;
    voiceCount: number;
    dailyBudget?: number;
    dailyAvg?: number;
}) {
    const diff = dailyAvg - total;
    const budgetPct = Math.min(100, (total / dailyBudget) * 100);

    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-[24px] p-6 relative overflow-hidden"
            style={{
                background: `
          radial-gradient(ellipse at top right, oklch(0.92 0.13 92) 0%, transparent 50%),
          linear-gradient(145deg, oklch(0.96 0.06 92), oklch(0.85 0.14 88))
        `,
                boxShadow: '0 12px 32px -8px oklch(0.65 0.16 75 / 0.35)',
                border: '1px solid oklch(0.88 0.10 88 / 0.6)',
            }}
        >
            {/* Decorative blob */}
            <div
                className="absolute pointer-events-none"
                style={{
                    right: -60,
                    bottom: -80,
                    width: 200,
                    height: 200,
                    borderRadius: '50%',
                    background: 'oklch(0.95 0.08 90)',
                    opacity: 0.5,
                    filter: 'blur(20px)',
                }}
            />

            <div className="relative z-10">
                <div className="text-[11px] text-gold-900 uppercase tracking-[0.14em] font-semibold">
                    Spent today
                </div>

                <div
                    className="display-number mt-1"
                    style={{
                        fontSize: 'clamp(38px, 6vw, 50px)',
                        color: '#2a1805',
                        textShadow: '0 1px 0 rgba(255, 255, 255, 0.4)',
                    }}
                >
                    <span style={{ fontSize: '0.45em', color: 'var(--color-gold-700)', marginRight: 4 }}>
                        S$
                    </span>
                    <AnimatedNumber value={total} format="decimal" duration={1500} />
                </div>

                <div className="text-xs text-gold-900 mt-2">
                    {diff > 0 ? (
                        <>
                            <span className="font-semibold mono">↓ {formatMoney(diff)}</span> vs daily avg ·{' '}
                        </>
                    ) : (
                        <>
                            <span className="font-semibold mono">↑ {formatMoney(Math.abs(diff))}</span> vs daily avg ·{' '}
                        </>
                    )}
                    {entriesCount} entries
                    {voiceCount > 0 && ` · ${voiceCount} voice`}
                </div>

                {/* Budget bar */}
                <div className="mt-4 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.55)' }}>
                    <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${budgetPct}%` }}
                        transition={{ duration: 1.4, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
                        className="h-full"
                        style={{
                            background:
                                'linear-gradient(90deg, oklch(0.7 0.155 78), oklch(0.55 0.14 70))',
                        }}
                    />
                </div>
                <div className="flex justify-between mt-1 text-[9px] text-gold-900" style={{ opacity: 0.7 }}>
                    <span>S$0</span>
                    <span>daily budget S${dailyBudget}</span>
                </div>
            </div>
        </motion.div>
    );
}

// ═══════════════════════════════════════════════════════════════
// Today By Category
// ═══════════════════════════════════════════════════════════════

function TodayByCategory({
    byCat,
    entriesCount,
}: {
    byCat: Record<string, number>;
    entriesCount: Record<string, number>;
}) {
    const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]) as [
        CategoryKey,
        number
    ][];

    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-[24px] bg-white p-5 md:p-6"
            style={{ border: '1px solid var(--color-line-soft)' }}
        >
            <div className="display text-[18px] mb-3">Today by category</div>
            <div className="flex flex-col">
                {sorted.map(([k, v], i) => (
                    <motion.div
                        key={k}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.4, delay: 0.3 + i * 0.05 }}
                        className={cn(
                            'flex items-center gap-3 py-2.5',
                            i !== 0 && 'border-t border-line-soft'
                        )}
                    >
                        <CategoryTile kind={k} size={30} variant="filled" />
                        <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-medium">
                                {CATEGORIES[k].label}
                            </div>
                            <div className="text-[10px] text-ink-2">
                                {entriesCount[k]} {entriesCount[k] === 1 ? 'entry' : 'entries'}
                            </div>
                        </div>
                        <div className="mono text-[13px] font-semibold">
                            {formatMoney(v)}
                        </div>
                    </motion.div>
                ))}
                {sorted.length === 0 && (
                    <div className="text-center text-ink-2 text-sm py-6">
                        No expenses on this day.
                    </div>
                )}
            </div>
        </motion.div>
    );
}

// ═══════════════════════════════════════════════════════════════
// AI Summary Card
// ═══════════════════════════════════════════════════════════════

function AISummaryCard({
    total,
    dailyAvg = 68.8,
    monthAvg = 2380,
}: {
    total: number;
    dailyAvg?: number;
    monthAvg?: number;
}) {
    const diff = dailyAvg - total;
    const isUnder = diff > 0;

    // Generate contextual summary
    const summary = isUnder
        ? `Today was a light day. You're ${formatMoney(diff)} under your daily average. If you keep this pace, April ends at ~${formatMoney(monthAvg)} — well under budget.`
        : `Today was a busier day. You're ${formatMoney(Math.abs(diff))} over your daily average. Consider lighter days ahead to stay on budget.`;

    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-[24px] p-5"
            style={{
                background: 'linear-gradient(135deg, #fff, oklch(0.98 0.03 92))',
                border: '1px solid oklch(0.90 0.06 88)',
            }}
        >
            <div className="flex items-center gap-2 mb-2">
                <SparkleIcon size={14} className="text-gold-600" />
                <span className="text-[11px] font-semibold text-gold-900 uppercase tracking-[0.08em]">
                    AI summary
                </span>
            </div>
            <p className="text-xs leading-[1.55] text-ink-1 m-0">{summary}</p>
        </motion.div>
    );
}

// ═══════════════════════════════════════════════════════════════
// Timeline Entry Row (with time gutter + dot)
// ═══════════════════════════════════════════════════════════════

function TimelineEntry({
    time,
    cat,
    note,
    amount,
    voice,
    isLast,
    index,
}: {
    time: string;
    cat: CategoryKey;
    note: string;
    amount: number;
    voice?: boolean;
    isLast: boolean;
    index: number;
}) {
    return (
        <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: 0.4 + index * 0.07 }}
            className={cn(
                'grid items-center gap-3 py-3',
                !isLast && 'border-b border-line-soft'
            )}
            style={{ gridTemplateColumns: '54px 16px 1fr auto' }}
        >
            {/* Time */}
            <div className="mono text-xs text-ink-2 font-medium">{time}</div>

            {/* Time gutter with vertical line + dot */}
            <div className="relative h-10">
                <div
                    className="absolute left-1/2 top-0 bottom-0 -translate-x-1/2 w-px"
                    style={{ background: 'var(--color-line)' }}
                />
                <div
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                    style={{
                        width: 10,
                        height: 10,
                        background: `oklch(0.78 0.12 ${CATEGORIES[cat].hue})`,
                        border: '2px solid #fff',
                        boxShadow: '0 0 0 1px var(--color-line)',
                    }}
                />
            </div>

            {/* Content */}
            <div className="flex items-center gap-2.5 min-w-0">
                <CategoryTile kind={cat} size={36} variant="filled" />
                <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium truncate">{note}</div>
                    <div className="text-[10px] text-ink-2 mt-0.5 flex items-center gap-1.5">
                        <span
                            className="chip"
                            style={{
                                height: 18,
                                fontSize: 9,
                                padding: '0 6px',
                            }}
                        >
                            {CATEGORIES[cat].label}
                        </span>
                        {voice && (
                            <span className="text-gold-700 inline-flex items-center gap-0.5">
                                <MicIcon size={9} className="text-gold-700" />
                                voice
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* Amount */}
            <div className="mono font-semibold text-sm whitespace-nowrap">
                −{formatMoney(amount)}
            </div>
        </motion.div>
    );
}

// ═══════════════════════════════════════════════════════════════
// Main Daily Detail Page
// ═══════════════════════════════════════════════════════════════

export default function DailyDetailPage() {
    const params = useParams();
    const router = useRouter();

    // Parse day from URL
    const dayParam = Array.isArray(params.day) ? params.day[0] : params.day;
    const day = parseInt(dayParam ?? '0', 10);

    // Validate day
    const isValidDay = !isNaN(day) && day >= 1 && day <= 31;
    const dayExpenses = useMemo(
        () => (isValidDay ? getExpensesForDay(day) : []),
        [day, isValidDay]
    );

    // Navigation: previous / next day with data
    const allDays = useMemo(() => getAllExpenseDays(), []);
    const currentIdx = allDays.indexOf(day);
    const prevDay = currentIdx > 0 ? allDays[currentIdx - 1] : null;
    const nextDay =
        currentIdx >= 0 && currentIdx < allDays.length - 1
            ? allDays[currentIdx + 1]
            : null;

    // Stats
    const total = dayExpenses.reduce((a, b) => a + b.amt, 0);
    const voiceCount = dayExpenses.filter((t) => t.voice).length;

    const byCat = dayExpenses.reduce<Record<string, number>>((acc, t) => {
        acc[t.cat] = (acc[t.cat] ?? 0) + t.amt;
        return acc;
    }, {});

    const entriesCountByCat = dayExpenses.reduce<Record<string, number>>(
        (acc, t) => {
            acc[t.cat] = (acc[t.cat] ?? 0) + 1;
            return acc;
        },
        {}
    );

    const hourBuckets = useMemo(
        () => (isValidDay ? getHourlyBuckets(day) : []),
        [day, isValidDay]
    );

    // Date display
    const date = isValidDay
        ? new Date(CURRENT.year, CURRENT.month - 1, day)
        : null;
    const weekdayFull = date
        ? date.toLocaleDateString('en-US', { weekday: 'long' })
        : '';
    const monthName = MONTH_NAMES[CURRENT.month - 1];
    const isToday = day === CURRENT.day;

    // Invalid day → show error
    if (!isValidDay || dayExpenses.length === 0) {
        return (
            <div className="px-4 md:px-8 py-5 md:py-7 max-w-[1320px] mx-auto">
                <button
                    onClick={() => router.push('/ledger')}
                    className="flex items-center gap-2 text-ink-1 hover:text-ink-0 transition-colors mb-6"
                >
                    <ChevronIcon direction="left" size={16} />
                    <span className="text-sm font-medium">Back to ledger</span>
                </button>

                <div
                    className="rounded-[20px] bg-white p-12 text-center"
                    style={{ border: '1px solid var(--color-line-soft)' }}
                >
                    <div className="display text-2xl mb-2">No expenses</div>
                    <div className="text-ink-2 text-sm">
                        {!isValidDay
                            ? `Day ${dayParam} doesn't exist.`
                            : `No entries logged for Apr ${day}.`}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="px-4 md:px-8 py-5 md:py-7 pb-16 max-w-[1320px] mx-auto">
            {/* ═══════════════════════════════════════════════════
          Header (back + title + day switcher)
          ═══════════════════════════════════════════════════ */}
            <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="flex flex-col md:flex-row md:items-end gap-4 mb-6"
            >
                <div className="flex-1 min-w-0">
                    <Link
                        href="/ledger"
                        className="inline-flex items-center gap-1.5 text-ink-1 hover:text-ink-0 transition-colors mb-2 text-sm"
                    >
                        <ChevronIcon direction="left" size={14} />
                        <span>Back to ledger</span>
                    </Link>

                    <div className="text-[10px] md:text-[11px] text-gold-900 uppercase tracking-[0.14em] font-semibold">
                        Daily detail · {isToday ? 'Today' : `Apr ${day}`}
                    </div>

                    <h1
                        className="display mt-0.5 md:mt-1"
                        style={{
                            fontSize: 'clamp(28px, 5vw, 52px)',
                            lineHeight: 1.05,
                        }}
                    >
                        {weekdayFull}, {monthName} {day}
                    </h1>

                    <div className="text-[12px] md:text-[13px] text-ink-2 mt-1">
                        {dayExpenses.length} entries
                        {voiceCount > 0 && ` · ${voiceCount} via voice`}
                    </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    <DaySwitcher day={day} prevDay={prevDay} nextDay={nextDay} />

                    <button
                        className="h-10 px-3 md:px-4 rounded-full border border-line bg-white text-sm font-medium hover:border-ink-2 flex items-center gap-2 transition-all"
                        aria-label="Jump to date"
                    >
                        <CalendarIcon size={14} />
                        <span className="hidden sm:inline">Jump</span>
                    </button>
                </div>
            </motion.div>

            {/* ═══════════════════════════════════════════════════
          Content Grid (timeline + sidebar stats)
          ═══════════════════════════════════════════════════ */}
            <div className="grid gap-5 md:gap-6 grid-cols-1 lg:[grid-template-columns:1.3fr_1fr]">
                {/* ── Left: Timeline ── */}
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
                    className="rounded-[24px] bg-white p-5 md:p-6"
                    style={{ border: '1px solid var(--color-line-soft)' }}
                >
                    <div className="flex items-baseline mb-4">
                        <div className="display text-[20px]">Timeline</div>
                        <div className="flex-1" />
                        <span className="chip">24h view</span>
                    </div>

                    {/* Hour bars */}
                    <div className="pb-5">
                        <HourTimeline buckets={hourBuckets} />
                    </div>

                    {/* Tx list with time gutter */}
                    <div className="border-t border-line-soft pt-3">
                        {dayExpenses.map((t, i) => (
                            <TimelineEntry
                                key={t.id}
                                time={t.time}
                                cat={t.cat}
                                note={t.note}
                                amount={t.amt}
                                voice={t.voice}
                                isLast={i === dayExpenses.length - 1}
                                index={i}
                            />
                        ))}
                    </div>
                </motion.div>

                {/* ── Right: Stats sidebar ── */}
                <div className="flex flex-col gap-4 md:gap-5">
                    <TodayStatsCard
                        total={total}
                        entriesCount={dayExpenses.length}
                        voiceCount={voiceCount}
                    />
                    <TodayByCategory
                        byCat={byCat}
                        entriesCount={entriesCountByCat}
                    />
                    <AISummaryCard total={total} />
                </div>
            </div>
        </div>
    );
}