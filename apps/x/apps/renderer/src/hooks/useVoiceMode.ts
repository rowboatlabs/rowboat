import { useCallback, useRef, useState } from 'react';
import { buildDeepgramListenUrl } from '@/lib/deepgram-listen-url';
import { finalizeDeepgramStream } from '@/lib/deepgram-finalize';
import { useRowboatAccount } from '@/hooks/useRowboatAccount';
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
// Hands-free (continuous) mode: Deepgram's endpoint fires FAST (600ms of
// silence) and we apply smart hold logic on our side — if the transcript
// already reads as a complete thought (terminal punctuation) the utterance
// fires immediately, otherwise we hold INCOMPLETE_HOLD_MS longer in case the
// user was mid-thought. Net effect: complete sentences turn around ~1.2s
// faster than the old fixed 1800ms endpoint, while thinking pauses still get
// the same total grace (~1.8s).
const CONTINUOUS_ENDPOINTING_MS = 600;
const INCOMPLETE_HOLD_MS = 1200;
// While the mic is paused (assistant speaking), keep the idle Deepgram socket
// alive — it closes after ~10s without audio otherwise.
const KEEPALIVE_INTERVAL_MS = 5000;

// Deepgram punctuates finals (punctuate=true) — a transcript ending in
// terminal punctuation (optionally inside a closing quote/paren) is treated
// as a complete thought.
const COMPLETE_THOUGHT_RE = /[.!?…]["')\]]*\s*$/;

function deepgramParams(continuous: boolean): URLSearchParams {
    if (!continuous) return DEEPGRAM_PARAMS;
    const params = new URLSearchParams(DEEPGRAM_PARAMS);
    params.set('endpointing', String(CONTINUOUS_ENDPOINTING_MS));
    // Second end-of-speech signal: speech_final can be missed (it often rides
    // on a result with an empty transcript, or never fires when background
    // noise keeps the endpointer engaged). UtteranceEnd is word-timing based
    // and arrives as its own message type, so we listen for both.
    params.set('utterance_end_ms', '1000');
    return params;
}

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
    // Hands-free mode: invoked with each completed utterance (speech_final).
    const continuousCbRef = useRef<((text: string) => void) | null>(null);
    // While true (assistant is speaking), mic audio is dropped instead of streamed.
    const pausedRef = useRef(false);
    // Push-to-talk hold (calls): while true, audio flows even when paused and
    // the utterance never auto-fires — it ends when the user releases the hold.
    const holdRef = useRef(false);
    const keepAliveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    // Pending mid-thought hold (smart endpointing) — see maybeEndUtterance.
    const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Refresh cached auth details (called on warmup, not on mic click)
    const refreshAuth = useCallback(async () => {
        const account = await refreshRowboatAccount();
        if (
            account?.signedIn &&
            account.accessToken &&
            account.config?.websocketApiUrl
        ) {
            cachedAuth = { type: 'rowboat', url: account.config.websocketApiUrl, token: account.accessToken };
        } else {
            const config = await window.ipc.invoke('voice:getConfig', null);
            if (config?.deepgram) {
                cachedAuth = { type: 'local', apiKey: config.deepgram.apiKey };
            }
        }
    }, [refreshRowboatAccount]);

    // Hands-free mode: flush the accumulated utterance to the callback.
    // Both end-of-speech signals may fire for the same utterance — the second
    // finds an empty buffer and is a no-op.
    const fireContinuousUtterance = useCallback(() => {
        if (holdTimerRef.current) {
            clearTimeout(holdTimerRef.current);
            holdTimerRef.current = null;
        }
        if (!continuousCbRef.current || pausedRef.current || holdRef.current) return;
        const utterance = transcriptBufferRef.current.trim();
        transcriptBufferRef.current = '';
        interimRef.current = '';
        setInterimText('');
        if (utterance) continuousCbRef.current(utterance);
    }, []);

    // Smart endpoint: Deepgram's endpoint fires fast (600ms). If the
    // transcript reads as a complete thought, hand it off immediately; if it
    // trails off mid-sentence ("so what I want is…"), hold a little longer —
    // resumed speech cancels the hold and the utterance keeps growing.
    const maybeEndUtterance = useCallback(() => {
        // A push-to-talk hold owns the endpoint: the utterance ends when the
        // user releases, never on silence detection.
        if (!continuousCbRef.current || pausedRef.current || holdRef.current) return;
        const buffered = transcriptBufferRef.current.trim();
        if (!buffered) return;
        if (COMPLETE_THOUGHT_RE.test(buffered)) {
            fireContinuousUtterance();
            return;
        }
        if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
        holdTimerRef.current = setTimeout(() => {
            holdTimerRef.current = null;
            fireContinuousUtterance();
        }, INCOMPLETE_HOLD_MS);
    }, [fireContinuousUtterance]);

    // Create and connect a Deepgram WebSocket using cached auth.
    // Starts the connection and returns immediately (does not wait for open).
    const connectWs = useCallback(async (continuous = false) => {
        if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) return;

        // Refresh auth if we don't have it cached yet
        if (!cachedAuth) {
            await refreshAuth();
        }
        if (!cachedAuth) return;

        const params = deepgramParams(continuous);
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

            // Hands-free mode: word-timing based end-of-speech marker.
            if (data.type === 'UtteranceEnd') {
                maybeEndUtterance();
                return;
            }

            if (!data.channel?.alternatives?.[0]) return;
            const transcript = data.channel.alternatives[0].transcript;

            // The user resumed speaking — cancel any pending mid-thought hold
            // so the utterance keeps growing instead of firing under them.
            if (transcript && holdTimerRef.current) {
                clearTimeout(holdTimerRef.current);
                holdTimerRef.current = null;
            }

            if (data.is_final) {
                // NOTE: the endpoint marker (speech_final) usually arrives on a
                // result whose transcript is EMPTY — the silence after the user
                // stops talking. Empty finals must still reach the speech_final
                // check below or hands-free utterances never complete.
                if (transcript) {
                    transcriptBufferRef.current += (transcriptBufferRef.current ? ' ' : '') + transcript;
                    interimRef.current = '';
                }
                // Hands-free mode: an endpoint may complete the utterance —
                // immediately for complete thoughts, after a short hold for
                // mid-sentence trails.
                if (continuousCbRef.current && data.speech_final) {
                    maybeEndUtterance();
                    return;
                }
                if (transcript) {
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
            // A hands-free call is long-lived — if the socket drops while the
            // call is still on, reconnect instead of silently going deaf.
            if (continuousCbRef.current) {
                setTimeout(() => {
                    if (continuousCbRef.current && !wsRef.current) {
                        void connectWs(true);
                    }
                }, 1000);
            }
        };
    }, [refreshAuth, maybeEndUtterance]);

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
        continuousCbRef.current = null;
        pausedRef.current = false;
        holdRef.current = false;
        if (holdTimerRef.current) {
            clearTimeout(holdTimerRef.current);
            holdTimerRef.current = null;
        }
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

    const start = useCallback(async (continuous = false) => {
        if (state !== 'idle') return;

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
            return;
        }

        // Kick off mic + WebSocket in parallel, don't await WebSocket
        const [stream] = await Promise.all([
            navigator.mediaDevices.getUserMedia({ audio: true }).catch((err) => {
                console.error('Microphone access denied:', err);
                return null;
            }),
            connectWs(continuous),
        ]);

        if (!stream) {
            // connectWs() may have already opened a socket — tear everything
            // down (close WS, reset buffers, state) rather than only resetting
            // state, which would leak the socket into the next attempt.
            stopAudioCapture();
            return;
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
            // assistant's own TTS never gets transcribed back at it. A
            // push-to-talk hold overrides the pause — the user explicitly
            // asked to be heard.
            if (pausedRef.current && !holdRef.current) return;
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
     * Hands-free (call) mode: listen continuously and invoke `onUtterance`
     * with each completed utterance. Runs until cancel()/stop.
     */
    const startContinuous = useCallback(async (onUtterance: (text: string) => void) => {
        continuousCbRef.current = onUtterance;
        await start(true);
    }, [start]);

    /**
     * Mute/unmute the continuous stream (used while the assistant is
     * thinking/speaking). Keeps the Deepgram socket alive with KeepAlives and
     * discards any half-heard utterance from before the pause.
     */
    const setPaused = useCallback((paused: boolean) => {
        if (pausedRef.current === paused) return;
        pausedRef.current = paused;
        if (paused) {
            if (holdTimerRef.current) {
                clearTimeout(holdTimerRef.current);
                holdTimerRef.current = null;
            }
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
     * Push-to-talk during a call (Wispr Flow style): start capturing on
     * hold, regardless of mute/auto-pause. While held, silence never ends the
     * utterance — endHold() is the one and only endpoint.
     */
    const startHold = useCallback(() => {
        if (!continuousCbRef.current || holdRef.current) return;
        // While paused (muted or assistant busy) the buffers only ever hold
        // stale fragments — start the held utterance clean.
        if (pausedRef.current) {
            transcriptBufferRef.current = '';
            interimRef.current = '';
            setInterimText('');
        }
        if (holdTimerRef.current) {
            clearTimeout(holdTimerRef.current);
            holdTimerRef.current = null;
        }
        holdRef.current = true;
    }, []);

    /** Release the push-to-talk hold: flush Deepgram and fire the utterance now. */
    const endHold = useCallback(async () => {
        if (!holdRef.current) return;
        holdRef.current = false;
        const cb = continuousCbRef.current;
        if (!cb) return;
        // Ask Deepgram to flush its tail so the last words land in the buffer.
        // (Finalize flushes the live stream without closing it.)
        await finalizeDeepgramStream(wsRef.current);
        // If we're not paused, the finalize response's speech_final may have
        // already fired the utterance through the normal path — the buffer is
        // then empty and this is a no-op instead of a double submit.
        let text = transcriptBufferRef.current;
        if (interimRef.current) {
            text += (text ? ' ' : '') + interimRef.current;
        }
        text = text.trim();
        transcriptBufferRef.current = '';
        interimRef.current = '';
        setInterimText('');
        if (text) cb(text);
    }, []);

    /** Abandon a push-to-talk hold without submitting (e.g. it was a combo keypress). */
    const cancelHold = useCallback(() => {
        if (!holdRef.current) return;
        holdRef.current = false;
        // Paused = the hold was the only reason audio flowed; what it heard
        // must not leak into a later utterance. Unpaused = the buffer holds a
        // live hands-free utterance — leave it alone.
        if (pausedRef.current) {
            transcriptBufferRef.current = '';
            interimRef.current = '';
            setInterimText('');
        }
    }, []);

    /** Pre-cache auth details so mic click skips IPC round-trips */
    const warmup = useCallback(() => {
        refreshAuth().catch(() => {});
    }, [refreshAuth]);

    return { state, interimText, audioLevelsRef, start, submit, cancel, warmup, startContinuous, setPaused, startHold, endHold, cancelHold };
}
