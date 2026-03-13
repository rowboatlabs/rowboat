import { useCallback, useRef, useState } from 'react';

export type TTSState = 'idle' | 'synthesizing' | 'speaking';

export function useVoiceTTS() {
    const [state, setState] = useState<TTSState>('idle');
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const queueRef = useRef<string[]>([]);
    const processingRef = useRef(false);

    const processQueue = useCallback(async () => {
        if (processingRef.current) return;
        processingRef.current = true;

        while (queueRef.current.length > 0) {
            const text = queueRef.current.shift()!;
            if (!text.trim()) continue;

            setState('synthesizing');
            console.log('[tts] synthesizing:', text.substring(0, 80));
            try {
                const result = await window.ipc.invoke('voice:synthesize', { text });
                console.log('[tts] got audio, mimeType:', result.mimeType, 'base64 length:', result.audioBase64.length);
                setState('speaking');

                await new Promise<void>((resolve, reject) => {
                    const dataUrl = `data:${result.mimeType};base64,${result.audioBase64}`;
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
            } catch (err) {
                console.error('[tts] error:', err);
            }
        }

        audioRef.current = null;
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
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
        }
        processingRef.current = false;
        setState('idle');
    }, []);

    return { state, speak, cancel };
}
