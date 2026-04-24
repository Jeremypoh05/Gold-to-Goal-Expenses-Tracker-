import type { CategoryKey } from '@/types';
import { CATEGORIES } from '@/data/categories';
import { CategoryIcon, type IconVariant } from './CategoryIcon';

interface CategoryTileProps {
    kind: CategoryKey;
    variant?: IconVariant;
    size?: number;
    iconSize?: number;
}

/**
 * A colored square tile with category icon inside.
 * Background uses a soft tinted version of the category hue.
 */
export function CategoryTile({
    kind,
    variant = 'filled',
    size = 40,
    iconSize,
}: CategoryTileProps) {
    const cat = CATEGORIES[kind];
    const bg = `oklch(0.95 0.04 ${cat?.hue ?? 80})`;

    return (
        <div
            style={{
                width: size,
                height: size,
                borderRadius: size * 0.32,
                background: bg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
            }}
        >
            <CategoryIcon
                kind={kind}
                variant={variant}
                size={iconSize ?? Math.round(size * 0.55)}
                color={cat?.color}
            />
        </div>
    );
}