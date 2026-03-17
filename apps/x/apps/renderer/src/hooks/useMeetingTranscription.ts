import { useCallback, useRef, useState } from 'react';

export type MeetingTranscriptionState = 'idle' | 'connecting' | 'recording' | 'stopping';

const DEEPGRAM_PARAMS = new URLSearchParams({
    model: 'nova-3',
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '2',
    multichannel: 'true',
    interim_results: 'true',
    smart_format: 'true',
    punctuate: 'true',
});
const DEEPGRAM_LISTEN_URL = `wss://api.deepgram.com/v1/listen?${DEEPGRAM_PARAMS.toString()}`;

interface TranscriptEntry {
    speaker: string;
    text: string;
}

function formatTranscript(entries: TranscriptEntry[], date: string): string {
    const lines = [
        '---',
        'type: meeting',
        'source: rowboat',
        'title: Meeting Transcription',
        `date: "${date}"`,
        '---',
        '',
        '# Meeting Transcription',
        '',
    ];
    for (const entry of entries) {
        lines.push(`**${entry.speaker}:** ${entry.text}`);
        lines.push('');
    }
    return lines.join('\n');
}

export function useMeetingTranscription() {
    const [state, setState] = useState<MeetingTranscriptionState>('idle');
    const wsRef = useRef<WebSocket | null>(null);
    const micStreamRef = useRef<MediaStream | null>(null);
    const systemStreamRef = useRef<MediaStream | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const transcriptRef = useRef<TranscriptEntry[]>([]);
    const notePathRef = useRef<string>('');
    const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const dateRef = useRef<string>('');

    const writeTranscriptToFile = useCallback(async () => {
        if (!notePathRef.current || transcriptRef.current.length === 0) return;
        const content = formatTranscript(transcriptRef.current, dateRef.current);
        try {
            await window.ipc.invoke('workspace:writeFile', {
                path: notePathRef.current,
                data: content,
                opts: { encoding: 'utf8' },
            });
        } catch (err) {
            console.error('[meeting] Failed to write transcript:', err);
        }
    }, []);

    const scheduleDebouncedWrite = useCallback(() => {
        if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
        writeTimerRef.current = setTimeout(() => {
            void writeTranscriptToFile();
        }, 5000);
    }, [writeTranscriptToFile]);

    const cleanup = useCallback(() => {
        if (writeTimerRef.current) {
            clearTimeout(writeTimerRef.current);
            writeTimerRef.current = null;
        }
        if (processorRef.current) {
            processorRef.current.disconnect();
            processorRef.current = null;
        }
        if (audioCtxRef.current) {
            audioCtxRef.current.close();
            audioCtxRef.current = null;
        }
        if (micStreamRef.current) {
            micStreamRef.current.getTracks().forEach(t => t.stop());
            micStreamRef.current = null;
        }
        if (systemStreamRef.current) {
            systemStreamRef.current.getTracks().forEach(t => t.stop());
            systemStreamRef.current = null;
        }
        if (wsRef.current) {
            wsRef.current.onclose = null;
            wsRef.current.close();
            wsRef.current = null;
        }
    }, []);

    const start = useCallback(async (): Promise<string | null> => {
        if (state !== 'idle') return null;
        setState('connecting');

        // Get Deepgram token
        let ws: WebSocket;
        try {
            const result = await window.ipc.invoke('voice:getDeepgramToken', null);
            if (result) {
                console.log('[meeting] Using proxy token');
                ws = new WebSocket(DEEPGRAM_LISTEN_URL, ['bearer', result.token]);
            } else {
                const config = await window.ipc.invoke('voice:getConfig', null);
                if (!config?.deepgram) {
                    console.error('[meeting] No Deepgram config available');
                    setState('idle');
                    return null;
                }
                console.log('[meeting] Using API key');
                ws = new WebSocket(DEEPGRAM_LISTEN_URL, ['token', config.deepgram.apiKey]);
            }
        } catch (err) {
            console.error('[meeting] Failed to get Deepgram token:', err);
            setState('idle');
            return null;
        }
        wsRef.current = ws;

        // Wait for WS open
        const wsOk = await new Promise<boolean>((resolve) => {
            ws.onopen = () => resolve(true);
            ws.onerror = () => resolve(false);
            setTimeout(() => resolve(false), 5000);
        });
        if (!wsOk) {
            console.error('[meeting] WebSocket failed to connect');
            cleanup();
            setState('idle');
            return null;
        }
        console.log('[meeting] WebSocket connected');

        // Set up WS message handler
        transcriptRef.current = [];
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (!data.channel?.alternatives?.[0]) return;
            const transcript = data.channel.alternatives[0].transcript;
            if (!transcript || !data.is_final) return;

            const channelIndex = data.channel_index?.[0] ?? 0;
            const speaker = channelIndex === 0 ? 'You' : 'Speaker';

            // Merge with last entry if same speaker
            const entries = transcriptRef.current;
            if (entries.length > 0 && entries[entries.length - 1].speaker === speaker) {
                entries[entries.length - 1].text += ' ' + transcript;
            } else {
                entries.push({ speaker, text: transcript });
            }
            scheduleDebouncedWrite();
        };

        ws.onclose = () => {
            console.log('[meeting] WebSocket closed');
            wsRef.current = null;
        };

        // Get mic stream
        let micStream: MediaStream;
        try {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err) {
            console.error('[meeting] Microphone access denied:', err);
            cleanup();
            setState('idle');
            return null;
        }
        micStreamRef.current = micStream;

        // Get system audio via getDisplayMedia
        // The main process setDisplayMediaRequestHandler auto-approves with loopback audio
        let systemStream: MediaStream;
        try {
            systemStream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
            // Stop any video tracks — we only need audio
            systemStream.getVideoTracks().forEach(t => t.stop());
        } catch (err) {
            console.error('[meeting] System audio access denied:', err);
            cleanup();
            setState('idle');
            return null;
        }
        if (systemStream.getAudioTracks().length === 0) {
            console.error('[meeting] No audio track from getDisplayMedia');
            systemStream.getTracks().forEach(t => t.stop());
            cleanup();
            setState('idle');
            return null;
        }
        console.log('[meeting] System audio captured');
        systemStreamRef.current = systemStream;

        // Set up AudioContext with channel merger
        const audioCtx = new AudioContext({ sampleRate: 16000 });
        audioCtxRef.current = audioCtx;

        const micSource = audioCtx.createMediaStreamSource(micStream);
        const systemSource = audioCtx.createMediaStreamSource(systemStream);
        const merger = audioCtx.createChannelMerger(2);

        micSource.connect(merger, 0, 0);     // mic → channel 0
        systemSource.connect(merger, 0, 1);  // system audio → channel 1

        const processor = audioCtx.createScriptProcessor(4096, 2, 2);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
            if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
            const ch0 = e.inputBuffer.getChannelData(0);
            const ch1 = e.inputBuffer.getChannelData(1);
            // Interleave 2 channels into stereo int16 PCM
            const int16 = new Int16Array(ch0.length * 2);
            for (let i = 0; i < ch0.length; i++) {
                const s0 = Math.max(-1, Math.min(1, ch0[i]));
                const s1 = Math.max(-1, Math.min(1, ch1[i]));
                int16[i * 2] = s0 < 0 ? s0 * 0x8000 : s0 * 0x7fff;
                int16[i * 2 + 1] = s1 < 0 ? s1 * 0x8000 : s1 * 0x7fff;
            }
            wsRef.current.send(int16.buffer);
        };

        merger.connect(processor);
        processor.connect(audioCtx.destination);

        // Create the note file
        const now = new Date();
        const dateStr = now.toISOString();
        dateRef.current = dateStr;
        const timestamp = dateStr.replace(/:/g, '-').replace(/\.\d+Z$/, '');
        const notePath = `knowledge/Meetings/rowboat/meeting-${timestamp}.md`;
        notePathRef.current = notePath;

        const initialContent = formatTranscript([], dateStr);
        await window.ipc.invoke('workspace:writeFile', {
            path: notePath,
            data: initialContent,
            opts: { encoding: 'utf8', mkdirp: true },
        });

        setState('recording');
        return notePath;
    }, [state, cleanup, scheduleDebouncedWrite]);

    const stop = useCallback(async () => {
        if (state !== 'recording') return;
        setState('stopping');

        cleanup();

        // Write final transcript
        await writeTranscriptToFile();

        setState('idle');
    }, [state, cleanup, writeTranscriptToFile]);

    return { state, start, stop };
}
