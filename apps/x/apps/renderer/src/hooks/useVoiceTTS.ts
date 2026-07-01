import { useCallback, useEffect, useRef, useState } from 'react';

export type TTSState = 'idle' | 'synthesizing' | 'speaking';

interface SynthesizedAudio {
    dataUrl: string;
}

function synthesize(text: string): Promise<SynthesizedAudio> {
    return window.ipc.invoke('voice:synthesize', { text }).then(
        (result: { audioBase64: string; mimeType: string }) => ({
            dataUrl: `data:${result.mimeType};base64,${result.audioBase64}`,
        })
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

export function useVoiceTTS() {
    const [state, setState] = useState<TTSState>('idle');
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const queueRef = useRef<string[]>([]);
    const processingRef = useRef(false);
    // Pre-fetched audio ready to play immediately
    const prefetchedRef = useRef<Promise<SynthesizedAudio> | null>(null);
    // Web Audio analyser tap for lip-sync (talking head)
    const audioCtxRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const levelBufferRef = useRef<Uint8Array | null>(null);

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

        while (queueRef.current.length > 0) {
            const text = queueRef.current.shift()!;
            if (!text.trim()) continue;

            try {
                // Use pre-fetched result if available, otherwise synthesize now
                let audioPromise: Promise<SynthesizedAudio>;
                if (prefetchedRef.current) {
                    console.log('[tts] using pre-fetched audio');
                    audioPromise = prefetchedRef.current;
                    prefetchedRef.current = null;
                } else {
                    setState('synthesizing');
                    console.log('[tts] synthesizing:', text.substring(0, 80));
                    audioPromise = synthesize(text);
                }

                const audio = await audioPromise;
                setState('speaking');

                // Kick off pre-fetch for next chunk while this one plays
                const nextText = queueRef.current[0];
                if (nextText?.trim()) {
                    console.log('[tts] pre-fetching next:', nextText.substring(0, 80));
                    prefetchedRef.current = synthesize(nextText);
                }

                await playAudio(audio.dataUrl, audioRef, connectAnalyser);
            } catch (err) {
                console.error('[tts] error:', err);
                prefetchedRef.current = null;
            }
        }

        audioRef.current = null;
        prefetchedRef.current = null;
        processingRef.current = false;
        setState('idle');
    }, [connectAnalyser]);

    const speak = useCallback((text: string) => {
        console.log('[tts] speak() called:', text.substring(0, 80));
        queueRef.current.push(text);
        processQueue();
    }, [processQueue]);

    const cancel = useCallback(() => {
        queueRef.current = [];
        prefetchedRef.current = null;
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
        }
        processingRef.current = false;
        setState('idle');
    }, []);

    return { state, speak, cancel, getLevel };
}
