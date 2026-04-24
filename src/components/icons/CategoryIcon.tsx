import type { CategoryKey } from '@/types';
import { CATEGORIES } from '@/data/categories';
import { useId } from 'react'; // 1. Import useId

export type IconVariant = 'outline' | 'filled' | '3d';

interface CategoryIconProps {
    kind?: CategoryKey;
    variant?: IconVariant;
    size?: number;
    color?: string;
}

// ─────────────────────────────────────────────────────────────
// SVG path definitions for each category
// ─────────────────────────────────────────────────────────────
const ICON_PATHS: Record<CategoryKey, React.ReactNode> = {
    food: (
        <g>
            <path d="M4 11 C4 15, 8 18, 12 18 C16 18, 20 15, 20 11 Z" />
            <path d="M3 11 H21" strokeLinecap="round" />
            <path d="M10 4 C 9 5, 11 6, 10 8" strokeLinecap="round" fill="none" />
            <path d="M13 3 C 12 4, 14 5, 13 7" strokeLinecap="round" fill="none" />
        </g>
    ),
    shop: (
        <g>
            <path d="M5 8 H19 L18 20 H6 Z" />
            <path d="M9 8 V6 A3 3 0 0 1 15 6 V8" fill="none" strokeLinecap="round" />
        </g>
    ),
    ent: (
        <g>
            <circle cx="12" cy="12" r="8" />
            <path d="M10 9 L15 12 L10 15 Z" fill="#fff" stroke="none" />
        </g>
    ),
    trans: (
        <g>
            <path d="M4 14 L5 10 A2 2 0 0 1 7 9 H17 A2 2 0 0 1 19 10 L20 14 V17 H4 Z" />
            <circle cx="8" cy="17" r="1.4" fill="#fff" stroke="none" />
            <circle cx="16" cy="17" r="1.4" fill="#fff" stroke="none" />
        </g>
    ),
    health: (
        <g>
            <path d="M12 19 C 7 15, 3 12, 3 8.5 A4 4 0 0 1 12 7 A4 4 0 0 1 21 8.5 C21 12, 17 15, 12 19 Z" />
        </g>
    ),
    bills: (
        <g>
            <path d="M6 4 H18 V20 L16 18.5 L14 20 L12 18.5 L10 20 L8 18.5 L6 20 Z" />
            <path d="M9 9 H15 M9 12 H15 M9 15 H13" stroke="#fff" strokeLinecap="round" fill="none" />
        </g>
    ),
    other: (
        <g>
            <path d="M12 4 L13.5 10.5 L20 12 L13.5 13.5 L12 20 L10.5 13.5 L4 12 L10.5 10.5 Z" />
        </g>
    ),
};

export function CategoryIcon({
    kind = 'food',
    variant = 'filled',
    size = 22,
    color,
}: CategoryIconProps) {
    const reactId = useId(); // 2. Generate a stable ID
    const c = color || CATEGORIES[kind]?.color || 'var(--color-ink-1)';
    const path = ICON_PATHS[kind];

    if (variant === 'outline') {
        return (
            <svg
                width={size}
                height={size}
                viewBox="0 0 24 24"
                fill="none"
                stroke={c}
                strokeWidth="1.6"
                style={{ flexShrink: 0 }}
            >
                {path}
            </svg>
        );
    }

    if (variant === '3d') {
        const gid = `g-${kind}-${reactId}`; // 3. Use the stable ID
        return (
            <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                <defs>
                    <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={c} stopOpacity="1" />
                        <stop offset="100%" stopColor={c} stopOpacity="0.55" />
                    </linearGradient>
                </defs>
                <g fill={`url(#${gid})`} stroke="none">{path}</g>
            </svg>
        );
    }

    // filled (default)
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill={c}
            stroke={c}
            strokeWidth="1.4"
            strokeLinejoin="round"
            style={{ flexShrink: 0 }}
        >
            {path}
        </svg>
    );
}