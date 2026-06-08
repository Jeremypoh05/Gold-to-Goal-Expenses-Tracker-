'use client';

// ADDED (Phase 5 · Bonus "Interactive Add Bonus"):
// Makes the design's "+ Add" button functional. Mirrors ManualAddModal's UX —
// desktop centered modal / mobile bottom sheet, ESC + backdrop close, body-scroll
// lock, AnimatePresence. Added bonuses are held in page state (client-only /
// non-persistent until the Phase 8 DB), surfaced via the onAdd callback.

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SparkleIcon } from '@/components/icons';
import { MONTH_NAMES } from '@/lib/utils';

export interface NewBonus {
    month: number; // 1-12
    amt: number;
    label: string;
}

interface AddBonusModalProps {
    open: boolean;
    onClose: () => void;
    onAdd: (bonus: NewBonus) => void;
}

function CloseIcon({ size = 14 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6 L18 18 M18 6 L6 18" />
        </svg>
    );
}

function CheckIcon({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12 L10 17 L19 7" />
        </svg>
    );
}

// ═══════════════════════════════════════════════════════════════
// Shared form body (used by both desktop modal + mobile sheet)
// ═══════════════════════════════════════════════════════════════

function BonusForm({
    label,
    setLabel,
    month,
    setMonth,
    amount,
    setAmount,
    isMobile,
}: {
    label: string;
    setLabel: (v: string) => void;
    month: number;
    setMonth: (m: number) => void;
    amount: string;
    setAmount: (v: string) => void;
    isMobile?: boolean;
}) {
    const [intPart, decPart] = amount.split('.');
    const formattedInt = intPart || '0';
    const formattedDec = decPart !== undefined ? decPart.padEnd(2, '0').slice(0, 2) : '00';

    return (
        <>
            {/* Amount (hidden input pattern — native keyboard, no numpad) */}
            <label
                className="block rounded-[20px] md:rounded-[22px] py-5 md:py-6 px-4 md:px-6 text-center relative overflow-hidden cursor-text"
                style={{
                    background: 'linear-gradient(145deg, oklch(0.97 0.05 92), oklch(0.92 0.09 88))',
                    border: '1px solid oklch(0.88 0.08 88)',
                }}
            >
                <input
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    autoFocus
                    onChange={(e) => {
                        const v = e.target.value.replace(/[^0-9.]/g, '');
                        const parts = v.split('.');
                        const cleaned = parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : v;
                        const [int, dec] = cleaned.split('.');
                        const final = dec !== undefined ? `${int}.${dec.slice(0, 2)}` : cleaned;
                        setAmount(final);
                    }}
                    className="absolute opacity-0 pointer-events-none"
                    aria-label="Bonus amount"
                />
                <div className="text-[10px] text-gold-900 uppercase tracking-[0.14em] font-semibold">
                    Bonus amount
                </div>
                <div
                    className="display-number mt-1 select-none"
                    style={{ fontSize: isMobile ? 'clamp(40px, 12vw, 56px)' : 60, lineHeight: 1 }}
                >
                    <span style={{ fontSize: '0.4em', color: 'var(--color-gold-700)', marginRight: 4 }}>
                        S$
                    </span>
                    {formattedInt}
                    <span style={{ color: 'var(--color-gold-700)' }}>.{formattedDec}</span>
                    <motion.span
                        animate={{ opacity: [1, 0, 1] }}
                        transition={{ duration: 1, repeat: Infinity }}
                        style={{ color: 'var(--color-gold-500)', marginLeft: 2 }}
                    >
                        |
                    </motion.span>
                </div>
                <div className="mt-2 text-[10px] text-gold-900 opacity-60">Type to enter amount</div>
            </label>

            {/* Label */}
            <div className="pt-4">
                <div className="text-[10px] md:text-[11px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-1.5">
                    Label
                </div>
                <input
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="e.g. Q3 bonus"
                    className="w-full px-3 py-2.5 border border-line rounded-xl bg-bg-1 text-[12px] md:text-[13px] outline-none focus:border-gold-400 focus:bg-white transition-all"
                />
            </div>

            {/* Month picker — horizontal scroll chips */}
            <div className="pt-4">
                <div className="text-[10px] md:text-[11px] text-ink-2 uppercase tracking-[0.06em] font-semibold mb-2">
                    Month
                </div>
                <div className="flex gap-1.5 overflow-x-auto mobile-h-scroll pb-1">
                    {MONTH_NAMES.map((name, i) => {
                        const m = i + 1;
                        const isSelected = m === month;
                        return (
                            <button
                                key={name}
                                type="button"
                                onClick={() => setMonth(m)}
                                className="h-8 px-3.5 rounded-full flex-shrink-0 text-xs font-medium transition-all cursor-pointer"
                                style={{
                                    background: isSelected
                                        ? 'linear-gradient(135deg, oklch(0.96 0.06 92), oklch(0.88 0.12 88))'
                                        : '#fff',
                                    border: isSelected
                                        ? '1px solid oklch(0.80 0.12 88)'
                                        : '1px solid var(--color-line-soft)',
                                    color: isSelected ? 'var(--color-gold-900)' : 'var(--color-ink-1)',
                                    boxShadow: isSelected ? 'var(--shadow-sm)' : 'none',
                                }}
                            >
                                {name}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* AI hint (decorative, matches the app's dashed-card pattern) */}
            <div
                className="mt-4 rounded-xl p-3 flex items-center gap-2.5"
                style={{
                    background: 'linear-gradient(135deg, oklch(0.97 0.04 92), #fff)',
                    border: '1px dashed oklch(0.85 0.10 88)',
                }}
            >
                <SparkleIcon size={isMobile ? 14 : 16} className="text-gold-600 flex-shrink-0" />
                <div className="flex-1 text-[11px] md:text-xs text-ink-1 leading-snug">
                    <b>Tip</b> · Bonuses are added to your yearly income and savings outlook instantly.
                </div>
            </div>
        </>
    );
}

function Footer({
    onClose,
    onSave,
    compact,
}: {
    onClose: () => void;
    onSave: () => void;
    compact?: boolean;
}) {
    return (
        <div className={`flex items-center gap-2.5 ${compact ? 'pt-4' : ''}`}>
            <div className="flex-1" />
            <button
                type="button"
                onClick={onClose}
                className="h-10 px-5 rounded-full border border-line bg-white text-[13px] md:text-sm font-medium hover:border-ink-2 transition-all"
            >
                Cancel
            </button>
            <button
                type="button"
                onClick={onSave}
                className="h-10 px-5 rounded-full text-[13px] md:text-sm font-semibold flex items-center gap-2 hover:brightness-[1.03] transition-all"
                style={{
                    background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))',
                    color: '#1a120a',
                    boxShadow: 'var(--shadow-gold)',
                }}
            >
                <CheckIcon size={14} />
                Add bonus
            </button>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
// Main component
// ═══════════════════════════════════════════════════════════════

// ModalContent only mounts while the modal is open. Mounting fresh each time
// resets the form to its defaults WITHOUT a setState-in-effect (the React 19
// anti-pattern) — see .claude/Instructions/06-LEARNINGS.md.
function ModalContent({
    onClose,
    onAdd,
}: {
    onClose: () => void;
    onAdd: (b: NewBonus) => void;
}) {
    const [label, setLabel] = useState('Q3 bonus');
    const [month, setMonth] = useState(9); // Sep — next un-bonused quarter
    const [amount, setAmount] = useState('5000.00');

    const handleSave = () => {
        const amt = parseFloat(amount);
        if (!Number.isFinite(amt) || amt <= 0) return; // ignore empty/invalid
        onAdd({ month, amt, label: label.trim() || 'Bonus' });
        onClose();
    };

    const formProps = { label, setLabel, month, setMonth, amount, setAmount };

    return (
        <>
                    {/* Mobile bottom sheet (< md) */}
                    <div className="md:hidden">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            onClick={onClose}
                            className="fixed inset-0 z-50 flex items-end justify-center"
                            style={{
                                background: 'rgba(30, 20, 5, 0.4)',
                                backdropFilter: 'blur(8px)',
                                WebkitBackdropFilter: 'blur(8px)',
                            }}
                        >
                            <motion.div
                                initial={{ y: '100%' }}
                                animate={{ y: 0 }}
                                exit={{ y: '100%' }}
                                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                                drag="y"
                                dragConstraints={{ top: 0, bottom: 0 }}
                                dragElastic={0.2}
                                onDragEnd={(_, info) => {
                                    if (info.offset.y > 100 || info.velocity.y > 500) onClose();
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="bg-white w-full rounded-t-[24px] relative overflow-hidden"
                                style={{
                                    maxHeight: '92vh',
                                    overflowY: 'auto',
                                    paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
                                    boxShadow: '0 -20px 60px -10px rgba(60, 40, 10, 0.3)',
                                }}
                            >
                                <div className="flex justify-center pt-2.5 pb-1 sticky top-0 bg-white z-10">
                                    <div className="w-10 h-1 rounded-full bg-line" />
                                </div>
                                <div className="px-5 pb-3 pt-1 flex items-start gap-2">
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[10px] text-gold-900 uppercase tracking-[0.14em] font-semibold">
                                            Bonus
                                        </div>
                                        <h2 className="display mt-0.5" style={{ fontSize: 24, lineHeight: 1.1 }}>
                                            Add a bonus
                                        </h2>
                                    </div>
                                    <button
                                        onClick={onClose}
                                        type="button"
                                        className="w-8 h-8 rounded-lg bg-bg-1 hover:bg-bg-2 flex items-center justify-center text-ink-1 flex-shrink-0 transition-colors"
                                        aria-label="Close"
                                    >
                                        <CloseIcon size={12} />
                                    </button>
                                </div>
                                <div className="px-4">
                                    <BonusForm {...formProps} isMobile />
                                    <div className="pt-4">
                                        <Footer onClose={onClose} onSave={handleSave} />
                                    </div>
                                </div>
                            </motion.div>
                        </motion.div>
                    </div>

                    {/* Desktop centered modal (md+) */}
                    <div className="hidden md:block">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.25 }}
                            onClick={onClose}
                            className="fixed inset-0 z-50 flex items-center justify-center p-6"
                            style={{
                                background: 'rgba(30, 20, 5, 0.4)',
                                backdropFilter: 'blur(12px)',
                                WebkitBackdropFilter: 'blur(12px)',
                            }}
                        >
                            <motion.div
                                initial={{ opacity: 0, y: 20, scale: 0.96 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 20, scale: 0.96 }}
                                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                                onClick={(e) => e.stopPropagation()}
                                className="bg-white rounded-[24px] shadow-2xl relative overflow-hidden"
                                style={{ width: 'min(520px, 100%)', maxHeight: '92vh', overflowY: 'auto' }}
                            >
                                <button
                                    onClick={onClose}
                                    type="button"
                                    className="absolute top-4 right-4 w-9 h-9 rounded-xl bg-bg-1 hover:bg-bg-2 flex items-center justify-center text-ink-1 transition-colors z-10"
                                    aria-label="Close"
                                >
                                    <CloseIcon size={14} />
                                </button>
                                <div className="px-7 pt-7 pb-4">
                                    <div className="text-[11px] text-gold-900 uppercase tracking-[0.14em] font-semibold">
                                        Bonus
                                    </div>
                                    <h2 className="display mt-1" style={{ fontSize: 28, lineHeight: 1.1 }}>
                                        Add a bonus
                                    </h2>
                                    <div className="text-[12px] text-ink-2 mt-1">
                                        Salary stays the same — bonuses stack on top of your yearly income.
                                    </div>
                                </div>
                                <div className="px-7 pb-7">
                                    <BonusForm {...formProps} />
                                    <div className="pt-5">
                                        <Footer onClose={onClose} onSave={handleSave} />
                                    </div>
                                </div>
                            </motion.div>
                        </motion.div>
                    </div>
        </>
    );
}

export function AddBonusModal({ open, onClose, onAdd }: AddBonusModalProps) {
    // ESC closes
    useEffect(() => {
        if (!open) return;
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [open, onClose]);

    // Lock body scroll while open
    useEffect(() => {
        if (open) document.body.style.overflow = 'hidden';
        else document.body.style.overflow = '';
        return () => {
            document.body.style.overflow = '';
        };
    }, [open]);

    return (
        <AnimatePresence>
            {/* key forces a fresh ModalContent mount per open → form resets cleanly */}
            {open && <ModalContent key="add-bonus" onClose={onClose} onAdd={onAdd} />}
        </AnimatePresence>
    );
}
