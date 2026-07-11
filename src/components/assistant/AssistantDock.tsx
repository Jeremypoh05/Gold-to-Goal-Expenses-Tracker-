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
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { BotIcon, MicIcon } from '@/components/icons';
import { useVoice } from '@/components/voice';
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
    useEffect(() => {
        setExpanded(false);
    }, [pathname, panelOpen]);

    // The panel covers the right edge — don't float the dock under it.
    if (panelOpen) return null;

    const onAssistant = pathname === '/assistant';
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
                      primary: true,
                  },
              ]),
        {
            key: 'voice',
            label: 'Quick voice log',
            Icon: MicIcon,
            onClick: () => openVoice(),
            primary: false,
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
                            <span className="text-[12px] font-medium px-2.5 py-1 rounded-lg bg-bg-card border border-line-soft text-ink-0 shadow-sm">
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
                                    background: a.primary
                                        ? 'linear-gradient(135deg, oklch(0.9 0.1 95), oklch(0.78 0.14 85))'
                                        : 'var(--color-bg-card)',
                                    border: a.primary ? 'none' : '1px solid var(--color-line)',
                                    boxShadow: '0 8px 22px -6px oklch(0.65 0.16 78 / 0.4)',
                                    color: a.primary ? '#1a120a' : 'var(--color-ink-1)',
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
                className="w-14 h-14 rounded-full flex items-center justify-center cursor-pointer"
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
