'use client';

// ADDED (AI Assistant · Phase A follow-up): the desktop floating mic used to
// live inside the dashboard page, so it only appeared there. It's now a global
// component mounted once in DashboardShell → available on EVERY dashboard page
// (desktop only; mobile already has the mic orb in BottomTabBar). Hidden on
// /voice, which has its own big hero mic.
import { usePathname } from 'next/navigation';
import { MicIcon } from '@/components/icons';
import { useVoice } from './VoiceContext';

export function FloatingVoiceButton() {
    const { openModal } = useVoice();
    const pathname = usePathname();
    // The /voice hub already has the hero mic — don't double up.
    if (pathname === '/voice') return null;
    return (
        <button
            type="button"
            onClick={openModal}
            className="hidden md:flex fixed bottom-8 right-8 z-30 w-14 h-14 rounded-full items-center justify-center cursor-pointer transition-all hover:scale-105 pulse"
            style={{
                background: 'linear-gradient(135deg, oklch(0.82 0.155 88), oklch(0.64 0.155 75))',
                boxShadow: '0 12px 32px -6px oklch(0.65 0.16 78 / 0.55), 0 0 0 4px rgba(255,255,255,0.4)',
                border: 'none',
            }}
            aria-label="Quick voice log"
        >
            <MicIcon size={24} className="text-[#1a120a]" />
        </button>
    );
}
