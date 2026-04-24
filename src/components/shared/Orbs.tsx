interface OrbsProps {
    count?: number;
}

interface OrbSpec {
    x: string;
    y: string;
    size: number;
    variant: 1 | 2;
    opacity: number;
}

const ORB_SPECS: OrbSpec[] = [
    { x: '-10%', y: '-8%', size: 360, variant: 1, opacity: 0.55 },
    { x: '78%', y: '10%', size: 280, variant: 2, opacity: 0.40 },
    { x: '30%', y: '70%', size: 320, variant: 1, opacity: 0.30 },
];

/**
 * Ambient floating gold orbs in the background.
 * Pure decoration - has pointer-events: none so it never blocks interactions.
 */
export function Orbs({ count = 3 }: OrbsProps) {
    return (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
            {ORB_SPECS.slice(0, count).map((orb, i) => (
                <div
                    key={i}
                    className={`orb orb-${orb.variant}`}
                    style={{
                        left: orb.x,
                        top: orb.y,
                        width: orb.size,
                        height: orb.size,
                        opacity: orb.opacity,
                    }}
                />
            ))}
        </div>
    );
}