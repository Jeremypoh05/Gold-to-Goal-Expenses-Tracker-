'use client';

// ADDED (Phase 6.1): global Voice capture modal. Opened from anywhere (bottom-bar
// mic, dashboard Voice CTA, floating mic, /voice hero) via useVoice().openModal().
// Mirrors ManualAddModal's overlay mechanics (AnimatePresence, ESC, scroll-lock,
// mobile drag-to-dismiss).
//
// CHANGED (Slice 3 — "one brain"): this modal no longer runs the old single-shot
// transcribeExpense intent-router (VoiceCapture — retired). It now hosts <QuickVoice /> — a
// VOICE-FIRST surface (big animated "tap to talk" mic + confirm-card feedback) powered
// by the SAME assistant engine, so the mic can log/edit expenses AND recurring AND
// income AND answer briefly — but with a distinct, non-chat UI so it never reads as a
// duplicate of the assistant. "Continue in assistant" hands the session off to the
// slide-over panel (openPanel({ sessionId })) so a complex thread carries over
// seamlessly.

import { useEffect } from 'react';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { MicIcon } from '@/components/icons';
import { QuickVoice } from '@/components/assistant/QuickVoice';
import { useAssistant } from '@/components/assistant/AssistantContext';
import { promoteQuickSession } from '@/lib/assistant-actions';
import { useVoice } from './VoiceContext';

function CloseIcon({ size = 14 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6 L18 18 M18 6 L6 18" />
        </svg>
    );
}

export function VoiceModal() {
    const { isModalOpen, closeModal } = useVoice();
    const { openPanel, setQuickSessionId } = useAssistant();
    const dragControls = useDragControls();

    // Escalate the quick session into the full slide-over chat, carrying the
    // session id so the panel opens on THIS exact thread (seamless hand-off —
    // the vision's "先给 summary, 再引导去助手"). The session is PROMOTED to a
    // real, History-visible chat (it's no longer a throwaway voice log) and the
    // persisted quick-session id is cleared so the next mic tap starts a fresh one.
    const handleHandoff = (sessionId: number | null) => {
        closeModal();
        if (sessionId != null) promoteQuickSession(sessionId).catch(() => {});
        setQuickSessionId(null);
        openPanel(sessionId != null ? { sessionId } : undefined);
    };

    // ESC closes
    useEffect(() => {
        if (!isModalOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') closeModal();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isModalOpen, closeModal]);

    // Lock body scroll while open
    useEffect(() => {
        if (isModalOpen) document.body.style.overflow = 'hidden';
        else document.body.style.overflow = '';
        return () => {
            document.body.style.overflow = '';
        };
    }, [isModalOpen]);

    // Shared inner content — a compact header + the quick assistant surface. The
    // chat scrolls internally (flex-1 min-h-0), so the modal frame stays fixed.
    const content = (
        <div className="flex flex-col flex-1 min-h-0">
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-line-soft flex-shrink-0">
                <div
                    className="w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0"
                    style={{ background: 'linear-gradient(135deg, oklch(0.85 0.14 90), oklch(0.65 0.16 78))' }}
                >
                    <MicIcon size={16} className="text-[#1a120a]" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold leading-none">Quick voice log</div>
                    <div className="text-[10.5px] text-ink-2 mt-0.5">Tap the mic — log it, edit it, or ask</div>
                </div>
                <button
                    onClick={closeModal}
                    type="button"
                    className="w-8 h-8 rounded-lg bg-bg-1 hover:bg-bg-2 flex items-center justify-center text-ink-1 z-10 transition-colors flex-shrink-0"
                    aria-label="Close"
                >
                    <CloseIcon size={12} />
                </button>
            </div>
            <QuickVoice onHandoff={handleHandoff} onClose={closeModal} />
        </div>
    );

    return (
        <AnimatePresence>
            {isModalOpen && (
                <>
                    {/* Mobile bottom sheet (< md) */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        onClick={closeModal}
                        className="md:hidden fixed inset-0 z-50 flex items-end justify-center"
                        style={{ background: 'rgba(30, 20, 5, 0.4)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
                    >
                        <motion.div
                            initial={{ y: '100%' }}
                            animate={{ y: 0 }}
                            exit={{ y: '100%' }}
                            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                            drag="y"
                            dragListener={false}
                            dragControls={dragControls}
                            dragConstraints={{ top: 0, bottom: 0 }}
                            dragElastic={0.2}
                            onDragEnd={(_, info) => {
                                if (info.offset.y > 120 || info.velocity.y > 500) closeModal();
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="bg-bg-card w-full rounded-t-[28px] relative flex flex-col overflow-hidden"
                            style={{
                                height: '86vh',
                                paddingBottom: 'env(safe-area-inset-bottom)',
                                boxShadow: '0 -20px 60px -10px rgba(60, 40, 10, 0.3)',
                            }}
                        >
                            {/* Drag handle — the ONLY drag-to-dismiss trigger (dragListener={false}
                                above), so dragging inside the scrollable QuickVoice content never
                                fights the sheet's dismiss gesture. */}
                            <div
                                onPointerDown={(e) => dragControls.start(e)}
                                className="flex justify-center pt-2.5 pb-1 flex-shrink-0 cursor-grab active:cursor-grabbing touch-none"
                            >
                                <div className="w-10 h-1 rounded-full bg-line" />
                            </div>
                            {content}
                        </motion.div>
                    </motion.div>

                    {/* Desktop centered modal (md+) */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        onClick={closeModal}
                        className="hidden md:flex fixed inset-0 z-50 items-center justify-center p-6"
                        style={{ background: 'rgba(30, 20, 5, 0.4)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
                    >
                        <motion.div
                            initial={{ opacity: 0, y: 20, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 20, scale: 0.96 }}
                            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                            onClick={(e) => e.stopPropagation()}
                            className="bg-bg-card rounded-[28px] shadow-2xl relative flex flex-col overflow-hidden"
                            style={{ width: 'min(560px, 100%)', height: 'min(640px, 88vh)' }}
                        >
                            {content}
                        </motion.div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
