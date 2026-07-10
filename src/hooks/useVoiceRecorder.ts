'use client';

// ADDED (Voice AI module): real microphone capture. Replaces the simulated
// useVoiceCapture for the live flow. States mirror the old hook (idle →
// listening → parsing → parsed) plus an `error` state, so the UI shape is
// familiar. Uses MediaRecorder + getUserMedia — supported on Chrome/Edge/
// Firefox and iOS Safari 14.3+ (needs HTTPS + a user tap, both satisfied).
// On stop it posts the audio to the transcribeExpense server action (OpenAI STT
// → Claude parse) and surfaces the structured result.

import { useEffect, useRef, useState } from 'react';
import { transcribeExpense, type VoiceParseResult } from '@/lib/actions';

export type RecStatus = 'idle' | 'listening' | 'parsing' | 'parsed' | 'error';

// Auto-stop so a forgotten recording can't balloon the upload / cost.
const MAX_RECORD_MS = 25_000;

function pickMimeType(): string {
    if (typeof MediaRecorder === 'undefined') return '';
    // Safari records audio/mp4 (AAC); Chromium/Firefox prefer webm/opus. Whisper
    // accepts all of these — feature-detect and take the first supported.
    for (const c of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) {
        if (MediaRecorder.isTypeSupported(c)) return c;
    }
    return '';
}

export function useVoiceRecorder() {
    const [status, setStatus] = useState<RecStatus>('idle');
    const [result, setResult] = useState<VoiceParseResult | null>(null);
    const [errorMsg, setErrorMsg] = useState('');

    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const streamRef = useRef<MediaStream | null>(null);
    const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const cleanupStream = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (autoStopRef.current) {
            clearTimeout(autoStopRef.current);
            autoStopRef.current = null;
        }
    };

    // Stop tracks if the component unmounts mid-recording.
    useEffect(() => cleanupStream, []);

    const fail = (msg: string) => {
        cleanupStream();
        setErrorMsg(msg);
        setStatus('error');
    };

    const start = async () => {
        setErrorMsg('');
        setResult(null);
        if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
            fail("This browser can't record audio. Try Chrome, Edge, or Safari.");
            return;
        }
        let stream: MediaStream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch {
            fail('Microphone access was blocked. Allow mic permission, then try again.');
            return;
        }
        streamRef.current = stream;

        let recorder: MediaRecorder;
        try {
            const mime = pickMimeType();
            recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        } catch {
            fail("This browser can't record audio in a supported format.");
            return;
        }

        chunksRef.current = [];
        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.onstop = async () => {
            cleanupStream();
            const type = recorder.mimeType || 'audio/webm';
            const blob = new Blob(chunksRef.current, { type });
            if (blob.size === 0) {
                fail("Didn't catch any audio — try again and speak after the tap.");
                return;
            }
            setStatus('parsing');
            try {
                const ext = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm';
                const fd = new FormData();
                fd.append('audio', blob, `voice.${ext}`);
                const res = await transcribeExpense(fd);
                // FIX (Phase B): only fail when the result is genuinely unusable
                // (res.ok === false). This USED to also fail on `!res.parsed` — but
                // edit/recurring intents intentionally have parsed === null (their
                // payload is res.edit, or the UI shows a "coming soon"/"not found"
                // card), so EVERY edit/recurring utterance wrongly showed "Could not
                // understand". Now ok results flow to VoiceCapture, which routes by intent.
                if (!res.ok) {
                    fail(
                        res.error === 'no-key'
                            ? "Voice AI isn't configured yet."
                            : res.error === 'empty'
                              ? "Didn't catch that — try speaking a little longer."
                              : res.error === 'stt-failed'
                                ? "I couldn't hear that clearly — try again, a bit louder or somewhere quieter."
                                : 'Could not understand that. Please try again.',
                    );
                    return;
                }
                setResult(res);
                setStatus('parsed');
            } catch {
                fail('Something went wrong transcribing that. Please try again.');
            }
        };

        recorder.start();
        recorderRef.current = recorder;
        setStatus('listening');
        // Safety auto-stop.
        autoStopRef.current = setTimeout(() => {
            if (recorderRef.current && recorderRef.current.state !== 'inactive') {
                recorderRef.current.stop();
            }
        }, MAX_RECORD_MS);
    };

    const stop = () => {
        if (autoStopRef.current) {
            clearTimeout(autoStopRef.current);
            autoStopRef.current = null;
        }
        if (recorderRef.current && recorderRef.current.state !== 'inactive') {
            recorderRef.current.stop();
        }
    };

    const reset = () => {
        if (recorderRef.current && recorderRef.current.state !== 'inactive') {
            recorderRef.current.stop();
        }
        cleanupStream();
        setResult(null);
        setErrorMsg('');
        setStatus('idle');
    };

    return { status, result, errorMsg, start, stop, reset };
}
