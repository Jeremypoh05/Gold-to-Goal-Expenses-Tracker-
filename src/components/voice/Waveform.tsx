'use client';

// ADDED (Phase 6): reusable animated waveform. Bars use the `.wave-bar` keyframe
// from globals.css; when `active` they scale up/down on a staggered delay, when
// idle they sit static + dimmed. `color` drives the bar fill via currentColor.

interface WaveformProps {
    bars?: number;
    height?: number;
    color?: string;
    active?: boolean;
}

export function Waveform({
    bars = 28,
    height = 40,
    color = 'currentColor',
    active = true,
}: WaveformProps) {
    return (
        <div
            className="flex items-center gap-[3px]"
            style={{ height, color, opacity: active ? 1 : 0.4 }}
        >
            {Array.from({ length: bars }).map((_, i) => {
                // Deterministic varied heights (no Math.random → stable across renders)
                const h = 6 + Math.abs(Math.sin(i * 1.3)) * (height - 10);
                return (
                    <div
                        key={i}
                        className={active ? 'wave-bar' : ''}
                        style={{
                            width: 3,
                            height: active ? h : 4,
                            background: 'currentColor',
                            borderRadius: 2,
                            animationDelay: `${(i % 7) * 0.12}s`,
                        }}
                    />
                );
            })}
        </div>
    );
}
