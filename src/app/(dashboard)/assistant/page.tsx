'use client';

// ADDED (AI Assistant · Slice 1): the full-page assistant chat. Same AssistantChat
// core as the global slide-over (which hides itself on this route) — this surface
// just gives it room: full height, centered column, session history built in.
import { BotIcon } from '@/components/icons';
import { AssistantChat } from '@/components/assistant';

export default function AssistantPage() {
    return (
        <div className="h-full flex flex-col max-w-3xl w-full mx-auto px-4 md:px-6 pt-4 md:pt-6">
            <div className="flex items-center gap-3 pb-3">
                <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center shadow-gold"
                    style={{
                        background: 'linear-gradient(135deg, oklch(0.85 0.14 90), oklch(0.65 0.16 78))',
                    }}
                >
                    <BotIcon size={22} className="text-[#1a120a]" />
                </div>
                <div>
                    <h1 className="display text-[22px] leading-none m-0">Assistant</h1>
                    <p className="text-[11.5px] text-ink-2 m-0 mt-1">
                        Ask about spending, recurring bills, savings goals — 中文 or English.
                    </p>
                </div>
            </div>

            <div
                className="flex-1 min-h-0 flex flex-col rounded-t-3xl border border-b-0 border-line-soft overflow-hidden"
                style={{ background: 'var(--surface-glass-soft)', backdropFilter: 'blur(20px)' }}
            >
                <AssistantChat active className="flex-1" />
            </div>
        </div>
    );
}
