"use client";

// ADDED (Tags module): the one gold-tinted "#tag" pill, reused by the add/edit
// modal (removable + tappable suggestions) and the ledger rows (read-only). Uses
// the app's gold tokens via color-mix so it stays legible in light + dark.

interface TagChipProps {
    label: string;
    /** Render an × that calls this — makes it a removable editor chip. */
    onRemove?: () => void;
    /** Clicking the body calls this — makes it a tappable suggestion chip. */
    onClick?: () => void;
    /** Slightly smaller variant for dense rows (ledger). */
    dense?: boolean;
    /** Muted look for suggestion chips (not yet applied). */
    muted?: boolean;
}

export function TagChip({ label, onRemove, onClick, dense, muted }: TagChipProps) {
    const interactive = !!onClick;
    return (
        <span
            onClick={onClick}
            role={interactive ? "button" : undefined}
            tabIndex={interactive ? 0 : undefined}
            onKeyDown={
                interactive
                    ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onClick?.();
                          }
                      }
                    : undefined
            }
            className={`inline-flex items-center gap-0.5 rounded-full font-medium whitespace-nowrap transition-all ${
                dense ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-1 text-[11px]"
            } ${interactive ? "cursor-pointer hover:brightness-[0.97] active:scale-95" : ""}`}
            style={{
                background: muted
                    ? "color-mix(in oklch, var(--color-gold-500) 8%, transparent)"
                    : "color-mix(in oklch, var(--color-gold-500) 16%, transparent)",
                // FIX (dark mode): the pill surface is a gold tint over the page bg,
                // which DARKENS in dark mode — so the text must use --color-on-soft
                // (dark gold in light, light gold in dark). Fixed gold-900 was dark
                // gold in both themes and vanished on the dark pill.
                color: "var(--color-on-soft)",
                border: `1px solid color-mix(in oklch, var(--color-gold-500) ${
                    muted ? 26 : 40
                }%, transparent)`,
            }}
        >
            <span style={{ opacity: 0.55 }}>#</span>
            {label}
            {onRemove && (
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onRemove();
                    }}
                    aria-label={`Remove tag ${label}`}
                    className="ml-0.5 -mr-0.5 rounded-full hover:bg-black/10 flex items-center justify-center"
                    style={{ width: 14, height: 14 }}
                >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                        <path d="M6 6 L18 18 M18 6 L6 18" />
                    </svg>
                </button>
            )}
        </span>
    );
}
