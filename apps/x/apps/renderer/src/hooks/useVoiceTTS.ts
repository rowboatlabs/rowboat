import { useCallback, useRef, useState } from 'react';

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

function playAudio(dataUrl: string, audioRef: React.MutableRefObject<HTMLAudioElement | null>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const audio = new Audio(dataUrl);
        audioRef.current = audio;
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

                await playAudio(audio.dataUrl, audioRef);
            } catch (err) {
                console.error('[tts] error:', err);
                prefetchedRef.current = null;
            }
        }

        audioRef.current = null;
        prefetchedRef.current = null;
        processingRef.current = false;
        setState('idle');
    }, []);

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

    return { state, speak, cancel };
}
