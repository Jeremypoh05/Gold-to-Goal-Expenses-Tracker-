'use client';

import { motion } from 'framer-motion';

export function CalendarHint() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
      className="shine-wrap inline-flex items-center gap-2 rounded-full px-3.5 py-1.5"
      style={{
        background:
          'linear-gradient(135deg, oklch(0.97 0.045 92), oklch(0.93 0.085 88))',
        border: '1px solid oklch(0.85 0.10 88)',
        boxShadow:
          '0 1px 0 rgba(255, 255, 255, 0.5) inset, 0 4px 12px -3px oklch(0.65 0.16 78 / 0.25)',
      }}
    >
      {/* Animated wand emoji */}
      <motion.span
        animate={{ rotate: [0, -10, 12, -8, 0] }}
        transition={{
          duration: 1.4,
          repeat: Infinity,
          repeatDelay: 3,
          ease: 'easeInOut',
        }}
        className="text-[14px]"
        style={{ display: 'inline-block', transformOrigin: 'bottom center' }}
      >
        🪄
      </motion.span>

      {/* Text — responsive */}
      <span className="text-[11px] md:text-xs font-medium text-gold-900">
        <span className="hidden md:inline">Hover any day for a peek</span>
        <span className="md:hidden">Tap a day for a peek</span>
      </span>
    </motion.div>
  );
}