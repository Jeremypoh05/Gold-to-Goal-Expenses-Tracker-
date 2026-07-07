'use client';

// CHANGED (Phase 6.1): /voice is the history / review hub. Capture happens in the
// global Voice modal (opened from here or anywhere).
// CHANGED (polish): the "Talk to log" hero now has a continuous, always-on effect —
// sonar ripples + breathing glow radiating from the mic, drifting ambient orbs, a
// rotating bilingual example, and a "how it works" strip to fill the space and
// invite a tap. No hover required.

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MicIcon, SparkleIcon } from '@/components/icons';
import { VoiceLogsPanel, useVoice } from '@/components/voice';
import { VOICE_SAMPLES } from '@/data/voiceSamples';

function CheckIcon({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12 L10 17 L19 7" />
        </svg>
    );
}

// "How it works" steps — fills the lower half + teaches the flow.
const STEPS = [
    { Icon: MicIcon, title: 'Speak', desc: 'English · Mandarin · Malay · Singlish' },
    { Icon: SparkleIcon, title: 'Honey parses', desc: 'Amount · category · note' },
    { Icon: CheckIcon, title: 'Confirm', desc: 'Save or edit in a tap' },
];

function TalkToLogHero({ onOpen }: { onOpen: () => void }) {
    // Rotate the example utterance continuously (lively + encourages a tap).
    const [exIdx, setExIdx] = useState(0);
    useEffect(() => {
        const t = setInterval(() => setExIdx((i) => (i + 1) % VOICE_SAMPLES.length), 3000);
        return () => clearInterval(t);
    }, []);
    const ex = VOICE_SAMPLES[exIdx];

    return (
        <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-3xl relative overflow-hidden flex flex-col items-center text-center px-6 md:px-10 pt-8 md:pt-10 pb-7 md:pb-8 min-h-[540px] lg:min-h-[620px]"
            style={{
                border: '1px solid var(--color-line-soft)',
                background:
                    'radial-gradient(ellipse at 50% 22%, oklch(0.95 0.08 90), var(--color-bg-card) 70%)',
            }}
        >
            {/* Ambient drifting orbs (continuous) */}
            <motion.div
                className="absolute rounded-full pointer-events-none"
                style={{ width: 280, height: 280, left: '-12%', top: '-14%', background: 'oklch(0.9 0.11 92)', opacity: 0.35, filter: 'blur(55px)' }}
                animate={{ x: [0, 24, 0], y: [0, 16, 0] }}
                transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
                className="absolute rounded-full pointer-events-none"
                style={{ width: 260, height: 260, right: '-14%', bottom: '-10%', background: 'oklch(0.86 0.12 78)', opacity: 0.28, filter: 'blur(60px)' }}
                animate={{ x: [0, -22, 0], y: [0, -14, 0] }}
                transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
            />

            {/* Header */}
            <div className="relative z-10 flex items-center gap-2 text-gold-700 text-[11px] uppercase tracking-[0.14em] font-semibold">
                <SparkleIcon size={12} className="text-gold-600" />
                AI voice logging
            </div>
            <h1 className="relative z-10 display mt-2.5" style={{ fontSize: 'clamp(30px, 5vw, 42px)' }}>
                Talk to log
            </h1>
            <p className="relative z-10 text-[13px] text-ink-1 mt-2 max-w-[420px]">
                Just say it in English, Mandarin, Malay, or Singlish — Honey parses the
                amount, category and note, and remembers your style.
            </p>

            {/* Mic with sonar ripples + breathing glow (always animating) */}
            <div className="relative z-10 my-7 md:my-8 flex items-center justify-center" style={{ width: 200, height: 200 }}>
                {/* Breathing radial glow */}
                <motion.div
                    className="absolute left-1/2 top-1/2 rounded-full pointer-events-none"
                    style={{
                        width: 200,
                        height: 200,
                        x: '-50%',
                        y: '-50%',
                        background: 'radial-gradient(circle, oklch(0.9 0.13 90 / 0.55), transparent 70%)',
                        filter: 'blur(6px)',
                    }}
                    animate={{ scale: [1, 1.14, 1], opacity: [0.55, 0.85, 0.55] }}
                    transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                />
                {/* Sonar ripple rings */}
                {[0, 1, 2].map((i) => (
                    <motion.span
                        key={i}
                        className="absolute left-1/2 top-1/2 rounded-full pointer-events-none"
                        style={{
                            width: 120,
                            height: 120,
                            x: '-50%',
                            y: '-50%',
                            border: '1.5px solid oklch(0.74 0.15 84 / 0.5)',
                        }}
                        initial={{ scale: 1, opacity: 0.5 }}
                        animate={{ scale: 3, opacity: 0 }}
                        transition={{ duration: 3.3, repeat: Infinity, delay: i * 1.1, ease: 'easeOut' }}
                    />
                ))}
                {/* Mic button — gentle breathing, opens the modal */}
                <motion.button
                    type="button"
                    onClick={onOpen}
                    aria-label="Start voice logging"
                    className="relative z-10 w-28 h-28 rounded-full flex items-center justify-center cursor-pointer"
                    style={{
                        background: 'linear-gradient(135deg, oklch(0.94 0.09 92), oklch(0.72 0.155 80))',
                        boxShadow: 'var(--shadow-gold), 0 0 60px -10px oklch(0.8 0.15 85 / 0.65)',
                    }}
                    animate={{ scale: [1, 1.04, 1] }}
                    transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
                    whileHover={{ scale: 1.07 }}
                    whileTap={{ scale: 0.95 }}
                >
                    <MicIcon size={44} className="text-[#1a120a]" />
                </motion.button>
            </div>

            <div className="relative z-10 text-[12px] text-ink-2">Tap to talk · ⌘ + space</div>

            {/* Rotating example (continuous) */}
            <div className="relative z-10 mt-3 h-9 flex items-center justify-center w-full max-w-[440px]">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={ex.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.35 }}
                        className="flex items-center gap-2"
                    >
                        <span className="chip" style={{ fontSize: 10, height: 20 }}>{ex.lang}</span>
                        <span className="text-[13px] text-ink-1 italic truncate">&ldquo;{ex.transcript}&rdquo;</span>
                    </motion.div>
                </AnimatePresence>
            </div>

            <div className="relative z-10 flex-1" />

            {/* How it works — fills the lower space */}
            <div className="relative z-10 w-full max-w-[480px] mt-6">
                <div className="grid grid-cols-3 gap-2.5">
                    {STEPS.map(({ Icon, title, desc }, i) => (
                        <motion.div
                            key={title}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5, delay: 0.3 + i * 0.1, ease: [0.16, 1, 0.3, 1] }}
                            className="rounded-2xl p-3 flex flex-col items-center gap-1.5"
                            style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-line-soft)' }}
                        >
                            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'oklch(0.95 0.05 92)', color: 'var(--color-gold-700)' }}>
                                <Icon size={17} />
                            </div>
                            <div className="text-[12px] font-semibold">{title}</div>
                            <div className="text-[10px] text-ink-2 leading-tight">{desc}</div>
                        </motion.div>
                    ))}
                </div>
            </div>
        </motion.div>
    );
}

export default function VoicePage() {
    const { openModal } = useVoice();

    return (
        <div className="px-4 md:px-8 py-5 md:py-7 pb-24 md:pb-16 max-w-[1320px] mx-auto grid grid-cols-1 lg:[grid-template-columns:1.3fr_1fr] gap-5 md:gap-6 items-start">
            <TalkToLogHero onOpen={openModal} />

            {/* Recent voice logs (review / edit / delete) */}
            <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            >
                <VoiceLogsPanel />
            </motion.div>
        </div>
    );
}
