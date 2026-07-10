'use client';

// ADDED (AI Assistant · Slice 1): the global slide-over — the assistant is
// reachable from ANY page (it needs the whole-page context, per the locked
// architecture). Stays mounted while closed so the conversation survives
// open/close; hidden on /assistant, which renders the full-page chat instead.
import { usePathname } from 'next/navigation';
import { SparkleIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import { useAssistant } from './AssistantContext';
import { AssistantChat } from './AssistantChat';

function CloseIcon({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
        </svg>
    );
}

export function AssistantPanel() {
    const { open, closePanel } = useAssistant();
    const pathname = usePathname();
    if (pathname === '/assistant') return null;

    return (
        <>
            {/* Backdrop — mobile only (desktop panel floats over content) */}
            <div
                className={cn(
                    'fixed inset-0 z-40 bg-black/30 md:hidden transition-opacity',
                    open ? 'opacity-100' : 'opacity-0 pointer-events-none',
                )}
                onClick={closePanel}
                aria-hidden
            />

            <aside
                className={cn(
                    'fixed inset-y-0 right-0 z-40 w-full sm:w-[420px] flex flex-col border-l border-line-soft transition-transform duration-300 ease-out',
                    open ? 'translate-x-0' : 'translate-x-full',
                )}
                style={{
                    background: 'var(--surface-glass-soft)',
                    backdropFilter: 'blur(24px)',
                }}
                aria-label="Honey assistant"
            >
                {/* Header */}
                <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-line-soft">
                    <div
                        className="w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0"
                        style={{
                            background:
                                'linear-gradient(135deg, oklch(0.85 0.14 90), oklch(0.65 0.16 78))',
                        }}
                    >
                        <SparkleIcon size={16} className="text-[#1a120a]" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-semibold leading-none">Honey Assistant</div>
                        <div className="text-[10.5px] text-ink-2 mt-0.5">
                            Ask · analyze · plan — your data, gently
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={closePanel}
                        aria-label="Close assistant"
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-2 hover:text-ink-0 hover:bg-bg-2 transition-colors"
                    >
                        <CloseIcon size={16} />
                    </button>
                </div>

                <AssistantChat active={open} className="flex-1" />
            </aside>
        </>
    );
}
