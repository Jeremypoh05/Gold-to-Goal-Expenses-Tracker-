'use client';

// ADDED (AI Assistant · Slice 1): assistant entry point. CHANGED (Slice 1 polish,
// user feedback): now MOBILE-ONLY — desktop consolidates mic + assistant into the
// AssistantDock speed-dial, so a lone launcher there would be the "two buttons"
// clutter the user flagged. On mobile the tab bar owns quick-voice (center mic),
// so this bot FAB is the dedicated assistant entry. Clear robot icon (was an
// ambiguous sparkle). Hidden on /assistant and while the panel is open.
import { usePathname } from 'next/navigation';
import { BotIcon } from '@/components/icons';
import { useAssistant } from './AssistantContext';

export function AssistantLauncher() {
    const { openPanel, open } = useAssistant();
    const pathname = usePathname();
    if (pathname === '/assistant' || open) return null;

    return (
        <button
            type="button"
            onClick={openPanel}
            // CHANGED (user feedback): the sonar-ring `.pulse` effect (matches the
            // desktop dock trigger) so the entry point invites a tap on mobile too.
            className="pulse md:hidden fixed bottom-24 right-5 z-30 w-12 h-12 rounded-full flex items-center justify-center cursor-pointer transition-all active:scale-95"
            style={{
                background: 'linear-gradient(135deg, oklch(0.85 0.14 90), oklch(0.64 0.16 78))',
                boxShadow:
                    '0 12px 32px -6px oklch(0.65 0.16 78 / 0.5), 0 0 0 4px rgba(255,255,255,0.35)',
                border: 'none',
            }}
            aria-label="Open Honey assistant"
        >
            <BotIcon size={22} className="text-[#1a120a]" />
        </button>
    );
}
