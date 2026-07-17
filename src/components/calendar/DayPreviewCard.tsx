'use client';

import {
    useState,
    useEffect,
    useMemo,
    useCallback,
    type RefObject,
} from 'react';
import { motion } from 'framer-motion';
import {
    useFloating,
    offset,
    flip,
    shift,
    arrow,
    FloatingArrow,
    autoUpdate,
} from '@floating-ui/react';
import { ArrowIcon } from '@/components/icons';
import { CATEGORIES } from '@/data/categories';
import { useExpenses } from '@/components/data/ExpensesContext';
import { getDayPreview } from '@/lib/expense-utils';
import { formatMoney, WEEKDAYS_SHORT, MONTH_NAMES } from '@/lib/utils';

const TOOLTIP_BG = 'oklch(0.20 0.015 75)';

interface DayPreviewCardProps {
    referenceEl: HTMLElement | null;
    day: number;
    isPinned?: boolean;
    containerRef?: RefObject<HTMLDivElement | null>;
    onClose?: () => void;
    onNavigate?: () => void;
}

function useIsMobile() {
    const [isMobile, setIsMobile] = useState(false)

    useEffect(() => {
        const check = () => setIsMobile(window.innerWidth < 640)
        check()
        window.addEventListener('resize', check)
        return () => window.removeEventListener('resize', check)
    }, [])

    return isMobile
}

export function DayPreviewCard({
    referenceEl,
    day,
    isPinned = false,
    containerRef,
    onClose,
    onNavigate,
}: DayPreviewCardProps) {
    const [arrowEl, setArrowEl] = useState<SVGSVGElement | null>(null);

    // Read containerRef.current via effect → state (React 19 safe)
    const [boundaryEl, setBoundaryEl] = useState<HTMLElement | null>(null);
    useEffect(() => {
        setBoundaryEl(containerRef?.current ?? null);
    }, [containerRef]);

    const { current, expenses } = useExpenses();
    const preview = getDayPreview(expenses, day);
    const date = new Date(current.year, current.month - 1, day);
    const monthName = MONTH_NAMES[current.month - 1]; // CHANGED (Phase 8.2): was hardcoded "Apr"
    const weekday = [
        'Sunday', 'Monday', 'Tuesday', 'Wednesday',
        'Thursday', 'Friday', 'Saturday',
    ][date.getDay()];
    const isToday = day === current.day;

    // Memoize middleware to avoid recreating on every render
    const isMobile = useIsMobile()

    const middleware = useMemo(
        () => [
            offset(() => ({
                mainAxis: 12,
                crossAxis: isMobile ? -6 : 0, // 👈 subtle 修正
            })),

            flip({ fallbackPlacements: ['bottom'] }),

            shift({
                padding: isMobile ? -8 : -10,
                boundary: boundaryEl ?? undefined,
                crossAxis: false, // 🔥 很关键
            }),

            arrow({
                element: arrowEl,
                padding: isMobile ? 30 : 34,
            }),
        ],
        [boundaryEl, arrowEl, isMobile]
    )

    const { refs, floatingStyles, context } = useFloating({
        open: true,
        elements: { reference: referenceEl },
        placement: 'top',
        whileElementsMounted: autoUpdate,
        middleware,
    });

    // ═══════════════════════════════════════════════════════════
    // KEY FIX: Wrap setFloating in useCallback (Gemini's approach)
    // This stabilizes the callback ref so React 19 doesn't warn
    // ═══════════════════════════════════════════════════════════
    const setFloatingRef = useCallback(
        (node: HTMLElement | null) => {
            refs.setFloating(node);
        },
        [refs]
    );

    // ═══════════════════════════════════════════════════════════
    // EMPTY STATE
    // ═══════════════════════════════════════════════════════════
    if (preview.count === 0) {
        return (
            <div
                ref={setFloatingRef}
                id="day-preview-card"
                style={{
                    ...floatingStyles,
                    zIndex: 100,
                    pointerEvents: isPinned ? 'auto' : 'none',
                }}
            >
                <motion.div
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                >
                    <div
                        className="rounded-xl px-3.5 py-2.5"
                        style={{
                            background: TOOLTIP_BG,
                            color: '#fff',
                            boxShadow: '0 12px 32px -8px rgba(0,0,0,0.35)',
                            minWidth: 180,
                        }}
                    >
                        <div className="text-[11px] mono opacity-60">
                            {monthName} {day} · {WEEKDAYS_SHORT[date.getDay()]}
                        </div>
                        <div className="text-xs mt-0.5 opacity-80">No expenses logged</div>
                    </div>
                    <FloatingArrow
                        ref={setArrowEl} 
                        context={context}
                        fill={TOOLTIP_BG}
                        width={12}
                        height={6}
                    />
                </motion.div>
            </div>
        );
    }

    // ═══════════════════════════════════════════════════════════
    // FILLED STATE
    // ═══════════════════════════════════════════════════════════
    const displayExpenses = preview.expenses.slice(0, 4);
    const remainingCount = preview.expenses.length - displayExpenses.length;

    return (
        <div
            ref={setFloatingRef}
            id="day-preview-card"
            style={{
                ...floatingStyles,
                zIndex: 100,
                pointerEvents: isPinned ? 'auto' : 'none',
                width: 280,
            }}
        >
            <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            >
                <div
                    className="rounded-2xl overflow-hidden"
                    style={{
                        background: TOOLTIP_BG,
                        color: '#fff',
                        boxShadow: '0 16px 40px -8px rgba(0,0,0,0.4)',
                    }}
                >
                    <div className="px-4 pt-3 pb-2.5 relative">
                        {isPinned && onClose && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onClose();
                                }}
                                onMouseDown={(e) => e.stopPropagation()}
                                className="absolute top-2 right-2 w-7 h-7 rounded-md flex items-center justify-center opacity-50 hover:opacity-100 hover:bg-white/10 transition-all cursor-pointer border-0 bg-transparent"
                                aria-label="Close preview"
                                type="button"
                            >
                                <svg
                                    width="11"
                                    height="11"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                >
                                    <path d="M6 6 L18 18 M18 6 L6 18" />
                                </svg>
                            </button>
                        )}

                        <div className="text-[11px] mono opacity-60">
                            {monthName} {day} · {weekday}
                        </div>
                        <div className="flex items-baseline gap-2 mt-0.5">
                            <span className="text-base font-semibold mono">
                                −{formatMoney(preview.total)}
                            </span>
                            {isToday && (
                                <span
                                    className="text-[10px] font-medium uppercase tracking-[0.05em]"
                                    style={{ color: 'oklch(0.85 0.14 88)' }}
                                >
                                    Today
                                </span>
                            )}
                        </div>
                        <div className="text-[11px] opacity-60 mt-0.5">
                            {preview.count} {preview.count === 1 ? 'expense' : 'expenses'}
                            {preview.voiceCount > 0 && (
                                <>
                                    {' '}·{' '}
                                    <span style={{ color: 'oklch(0.85 0.14 88)' }}>
                                        {preview.voiceCount} voice
                                    </span>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="h-px mx-4" style={{ background: 'rgba(255,255,255,0.1)' }} />

                    <div className="px-4 py-2">
                        {displayExpenses.map((t) => (
                            <div key={t.id} className="flex items-center gap-2 py-1">
                                <div
                                    className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
                                    style={{
                                        background: `oklch(0.78 0.12 ${CATEGORIES[t.cat].hue} / 0.25)`,
                                    }}
                                >
                                    <div
                                        className="w-2 h-2 rounded-full"
                                        style={{
                                            background: `oklch(0.78 0.12 ${CATEGORIES[t.cat].hue})`,
                                        }}
                                    />
                                </div>
                                <div className="flex-1 min-w-0 text-[11px] truncate">{t.note}</div>
                                <div className="mono text-[11px] font-medium opacity-90 whitespace-nowrap">
                                    −{formatMoney(t.amt)}
                                </div>
                            </div>
                        ))}
                        {remainingCount > 0 && (
                            <div className="text-[10px] opacity-50 mt-1">
                                + {remainingCount} more
                            </div>
                        )}
                    </div>

                    {isPinned && onNavigate ? (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onNavigate();
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            className="w-full px-4 py-2.5 flex items-center justify-center gap-1.5 text-[11px] font-medium border-0 cursor-pointer transition-colors hover:brightness-110"
                            style={{
                                background: 'oklch(0.30 0.02 75)',
                                color: '#fff',
                                pointerEvents: 'auto',
                            }}
                            type="button"
                        >
                            <span>View full day</span>
                            <ArrowIcon direction="right" size={12} />
                        </button>
                    ) : (
                        <div
                            className="px-4 py-2 flex items-center justify-center gap-1 text-[10px] opacity-60"
                            style={{ background: 'rgba(255,255,255,0.04)' }}
                        >
                            <span>Click to view full day</span>
                            <ArrowIcon direction="right" size={10} />
                        </div>
                    )}
                </div>

                <FloatingArrow
                    ref={setArrowEl}   
                    context={context}
                    fill={TOOLTIP_BG}
                    width={12}
                    height={6}
                />
            </motion.div>
        </div>
    );
}