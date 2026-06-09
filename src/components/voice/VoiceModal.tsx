'use client';

// ADDED (Phase 6.1): global Voice capture modal. Opened from anywhere (bottom-bar
// mic, dashboard Voice CTA, floating mic, /voice hero) via useVoice().openModal().
// Mirrors ManualAddModal's overlay mechanics (AnimatePresence, ESC, scroll-lock,
// mobile drag-to-dismiss). VoiceCapture mounts fresh each open (idle state).

import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { VoiceCapture } from './VoiceCapture';
import { useVoice } from './VoiceContext';

function CloseIcon({ size = 14 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6 L18 18 M18 6 L6 18" />
        </svg>
    );
}

export function VoiceModal() {
    const { isModalOpen, closeModal, addLog } = useVoice();

    // On save: store the log (provider also fires the toast), then close.
    const handleSave = (entry: Parameters<typeof addLog>[0]) => {
        addLog(entry);
        closeModal();
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
                            dragConstraints={{ top: 0, bottom: 0 }}
                            dragElastic={0.2}
                            onDragEnd={(_, info) => {
                                if (info.offset.y > 120 || info.velocity.y > 500) closeModal();
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="bg-bg-card w-full rounded-t-[28px] relative"
                            style={{
                                maxHeight: '92vh',
                                overflowY: 'auto',
                                paddingBottom: 'calc(24px + env(safe-area-inset-bottom))',
                                boxShadow: '0 -20px 60px -10px rgba(60, 40, 10, 0.3)',
                            }}
                        >
                            <div className="flex justify-center pt-2.5 pb-1 sticky top-0 bg-bg-card z-10">
                                <div className="w-10 h-1 rounded-full bg-line" />
                            </div>
                            <button
                                onClick={closeModal}
                                type="button"
                                className="absolute top-3 right-3 w-8 h-8 rounded-lg bg-bg-1 hover:bg-bg-2 flex items-center justify-center text-ink-1 z-10 transition-colors"
                                aria-label="Close"
                            >
                                <CloseIcon size={12} />
                            </button>
                            <div className="px-4 pt-3 pb-2">
                                <VoiceCapture onSave={handleSave} />
                            </div>
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
                            className="bg-bg-card rounded-[28px] shadow-2xl relative"
                            style={{ width: 'min(680px, 100%)', maxHeight: '92vh', overflowY: 'auto' }}
                        >
                            <button
                                onClick={closeModal}
                                type="button"
                                className="absolute top-4 right-4 w-9 h-9 rounded-xl bg-bg-1 hover:bg-bg-2 flex items-center justify-center text-ink-1 z-10 transition-colors"
                                aria-label="Close"
                            >
                                <CloseIcon size={14} />
                            </button>
                            <div className="p-8">
                                <VoiceCapture onSave={handleSave} />
                            </div>
                        </motion.div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
