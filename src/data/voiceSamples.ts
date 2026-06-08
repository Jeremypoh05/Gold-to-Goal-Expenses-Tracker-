// ADDED (Phase 6): scripted voice data. Everything here is mock — it simulates
// the speech→AI-parse experience so the UI can be built and demoed. Phase 9
// replaces VOICE_SAMPLES with real speech-to-text + Claude parsing, and
// INITIAL_VOICE_LOGS with DB-backed history.

import type { VoiceSample, VoiceLog } from "@/types";

// ─────────────────────────────────────────────────────────────
// Scripted utterances — the idle orb cycles these; tapping the mic
// "hears" the currently-shown one, then "parses" it into VoiceParsed.
// Bilingual on purpose (EN / 中文 / Singlish) to show off multilingual parsing.
// ─────────────────────────────────────────────────────────────
export const VOICE_SAMPLES: VoiceSample[] = [
  {
    id: 1,
    lang: "zh+en",
    transcript:
      "今天购物了一个 Uniqlo 衬衫 148 dollars, 嗯… actually no note please",
    parsed: { cat: "shop", amt: 148, note: "", currency: "SGD" },
    learned: "You prefer minimal notes on Shopping",
    ms: 0.4,
  },
  {
    id: 2,
    lang: "en",
    transcript: "Grab to the airport, twenty eight dollars",
    parsed: { cat: "trans", amt: 28, note: "Grab · to airport", currency: "SGD" },
    learned: "“Grab” → Transport",
    ms: 0.3,
  },
  {
    id: 3,
    lang: "zh",
    transcript: "早餐吃了5块, kaya toast + kopi",
    parsed: { cat: "food", amt: 5, note: "Kaya toast + kopi", currency: "SGD" },
    learned: "Breakfast spots → Food",
    ms: 0.3,
  },
  {
    id: 4,
    lang: "Singlish",
    transcript: "eh lunch at hawker 6.50 lah",
    parsed: { cat: "food", amt: 6.5, note: "Lunch · hawker", currency: "SGD" },
    learned: "Singlish understood ✓",
    ms: 0.4,
  },
];

// ─────────────────────────────────────────────────────────────
// Seed for the Recent voice logs review panel. Mirrors the two
// voice-logged sample expenses (+ a couple more) with transcripts.
// ─────────────────────────────────────────────────────────────
export const INITIAL_VOICE_LOGS: VoiceLog[] = [
  {
    id: 101,
    lang: "zh",
    transcript: "早餐 kaya toast + kopi 5块",
    cat: "food",
    amt: 5.0,
    currency: "SGD",
    note: "Kaya toast + kopi",
    time: "08:12",
    day: 23,
    status: "confirmed",
  },
  {
    id: 102,
    lang: "zh+en",
    transcript: "lunch 鸡饭 chicken rice 12.80",
    cat: "food",
    amt: 12.8,
    currency: "SGD",
    note: "Lunch · chicken rice",
    time: "13:02",
    day: 23,
    status: "confirmed",
  },
  {
    id: 103,
    lang: "en",
    transcript: "flat white coffee six fifty",
    cat: "ent",
    amt: 6.5,
    currency: "SGD",
    note: "Flat white ☕",
    time: "15:30",
    day: 23,
    status: "edited",
  },
  {
    id: 104,
    lang: "Singlish",
    transcript: "grab to client meeting 14.80 lah",
    cat: "trans",
    amt: 14.8,
    currency: "SGD",
    note: "Grab · to client",
    time: "09:05",
    day: 22,
    status: "confirmed",
  },
];
