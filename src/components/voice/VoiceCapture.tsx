'use client';

// CHANGED (Phase 6.1): VoiceCapture now lives inside the global Voice modal.
// - Inline edit reuses the shared VoiceEntryEditor (amount/currency/category/note).
// - Saved entry includes currency.
// - FIX: parsed-card action buttons stack on mobile (primary full-width + a
//   second row of Edit/Say more) so "Looks good, save" no longer wraps.

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MicIcon, SparkleIcon, EditIcon, CategoryTile } from '@/components/icons';
import { AnimatedNumber } from '@/components/shared/AnimatedNumber';
import { Waveform } from './Waveform';
import { VoiceEntryEditor } from './VoiceEntryEditor';
import { CATEGORIES } from '@/data/categories';
import { useVoiceCapture } from '@/hooks/useVoiceCapture';
import type { NewVoiceLog } from './VoiceContext';

function CheckIcon({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12 L10 17 L19 7" />
        </svg>
    );
}

function MemChip({ label, text }: { label: string; text: string }) {
    return (
        <div className="inline-flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full" style={{ background: 'var(--color-bg-1)', border: '1px solid var(--color-line-soft)' }}>
            <span className="text-[10px] font-semibold px-2 py-[3px] rounded-[10px] uppercase tracking-[0.04em]" style={{ background: 'oklch(0.95 0.05 92)', color: 'var(--color-gold-900)' }}>
                {label}
            </span>
            <span className="text-xs text-ink-1">{text}</span>
        </div>
    );
}

export function VoiceCapture({ onSave }: { onSave: (entry: NewVoiceLog) => void }) {
    const { status, sample, transcript, start, reset, sayMore } = useVoiceCapture();
    const [editing, setEditing] = useState(false);

    const isActive = status === 'listening' || status === 'parsing';
    const title =
        status === 'idle'
            ? 'Tap to talk'
            : status === 'listening'
                ? 'Listening…'
                : status === 'parsing'
                    ? 'Parsing…'
                    : 'Got it ✨';

    const confirm = () => {
        onSave({
            lang: sample.lang,
            transcript: sample.transcript,
            cat: sample.parsed.cat,
            amt: sample.parsed.amt,
            currency: sample.parsed.currency,
            note: sample.parsed.note,
            status: 'confirmed',
        });
        reset();
    };

    const saveEdited = (v: { amt: number; currency: typeof sample.parsed.currency; cat: typeof sample.parsed.cat; note: string }) => {
        onSave({
            lang: sample.lang,
            transcript: sample.transcript,
            cat: v.cat,
            amt: v.amt,
            currency: v.currency,
            note: v.note,
            status: 'edited',
        });
        setEditing(false);
        reset();
    };

    return (
        <div className="flex flex-col items-center text-center">
            {/* Header */}
            <div className="flex items-center gap-2 text-gold-700 text-[11px] uppercase tracking-[0.14em] font-semibold">
                <SparkleIcon size={12} className="text-gold-600" />
                Voice logging · live
            </div>
            <h1 className="display mt-2.5" style={{ fontSize: 'clamp(28px, 5vw, 38px)' }}>
                {title.split('…')[0]}
                {title.includes('…') && <span className="text-gold-500">…</span>}
            </h1>

            {/* Mic orb */}
            <button
                type="button"
                onClick={status === 'idle' ? start : undefined}
                aria-label={status === 'idle' ? 'Start voice logging' : 'Listening'}
                className={`${isActive ? 'pulse' : ''} mt-6 w-28 h-28 rounded-full flex items-center justify-center relative transition-transform ${status === 'idle' ? 'cursor-pointer hover:scale-105' : 'cursor-default'}`}
                style={{
                    background: 'linear-gradient(135deg, oklch(0.94 0.09 92), oklch(0.72 0.155 80))',
                    boxShadow: 'var(--shadow-gold)',
                    opacity: status === 'parsed' ? 0.7 : 1,
                }}
            >
                <MicIcon size={44} className="text-[#1a120a]" />
            </button>

            {/* Waveform */}
            <div className="mt-5 mb-1 text-gold-600" style={{ minHeight: 36 }}>
                <Waveform bars={28} height={32} active={isActive} />
            </div>

            {/* Idle hint — cycles the bilingual examples */}
            {status === 'idle' && (
                <AnimatePresence mode="wait">
                    <motion.div
                        key={sample.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.35 }}
                        className="mt-2 max-w-[440px]"
                    >
                        <span className="chip mb-2">{sample.lang}</span>
                        <p className="text-[15px] text-ink-1 leading-snug mt-2">
                            Try: <span className="text-ink-0 font-medium">&ldquo;{sample.transcript}&rdquo;</span>
                        </p>
                    </motion.div>
                </AnimatePresence>
            )}

            {/* Transcript bubble */}
            {status !== 'idle' && (
                <div className="mt-4 w-full max-w-[560px] rounded-[20px] p-5 text-left" style={{ background: 'var(--color-bg-1)' }}>
                    <div className="text-[11px] text-ink-2 uppercase tracking-[0.08em] mb-2">
                        You said · {sample.lang}
                    </div>
                    <div className="text-[17px] leading-relaxed">
                        &ldquo;{transcript}
                        {status === 'listening' && (
                            <motion.span animate={{ opacity: [1, 0, 1] }} transition={{ duration: 0.9, repeat: Infinity }} style={{ color: 'var(--color-gold-500)' }}>
                                |
                            </motion.span>
                        )}
                        {status !== 'listening' && '"'}
                    </div>
                </div>
            )}

            {/* Parsed result */}
            <AnimatePresence>
                {status === 'parsed' && (
                    <motion.div
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                        className="mt-4 w-full max-w-[560px] rounded-[20px] p-5 text-left"
                        style={{ border: '1px solid oklch(0.88 0.08 88)', background: 'linear-gradient(135deg, var(--grad-soft-a), var(--grad-soft-b))' }}
                    >
                        {/* AI header */}
                        <div className="flex items-center gap-2.5 mb-3.5">
                            <div className="w-7 h-7 rounded-[9px] flex items-center justify-center" style={{ background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.65 0.155 78))' }}>
                                <SparkleIcon size={13} className="text-[#1a120a]" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-[13px] font-semibold">
                                    {editing ? 'Edit the details' : 'Got it! Added one expense ✨'}
                                </div>
                                <div className="text-[11px] text-ink-2">
                                    Parsed in {sample.ms}s
                                    {sample.parsed.note === '' && !editing && ' · no note (your preference)'}
                                </div>
                            </div>
                            {!editing && (
                                <span className="chip" style={{ background: 'oklch(0.96 0.06 160)', color: 'oklch(0.40 0.08 160)' }}>
                                    <CheckIcon size={11} /> Confirmed
                                </span>
                            )}
                        </div>

                        {editing ? (
                            <VoiceEntryEditor
                                initial={{
                                    amt: sample.parsed.amt,
                                    currency: sample.parsed.currency,
                                    cat: sample.parsed.cat,
                                    note: sample.parsed.note,
                                }}
                                onSave={saveEdited}
                                onCancel={() => setEditing(false)}
                                saveLabel="Save"
                            />
                        ) : (
                            <>
                                {/* Result row */}
                                <div className="grid items-center gap-3.5 p-3.5 rounded-[14px]" style={{ gridTemplateColumns: 'auto 1fr auto', background: 'var(--color-bg-card)', border: '1px solid var(--color-line-soft)' }}>
                                    <CategoryTile kind={sample.parsed.cat} size={48} variant="filled" />
                                    <div className="min-w-0">
                                        <div className="text-[15px] font-medium">{CATEGORIES[sample.parsed.cat].label}</div>
                                        <div className="text-[11px] text-ink-2 mt-0.5 truncate">
                                            {sample.parsed.note || <span className="italic text-ink-3">no note</span>}
                                        </div>
                                    </div>
                                    <div className="display-number" style={{ fontSize: 26 }}>
                                        <AnimatedNumber value={sample.parsed.amt} format="money" currency={sample.parsed.currency} duration={900} />
                                    </div>
                                </div>

                                {/* Memory chips */}
                                <div className="flex gap-2 flex-wrap mt-4">
                                    {sample.learned && <MemChip label="Learned" text={sample.learned} />}
                                    <MemChip label="Currency" text={`${sample.parsed.currency} (auto-detected)`} />
                                    <MemChip label="Language" text={sample.lang} />
                                </div>

                                {/* Actions — mobile: primary full-width row, then Edit/Say more row */}
                                <div className="mt-4 flex flex-col sm:flex-row gap-2.5">
                                    <button
                                        type="button"
                                        onClick={confirm}
                                        className="w-full sm:flex-1 h-11 rounded-full text-sm font-semibold flex items-center justify-center gap-2 hover:brightness-[1.03] transition-all"
                                        style={{
                                            background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))',
                                            color: '#1a120a',
                                            boxShadow: 'var(--shadow-gold)',
                                        }}
                                    >
                                        <CheckIcon size={16} /> Looks good, save
                                    </button>
                                    <div className="flex gap-2.5">
                                        <button
                                            type="button"
                                            onClick={() => setEditing(true)}
                                            className="flex-1 sm:flex-none h-11 px-4 rounded-full border border-line bg-bg-card text-sm font-medium flex items-center justify-center gap-1.5 hover:border-ink-2 transition-all"
                                        >
                                            <EditIcon size={14} /> Edit
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setEditing(false);
                                                sayMore();
                                            }}
                                            className="flex-1 sm:flex-none h-11 px-4 rounded-full border border-line bg-bg-card text-sm font-medium flex items-center justify-center gap-1.5 hover:border-ink-2 transition-all"
                                        >
                                            <MicIcon size={14} /> Say more
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Cancel back to idle while listening/parsing */}
            {(status === 'listening' || status === 'parsing') && (
                <button type="button" onClick={reset} className="mt-4 text-xs text-ink-2 hover:text-ink-0 transition-colors">
                    Cancel
                </button>
            )}
        </div>
    );
}
