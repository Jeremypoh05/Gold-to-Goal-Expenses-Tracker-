// ─────────────────────────────────────────────────────────────
// Generic UI icons - small SVG glyphs for navigation, buttons, etc.
// Separated from CategoryIcon since these have different semantic meaning.
// ─────────────────────────────────────────────────────────────

interface IconProps {
    size?: number;
    className?: string;
}

export function HomeIcon({ size = 18, className }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
        >
            <path d="M3 11 L12 4 L21 11 V20 H14 V14 H10 V20 H3 Z" />
        </svg>
    );
}

export function MicIcon({ size = 18, className }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
        >
            <rect x="9" y="3" width="6" height="12" rx="3" />
            <path d="M5 11 A7 7 0 0 0 19 11" />
            <path d="M12 18 V21" />
        </svg>
    );
}

export function GridIcon({ size = 18, className }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            className={className}
        >
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
    );
}

export function CalendarIcon({ size = 18, className }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            className={className}
        >
            <rect x="3" y="5" width="18" height="16" rx="3" />
            <path d="M3 10 H21 M8 3 V7 M16 3 V7" />
        </svg>
    );
}

export function WalletIcon({ size = 18, className }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
        >
            <rect x="3" y="6" width="18" height="14" rx="3" />
            <path d="M3 10 H21 M17 15 h.01" />
        </svg>
    );
}

export function SettingsIcon({ size = 18, className }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
        >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.09a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
    );
}

export function ChevronIcon({
    size = 16,
    direction = 'right',
    className,
}: IconProps & { direction?: 'left' | 'right' | 'up' | 'down' }) {
    const rotation = { right: 0, down: 90, left: 180, up: 270 }[direction];
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: `rotate(${rotation}deg)` }}
            className={className}
        >
            <path d="M9 6 L15 12 L9 18" />
        </svg>
    );
}

export function PlusIcon({ size = 18, className }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            className={className}
        >
            <path d="M12 5V19M5 12H19" />
        </svg>
    );
}

export function ArrowIcon({
    direction = 'right',
    size = 16,
    className,
}: IconProps & { direction?: 'left' | 'right' | 'up' | 'down' }) {
    const rotation = { right: 0, down: 90, left: 180, up: 270 }[direction];
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: `rotate(${rotation}deg)` }}
            className={className}
        >
            <path d="M5 12 H19 M13 6 L19 12 L13 18" />
        </svg>
    );
}

export function BellIcon({ size = 18, className }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
        >
            <path d="M6 9 A6 6 0 0 1 18 9 V14 L20 17 H4 L6 14 Z M10 20 A2 2 0 0 0 14 20" />
        </svg>
    );
}

export function SparkleIcon({ size = 16, className }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="currentColor"
            className={className}
        >
            <path d="M12 2 L13.5 9 L20 10.5 L13.5 12 L12 19 L10.5 12 L4 10.5 L10.5 9 Z" />
        </svg>
    );
}

export function EditIcon({ size = 14, className }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
        >
            <path d="M4 20 H9 L20 9 L15 4 L4 15 Z" />
        </svg>
    );
}

export function TrashIcon({ size = 14, className }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            className={className}
        >
            <path d="M5 7 H19 M8 7 V20 H16 V7 M10 11 V17 M14 11 V17 M9 7 V4 H15 V7" />
        </svg>
    );
}

export function SearchIcon({ size = 16, className }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            className={className}
        >
            <circle cx="11" cy="11" r="6" />
            <path d="M20 20 L16 16" />
        </svg>
    );
}

export function DownloadIcon({ size = 16, className }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
        >
            <path d="M12 4 V16 M6 11 L12 17 L18 11 M4 20 H20" />
        </svg>
    );
}

export function SortIcon({ size = 14, className }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
        >
            <path d="M7 4 V20 M3 16 L7 20 L11 16 M17 20 V4 M13 8 L17 4 L21 8" />
        </svg>
    );
}