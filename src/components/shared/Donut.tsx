'use client';

import { useEffect, useState } from 'react';
import { CATEGORIES } from '@/data/categories';
import { useExpenses } from '@/components/data/ExpensesContext';
import { expensesByCategory } from '@/lib/expense-utils';
import { formatMoney } from '@/lib/utils';
import type { CategoryKey } from '@/types';
import { AnimatedHeroAmount } from './AnimatedNumber';

interface DonutData {
    // CHANGED (Phase 5): widened from CategoryKey to string so the donut can also
    // render non-category segments (e.g. Income: "salary" / "bonuses").
    k: string;
    v: number;
    // ADDED (Phase 5): explicit segment color; falls back to the category hue when omitted.
    color?: string;
    // ADDED (Module 4 · viz): human label for the hover detail (else CATEGORIES[k] or k).
    label?: string;
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
    // ADDED (Phase 5): customizable center text (defaults keep the dashboard's "Spent … budget").
    centerLabel?: string;
    centerSub?: string;
    /** Override the center amount; defaults to the sum of segments. */
    centerValue?: number;
}

export function Donut({
    size = 180,
    thickness = 22,
    data,
    animated = true,
    centerLabel = 'Spent',
    centerSub = 'this month',
    centerValue,
}: DonutProps) {
    const { expenses } = useExpenses();
    const [progress, setProgress] = useState(animated ? 0 : 1);
    // ADDED (Module 4 · viz): hover/tap a slice → highlight it + show its detail.
    const [active, setActive] = useState<number | null>(null);

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
        (Object.entries(expensesByCategory(expenses)) as [CategoryKey, number][]).map(
            ([k, v]) => ({ k, v })
        );

    const total = arr.reduce((sum, item) => sum + item.v, 0);
    const r = (size - thickness) / 2;
    const c = 2 * Math.PI * r;

    const segments: Segment[] = arr.reduce<Segment[]>((acc, d) => {
        const length = total > 0 ? (d.v / total) * c : 0;
        const previous = acc[acc.length - 1];
        const offset = previous ? previous.offset + previous.length : 0;
        acc.push({ data: d, length, offset });
        return acc;
    }, []);

    const labelFor = (d: DonutData) =>
        d.label ?? CATEGORIES[d.k as CategoryKey]?.label ?? d.k;

    const activeSeg = active != null ? segments[active] : null;
    const activePct = activeSeg && total > 0 ? Math.round((activeSeg.data.v / total) * 100) : 0;

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
                    const category = CATEGORIES[segment.data.k as CategoryKey];
                    const hue = category?.hue ?? 80;
                    const stroke = segment.data.color ?? `oklch(0.78 0.12 ${hue})`;
                    const dimmed = active != null && active !== i;
                    const isActive = active === i;
                    return (
                        <circle
                            key={i}
                            cx={size / 2}
                            cy={size / 2}
                            r={r}
                            fill="none"
                            stroke={stroke}
                            // Highlighted slice grows slightly; the rest recede — clear focus.
                            strokeWidth={isActive ? thickness + 4 : thickness}
                            strokeDasharray={`${animatedLength} ${c - animatedLength}`}
                            strokeDashoffset={-animatedOffset}
                            strokeLinecap="butt"
                            onPointerEnter={(e) => { if (e.pointerType === 'mouse') setActive(i); }}
                            onPointerLeave={(e) => { if (e.pointerType === 'mouse') setActive((p) => (p === i ? null : p)); }}
                            onClick={() => setActive((p) => (p === i ? null : i))}
                            style={{
                                opacity: dimmed ? 0.32 : 1,
                                cursor: 'pointer',
                                transition: 'opacity 0.2s, stroke-width 0.2s',
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
                    pointerEvents: 'none',
                    padding: '0 12px',
                    textAlign: 'center',
                }}
            >
                <div
                    style={{
                        fontSize: 11,
                        color: activeSeg ? 'var(--color-ink-1)' : 'var(--color-ink-2)',
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        fontWeight: activeSeg ? 600 : 400,
                        maxWidth: size - thickness * 2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {activeSeg ? labelFor(activeSeg.data) : centerLabel}
                </div>
                <div
                    className="display-number"
                    style={{ fontSize: 26, lineHeight: 1, marginTop: 4 }}
                >
                    {activeSeg ? (
                        <>
                            <span style={{ fontSize: 14, color: 'var(--color-ink-2)', marginRight: 3 }}>S$</span>
                            {Math.round(activeSeg.data.v).toLocaleString('en-SG')}
                        </>
                    ) : (
                        <AnimatedHeroAmount
                            value={centerValue ?? total}
                            duration={1500}
                            delay={200}
                            symbolSize={14}
                            numberSize={26}
                        />
                    )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-ink-2)', marginTop: 4 }}>
                    {activeSeg ? `${activePct}% of ${formatMoney(total)}` : centerSub}
                </div>
            </div>
        </div>
    );
}
