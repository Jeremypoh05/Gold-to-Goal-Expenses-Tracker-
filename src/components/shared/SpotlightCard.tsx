'use client';

// ADDED (Module 4 · viz): a soft gold gradient + themed border glow that follow the
// cursor on hover (mouse only — touch skips it). Replaces the heavier shine sweep.
// Drop-in on any card: add `spotlight-card` to its className, wire
// `onPointerMove={spotlightMove}`, and render <SpotlightLayer/> as the first child:
//   <motion.div className="… spotlight-card" onPointerMove={spotlightMove}>
//     <SpotlightLayer />
//     …content…
//   </motion.div>
// The highlight/border-glow (radius + colour) live in globals.css `.spotlight-card`.

/** Track the cursor position as CSS vars on the hovered card (mouse only). */
export function spotlightMove(e: React.PointerEvent<HTMLElement>) {
    if (e.pointerType !== 'mouse') return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
}

/** The gradient overlay element. Render as the first child of a `.spotlight-card`. */
export function SpotlightLayer() {
    return <span aria-hidden className="spotlight-layer" />;
}
