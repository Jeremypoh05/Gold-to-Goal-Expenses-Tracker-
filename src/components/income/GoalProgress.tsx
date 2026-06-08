'use client';

// ADDED (Phase 5 · Bonus "Animated goal progress"):
// A savings-goal progress bar whose fill animates in on mount (Framer Motion)
// and shimmers on hover via the shared `.shine-wrap` utility. Numbers below use
// the mono tabular font. Kept presentational — all figures come in via props.

import { motion } from 'framer-motion';
import { formatMoney } from '@/lib/utils';

interface GoalProgressProps {
    saved: number;
    goal: number;
    toGo: number;
    /** 0–100 */
    progressPct: number;
    /** Delay the bar fill so it follows the count-up heroes. */
    delay?: number;
}

export function GoalProgress({
    saved,
    goal,
    toGo,
    progressPct,
    delay = 0.5,
}: GoalProgressProps) {
    return (
        <div>
            <div className="text-[11px] text-gold-900 font-semibold tracking-[0.1em] uppercase mb-2.5">
                Progress to {formatMoney(goal).replace('.00', '')} goal
            </div>

            {/* Track — `.shine-wrap` gives the hover shimmer sweep (premium feel). */}
            <div
                className="shine-wrap h-3 rounded-full relative"
                style={{ background: 'rgba(255, 255, 255, 0.55)' }}
            >
                <motion.div
                    className="h-full rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${progressPct}%` }}
                    transition={{ duration: 1.4, delay, ease: [0.16, 1, 0.3, 1] }}
                    style={{
                        background:
                            'linear-gradient(90deg, oklch(0.82 0.155 88), oklch(0.65 0.155 78))',
                    }}
                />
            </div>

            <div className="flex justify-between mt-1.5 text-[11px] text-ink-2">
                <span className="mono">{formatMoney(saved)} saved</span>
                <span className="mono">{formatMoney(toGo)} to go</span>
            </div>
        </div>
    );
}
