'use client';

// ADDED (Phase 9): surfaces custom recurring income (freelance, dividends, rental)
// on the Income page. Mirrors the BonusesCard look. The button opens the manage
// modal; paused sources are dimmed and excluded from the active monthly total.

import { motion } from 'framer-motion';
import { PlusIcon } from '@/components/icons';
import { AnimatedNumber } from '@/components/shared/AnimatedNumber';
import { formatMoney, MONTH_NAMES } from '@/lib/utils';
import type { UiIncomeSource } from '@/lib/expense-utils';

export function IncomeSourcesCard({
    sources,
    onManage,
    delay = 0,
}: {
    sources: UiIncomeSource[];
    onManage: () => void;
    delay?: number;
}) {
    const monthlyTotal = sources
        .filter((s) => s.active)
        .reduce((a, s) => a + s.monthlyAmount, 0);

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
            className="glass rounded-3xl p-6 md:p-7 bg-bg-card"
            style={{ border: '1px solid var(--color-line-soft)' }}
        >
            <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                    <div className="display text-[20px]">Other income</div>
                    <div className="text-xs text-ink-2 mt-0.5">Freelance, dividends, rental &amp; more</div>
                </div>
                <button
                    type="button"
                    onClick={onManage}
                    className="flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium border border-line bg-bg-card hover:border-ink-2 transition-all"
                >
                    <PlusIcon size={14} /> {sources.length > 0 ? 'Manage' : 'Add'}
                </button>
            </div>

            {sources.length === 0 ? (
                <button
                    type="button"
                    onClick={onManage}
                    className="mt-4 w-full rounded-[16px] py-6 text-center transition-all hover:brightness-[1.02]"
                    style={{ border: '1.5px dashed var(--color-line)', background: 'var(--color-bg-1)' }}
                >
                    <div className="text-[13px] font-medium text-ink-1">Add extra income</div>
                    <div className="text-[11px] text-ink-2 mt-0.5">Side gigs, investments, rent…</div>
                </button>
            ) : (
                <>
                    <div className="mt-4 flex flex-col gap-2.5">
                        {sources.map((s, i) => (
                            <motion.div
                                key={s.id}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.4, delay: delay + 0.2 + i * 0.06 }}
                                className="flex items-center gap-3 p-3.5 rounded-[14px]"
                                style={{
                                    background: 'var(--color-bg-1)',
                                    border: '1px solid var(--color-line-soft)',
                                    opacity: s.active ? 1 : 0.55,
                                }}
                            >
                                <div
                                    className="w-10 h-10 rounded-[10px] bg-bg-card flex items-center justify-center flex-shrink-0 text-[18px]"
                                    style={{ border: '1px solid var(--color-line-soft)' }}
                                >
                                    {s.emoji}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-[13px] font-medium truncate">
                                        {s.label}
                                        {!s.active && <span className="text-ink-2 font-normal"> · paused</span>}
                                    </div>
                                    <div className="text-[11px] text-ink-2">
                                        from {MONTH_NAMES[s.month - 1].slice(0, 3)} {s.year}
                                    </div>
                                </div>
                                <div className="mono text-[15px] font-semibold">
                                    {formatMoney(s.monthlyAmount)}
                                    <span className="text-[11px] text-ink-2 font-normal">/mo</span>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                    <div className="mt-5 p-3.5 rounded-[14px] flex items-baseline gap-2" style={{ background: 'var(--color-bg-1)' }}>
                        <span className="text-[11px] text-ink-2 uppercase tracking-[0.06em]">
                            Active per month
                        </span>
                        <div className="flex-1" />
                        <span className="mono font-semibold text-[18px]">
                            S$ <AnimatedNumber value={monthlyTotal} format="integer" duration={1200} delay={500} />
                        </span>
                    </div>
                </>
            )}
        </motion.div>
    );
}
