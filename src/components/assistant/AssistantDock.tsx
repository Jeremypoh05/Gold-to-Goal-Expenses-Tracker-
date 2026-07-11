'use client';

// ADDED (AI Assistant · Slice 1 polish, user feedback): desktop had TWO stacked
// FABs (mic + assistant) which read as accidental. This consolidates them into
// ONE speed-dial: a single resting button that expands upward into two clearly
// labeled actions — "Ask Honey" (assistant panel) and "Quick voice log". Desktop
// only; mobile uses the tab-bar mic + a dedicated bot FAB (AssistantLauncher).
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
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

            {/* Action pills — revealed upward when expanded */}
            {expanded &&
                actions.map((a, i) => (
                    <div
                        key={a.key}
                        className="flex items-center gap-2.5 animate-[dockIn_0.18s_ease-out_both]"
                        style={{ animationDelay: `${i * 40}ms` }}
                    >
                        <span className="text-[12px] font-medium px-2.5 py-1 rounded-lg bg-bg-card border border-line-soft text-ink-0 shadow-sm">
                            {a.label}
                        </span>
                        <button
                            type="button"
                            onClick={() => {
                                a.onClick();
                                setExpanded(false);
                            }}
                            aria-label={a.label}
                            className="w-12 h-12 rounded-full flex items-center justify-center cursor-pointer transition-transform hover:scale-105"
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
                        </button>
                    </div>
                ))}

            {/* Main trigger */}
            <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-label={expanded ? 'Close quick actions' : 'Quick actions'}
                aria-expanded={expanded}
                className="w-14 h-14 rounded-full flex items-center justify-center cursor-pointer transition-all hover:scale-105"
                style={{
                    background: 'linear-gradient(135deg, oklch(0.85 0.14 90), oklch(0.64 0.16 78))',
                    boxShadow:
                        '0 12px 32px -6px oklch(0.65 0.16 78 / 0.55), 0 0 0 4px rgba(255,255,255,0.4)',
                    border: 'none',
                }}
            >
                <span
                    className="text-[#1a120a] transition-transform duration-200"
                    style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}
                >
                    {expanded ? <CloseIcon size={22} /> : <BotIcon size={24} />}
                </span>
            </button>
        </div>
    );
}
