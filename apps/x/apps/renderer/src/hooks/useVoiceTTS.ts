import { useCallback, useEffect, useRef, useState } from 'react';
import { dispatchCreditReplenished } from '@/lib/credit-status';

export type TTSState = 'idle' | 'synthesizing' | 'speaking';

interface SynthesizedAudio {
    dataUrl: string;
}

function synthesize(text: string): Promise<SynthesizedAudio> {
    return window.ipc.invoke('voice:synthesize', { text }).then(
        (result: { audioBase64: string; mimeType: string }) => {
            // A successful Rowboat voice synth is a cost-incurring call that
            // returned OK, so it proves credits are available again.
            dispatchCreditReplenished();
            return { dataUrl: `data:${result.mimeType};base64,${result.audioBase64}` };
        }
    );
}

function playAudio(
    dataUrl: string,
    audioRef: React.MutableRefObject<HTMLAudioElement | null>,
    onAudioElement?: (audio: HTMLAudioElement) => void
): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const audio = new Audio(dataUrl);
        audioRef.current = audio;
        onAudioElement?.(audio);
        audio.onended = () => {
            console.log('[tts] audio ended');
            resolve();
        };
        // pause() (from cancel) must settle this promise too, or the queue
        // loop stays parked on it forever. Natural end also fires 'pause'
        // just before 'ended'; double-resolve is harmless.
        audio.onpause = () => resolve();
        audio.onerror = (e) => {
            console.error('[tts] audio error:', e);
            reject(new Error('Audio playback failed'));
        };
        audio.play().then(() => {
            console.log('[tts] audio playing');
        }).catch((err) => {
            console.error('[tts] play() rejected:', err);
            reject(err);
        });
    });
}

/** A queue entry: text to synthesize, or a ready-to-play audio URL (e.g. a bundled clip). */
type QueueItem = { text: string } | { url: string };

type TtsChunkMsg = { requestId: string; chunkBase64?: string; done: boolean; error?: string };

export function useVoiceTTS() {
    const [state, setState] = useState<TTSState>('idle');
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const queueRef = useRef<QueueItem[]>([]);
    const processingRef = useRef(false);
    // Pre-fetched audio ready to play immediately
    const prefetchedRef = useRef<Promise<SynthesizedAudio> | null>(null);
    // Streaming synthesis: per-request chunk handlers + the in-flight request
    // id (so cancel() can abort the main-process fetch).
    const streamHandlersRef = useRef<Map<string, (msg: TtsChunkMsg) => void>>(new Map());
    const activeStreamIdRef = useRef<string | null>(null);
    // Bumped by cancel(). A queue loop that awaited across a cancel sees a
    // stale generation and exits instead of playing audio that was cancelled
    // while still synthesizing (which would overlap the next utterance).
    const generationRef = useRef(0);
    // Web Audio analyser tap for lip-sync (talking head)
    const audioCtxRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const levelBufferRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

    // Route playback through an AnalyserNode so consumers can read the live
    // output level. If Web Audio wiring fails, the element still plays directly.
    const connectAnalyser = useCallback((audio: HTMLAudioElement) => {
        try {
            let ctx = audioCtxRef.current;
            if (!ctx) {
                ctx = new AudioContext();
                audioCtxRef.current = ctx;
                const analyser = ctx.createAnalyser();
                analyser.fftSize = 512;
                analyser.smoothingTimeConstant = 0.5;
                analyser.connect(ctx.destination);
                analyserRef.current = analyser;
            }
            if (ctx.state === 'suspended') {
                void ctx.resume();
            }
            const source = ctx.createMediaElementSource(audio);
            source.connect(analyserRef.current!);
            // Detach once this chunk is done (ended, cancelled via pause, or
            // failed) so source nodes don't accumulate over a long session.
            const disconnect = () => {
                try {
                    source.disconnect();
                } catch {
                    // already disconnected
                }
            };
            audio.addEventListener('ended', disconnect, { once: true });
            audio.addEventListener('pause', disconnect, { once: true });
            audio.addEventListener('error', disconnect, { once: true });
        } catch (err) {
            console.error('[tts] analyser hookup failed:', err);
        }
    }, []);

    // Current output level, 0..1. Safe to call every animation frame.
    // Release the audio graph when the owning component unmounts
    useEffect(() => () => {
        audioCtxRef.current?.close().catch(() => {});
        audioCtxRef.current = null;
        analyserRef.current = null;
    }, []);

    // Route streaming TTS chunks to whichever request is waiting for them.
    useEffect(() => {
        return window.ipc.on('voice:tts-chunk', (msg) => {
            streamHandlersRef.current.get(msg.requestId)?.(msg);
        });
    }, []);

    /**
     * Streaming synthesis + playback via MediaSource: audio starts on the
     * first chunk instead of after the full body. Rejects (for caller
     * fallback to non-streaming synth) if the stream fails before any audio
     * arrived; resolves when playback finishes.
     */
    const streamSynthesizeAndPlay = useCallback((text: string, onStarted: () => void): Promise<void> => {
        return new Promise<void>((resolve, reject) => {
            if (typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported('audio/mpeg')) {
                reject(new Error('MSE audio/mpeg unsupported'));
                return;
            }
            const requestId = `tts-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
            const mediaSource = new MediaSource();
            const audio = new Audio();
            audio.src = URL.createObjectURL(mediaSource);
            audioRef.current = audio;
            connectAnalyser(audio);
            activeStreamIdRef.current = requestId;

            let sourceBuffer: SourceBuffer | null = null;
            const pending: Uint8Array[] = [];
            let streamDone = false;
            let gotAudio = false;
            let settled = false;

            const cleanup = () => {
                streamHandlersRef.current.delete(requestId);
                if (activeStreamIdRef.current === requestId) activeStreamIdRef.current = null;
                URL.revokeObjectURL(audio.src);
            };
            const finish = (err?: Error) => {
                if (settled) return;
                settled = true;
                cleanup();
                if (err) reject(err);
                else resolve();
            };

            // Drain pending chunks into the SourceBuffer one at a time
            // (appendBuffer is async; only one append may be in flight).
            const pump = () => {
                if (!sourceBuffer || sourceBuffer.updating || settled) return;
                const chunk = pending.shift();
                if (chunk) {
                    try {
                        sourceBuffer.appendBuffer(chunk as BufferSource);
                    } catch (e) {
                        finish(e as Error);
                    }
                    return;
                }
                if (streamDone && mediaSource.readyState === 'open') {
                    try {
                        mediaSource.endOfStream();
                    } catch { /* already ended */ }
                }
            };

            mediaSource.addEventListener('sourceopen', () => {
                try {
                    sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
                } catch (e) {
                    finish(e as Error);
                    return;
                }
                sourceBuffer.addEventListener('updateend', pump);
                pump();
            }, { once: true });

            streamHandlersRef.current.set(requestId, (msg) => {
                if (msg.error && !gotAudio) {
                    streamDone = true;
                    finish(new Error(msg.error));
                    return;
                }
                if (msg.chunkBase64) {
                    gotAudio = true;
                    const bin = atob(msg.chunkBase64);
                    const bytes = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                    pending.push(bytes);
                    pump();
                }
                if (msg.done) {
                    streamDone = true;
                    pump();
                }
            });

            audio.addEventListener('playing', () => onStarted(), { once: true });
            audio.onended = () => finish();
            // pause() (from cancel) must settle this promise too; natural end
            // also fires 'pause' just before 'ended'; double-settle is a no-op.
            audio.onpause = () => finish();
            audio.onerror = () => finish(new Error('stream playback failed'));

            window.ipc
                .invoke('voice:synthesizeStreamStart', { requestId, text })
                .then((res) => {
                    if (!res.ok) finish(new Error(res.error || 'stream start failed'));
                })
                .catch((e) => finish(e as Error));

            // Starts as soon as the first appended data is decodable.
            audio.play().catch(() => { /* surfaced via onerror / chunk error */ });

            // Nothing arrived at all — bail so the caller can fall back.
            setTimeout(() => {
                if (!gotAudio && !settled) finish(new Error('stream timeout'));
            }, 10_000);
        });
    }, [connectAnalyser]);

    const getLevel = useCallback((): number => {
        const analyser = analyserRef.current;
        if (!analyser) return 0;
        let buffer = levelBufferRef.current;
        if (!buffer || buffer.length !== analyser.fftSize) {
            buffer = new Uint8Array(analyser.fftSize);
            levelBufferRef.current = buffer;
        }
        analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
            const d = (buffer[i] - 128) / 128;
            sum += d * d;
        }
        const rms = Math.sqrt(sum / buffer.length);
        return Math.min(1, rms * 4);
    }, []);

    const processQueue = useCallback(async () => {
        if (processingRef.current) return;
        processingRef.current = true;
        const gen = generationRef.current;

        // Kick off full-body pre-fetch for the next queued text while the
        // current one plays — keeps sentence-to-sentence playback gapless.
        const prefetchNext = () => {
            const next = queueRef.current[0];
            if (next && 'text' in next && next.text.trim() && !prefetchedRef.current) {
                console.log('[tts] pre-fetching next:', next.text.substring(0, 80));
                prefetchedRef.current = synthesize(next.text);
            }
        };

        while (queueRef.current.length > 0) {
            const item = queueRef.current.shift()!;
            if ('text' in item && !item.text.trim()) continue;

            // Cold start (nothing playing, nothing pre-fetched): stream the
            // synthesis so audio begins on the first chunk instead of after
            // the full body — this is where first-response latency lives.
            if ('text' in item && !prefetchedRef.current) {
                setState('synthesizing');
                console.log('[tts] stream-synthesizing:', item.text.substring(0, 80));
                try {
                    await streamSynthesizeAndPlay(item.text, () => {
                        if (generationRef.current !== gen) return;
                        setState('speaking');
                        prefetchNext();
                    });
                    if (generationRef.current !== gen) return;
                    continue;
                } catch (err) {
                    if (generationRef.current !== gen) return;
                    console.error('[tts] stream failed, falling back to full synth:', err);
                    // fall through to the non-streaming path below
                }
            }

            try {
                // Pre-recorded URL plays as-is; text uses the pre-fetched
                // result if available, otherwise synthesizes now.
                let audioPromise: Promise<SynthesizedAudio>;
                if ('url' in item) {
                    audioPromise = Promise.resolve({ dataUrl: item.url });
                } else if (prefetchedRef.current) {
                    console.log('[tts] using pre-fetched audio');
                    audioPromise = prefetchedRef.current;
                    prefetchedRef.current = null;
                } else {
                    setState('synthesizing');
                    console.log('[tts] synthesizing:', item.text.substring(0, 80));
                    audioPromise = synthesize(item.text);
                }

                const audio = await audioPromise;
                // Cancelled while synthesizing — cancel() already reset all
                // state (and a new loop may be running), so just bail.
                if (generationRef.current !== gen) return;
                setState('speaking');

                prefetchNext();

                await playAudio(audio.dataUrl, audioRef, connectAnalyser);
                if (generationRef.current !== gen) return;
            } catch (err) {
                if (generationRef.current !== gen) return;
                console.error('[tts] error:', err);
                prefetchedRef.current = null;
            }
        }

        audioRef.current = null;
        prefetchedRef.current = null;
        processingRef.current = false;
        setState('idle');
    }, [connectAnalyser, streamSynthesizeAndPlay]);

    const speak = useCallback((text: string) => {
        console.log('[tts] speak() called:', text.substring(0, 80));
        queueRef.current.push({ text });
        processQueue();
    }, [processQueue]);

    // Play a pre-recorded clip (e.g. bundled tour narration) through the same
    // queue, so lip-sync levels, state, and cancel() all work unchanged.
    const speakUrl = useCallback((url: string) => {
        console.log('[tts] speakUrl() called:', url.substring(0, 120));
        queueRef.current.push({ url });
        processQueue();
    }, [processQueue]);

    const cancel = useCallback(() => {
        generationRef.current++;
        queueRef.current = [];
        prefetchedRef.current = null;
        // Abort any in-flight streaming synthesis in the main process.
        if (activeStreamIdRef.current) {
            void window.ipc
                .invoke('voice:synthesizeStreamCancel', { requestId: activeStreamIdRef.current })
                .catch(() => {});
            activeStreamIdRef.current = null;
        }
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
        }
        processingRef.current = false;
        setState('idle');
    }, []);

    return { state, speak, speakUrl, cancel, getLevel };
}
