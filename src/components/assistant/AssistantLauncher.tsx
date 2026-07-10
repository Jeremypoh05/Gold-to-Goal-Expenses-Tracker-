'use client';

// ADDED (AI Assistant · Slice 1): the global floating launcher — sits above the
// floating mic on desktop, above the tab bar on mobile. Hidden on /assistant
// (the full-page chat is already open there).
import { usePathname } from 'next/navigation';
import { SparkleIcon } from '@/components/icons';
import { useAssistant } from './AssistantContext';

export function AssistantLauncher() {
    const { togglePanel, open } = useAssistant();
    const pathname = usePathname();
    if (pathname === '/assistant' || open) return null;

    return (
        <button
            type="button"
            onClick={togglePanel}
            className="fixed bottom-24 right-5 md:bottom-[104px] md:right-8 z-30 w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center cursor-pointer transition-all hover:scale-105"
            style={{
                background: 'linear-gradient(135deg, oklch(0.9 0.1 95), oklch(0.78 0.14 85))',
                boxShadow:
                    '0 12px 32px -6px oklch(0.65 0.16 78 / 0.45), 0 0 0 4px rgba(255,255,255,0.35)',
                border: 'none',
            }}
            aria-label="Open Honey assistant"
        >
            <SparkleIcon size={22} className="text-[#1a120a]" />
        </button>
    );
}
