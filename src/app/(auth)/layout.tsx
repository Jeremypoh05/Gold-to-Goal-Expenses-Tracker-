// ADDED (Phase 7 · Auth): shell for the sign-in / sign-up pages — centered Honey
// brand + ambient orbs, no sidebar/topbar. Route group `(auth)` keeps URLs as
// /sign-in and /sign-up. Dark-aware via tokens.

import { Orbs } from '@/components/shared';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden bg-bg-0 px-4 py-10">
            <Orbs count={3} />

            <div className="relative z-10 flex flex-col items-center">
                {/* Brand */}
                <div className="flex items-center gap-2.5 mb-8">
                    <div
                        className="w-9 h-9 rounded-[10px] flex items-center justify-center shadow-gold"
                        style={{
                            background:
                                'linear-gradient(135deg, oklch(0.85 0.14 90), oklch(0.65 0.16 78))',
                        }}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="#1a120a">
                            <path d="M12 2 L13.5 9 L20 10.5 L13.5 12 L12 19 L10.5 12 L4 10.5 L10.5 9 Z" />
                        </svg>
                    </div>
                    <div>
                        <div className="display text-[20px] leading-none">Honey</div>
                        <div className="text-[10px] uppercase tracking-[0.1em] text-ink-2 mt-0.5">
                            expense tracker
                        </div>
                    </div>
                </div>

                {children}
            </div>
        </div>
    );
}
