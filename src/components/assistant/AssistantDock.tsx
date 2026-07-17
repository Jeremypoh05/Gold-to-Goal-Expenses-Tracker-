'use client';

// ADDED (AI Assistant · Slice 1 polish, user feedback): desktop had TWO stacked
// FABs (mic + assistant) which read as accidental. This consolidates them into
// ONE speed-dial: a single resting button that expands upward into two clearly
// labeled actions — "Ask Honey" (assistant panel) and "Quick voice log". Desktop
// only; mobile uses the tab-bar mic + a dedicated bot FAB (AssistantLauncher).
//
// CHANGED (polish v2): framer-motion for a springy, premium expand/collapse with
// staggered reveal + proper exit animation (matches the app's motion language —
// ConfirmDialog / modals already use framer-motion).
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { BotIcon, MicIcon } from '@/components/icons';
import { useVoice } from '@/components/voice';
import { cn } from '@/lib/utils';
import { useAssistant } from './AssistantContext';

function CloseIcon({ size = 22 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
        </svg>
    );
}

export function AssistantDock() {
    const { openPanel, open: panelOpen } = useAssistant();
    const { openModal: openVoice } = useVoice();
    const pathname = usePathname();
    const [expanded, setExpanded] = useState(false);

    // Collapse the dial whenever the route changes or the panel opens over it.
    // Render-time adjustment (the React-docs "reset state when a value changes"
    // pattern) instead of a setState-in-effect — same behavior, one render sooner,
    // and no cascading-render lint error.
    const collapseKey = `${pathname}|${panelOpen}`;
    const [prevCollapseKey, setPrevCollapseKey] = useState(collapseKey);
    if (prevCollapseKey !== collapseKey) {
        setPrevCollapseKey(collapseKey);
        setExpanded(false);
    }

    // The panel covers the right edge — don't float the dock under it.
    if (panelOpen) return null;

    const onAssistant = pathname === '/assistant';
    // CHANGED (user feedback): each action gets its OWN gradient/glow instead of
    // a primary/plain split — the voice action was a "plain white circle" that
    // didn't read as clickable. Explicit oklch stops (not surface tokens) so both
    // colors stay obvious and correct in light AND dark mode.
    const actions = [
        // On /assistant the panel is disabled (the full page IS the assistant),
        // so only offer voice there; elsewhere offer both.
        ...(onAssistant
            ? []
            : [
                  {
                      key: 'assistant',
                      label: 'Ask Honey',
                      Icon: BotIcon,
                      onClick: () => openPanel(),
                      gradient: 'linear-gradient(135deg, oklch(0.9 0.1 95), oklch(0.78 0.14 85))',
                      iconColor: '#1a120a',
                      glow: '0 8px 24px -6px oklch(0.65 0.16 78 / 0.5)',
                  },
              ]),
        {
            key: 'voice',
            label: 'Quick Voice Log',
            Icon: MicIcon,
            onClick: () => openVoice(),
            // Warm coral/ember — distinct from the golden assistant button so
            // "voice" reads as its own obvious action, not a muted afterthought.
            gradient: 'linear-gradient(135deg, oklch(0.76 0.16 35), oklch(0.58 0.2 22))',
            iconColor: '#fff',
            glow: '0 8px 24px -6px oklch(0.58 0.2 22 / 0.55)',
        },
    ];

    return (
        <div className="hidden md:flex fixed bottom-8 right-8 z-30 flex-col items-end gap-3">
            {/* Backdrop to dismiss on outside click while expanded */}
            {expanded && (
                <div
                    className="fixed inset-0 -z-10"
                    onClick={() => setExpanded(false)}
                    aria-hidden
                />
            )}

            {/* Action pills — spring up in sequence when expanded */}
            <AnimatePresence>
                {expanded &&
                    actions.map((a, i) => (
                        <motion.div
                            key={a.key}
                            className="flex items-center gap-2.5"
                            initial={{ opacity: 0, y: 14, scale: 0.8 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.85 }}
                            transition={{
                                type: 'spring',
                                stiffness: 500,
                                damping: 30,
                                delay: expanded ? (actions.length - 1 - i) * 0.05 : 0,
                            }}
                        >
                            {/* CHANGED (user feedback): frosted-glass pill (not plain
                                bg-bg-card) so the label never blends into whatever card
                                sits behind it on the page; uppercase + tracking matches
                                the app's other badge/chip typography. */}
                            <span
                                className="text-[10.5px] font-semibold uppercase tracking-[0.06em] px-3 py-1.5 rounded-full text-ink-0 whitespace-nowrap"
                                style={{
                                    background: 'var(--surface-glass-strong)',
                                    backdropFilter: 'blur(14px) saturate(1.4)',
                                    WebkitBackdropFilter: 'blur(14px) saturate(1.4)',
                                    border: '1px solid oklch(0.78 0.16 78 / 0.4)',
                                    boxShadow: '0 8px 20px -6px rgba(0,0,0,0.25)',
                                }}
                            >
                                {a.label}
                            </span>
                            <motion.button
                                type="button"
                                whileTap={{ scale: 0.9 }}
                                whileHover={{ scale: 1.08 }}
                                onClick={() => {
                                    a.onClick();
                                    setExpanded(false);
                                }}
                                aria-label={a.label}
                                className="w-12 h-12 rounded-full flex items-center justify-center cursor-pointer"
                                style={{
                                    background: a.gradient,
                                    border: 'none',
                                    boxShadow: a.glow,
                                    color: a.iconColor,
                                }}
                            >
                                <a.Icon size={20} />
                            </motion.button>
                        </motion.div>
                    ))}
            </AnimatePresence>

            {/* Main trigger — gentle idle "breathing" so it reads as alive/tappable */}
            <motion.button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-label={expanded ? 'Close quick actions' : 'Quick actions'}
                aria-expanded={expanded}
                animate={
                    expanded
                        ? { scale: 1, boxShadow: '0 12px 32px -6px oklch(0.65 0.16 78 / 0.55)' }
                        : {
                              scale: [1, 1.05, 1],
                              boxShadow: [
                                  '0 12px 32px -6px oklch(0.65 0.16 78 / 0.5)',
                                  '0 14px 38px -6px oklch(0.65 0.16 78 / 0.68)',
                                  '0 12px 32px -6px oklch(0.65 0.16 78 / 0.5)',
                              ],
                          }
                }
                transition={expanded ? { duration: 0.2 } : { duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
                whileTap={{ scale: 0.92 }}
                whileHover={{ scale: 1.08 }}
                // CHANGED (user feedback): layer the app's existing sonar-ring `.pulse`
                // effect (same one the voice mic used to have) on top of the breathing
                // scale/shadow — needs `relative` so the rings anchor to the button
                // itself, not the outer fixed container. Rings only show at rest (not
                // while expanded, where the button is the ✕ close control).
                className={cn(
                    'relative w-14 h-14 rounded-full flex items-center justify-center cursor-pointer',
                    !expanded && 'pulse',
                )}
                style={{
                    background: 'linear-gradient(135deg, oklch(0.85 0.14 90), oklch(0.64 0.16 78))',
                    boxShadow:
                        '0 12px 32px -6px oklch(0.65 0.16 78 / 0.55), 0 0 0 4px rgba(255,255,255,0.4)',
                    border: 'none',
                }}
            >
                <motion.span
                    className="text-[#1a120a] flex items-center justify-center"
                    animate={{ rotate: expanded ? 90 : 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                >
                    {expanded ? <CloseIcon size={22} /> : <BotIcon size={24} />}
                </motion.span>
            </motion.button>
        </div>
    );
}
