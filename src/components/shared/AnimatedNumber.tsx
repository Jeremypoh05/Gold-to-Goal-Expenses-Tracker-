'use client';

import { useCountUp, easeOutExpo } from '@/hooks/useCountUp';
import { formatMoney } from '@/lib/utils';

interface AnimatedNumberProps {
    value: number;
    duration?: number;
    delay?: number;
    /** Format the number (default: pass through as-is) */
    format?: 'money' | 'integer' | 'decimal';
    /** Currency for money format */
    currency?: 'SGD' | 'USD' | 'MYR' | 'CNY';
    className?: string;
    style?: React.CSSProperties;
}

/**
 * A number that smoothly counts from 0 to `value` on mount.
 * Used for hero amounts, stat counters, balance displays.
 */
export function AnimatedNumber({
    value,
    duration = 1500,
    delay = 0,
    format = 'decimal',
    currency = 'SGD',
    className,
    style,
}: AnimatedNumberProps) {
    const animated = useCountUp({
        to: value,
        duration,
        delay,
        easing: easeOutExpo,
    });

    let display: string;
    switch (format) {
        case 'money':
            display = formatMoney(animated, currency);
            break;
        case 'integer':
            display = Math.floor(animated).toLocaleString();
            break;
        case 'decimal':
        default:
            display = animated.toLocaleString('en-SG', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            });
            break;
    }

    return (
        <span className={className} style={style}>
            {display}
        </span>
    );
}

/**
 * Specialized version for the hero "S$ 2,561.50" display
 * with separately styled integer + decimal parts.
 */
export function AnimatedHeroAmount({
    value,
    duration = 1500,
    delay = 0,
    symbolSize = 32,
    numberSize = 72,
}: {
    value: number;
    duration?: number;
    delay?: number;
    symbolSize?: number | string;
    numberSize?: number | string;
}) {
    const animated = useCountUp({
        to: value,
        duration,
        delay,
        easing: easeOutExpo,
    });

    const integer = Math.floor(animated);
    const decimal = Math.round((animated - integer) * 100);

    return (
        <span style={{ fontSize: numberSize }}>
            <span
                style={{
                    fontSize: symbolSize,
                    verticalAlign: '0.3em',
                    marginRight: 6,
                    color: 'var(--color-ink-1)',
                }}
            >
                S$
            </span>
            {integer.toLocaleString()}
            <span style={{ color: 'var(--color-ink-2)' }}>
                .{String(decimal).padStart(2, '0')}
            </span>
        </span>
    );
}