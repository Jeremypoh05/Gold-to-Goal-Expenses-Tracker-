'use client';

import { useEffect, useRef } from 'react';
import { CURRENT, SAMPLE_EXPENSES } from '@/data/sampleExpenses';
import { daysInMonth } from '@/lib/utils';

interface MonthBarsProps {
    width?: number;
    height?: number;
    color?: string;
    mini?: boolean;
    /** Animate bars growing up on mount */
    animated?: boolean;
}

export function MonthBars({
    width = 540,
    height = 120,
    color = 'var(--color-gold-500)',
    mini = false,
    animated = true,
}: MonthBarsProps) {
    const days = daysInMonth(CURRENT.year, CURRENT.month);

    const byDay = Array.from({ length: days }, (_, i) =>
        SAMPLE_EXPENSES.filter((t) => t.day === i + 1).reduce((a, b) => a + b.amt, 0)
    );

    const max = Math.max(...byDay, 1);
    const barW = (width - (days - 1) * 3) / days;

    return (
        <svg width={width} height={height} style={{ display: 'block' }}>
            {byDay.map((v, i) => {
                const h = Math.max(3, (v / max) * (height - 14));
                const isToday = i + 1 === CURRENT.day;
                const x = i * (barW + 3);
                return (
                    <g key={i}>
                        <rect
                            x={x}
                            y={height - h}
                            width={barW}
                            height={h}
                            rx={Math.min(barW / 2, 4)}
                            fill={isToday ? 'var(--color-gold-600)' : color}
                            opacity={isToday ? 1 : v === 0 ? 0.22 : 0.72}
                            style={
                                animated
                                    ? {
                                        transformOrigin: `${x + barW / 2}px ${height}px`,
                                        animation: `barGrowUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) ${i * 0.025}s both`,
                                    }
                                    : undefined
                            }
                        />
                        {isToday && !mini && (
                            <rect
                                x={x - 1}
                                y={height - h - 3}
                                width={barW + 2}
                                height={2}
                                rx={1}
                                fill="var(--color-gold-700)"
                                style={
                                    animated
                                        ? {
                                            opacity: 0,
                                            animation: `fadeUpStrong 0.4s ease-out ${0.025 * days + 0.2}s both`,
                                        }
                                        : undefined
                                }
                            />
                        )}
                    </g>
                );
            })}
        </svg>
    );
}