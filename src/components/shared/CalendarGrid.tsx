'use client';

import { CURRENT, SAMPLE_EXPENSES } from '@/data/sampleExpenses';
import { daysInMonth } from '@/lib/utils';

interface CalendarGridProps {
    cellSize?: number;
    showSpend?: boolean;
    month?: number;
    year?: number;
    today?: number;
    gap?: number;
}

/**
 * 30-day calendar heatmap.
 * - Auto handles 28/29/30/31 day months.
 * - Today is highlighted with gold gradient.
 * - Days with spending get a tinted background based on amount.
 */
export function CalendarGrid({
    showSpend = true,
    month = CURRENT.month,
    year = CURRENT.year,
    today = CURRENT.day,
    gap = 6,
}: CalendarGridProps) {
    const days = daysInMonth(year, month);
    const firstDow = new Date(year, month - 1, 1).getDay(); // 0 = Sunday

    // Build cells array: [null, null, ..., 1, 2, 3, ..., 30, null, null]
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDow; i++) cells.push(null); // empty leading cells
    for (let d = 1; d <= days; d++) cells.push(d);
    const rows = Math.ceil(cells.length / 7);
    while (cells.length < rows * 7) cells.push(null); // pad trailing

    // Sum spending per day (pre-computed, no mutation in render)
    // Sum spending per day (pre-computed, no mutation in render)
    const byDay: Record<number, number> = SAMPLE_EXPENSES.reduce<Record<number, number>>((acc, t) => {
        acc[t.day] = (acc[t.day] ?? 0) + t.amt;
        return acc;
    }, {});

    const maxSpend = Math.max(...Object.values(byDay), 1);
    const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

    return (
        <div style={{ width: '100%' }}>
            {/* Day-of-week labels */}
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(7, 1fr)',
                    gap,
                    marginBottom: 8,
                }}
            >
                {dayLabels.map((d, i) => (
                    <div
                        key={i}
                        style={{
                            textAlign: 'center',
                            fontFamily: 'var(--font-ui)',
                            fontWeight: 500,
                            fontSize: 10,
                            lineHeight: 1,
                            letterSpacing: '0.12em',
                            color: 'var(--color-ink-3)',
                        }}
                    >
                        {d}
                    </div>
                ))}
            </div>

            {/* Day cells */}
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(7, 1fr)',
                    gap,
                }}
            >
                {cells.map((d, i) => {
                    if (d === null) return <div key={i} />;

                    const spent = byDay[d] ?? 0;
                    const isToday = d === today;
                    const isFuture = d > today;
                    const intensity = showSpend ? Math.min(1, spent / maxSpend) : 0;

                    // Background logic:
                    // - Today: gold gradient
                    // - Has spending: tinted gold based on intensity
                    // - Empty / future: neutral
                    let background: string;
                    if (isToday) {
                        background = 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))';
                    } else if (showSpend && spent > 0) {
                        background = `oklch(${0.97 - intensity * 0.10} ${intensity * 0.13} 88)`;
                    } else {
                        background = 'var(--color-bg-1)';
                    }

                    let textColor: string;
                    if (isToday) textColor = '#1a120a';
                    else if (isFuture) textColor = 'var(--color-ink-3)';
                    else textColor = 'var(--color-ink-0)';

                    return (
                        <div
                            key={i}
                            style={{
                                aspectRatio: '1',
                                borderRadius: 12,
                                background,
                                color: textColor,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                border: isToday
                                    ? 'none'
                                    : `1px solid ${spent > 0 ? 'transparent' : 'var(--color-line-soft)'}`,
                                boxShadow: isToday ? 'var(--shadow-gold)' : 'none',
                                fontSize: 13,
                                fontWeight: 500,
                                position: 'relative',
                                cursor: 'pointer',
                                transition: 'transform 0.15s ease',
                            }}
                        >
                            <div style={{ fontSize: 13, fontWeight: isToday ? 600 : 500 }}>
                                {d}
                            </div>
                            {showSpend && spent > 0 && !isToday && (
                                <div
                                    className="mono"
                                    style={{
                                        fontSize: 9,
                                        opacity: 0.7,
                                        marginTop: 1,
                                    }}
                                >
                                    {spent >= 100 ? Math.round(spent) : spent.toFixed(0)}
                                </div>
                            )}
                            {isToday && (
                                <div
                                    className="mono"
                                    style={{ fontSize: 9, fontWeight: 600, marginTop: 1 }}
                                >
                                    {(byDay[d] ?? 0).toFixed(0)}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}