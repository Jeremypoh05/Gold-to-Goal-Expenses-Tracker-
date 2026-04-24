'use client';

import { useEffect, useState } from 'react';
import { CATEGORIES } from '@/data/categories';
import { EXPENSES_BY_CATEGORY } from '@/data/sampleExpenses';
import { formatMoney } from '@/lib/utils';
import type { CategoryKey } from '@/types';
import { AnimatedHeroAmount } from './AnimatedNumber';

interface DonutData {
    k: CategoryKey;
    v: number;
}

interface Segment {
    data: DonutData;
    length: number;
    offset: number;
}

interface DonutProps {
    size?: number;
    thickness?: number;
    data?: DonutData[];
    /** Animate segments drawing in (default: true) */
    animated?: boolean;
}

export function Donut({
    size = 180,
    thickness = 22,
    data,
    animated = true,
}: DonutProps) {
    const [progress, setProgress] = useState(animated ? 0 : 1);

    // Trigger animation on mount
    useEffect(() => {
        if (!animated) return;

        const startTime = performance.now();
        const duration = 1500;
        let rafId: number;

        const tick = (now: number) => {
            const elapsed = now - startTime;
            const t = Math.min(elapsed / duration, 1);
            // easeOutExpo
            const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
            setProgress(eased);
            if (t < 1) rafId = requestAnimationFrame(tick);
        };

        // Small delay so the user sees the start
        const timeoutId = setTimeout(() => {
            rafId = requestAnimationFrame(tick);
        }, 200);

        return () => {
            clearTimeout(timeoutId);
            if (rafId) cancelAnimationFrame(rafId);
        };
    }, [animated]);

    const arr: DonutData[] =
        data ??
        (Object.entries(EXPENSES_BY_CATEGORY) as [CategoryKey, number][]).map(
            ([k, v]) => ({ k, v })
        );

    const total = arr.reduce((sum, item) => sum + item.v, 0);
    const r = (size - thickness) / 2;
    const c = 2 * Math.PI * r;

    const segments: Segment[] = arr.reduce<Segment[]>((acc, d) => {
        const length = (d.v / total) * c;
        const previous = acc[acc.length - 1];
        const offset = previous ? previous.offset + previous.length : 0;
        acc.push({ data: d, length, offset });
        return acc;
    }, []);

    return (
        <div style={{ position: 'relative', width: size, height: size }}>
            <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    fill="none"
                    stroke="var(--color-bg-2)"
                    strokeWidth={thickness}
                />
                {segments.map((segment, i) => {
                    const animatedLength = segment.length * progress;
                    const animatedOffset = segment.offset * progress;
                    const category = CATEGORIES[segment.data.k];
                    const hue = category?.hue ?? 80;
                    return (
                        <circle
                            key={i}
                            cx={size / 2}
                            cy={size / 2}
                            r={r}
                            fill="none"
                            stroke={`oklch(0.78 0.12 ${hue})`}
                            strokeWidth={thickness}
                            strokeDasharray={`${animatedLength} ${c - animatedLength}`}
                            strokeDashoffset={-animatedOffset}
                            strokeLinecap="butt"
                            style={{
                                transition: 'none',
                            }}
                        />
                    );
                })}
            </svg>

            <div
                style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <div
                    style={{
                        fontSize: 11,
                        color: 'var(--color-ink-2)',
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                    }}
                >
                    Spent
                </div>
                <div
                    className="display-number"
                    style={{ fontSize: 26, lineHeight: 1, marginTop: 4 }}
                >
                    <AnimatedHeroAmount
                        value={total}
                        duration={1500}
                        delay={200}
                        symbolSize={14}
                        numberSize={26}
                    />
                </div>
                <div
                    style={{ fontSize: 11, color: 'var(--color-ink-2)', marginTop: 4 }}
                >
                    of S$3,500 budget
                </div>
            </div>
        </div>
    );
}