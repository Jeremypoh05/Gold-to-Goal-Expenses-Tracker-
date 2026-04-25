'use client';

import { motion } from 'framer-motion';
import { CategoryTile, MicIcon } from '@/components/icons';
import { AnimatedNumber } from '@/components/shared/AnimatedNumber';
import { CATEGORIES } from '@/data/categories';
import { getMonthStats, CURRENT } from '@/data/sampleExpenses';
import { formatMoney, MONTH_NAMES, WEEKDAYS_SHORT } from '@/lib/utils';
import type { CategoryKey } from '@/types';

function StatCard({
    label,
    children,
    delay = 0,
}: {
    label: string;
    children: React.ReactNode;
    delay?: number;
}) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-2xl p-4"
            style={{
                background: '#fff',
                border: '1px solid var(--color-line-soft)',
            }}
        >
            <div className="text-[10px] text-ink-2 uppercase tracking-[0.08em] font-semibold">
                {label}
            </div>
            <div className="mt-1.5">{children}</div>
        </motion.div>
    );
}

export function MonthSummary() {
    const stats = getMonthStats();
    const date = new Date(CURRENT.year, CURRENT.month - 1, stats.topDay);
    const weekday = WEEKDAYS_SHORT[date.getDay()];
    const monthName = MONTH_NAMES[CURRENT.month - 1];
    const topCat = stats.topCategory as CategoryKey;

    return (
        <div className="flex flex-col gap-3">
            {/* Section header */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4 }}
                className="px-1"
            >
                <div className="text-[10px] text-gold-900 uppercase tracking-[0.14em] font-semibold">
                    {monthName} summary
                </div>
                <div className="display text-[20px] mt-0.5">Insights</div>
            </motion.div>

            {/* Top spending day */}
            <StatCard label="Top spending day" delay={0.1}>
                <div className="flex items-baseline gap-2">
                    <div className="display text-[22px] leading-none">
                        Apr {stats.topDay}
                    </div>
                    <div className="text-[11px] text-ink-2">{weekday}</div>
                </div>
                <div className="mono text-sm font-semibold mt-1" style={{ color: 'var(--color-gold-700)' }}>
                    −<AnimatedNumber value={stats.topDayAmount} format="money" duration={1500} delay={300} />
                </div>
            </StatCard>

            {/* Daily average */}
            <StatCard label="Daily average" delay={0.18}>
                <div className="display-number text-[22px] leading-none">
                    <span style={{ fontSize: '0.5em', color: 'var(--color-ink-2)', marginRight: 3 }}>
                        S$
                    </span>
                    <AnimatedNumber value={stats.dailyAvg} format="decimal" duration={1500} delay={400} />
                </div>
                <div className="text-[11px] text-ink-2 mt-1">
                    across {stats.activeDays} active days
                </div>
            </StatCard>

            {/* Top category */}
            <StatCard label="Top category" delay={0.26}>
                <div className="flex items-center gap-2.5">
                    <CategoryTile kind={topCat} size={32} variant="filled" />
                    <div className="flex-1 min-w-0">
                        <div className="font-medium text-[13px]">
                            {CATEGORIES[topCat].label}
                        </div>
                        <div className="mono text-xs text-ink-2 mt-0.5">
                            <AnimatedNumber value={stats.topCategoryAmount} format="money" duration={1500} delay={500} />
                        </div>
                    </div>
                </div>
            </StatCard>

            {/* Voice ratio */}
            <StatCard label="Voice usage" delay={0.34}>
                <div className="flex items-baseline gap-1.5">
                    <div className="display-number text-[22px] leading-none">
                        <AnimatedNumber value={stats.voiceRatio} format="decimal" duration={1500} delay={600} />
                        <span style={{ fontSize: '0.55em', color: 'var(--color-ink-2)' }}>%</span>
                    </div>
                    <MicIcon size={14} className="text-gold-600" />
                </div>
                <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-bg-2)' }}>
                    <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${stats.voiceRatio}%` }}
                        transition={{ duration: 1.4, delay: 0.7, ease: [0.16, 1, 0.3, 1] }}
                        className="h-full"
                        style={{
                            background: 'linear-gradient(90deg, oklch(0.78 0.165 85), oklch(0.55 0.15 75))',
                        }}
                    />
                </div>
                <div className="text-[11px] text-ink-2 mt-1.5">
                    {stats.voiceCount} of 24 logged via voice
                </div>
            </StatCard>

            {/* Active days */}
            <StatCard label="Active days" delay={0.42}>
                <div className="flex items-baseline gap-1.5">
                    <div className="display text-[22px] leading-none">
                        <AnimatedNumber value={stats.activeDays} format="integer" duration={1200} delay={700} />
                    </div>
                    <div className="text-[11px] text-ink-2">/ 30 days</div>
                </div>
                <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-bg-2)' }}>
                    <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${(stats.activeDays / 30) * 100}%` }}
                        transition={{ duration: 1.4, delay: 0.8, ease: [0.16, 1, 0.3, 1] }}
                        className="h-full"
                        style={{
                            background: 'linear-gradient(90deg, oklch(0.78 0.165 85), oklch(0.55 0.15 75))',
                        }}
                    />
                </div>
            </StatCard>
        </div>
    );
}