'use client';

// ADDED (Module 5.1): custom in-house Date + Time picker, replacing the native
// <input type=date/time>. Reasons: the native calendar/clock indicator glyphs
// were black-on-dark (invisible) and the browser popup ignores our design. This
// matches the app (gold accents, glass, theme-aware) and — like the income
// pickers — EXPANDS INLINE (in-flow) rather than a floating popover, so the
// modal's scroll container can't clip it. Keeps the same string contract:
// `date` = "YYYY-MM-DD", `time` = "HH:MM" (24h) — so useManualExpenseForm and
// the save path are unchanged.

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronIcon, CalendarIcon } from '@/components/icons';
import { MONTH_NAMES } from '@/lib/utils';

// Local clock glyph (not in the shared icon set).
function ClockIcon({ size = 12 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7 V12 L15 14" />
        </svg>
    );
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/** "YYYY-MM-DD" → {y,m,d} (m is 1–12). Falls back to today on garbage. */
function parseDate(s: string): { y: number; m: number; d: number } {
    const [y, m, d] = s.split('-').map(Number);
    if (y && m && d) return { y, m, d };
    const now = new Date();
    return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
}
function parseTime(s: string): { h: number; min: number } {
    const [h, min] = s.split(':').map(Number);
    return { h: Number.isFinite(h) ? h : 0, min: Number.isFinite(min) ? min : 0 };
}

const triggerCls =
    'w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border bg-bg-1 hover:bg-bg-card transition-all text-left';

// ── Calendar panel ─────────────────────────────────────────────
function CalendarPanel({
    value,
    onPick,
}: {
    value: string;
    onPick: (v: string) => void;
}) {
    const sel = parseDate(value);
    const [viewY, setViewY] = useState(sel.y);
    const [viewM, setViewM] = useState(sel.m); // 1–12
    // CHANGED (Module 5.1): two modes so the year is easy to change — 'days' (the
    // day grid) and 'months' (a year stepper + 12-month grid). Tapping the header
    // title flips to 'months'; picking a month returns to 'days'.
    const [mode, setMode] = useState<'days' | 'months'>('days');

    const today = new Date();
    const tY = today.getFullYear();
    const tM = today.getMonth() + 1;
    const tD = today.getDate();

    // ADDED (Module 5.1): you can't log a FUTURE expense, so today is the max —
    // future days/months/years are disabled and un-navigable.
    const isFutureDay = (d: number) =>
        viewY > tY || (viewY === tY && (viewM > tM || (viewM === tM && d > tD)));
    const isFutureMonth = (m1: number) => viewY > tY || (viewY === tY && m1 > tM);
    const canGoNextMonth = viewY < tY || (viewY === tY && viewM < tM);
    const canGoNextYear = viewY < tY;

    const daysInMonth = new Date(viewY, viewM, 0).getDate();
    // Monday-first leading blanks.
    const firstDow = (new Date(viewY, viewM - 1, 1).getDay() + 6) % 7;
    const cells: (number | null)[] = [
        ...Array(firstDow).fill(null),
        ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
    ];

    const stepMonth = (delta: number) => {
        let m = viewM + delta;
        let y = viewY;
        if (m < 1) { m = 12; y -= 1; } else if (m > 12) { m = 1; y += 1; }
        setViewM(m);
        setViewY(y);
    };

    return (
        <div
            className="mt-2 p-3 rounded-2xl"
            style={{ background: 'var(--color-bg-1)', border: '1px solid var(--color-line)' }}
        >
            {mode === 'months' ? (
                <>
                    {/* Year stepper */}
                    <div className="flex items-center justify-between mb-2">
                        <button type="button" onClick={() => setViewY((y) => y - 1)} className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-1 hover:bg-bg-2 transition-colors" aria-label="Previous year">
                            <ChevronIcon direction="left" size={14} />
                        </button>
                        <div className="mono text-[15px] font-semibold">{viewY}</div>
                        <button type="button" onClick={() => canGoNextYear && setViewY((y) => y + 1)} disabled={!canGoNextYear} className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-1 enabled:hover:bg-bg-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed" aria-label="Next year">
                            <ChevronIcon direction="right" size={14} />
                        </button>
                    </div>
                    {/* Month grid */}
                    <div className="grid grid-cols-3 gap-1.5">
                        {MONTH_NAMES.map((m, i) => {
                            const isSel = viewY === sel.y && i + 1 === sel.m;
                            const isThis = viewY === tY && i + 1 === tM;
                            const disabled = isFutureMonth(i + 1);
                            return (
                                <button
                                    key={m}
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => { if (!disabled) { setViewM(i + 1); setMode('days'); } }}
                                    className="h-9 rounded-lg text-[12px] font-medium transition-all enabled:hover:brightness-[1.05] disabled:cursor-not-allowed"
                                    style={
                                        isSel
                                            ? { background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))', color: '#1a120a' }
                                            : { background: 'var(--color-bg-card)', color: 'var(--color-ink-1)', border: isThis ? '1px solid oklch(0.80 0.13 88)' : '1px solid transparent', opacity: disabled ? 0.32 : 1 }
                                    }
                                >
                                    {m.slice(0, 3)}
                                </button>
                            );
                        })}
                    </div>
                </>
            ) : (
                <>
                    {/* Header — arrows step the month; the title jumps to year/month view */}
                    <div className="flex items-center justify-between mb-2">
                        <button type="button" onClick={() => stepMonth(-1)} className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-1 hover:bg-bg-2 transition-colors" aria-label="Previous month">
                            <ChevronIcon direction="left" size={14} />
                        </button>
                        <button
                            type="button"
                            onClick={() => setMode('months')}
                            className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[13px] font-semibold hover:bg-bg-2 transition-colors"
                            aria-label="Pick month and year"
                        >
                            {MONTH_NAMES[viewM - 1]} {viewY}
                            <ChevronIcon direction="down" size={12} className="text-ink-2" />
                        </button>
                        <button type="button" onClick={() => canGoNextMonth && stepMonth(1)} disabled={!canGoNextMonth} className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-1 enabled:hover:bg-bg-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed" aria-label="Next month">
                            <ChevronIcon direction="right" size={14} />
                        </button>
                    </div>
                    {/* Weekday row */}
                    <div className="grid grid-cols-7 gap-1 mb-1">
                        {WEEKDAYS.map((w) => (
                            <div key={w} className="text-[10px] text-ink-3 font-semibold text-center uppercase tracking-[0.04em]">{w}</div>
                        ))}
                    </div>
                    {/* Day grid */}
                    <div className="grid grid-cols-7 gap-1">
                        {cells.map((d, i) => {
                            if (d === null) return <div key={`b${i}`} />;
                            const isSel = viewY === sel.y && viewM === sel.m && d === sel.d;
                            const isToday = viewY === tY && viewM === tM && d === tD;
                            const disabled = isFutureDay(d);
                            return (
                                <button
                                    key={d}
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => !disabled && onPick(`${viewY}-${pad2(viewM)}-${pad2(d)}`)}
                                    className="h-8 rounded-lg text-[12px] font-medium transition-all mono disabled:cursor-not-allowed enabled:hover:brightness-[1.05]"
                                    style={
                                        isSel
                                            ? { background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))', color: '#1a120a' }
                                            : {
                                                background: 'var(--color-bg-card)',
                                                color: 'var(--color-ink-1)',
                                                border: isToday ? '1px solid oklch(0.80 0.13 88)' : '1px solid transparent',
                                                opacity: disabled ? 0.32 : 1,
                                            }
                                    }
                                    aria-label={`${MONTH_NAMES[viewM - 1]} ${d}, ${viewY}`}
                                    aria-current={isToday ? 'date' : undefined}
                                >
                                    {d}
                                </button>
                            );
                        })}
                    </div>
                    {/* Footer: quick Today */}
                    <div className="flex justify-end mt-2">
                        <button
                            type="button"
                            onClick={() => onPick(`${tY}-${pad2(tM)}-${pad2(tD)}`)}
                            className="text-[12px] font-semibold text-gold-700 hover:text-gold-900 transition-colors"
                        >
                            Today
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}

// ── Time panel ─────────────────────────────────────────────────
function Stepper({ label, value, onStep }: { label: string; value: number; onStep: (d: number) => void }) {
    return (
        <div className="flex-1">
            <div className="text-[10px] text-ink-3 font-semibold text-center uppercase tracking-[0.06em] mb-1">{label}</div>
            <div className="flex items-center rounded-xl border border-line bg-bg-card overflow-hidden h-[46px]">
                <button type="button" onClick={() => onStep(-1)} className="px-3.5 h-full text-ink-1 hover:bg-bg-2 transition-colors text-lg leading-none" aria-label={`Decrease ${label}`}>−</button>
                <span className="flex-1 text-center mono text-[18px] font-semibold">{pad2(value)}</span>
                <button type="button" onClick={() => onStep(1)} className="px-3.5 h-full text-ink-1 hover:bg-bg-2 transition-colors text-lg leading-none" aria-label={`Increase ${label}`}>+</button>
            </div>
        </div>
    );
}

function TimePanel({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const { h, min } = parseTime(value);
    const set = (nh: number, nm: number) => onChange(`${pad2((nh + 24) % 24)}:${pad2((nm + 60) % 60)}`);
    return (
        <div
            className="mt-2 p-3 rounded-2xl"
            style={{ background: 'var(--color-bg-1)', border: '1px solid var(--color-line)' }}
        >
            <div className="flex items-center gap-2">
                <Stepper label="Hour" value={h} onStep={(d) => set(h + d, min)} />
                <span className="mono text-[18px] font-semibold text-ink-2 pt-4">:</span>
                {/* Minutes step by 5 for speed; the number still wraps 0–59. */}
                <Stepper label="Min" value={min} onStep={(d) => set(h, min + d * 5)} />
            </div>
            <div className="flex justify-end mt-2">
                <button
                    type="button"
                    onClick={() => { const n = new Date(); onChange(`${pad2(n.getHours())}:${pad2(n.getMinutes())}`); }}
                    className="text-[12px] font-semibold text-gold-700 hover:text-gold-900 transition-colors"
                >
                    Now
                </button>
            </div>
        </div>
    );
}

// ── Public component (same props as the old native DateTimeFields) ──
export function DateTimeFields({
    date,
    setDate,
    time,
    setTime,
}: {
    date: string;
    setDate: (v: string) => void;
    time: string;
    setTime: (v: string) => void;
}) {
    const [panel, setPanel] = useState<'date' | 'time' | null>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    // Scroll the expanded panel into view (mirrors the income MonthGridDropdown) so
    // it's never hidden below the modal's fold.
    useEffect(() => {
        if (!panel) return;
        const id = requestAnimationFrame(() =>
            panelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
        );
        return () => cancelAnimationFrame(id);
    }, [panel]);

    const sel = parseDate(date);
    const dateLabel = `${MONTH_NAMES[sel.m - 1].slice(0, 3)} ${sel.d}, ${sel.y}`;

    return (
        <div>
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <div className="text-[10px] md:text-[11px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1.5 flex items-center gap-1.5">
                        <CalendarIcon size={12} /> Date
                    </div>
                    <button
                        type="button"
                        onClick={() => setPanel((p) => (p === 'date' ? null : 'date'))}
                        className={triggerCls}
                        style={{ borderColor: panel === 'date' ? 'oklch(0.82 0.12 88)' : 'var(--color-line)' }}
                        aria-expanded={panel === 'date'}
                    >
                        <span className="text-[13px] font-medium mono">{dateLabel}</span>
                        <ChevronIcon direction={panel === 'date' ? 'up' : 'down'} size={13} className="text-ink-2" />
                    </button>
                </div>
                <div>
                    <div className="text-[10px] md:text-[11px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1.5 flex items-center gap-1.5">
                        <ClockIcon size={12} /> Time
                    </div>
                    <button
                        type="button"
                        onClick={() => setPanel((p) => (p === 'time' ? null : 'time'))}
                        className={triggerCls}
                        style={{ borderColor: panel === 'time' ? 'oklch(0.82 0.12 88)' : 'var(--color-line)' }}
                        aria-expanded={panel === 'time'}
                    >
                        <span className="text-[13px] font-medium mono">{time || '00:00'}</span>
                        <ChevronIcon direction={panel === 'time' ? 'up' : 'down'} size={13} className="text-ink-2" />
                    </button>
                </div>
            </div>

            <AnimatePresence initial={false}>
                {panel && (
                    <motion.div
                        ref={panelRef}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden"
                    >
                        {panel === 'date' ? (
                            <CalendarPanel value={date} onPick={(v) => { setDate(v); setPanel(null); }} />
                        ) : (
                            <TimePanel value={time} onChange={setTime} />
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
