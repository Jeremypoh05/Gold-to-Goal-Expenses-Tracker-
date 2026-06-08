'use client';

// ADDED (Phase 6): the simulated voice capture state machine.
// idle → listening → parsing → parsed. All "AI"/mic behaviour is faked with
// timers + scripted VOICE_SAMPLES so the UI can be built now; Phase 9 swaps the
// body of this hook for real speech-to-text + Claude parsing behind the SAME
// states, so VoiceCapture.tsx won't need to change.
//
// React 19 note (06-LEARNINGS.md): state is only set inside event handlers or
// timer callbacks — never synchronously in an effect body — to avoid the
// cascading-render / set-state-in-effect warning.

import { useEffect, useMemo, useState } from 'react';
import { VOICE_SAMPLES } from '@/data/voiceSamples';

export type VoiceStatus = 'idle' | 'listening' | 'parsing' | 'parsed';

const REVEAL_MS = 1600; // time to "type" the transcript in
const LISTEN_HOLD_MS = 550; // small pause after transcript finishes
const CYCLE_MS = 2800; // idle example rotation

export function useVoiceCapture() {
    const [status, setStatus] = useState<VoiceStatus>('idle');
    const [sampleIndex, setSampleIndex] = useState(0);
    const [revealLen, setRevealLen] = useState(0);

    const sample = VOICE_SAMPLES[sampleIndex];

    // Idle: rotate through the bilingual examples (the "try saying…" hint).
    useEffect(() => {
        if (status !== 'idle') return;
        const t = setInterval(() => {
            setSampleIndex((i) => (i + 1) % VOICE_SAMPLES.length);
        }, CYCLE_MS);
        return () => clearInterval(t);
    }, [status]);

    // Listening: progressively reveal the transcript, then advance to parsing.
    useEffect(() => {
        if (status !== 'listening') return;
        const full = sample.transcript;
        const step = Math.max(18, REVEAL_MS / full.length);
        const reveal = setInterval(() => {
            setRevealLen((n) => (n >= full.length ? n : n + 1));
        }, step);
        const toParsing = setTimeout(() => setStatus('parsing'), REVEAL_MS + LISTEN_HOLD_MS);
        return () => {
            clearInterval(reveal);
            clearTimeout(toParsing);
        };
    }, [status, sample.transcript]);

    // Parsing: short "thinking" beat, then show the parsed result.
    useEffect(() => {
        if (status !== 'parsing') return;
        const ms = Math.max(600, sample.ms * 1000);
        const t = setTimeout(() => setStatus('parsed'), ms);
        return () => clearTimeout(t);
    }, [status, sample.ms]);

    // Visible transcript: typing during listening, full otherwise.
    const transcript = useMemo(() => {
        if (status === 'listening') return sample.transcript.slice(0, revealLen);
        if (status === 'idle') return sample.transcript; // shown as a hint
        return sample.transcript;
    }, [status, sample.transcript, revealLen]);

    // Controls (event handlers — safe to setState here)
    const start = () => {
        setRevealLen(0);
        setStatus('listening');
    };
    const reset = () => {
        setRevealLen(0);
        setStatus('idle');
    };
    const sayMore = () => {
        // hear a different example next
        setSampleIndex((i) => (i + 1) % VOICE_SAMPLES.length);
        setRevealLen(0);
        setStatus('listening');
    };

    return { status, sample, transcript, start, reset, sayMore };
}
