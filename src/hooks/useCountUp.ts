"use client";

import { useEffect, useState } from "react";

interface UseCountUpOptions {
  /** Starting value (default: 0) */
  from?: number;
  /** Target value */
  to: number;
  /** Animation duration in ms (default: 1500) */
  duration?: number;
  /** Easing function (default: easeOutCubic) */
  easing?: (t: number) => number;
  /** Delay before animation starts in ms (default: 0) */
  delay?: number;
}

/**
 * Smoothly animates a number from `from` to `to` over `duration` ms.
 * Uses requestAnimationFrame for buttery smooth 60fps animation.
 *
 * @example
 * const value = useCountUp({ to: 2561.50, duration: 1200 });
 * return <div>{value.toFixed(2)}</div>;
 */
export function useCountUp({
  from = 0,
  to,
  duration = 1500,
  easing = easeOutCubic,
  delay = 0,
}: UseCountUpOptions): number {
  const [value, setValue] = useState(from);

   useEffect(() => {
     let rafId: number;
     let startTime: number | null = null;

     const tick = (currentTime: number) => {
       if (startTime === null) startTime = currentTime;
       const elapsed = currentTime - startTime;
       const progress = Math.min(elapsed / duration, 1);
       const eased = easing(progress);
       const current = from + (to - from) * eased;

       setValue(current);

       if (progress < 1) {
         rafId = requestAnimationFrame(tick);
       } else {
         setValue(to); // Snap to exact final value
       }
     };

     const timeoutId = setTimeout(() => {
       rafId = requestAnimationFrame(tick);
     }, delay);

     return () => {
       clearTimeout(timeoutId);
       if (rafId) cancelAnimationFrame(rafId);
     };
     // We intentionally re-run this effect when `to` changes
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [to]);

  return value;
}

// ─────────────────────────────────────────────────────────────
// Easing functions (premium feel)
// ─────────────────────────────────────────────────────────────

/** Smooth deceleration - feels expensive */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Even smoother deceleration - for hero numbers */
export function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

/** Bouncy at end - for fun animations */
export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
