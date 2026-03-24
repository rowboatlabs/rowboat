import { useCallback, useRef, useState } from 'react';
import { buildDeepgramListenUrl } from '@/lib/deepgram-listen-url';
import { useRowboatAccount } from '@/hooks/useRowboatAccount';

export type VoiceState = 'idle' | 'connecting' | 'listening';

const DEEPGRAM_PARAMS = new URLSearchParams({
    model: 'nova-3',
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    interim_results: 'true',
    smart_format: 'true',
    punctuate: 'true',
    language: 'en',
});
const DEEPGRAM_LISTEN_URL = `wss://api.deepgram.com/v1/listen?${DEEPGRAM_PARAMS.toString()}`;

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

    // Connect (or reconnect) the Deepgram WebSocket.
    // Refreshes Rowboat account before connect so access token is current.
    const connectWs = useCallback(async () => {
        if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) return;

        let ws: WebSocket;

        const account = await refreshRowboatAccount();
        if (
            account?.signedIn &&
            account.accessToken &&
            account.config?.websocketApiUrl
        ) {
            const listenUrl = buildDeepgramListenUrl(account.config.websocketApiUrl, DEEPGRAM_PARAMS);
            ws = new WebSocket(listenUrl, ['bearer', account.accessToken]);
        } else {
            // Fall back to local API key (passed as subprotocol)
            const config = await window.ipc.invoke('voice:getConfig', null);
            if (!config?.deepgram) return;
            ws = new WebSocket(DEEPGRAM_LISTEN_URL, ['token', config.deepgram.apiKey]);
        }
        wsRef.current = ws;

        ws.onopen = () => {
            console.log('[voice] WebSocket connected');
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (!data.channel?.alternatives?.[0]) return;

            const transcript = data.channel.alternatives[0].transcript;
            if (!transcript) return;

            if (data.is_final) {
                transcriptBufferRef.current += (transcriptBufferRef.current ? ' ' : '') + transcript;
                interimRef.current = '';
                setInterimText(transcriptBufferRef.current);
            } else {
                interimRef.current = transcript;
                setInterimText(transcriptBufferRef.current + (transcriptBufferRef.current ? ' ' : '') + transcript);
            }
        };

        ws.onerror = () => {
            console.error('[voice] WebSocket error');
        };

        ws.onclose = () => {
            console.log('[voice] WebSocket closed');
            wsRef.current = null;
        };
    }, [refreshRowboatAccount]);

    // Stop audio capture and close WS
    const stopAudioCapture = useCallback(() => {
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
        if (wsRef.current) {
            wsRef.current.onclose = null;
            wsRef.current.close();
            wsRef.current = null;
        }
        setInterimText('');
        transcriptBufferRef.current = '';
        interimRef.current = '';
        setState('idle');
    }, []);

    const start = useCallback(async () => {
        if (state !== 'idle') return;

        transcriptBufferRef.current = '';
        interimRef.current = '';
        setInterimText('');

        // If WS isn't connected, connect and wait for it
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            setState('connecting');
            connectWs();
            // Wait for WS to be ready (up to 5 seconds)
            const wsOk = await new Promise<boolean>((resolve) => {
                const checkInterval = setInterval(() => {
                    if (wsRef.current?.readyState === WebSocket.OPEN) {
                        clearInterval(checkInterval);
                        resolve(true);
                    }
                }, 50);
                setTimeout(() => {
                    clearInterval(checkInterval);
                    resolve(false);
                }, 5000);
            });
            if (!wsOk) {
                setState('idle');
                return;
            }
        }

        setState('listening');

        // Start mic
        let stream: MediaStream | null = null;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err) {
            console.error('Microphone access denied:', err);
            setState('idle');
            return;
        }

        mediaStreamRef.current = stream;

        // Start audio capture
        const audioCtx = new AudioContext({ sampleRate: 16000 });
        audioCtxRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
            if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
            const float32 = e.inputBuffer.getChannelData(0);
            const int16 = new Int16Array(float32.length);
            for (let i = 0; i < float32.length; i++) {
                const s = Math.max(-1, Math.min(1, float32[i]));
                int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
            wsRef.current.send(int16.buffer);
        };

        source.connect(processor);
        processor.connect(audioCtx.destination);
    }, [state, connectWs]);

    /** Stop recording and return the full transcript (finalized + any current interim) */
    const submit = useCallback((): string => {
        let text = transcriptBufferRef.current;
        if (interimRef.current) {
            text += (text ? ' ' : '') + interimRef.current;
        }
        text = text.trim();
        stopAudioCapture();
        return text;
    }, [stopAudioCapture]);

    /** Cancel recording without returning transcript */
    const cancel = useCallback(() => {
        stopAudioCapture();
    }, [stopAudioCapture]);

    return { state, interimText, start, submit, cancel };
}
