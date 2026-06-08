// ─────────────────────────────────────────────────────────────
// Expense type definitions
// ─────────────────────────────────────────────────────────────

export type CategoryKey =
  | "food"
  | "shop"
  | "ent"
  | "trans"
  | "health"
  | "bills"
  | "other";

export interface Category {
  key: CategoryKey;
  label: string;
  color: string; // CSS variable reference, e.g. 'var(--color-hue-food)'
  hue: number; // OKLCH hue value for dynamic backgrounds
}

export interface Expense {
  id: number;
  day: number; // Day of month (1-31)
  time: string; // HH:MM format
  cat: CategoryKey;
  amt: number; // Amount in default currency (SGD)
  note: string;
  voice?: boolean; // Was this logged via voice?
  fixed?: boolean; // Is this a recurring fixed expense?
}

export interface MonthInfo {
  year: number;
  month: number; // 1-12
  day: number; // Today's day
}

export interface IncomeInfo {
  salary: number;
  bonuses: { month: number; amt: number; label: string }[];
  yearly: number;
  saved: number;
}

export type Currency = "SGD" | "USD" | "MYR" | "CNY";

// ─────────────────────────────────────────────────────────────
// Voice (Phase 6 — simulated; real speech/AI is Phase 9)
// ─────────────────────────────────────────────────────────────

/** The structured expense the (mock) AI extracts from a spoken utterance. */
export interface VoiceParsed {
  cat: CategoryKey;
  amt: number;
  note: string;
  currency: Currency;
}

/** A scripted utterance used to simulate the listen → parse flow. */
export interface VoiceSample {
  id: number;
  lang: string; // 'zh+en' | 'en' | 'zh' | 'Singlish'
  transcript: string;
  parsed: VoiceParsed;
  learned?: string; // "what Honey learned" memory-chip text
  ms: number; // simulated parse time in seconds (e.g. 0.4)
}

/** A past voice-logged entry shown in the Recent voice logs panel. */
export interface VoiceLog {
  id: number;
  lang: string;
  transcript: string;
  cat: CategoryKey;
  amt: number;
  currency: Currency; // ADDED (Phase 6.1): editable in the history editor
  note: string;
  time: string; // HH:MM
  day: number;
  status: "confirmed" | "edited" | "reparsed";
}
