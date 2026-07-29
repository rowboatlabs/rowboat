import { useCallback, useRef, useState } from 'react';
import { buildDeepgramListenUrl } from '@/lib/deepgram-listen-url';
import { finalizeDeepgramStream } from '@/lib/deepgram-finalize';
import { useRowboatAccount } from '@/hooks/useRowboatAccount';
import { fetchRowboatConfig } from '@/hooks/use-rowboat-config';
import posthog from 'posthog-js';
import * as analytics from '@/lib/analytics';

export type VoiceState = 'idle' | 'connecting' | 'listening' | 'submitting';

const DEEPGRAM_PARAMS = new URLSearchParams({
    model: 'nova-3',
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    interim_results: 'true',
    smart_format: 'true',
    punctuate: 'true',
    language: 'en',
    endpointing: '100',
    no_delay: 'true',
});
// While the mic is paused (PTT gate closed), keep the idle Deepgram socket
// alive — it closes after ~10s without audio otherwise.
const KEEPALIVE_INTERVAL_MS = 5000;

// Cap on retained per-frame amplitude samples (~64ms/frame ⇒ ~5 min of history).
// The waveform only ever displays the most recent window, so older samples are dropped.
const MAX_AUDIO_LEVELS = 4800;

// Auto-gain for the waveform: each frame's amplitude is stored normalized against a
// running peak (instant attack, slow release) so bar heights track the *relative*
// loudness of the voice accurately regardless of mic/OS input gain. MIN_PEAK is a
// floor so near-silence doesn't get amplified up into tall bars.
const PEAK_DECAY = 0.97;
const MIN_PEAK = 0.02;

// Cache auth details so we don't need IPC round-trips on every mic click
let cachedAuth: { type: 'rowboat'; url: string; token: string } | { type: 'local'; apiKey: string } | null = null;

export function useVoiceMode() {
    const { refresh: refreshRowboatAccount } = useRowboatAccount();
    const [state, setState] = useState<VoiceState>('idle');
    const [interimText, setInterimText] = useState('');
    const wsRef = useRef<WebSocket | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const transcriptBufferRef = useRef('');
    const interimRef = useRef('');
    // Buffer audio chunks captured before the WebSocket is ready
    const audioBufferRef = useRef<ArrayBuffer[]>([]);
    // Rolling history of per-frame mic amplitude (auto-gained to 0..1), oldest first.
    // Drives the live waveform — the UI reads this via requestAnimationFrame so
    // amplitude updates never re-render the rest of the tree.
    const audioLevelsRef = useRef<number[]>([]);
    // Running peak amplitude for the waveform auto-gain (see PEAK_DECAY/MIN_PEAK).
    const audioPeakRef = useRef(0);
    // Push-to-talk call mode: invoked with the utterance captured between
    // pttBegin() and pttEnd().
    const pttCbRef = useRef<((text: string) => void) | null>(null);
    // While true (PTT gate closed), mic audio is dropped instead of streamed.
    const pausedRef = useRef(false);
    const keepAliveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Refresh cached auth details (called on warmup, not on mic click)
    const refreshAuth = useCallback(async () => {
        // Auth (account) and the websocket URL (bootstrap config) are
        // separate concerns: the token comes from account refresh, the URL
        // from the sign-in-independent config store.
        const [account, rowboatConfig] = await Promise.all([
            refreshRowboatAccount(),
            fetchRowboatConfig(),
        ]);
        if (
            account?.signedIn &&
            account.accessToken &&
            rowboatConfig?.websocketApiUrl
        ) {
            cachedAuth = { type: 'rowboat', url: rowboatConfig.websocketApiUrl, token: account.accessToken };
        } else {
            const config = await window.ipc.invoke('voice:getConfig', null);
            if (config?.deepgram) {
                cachedAuth = { type: 'local', apiKey: config.deepgram.apiKey };
            }
        }
    }, [refreshRowboatAccount]);

    // Create and connect a Deepgram WebSocket using cached auth.
    // Starts the connection and returns immediately (does not wait for open).
    const connectWs = useCallback(async () => {
        if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) return;

        // Refresh auth if we don't have it cached yet
        if (!cachedAuth) {
            await refreshAuth();
        }
        if (!cachedAuth) return;

        const params = DEEPGRAM_PARAMS;
        let ws: WebSocket;
        if (cachedAuth.type === 'rowboat') {
            const listenUrl = buildDeepgramListenUrl(cachedAuth.url, params);
            ws = new WebSocket(listenUrl, ['bearer', cachedAuth.token]);
        } else {
            ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, ['token', cachedAuth.apiKey]);
        }
        wsRef.current = ws;

        ws.onopen = () => {
            console.log('[voice] WebSocket connected');
            // Flush any buffered audio captured while we were connecting
            const buffered = audioBufferRef.current;
            audioBufferRef.current = [];
            for (const chunk of buffered) {
                ws.send(chunk);
            }
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (!data.channel?.alternatives?.[0]) return;
            const transcript = data.channel.alternatives[0].transcript;

            if (data.is_final) {
                if (transcript) {
                    transcriptBufferRef.current += (transcriptBufferRef.current ? ' ' : '') + transcript;
                    interimRef.current = '';
                    setInterimText(transcriptBufferRef.current);
                }
            } else if (transcript) {
                interimRef.current = transcript;
                setInterimText(transcriptBufferRef.current + (transcriptBufferRef.current ? ' ' : '') + transcript);
            }
        };

        ws.onerror = () => {
            console.error('[voice] WebSocket error');
            // Auth may be stale — clear cache so next attempt refreshes
            cachedAuth = null;
        };

        ws.onclose = () => {
            console.log('[voice] WebSocket closed');
            wsRef.current = null;
            // A PTT call is long-lived — if the socket drops while the call
            // is still on, reconnect instead of silently going deaf.
            if (pttCbRef.current) {
                setTimeout(() => {
                    if (pttCbRef.current && !wsRef.current) {
                        void connectWs();
                    }
                }, 1000);
            }
        };
    }, [refreshAuth]);

    const waitForWsOpen = useCallback(async (timeoutMs = 1500): Promise<boolean> => {
        const ws = wsRef.current;
        if (!ws) return false;
        if (ws.readyState === WebSocket.OPEN) return true;
        if (ws.readyState !== WebSocket.CONNECTING) return false;

        return new Promise<boolean>((resolve) => {
            let done = false;
            let timeout: ReturnType<typeof setTimeout>;
            const finish = (ok: boolean) => {
                if (done) return;
                done = true;
                clearTimeout(timeout);
                ws.removeEventListener('open', onOpen);
                ws.removeEventListener('error', onError);
                ws.removeEventListener('close', onClose);
                resolve(ok);
            };
            const onOpen = () => finish(true);
            const onError = () => finish(false);
            const onClose = () => finish(false);
            timeout = setTimeout(() => finish(false), timeoutMs);
            ws.addEventListener('open', onOpen);
            ws.addEventListener('error', onError);
            ws.addEventListener('close', onClose);
        });
    }, []);

    const flushBufferedAudio = useCallback(() => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const buffered = audioBufferRef.current;
        audioBufferRef.current = [];
        for (const chunk of buffered) {
            ws.send(chunk);
        }
    }, []);

    const stopInputCapture = useCallback(() => {
        if (processorRef.current) {
            processorRef.current.disconnect();
            processorRef.current = null;
        }
        if (audioCtxRef.current) {
            audioCtxRef.current.close();
            audioCtxRef.current = null;
        }
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(t => t.stop());
            mediaStreamRef.current = null;
        }
    }, []);

    // Stop audio capture and close WS
    const stopAudioCapture = useCallback(() => {
        stopInputCapture();
        if (wsRef.current) {
            wsRef.current.onclose = null;
            wsRef.current.close();
            wsRef.current = null;
        }
        pttCbRef.current = null;
        pausedRef.current = false;
        if (keepAliveTimerRef.current) {
            clearInterval(keepAliveTimerRef.current);
            keepAliveTimerRef.current = null;
        }
        audioBufferRef.current = [];
        audioLevelsRef.current = [];
        audioPeakRef.current = 0;
        setInterimText('');
        transcriptBufferRef.current = '';
        interimRef.current = '';
        setState('idle');
    }, [stopInputCapture]);

    const start = useCallback(async (): Promise<'ok' | 'mic-denied' | 'busy'> => {
        if (state !== 'idle') return 'busy';

        transcriptBufferRef.current = '';
        interimRef.current = '';
        setInterimText('');
        audioBufferRef.current = [];
        audioLevelsRef.current = [];
        audioPeakRef.current = 0;

        // Show listening immediately — don't wait for WebSocket
        setState('listening');
        analytics.voiceInputStarted();
        posthog.people.set_once({ has_used_voice: true });

        // Settle the OS-level microphone permission before capturing. On the
        // first-ever use (macOS) the permission is 'not-determined'; calling
        // getUserMedia directly would reject while the native prompt is up,
        // making the first mic click silently do nothing. Resolving it here
        // lets this same click proceed once the user grants access.
        const mic = await window.ipc
            .invoke('voice:ensureMicAccess', null)
            .catch(() => ({ granted: true }));
        if (!mic.granted) {
            console.error('Microphone access denied');
            stopAudioCapture();
            return 'mic-denied';
        }

        // Kick off mic + WebSocket in parallel, don't await WebSocket
        const [stream] = await Promise.all([
            navigator.mediaDevices.getUserMedia({ audio: true }).catch((err) => {
                console.error('Microphone access denied:', err);
                return null;
            }),
            connectWs(),
        ]);

        if (!stream) {
            // connectWs() may have already opened a socket — tear everything
            // down (close WS, reset buffers, state) rather than only resetting
            // state, which would leak the socket into the next attempt.
            stopAudioCapture();
            return 'mic-denied';
        }

        mediaStreamRef.current = stream;

        // Start audio capture immediately — buffer if WS isn't open yet
        const audioCtx = new AudioContext({ sampleRate: 16000 });
        audioCtxRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        // 1024-sample frames (~64ms at 16kHz) — smaller than the usual 2048 so the
        // waveform gets ~16 amplitude updates/sec, making bars appear faster and
        // flow more smoothly. Still a comfortable chunk size for Deepgram streaming.
        const processor = audioCtx.createScriptProcessor(1024, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
            // Paused (assistant is speaking in a call): drop mic audio so the
            // assistant's own TTS never gets transcribed back at it.
            if (pausedRef.current) return;
            const float32 = e.inputBuffer.getChannelData(0);
            const int16 = new Int16Array(float32.length);
            let sumSquares = 0;
            for (let i = 0; i < float32.length; i++) {
                const s = Math.max(-1, Math.min(1, float32[i]));
                int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
                sumSquares += s * s;
            }
            // Record this frame's loudness for the live waveform, auto-gained against
            // a running peak so bar heights accurately reflect the voice's dynamics.
            // Instant attack (a louder frame raises the peak immediately), slow
            // release (PEAK_DECAY), floored at MIN_PEAK so silence stays flat.
            const rms = Math.sqrt(sumSquares / float32.length);
            const peak = Math.max(rms, audioPeakRef.current * PEAK_DECAY, MIN_PEAK);
            audioPeakRef.current = peak;
            const levels = audioLevelsRef.current;
            levels.push(rms / peak);
            if (levels.length > MAX_AUDIO_LEVELS) {
                levels.splice(0, levels.length - MAX_AUDIO_LEVELS);
            }
            const buffer = int16.buffer;
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(buffer);
            } else {
                // WebSocket still connecting (or reconnecting mid-call) —
                // buffer the audio, bounded so an unreachable server during a
                // long call can't grow it without limit (~30s at 64ms/chunk).
                audioBufferRef.current.push(buffer);
                if (audioBufferRef.current.length > 500) {
                    audioBufferRef.current.shift();
                }
            }
        };

        source.connect(processor);
        processor.connect(audioCtx.destination);
        return 'ok';
    }, [state, connectWs, stopAudioCapture]);

    /** Stop recording and return the full transcript (finalized + any current interim) */
    const submit = useCallback(async (): Promise<string> => {
        setState('submitting');
        stopInputCapture();

        if (wsRef.current?.readyState === WebSocket.CONNECTING) {
            await waitForWsOpen();
        }
        flushBufferedAudio();
        await finalizeDeepgramStream(wsRef.current);

        let text = transcriptBufferRef.current;
        if (interimRef.current) {
            text += (text ? ' ' : '') + interimRef.current;
        }
        text = text.trim();

        stopAudioCapture();
        return text;
    }, [flushBufferedAudio, stopAudioCapture, stopInputCapture, waitForWsOpen]);

    /** Cancel recording without returning transcript */
    const cancel = useCallback(() => {
        stopAudioCapture();
    }, [stopAudioCapture]);

    /**
     * Open/close the PTT mic gate. Closing keeps the Deepgram socket alive
     * with KeepAlives and discards anything half-heard before the close.
     */
    const setPaused = useCallback((paused: boolean) => {
        if (pausedRef.current === paused) return;
        pausedRef.current = paused;
        if (paused) {
            transcriptBufferRef.current = '';
            interimRef.current = '';
            setInterimText('');
            keepAliveTimerRef.current = setInterval(() => {
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({ type: 'KeepAlive' }));
                }
            }, KEEPALIVE_INTERVAL_MS);
        } else if (keepAliveTimerRef.current) {
            clearInterval(keepAliveTimerRef.current);
            keepAliveTimerRef.current = null;
        }
    }, []);

    /**
     * Push-to-talk (call) mode: mic + Deepgram socket stay acquired for the
     * whole call (instant capture on key-down), but audio is gated OFF until
     * pttBegin(). No endpointing — the user's key release IS the endpoint.
     */
    const startPtt = useCallback(async (onUtterance: (text: string) => void) => {
        pttCbRef.current = onUtterance;
        const result = await start();
        // Gate closed until the PTT key goes down; KeepAlives hold the idle
        // socket open.
        if (result === 'ok') setPaused(true);
        return result;
    }, [start, setPaused]);

    /** PTT key down: open the mic gate and start a fresh utterance. */
    const pttBegin = useCallback(() => {
        if (!pttCbRef.current) return;
        setPaused(false);
        transcriptBufferRef.current = '';
        interimRef.current = '';
        setInterimText('');
    }, [setPaused]);

    /**
     * PTT key up: finalize what was heard, hand the utterance to the
     * callback, and close the gate again. The call session stays live.
     */
    const pttEnd = useCallback(async () => {
        if (!pttCbRef.current || pausedRef.current) return;
        // Let any audio buffered during a reconnect reach the server before
        // asking it to finalize.
        if (wsRef.current?.readyState === WebSocket.CONNECTING) {
            await waitForWsOpen();
        }
        flushBufferedAudio();
        await finalizeDeepgramStream(wsRef.current);
        let text = transcriptBufferRef.current;
        if (interimRef.current) {
            text += (text ? ' ' : '') + interimRef.current;
        }
        text = text.trim();
        // setPaused(true) clears the transcript buffers — read before gating.
        setPaused(true);
        const cb = pttCbRef.current;
        // Guard against teardown while finalize was in flight (call ended).
        if (text && cb) cb(text);
    }, [flushBufferedAudio, setPaused, waitForWsOpen]);

    /** PTT capture aborted (chord/escape): discard audio heard so far. */
    const pttCancel = useCallback(() => {
        if (!pttCbRef.current || pausedRef.current) return;
        setPaused(true);
    }, [setPaused]);

    /** Pre-cache auth details so mic click skips IPC round-trips */
    const warmup = useCallback(() => {
        refreshAuth().catch(() => {});
    }, [refreshAuth]);

    return { state, interimText, audioLevelsRef, start, submit, cancel, warmup, startPtt, pttBegin, pttEnd, pttCancel };
}
