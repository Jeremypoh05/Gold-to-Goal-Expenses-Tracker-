'use client';

// CHANGED (Phase 6.1): Recent voice logs — reads the shared store (useVoice).
// Row action is now comprehensive Edit (amount/currency/category/note via the
// shared VoiceEntryEditor) — "Re-parse" was dropped (it only matters with the
// real Phase-9 parser). Keeps Delete; adds an empty state + "View all in Ledger".

import { useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
    CategoryTile,
    EditIcon,
    TrashIcon,
    MicIcon,
    ChevronIcon,
} from '@/components/icons';
import { CATEGORIES } from '@/data/categories';
import { formatMoney, MONTH_NAMES } from '@/lib/utils';
import { useExpenses } from '@/components/data/ExpensesContext';
import { useVoice } from './VoiceContext';
import { VoiceEntryEditor } from './VoiceEntryEditor';
import type { VoiceLog } from '@/types';

const STATUS_STYLE: Record<VoiceLog['status'], { label: string; bg: string; color: string }> = {
    confirmed: { label: 'Confirmed', bg: 'oklch(0.96 0.06 160)', color: 'oklch(0.40 0.08 160)' },
    edited: { label: 'Edited', bg: 'oklch(0.96 0.06 92)', color: 'var(--color-gold-900)' },
    reparsed: { label: 'Re-parsed', bg: 'oklch(0.95 0.05 250)', color: 'oklch(0.45 0.10 260)' },
};

export function VoiceLogsPanel() {
    const { logs, editLog, deleteLog, openModal } = useVoice();
    const { current } = useExpenses();
    const [editingId, setEditingId] = useState<number | null>(null);

    return (
        <div className="flex flex-col gap-3">
            {/* Header */}
            <div className="px-1 flex items-end gap-2">
                <div className="flex-1">
                    <div className="text-[11px] text-on-soft uppercase tracking-[0.14em] font-semibold">
                        Voice history
                    </div>
                    <div className="display text-[20px] mt-0.5">
                        Recent voice logs
                        <span className="text-ink-3 font-light"> · {logs.length}</span>
                    </div>
                </div>
                {logs.length > 0 && (
                    <Link href="/ledger" className="text-[12px] font-medium text-gold-700 hover:underline inline-flex items-center gap-0.5">
                        View all in Ledger
                        <ChevronIcon direction="right" size={12} />
                    </Link>
                )}
            </div>

            <AnimatePresence initial={false}>
                {logs.map((log, i) => {
                    const st = STATUS_STYLE[log.status];
                    const isEditing = editingId === log.id;
                    return (
                        <motion.div
                            key={log.id}
                            layout
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, height: 0, marginBottom: -12, transition: { duration: 0.25 } }}
                            transition={{ duration: 0.4, delay: Math.min(i * 0.05, 0.3), ease: [0.16, 1, 0.3, 1] }}
                            className="rounded-2xl p-3.5"
                            style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-line-soft)' }}
                        >
                            {/* Top: lang + time + status */}
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="chip" style={{ height: 20, fontSize: 10 }}>{log.lang}</span>
                                <span className="text-[11px] text-ink-3 mono">
                                    {log.time} · {MONTH_NAMES[current.month - 1]} {log.day}
                                </span>
                                <div className="flex-1" />
                                <span className="chip" style={{ height: 20, fontSize: 10, background: st.bg, color: st.color, border: 'none' }}>
                                    {st.label}
                                </span>
                            </div>

                            {/* Transcript */}
                            <div className="text-[12px] text-ink-2 italic mt-2 leading-snug">
                                &ldquo;{log.transcript}&rdquo;
                            </div>

                            {isEditing ? (
                                <div className="mt-2.5">
                                    <VoiceEntryEditor
                                        initial={{ amt: log.amt, currency: log.currency, cat: log.cat, note: log.note }}
                                        onSave={(v) => {
                                            editLog(log.id, v);
                                            setEditingId(null);
                                        }}
                                        onCancel={() => setEditingId(null)}
                                        saveLabel="Save"
                                    />
                                </div>
                            ) : (
                                <>
                                    {/* Parsed result */}
                                    <div className="flex items-center gap-3 mt-2.5">
                                        <CategoryTile kind={log.cat} size={36} variant="filled" />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[13px] font-medium">{CATEGORIES[log.cat].label}</div>
                                            <div className="text-[11px] text-ink-2 truncate">
                                                {log.note || <span className="italic text-ink-3">no note</span>}
                                            </div>
                                        </div>
                                        <div className="mono text-[14px] font-semibold whitespace-nowrap">
                                            −{formatMoney(log.amt, log.currency)}
                                        </div>
                                    </div>

                                    {/* Row actions */}
                                    <div className="flex justify-end gap-1.5 mt-2.5 pt-2.5" style={{ borderTop: '1px solid var(--color-line-soft)' }}>
                                        <button
                                            type="button"
                                            onClick={() => setEditingId(log.id)}
                                            className="flex items-center gap-1.5 h-8 px-3 rounded-full text-[11px] font-medium border border-line bg-bg-card hover:border-ink-2 transition-all"
                                        >
                                            <EditIcon size={13} /> Edit
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => deleteLog(log.id)}
                                            aria-label="Delete entry"
                                            className="flex items-center gap-1.5 h-8 px-3 rounded-full text-[11px] font-medium border border-line bg-bg-card text-ink-1 hover:border-[oklch(0.7_0.15_25)] hover:text-[oklch(0.55_0.18_25)] transition-all"
                                        >
                                            <TrashIcon size={13} /> Delete
                                        </button>
                                    </div>
                                </>
                            )}
                        </motion.div>
                    );
                })}
            </AnimatePresence>

            {/* Empty state */}
            {logs.length === 0 && (
                <div className="rounded-2xl p-8 text-center" style={{ background: 'var(--color-bg-1)', border: '1px dashed var(--color-line)' }}>
                    <div className="w-12 h-12 rounded-full mx-auto flex items-center justify-center" style={{ background: 'oklch(0.95 0.05 92)' }}>
                        <MicIcon size={22} className="text-gold-600" />
                    </div>
                    <div className="text-[14px] font-medium mt-3">No voice logs yet</div>
                    <div className="text-[12px] text-ink-2 mt-1">Tap the mic and say an expense to log it.</div>
                    <button
                        type="button"
                        onClick={openModal}
                        className="mt-4 h-9 px-4 rounded-full text-[13px] font-semibold inline-flex items-center gap-1.5"
                        style={{ background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.70 0.155 78))', color: '#1a120a', boxShadow: 'var(--shadow-gold)' }}
                    >
                        <MicIcon size={14} /> Tap to talk
                    </button>
                </div>
            )}
        </div>
    );
}
