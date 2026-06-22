import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { buildDeepgramListenUrl } from '@/lib/deepgram-listen-url';
import { useRowboatAccount } from '@/hooks/useRowboatAccount';

export type MeetingTranscriptionState = 'idle' | 'connecting' | 'recording' | 'stopping';

const DEEPGRAM_PARAMS = new URLSearchParams({
    model: 'nova-3',
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '2',
    multichannel: 'true',
    diarize: 'true',
    interim_results: 'true',
    smart_format: 'true',
    punctuate: 'true',
    language: 'en',
});
const DEEPGRAM_LISTEN_URL = `wss://api.deepgram.com/v1/listen?${DEEPGRAM_PARAMS.toString()}`;

// RMS threshold: system audio above this = "active" (speakers playing)
const SYSTEM_AUDIO_GATE_THRESHOLD = 0.005;

// RMS threshold for "someone is talking" on either channel. Drives silence
// detection — kept a touch above the gate threshold so faint room noise on the
// mic doesn't read as speech and keep a finished recording alive.
const SPEECH_RMS_THRESHOLD = 0.01;

// Silence handling. "Silence" = no audio above SPEECH_RMS_THRESHOLD on EITHER
// the mic or the system-audio channel (i.e. nobody — local or remote — talking).
// - After SILENCE_NUDGE_MS we ask the user (toast) whether to stop.
// - After SILENCE_BACKSTOP_MS we stop unconditionally.
// - Once past the linked calendar event's end time we use the shorter
//   POST_CALENDAR_END_SILENCE_MS, since a lull after the scheduled end is a
//   strong signal the meeting is actually over.
const SILENCE_NUDGE_MS = 2 * 60 * 1000;
const SILENCE_BACKSTOP_MS = 5 * 60 * 1000;
const POST_CALENDAR_END_SILENCE_MS = 2 * 60 * 1000;
// How often the silence checker runs.
const SILENCE_CHECK_INTERVAL_MS = 5 * 1000;

// On macOS (ScreenCaptureKit) the system-audio track never fires "ended"/"mute"
// when the meeting ends, and its readyState stays "live" — only track.muted flips
// to true. But muted is ambiguous: it also goes true whenever no system audio is
// playing (a quiet but live meeting), so muted alone can't safely trigger a stop.
// See the poll in start() for how the muted signal is gated on the scheduled
// calendar end so a quiet stretch never cuts a live meeting short.
const TRACK_POLL_INTERVAL_MS = 3 * 1000;
const MUTE_POLLS_TO_STOP = 3;

// The ScreenCaptureKit quirk above is macOS-only; on Windows the track's "ended"
// event fires normally (handled by the listener in start()), so the poll below is
// gated to macOS.
const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');

// ---------------------------------------------------------------------------
// Headphone detection
// ---------------------------------------------------------------------------
async function detectHeadphones(): Promise<boolean> {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const outputs = devices.filter(d => d.kind === 'audiooutput');
        const defaultOutput = outputs.find(d => d.deviceId === 'default');
        const label = (defaultOutput?.label ?? '').toLowerCase();
        // Heuristic: built-in speakers won't match these patterns
        const headphonePatterns = ['headphone', 'airpod', 'earpod', 'earphone', 'earbud', 'bluetooth', 'bt_', 'jabra', 'bose', 'sony wh', 'sony wf'];
        return headphonePatterns.some(p => label.includes(p));
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------
// Transcript formatting
// ---------------------------------------------------------------------------
interface TranscriptEntry {
    speaker: string;
    text: string;
}

export interface CalendarEventMeta {
    summary?: string
    start?: { dateTime?: string; date?: string }
    end?: { dateTime?: string; date?: string }
    location?: string
    htmlLink?: string
    conferenceLink?: string
    source?: string
}

function formatTranscript(entries: TranscriptEntry[], date: string, calendarEvent?: CalendarEventMeta): string {
    const noteTitle = calendarEvent?.summary || 'Meeting Notes';
    const lines = [
        '---',
        'type: meeting',
        'source: rowboat',
        `title: ${noteTitle}`,
        `date: "${date}"`,
    ];
    if (calendarEvent) {
        // Serialize as a JSON string on one line — the frontmatter system
        // only supports flat key: value pairs, not nested YAML objects.
        const eventObj: Record<string, string> = {}
        if (calendarEvent.summary) eventObj.summary = calendarEvent.summary
        if (calendarEvent.start?.dateTime) eventObj.start = calendarEvent.start.dateTime
        else if (calendarEvent.start?.date) eventObj.start = calendarEvent.start.date
        if (calendarEvent.end?.dateTime) eventObj.end = calendarEvent.end.dateTime
        else if (calendarEvent.end?.date) eventObj.end = calendarEvent.end.date
        if (calendarEvent.location) eventObj.location = calendarEvent.location
        if (calendarEvent.htmlLink) eventObj.htmlLink = calendarEvent.htmlLink
        if (calendarEvent.conferenceLink) eventObj.conferenceLink = calendarEvent.conferenceLink
        if (calendarEvent.source) eventObj.source = calendarEvent.source
        lines.push(`calendar_event: '${JSON.stringify(eventObj).replace(/'/g, "''")}'`)
    }
    lines.push(
        '---',
        '',
        `# ${noteTitle}`,
        '',
    );
    // Build the raw transcript text
    const transcriptLines: string[] = [];
    for (let i = 0; i < entries.length; i++) {
        if (i > 0 && entries[i].speaker !== entries[i - 1].speaker) {
            transcriptLines.push('');
        }
        transcriptLines.push(`**${entries[i].speaker}:** ${entries[i].text}`);
        transcriptLines.push('');
    }
    const transcriptText = transcriptLines.join('\n').trim();
    const transcriptData = JSON.stringify({ transcript: transcriptText });
    lines.push('```transcript', transcriptData, '```');
    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useMeetingTranscription(onAutoStop?: () => void) {
    const { refresh: refreshRowboatAccount } = useRowboatAccount();
    const [state, setState] = useState<MeetingTranscriptionState>('idle');
    const wsRef = useRef<WebSocket | null>(null);
    const micStreamRef = useRef<MediaStream | null>(null);
    const systemStreamRef = useRef<MediaStream | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const transcriptRef = useRef<TranscriptEntry[]>([]);
    const interimRef = useRef<Map<number, { speaker: string; text: string }>>(new Map());
    const notePathRef = useRef<string>('');
    const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Silence detection: timestamp of the last speech-level audio on either
    // channel, plus the interval that checks it. calendarEndMsRef holds the
    // linked event's end time (null if none).
    const lastAudioActivityRef = useRef<number>(0);
    const silenceCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const calendarEndMsRef = useRef<number | null>(null);
    const nudgeToastIdRef = useRef<string | number | null>(null);
    // On macOS (ScreenCaptureKit) the system-audio track doesn't reliably fire
    // "ended"/"mute" when the meeting ends, so we poll its readyState/muted
    // state instead.
    const trackPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const onAutoStopRef = useRef(onAutoStop);
    onAutoStopRef.current = onAutoStop;
    const dateRef = useRef<string>('');
    const calendarEventRef = useRef<CalendarEventMeta | undefined>(undefined);

    const writeTranscriptToFile = useCallback(async () => {
        if (!notePathRef.current) return;
        const entries = [...transcriptRef.current];
        for (const interim of interimRef.current.values()) {
            if (!interim.text) continue;
            if (entries.length > 0 && entries[entries.length - 1].speaker === interim.speaker) {
                entries[entries.length - 1] = { speaker: interim.speaker, text: entries[entries.length - 1].text + ' ' + interim.text };
            } else {
                entries.push({ speaker: interim.speaker, text: interim.text });
            }
        }
        if (entries.length === 0) return;
        const content = formatTranscript(entries, dateRef.current, calendarEventRef.current);
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
        }, 1000);
    }, [writeTranscriptToFile]);

    const cleanup = useCallback(() => {
        if (writeTimerRef.current) {
            clearTimeout(writeTimerRef.current);
            writeTimerRef.current = null;
        }
        if (silenceCheckRef.current) {
            clearInterval(silenceCheckRef.current);
            silenceCheckRef.current = null;
        }
        if (nudgeToastIdRef.current !== null) {
            toast.dismiss(nudgeToastIdRef.current);
            nudgeToastIdRef.current = null;
        }
        if (trackPollingRef.current) {
            clearInterval(trackPollingRef.current);
            trackPollingRef.current = null;
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

    const start = useCallback(async (calendarEvent?: CalendarEventMeta): Promise<string | null> => {
        if (state !== 'idle') return null;
        setState('connecting');

        // Run independent setup steps in parallel for faster startup
        const [headphoneResult, wsResult, micResult, systemResult] = await Promise.allSettled([
            // 1. Detect headphones vs speakers
            detectHeadphones(),
            // 2. Set up Deepgram WebSocket (account refresh + connect + wait for open)
            (async () => {
                const account = await refreshRowboatAccount();
                let ws: WebSocket;
                if (
                    account?.signedIn &&
                    account.accessToken &&
                    account.config?.websocketApiUrl
                ) {
                    const listenUrl = buildDeepgramListenUrl(account.config.websocketApiUrl, DEEPGRAM_PARAMS);
                    console.log('[meeting] Using Rowboat WebSocket');
                    ws = new WebSocket(listenUrl, ['bearer', account.accessToken]);
                } else {
                    const config = await window.ipc.invoke('voice:getConfig', null);
                    if (!config?.deepgram) {
                        throw new Error('No Deepgram config available');
                    }
                    console.log('[meeting] Using Deepgram API key');
                    ws = new WebSocket(DEEPGRAM_LISTEN_URL, ['token', config.deepgram.apiKey]);
                }
                const ok = await new Promise<boolean>((resolve) => {
                    ws.onopen = () => resolve(true);
                    ws.onerror = () => resolve(false);
                    setTimeout(() => resolve(false), 5000);
                });
                if (!ok) throw new Error('WebSocket failed to connect');
                console.log('[meeting] WebSocket connected');
                return ws;
            })(),
            // 3. Get mic stream
            navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            }),
            // 4. Get system audio via getDisplayMedia (loopback)
            (async () => {
                const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
                stream.getVideoTracks().forEach(t => t.stop());
                if (stream.getAudioTracks().length === 0) {
                    stream.getTracks().forEach(t => t.stop());
                    throw new Error('No audio track from getDisplayMedia');
                }
                console.log('[meeting] System audio captured');
                return stream;
            })(),
        ]);

        // Check for failures — clean up any successful resources if something failed
        const failed = wsResult.status === 'rejected'
            || micResult.status === 'rejected'
            || systemResult.status === 'rejected';

        if (failed) {
            if (wsResult.status === 'rejected') console.error('[meeting] WebSocket setup failed:', wsResult.reason);
            if (micResult.status === 'rejected') console.error('[meeting] Microphone access denied:', micResult.reason);
            if (systemResult.status === 'rejected') console.error('[meeting] System audio access denied:', systemResult.reason);
            // Clean up any resources that did succeed
            if (wsResult.status === 'fulfilled') { wsResult.value.close(); }
            if (micResult.status === 'fulfilled') { micResult.value.getTracks().forEach(t => t.stop()); }
            if (systemResult.status === 'fulfilled') { systemResult.value.getTracks().forEach(t => t.stop()); }
            cleanup();
            setState('idle');
            return null;
        }

        const usingHeadphones = headphoneResult.status === 'fulfilled' ? headphoneResult.value : false;
        console.log(`[meeting] Audio output mode: ${usingHeadphones ? 'headphones' : 'speakers'}`);

        const ws = wsResult.value;
        wsRef.current = ws;

        // Set up WS message handler
        transcriptRef.current = [];
        interimRef.current = new Map();
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (!data.channel?.alternatives?.[0]) return;
            const transcript = data.channel.alternatives[0].transcript;
            if (!transcript) return;

            const channelIndex = data.channel_index?.[0] ?? 0;
            const isMic = channelIndex === 0;

            // Channel 0 = mic = "You", Channel 1 = system audio with diarization
            let speaker: string;
            if (isMic) {
                speaker = 'You';
            } else {
                // Use Deepgram diarization speaker ID for system audio channel
                const words = data.channel.alternatives[0].words;
                const speakerId = words?.[0]?.speaker;
                speaker = speakerId != null ? `Speaker ${speakerId}` : 'System audio';
            }

            if (data.is_final) {
                interimRef.current.delete(channelIndex);
                const entries = transcriptRef.current;
                if (entries.length > 0 && entries[entries.length - 1].speaker === speaker) {
                    entries[entries.length - 1].text += ' ' + transcript;
                } else {
                    entries.push({ speaker, text: transcript });
                }
            } else {
                interimRef.current.set(channelIndex, { speaker, text: transcript });
            }
            scheduleDebouncedWrite();
        };

        ws.onclose = () => {
            console.log('[meeting] WebSocket closed');
            wsRef.current = null;
        };

        const micStream = micResult.value;
        micStreamRef.current = micStream;

        const systemStream = systemResult.value;
        systemStreamRef.current = systemStream;

        // If the shared source goes away (user closes the call window / clicks
        // "Stop sharing"), the track fires "ended" — treat that as the meeting
        // ending and stop. Our own cleanup() calls track.stop(), which does NOT
        // fire "ended", so this won't double-trigger on a manual stop.
        systemStream.getAudioTracks().forEach(track => {
            track.addEventListener('ended', () => {
                console.log('[meeting] system-audio track ended (shared source closed) — auto-stopping');
                onAutoStopRef.current?.();
            });
        });

        // On macOS the system-audio track's "ended"/"mute" events don't fire when
        // the meeting ends, so poll its state instead. (On Windows the "ended"
        // listener above already covers this, so the poll is macOS-only.)
        //
        //  - readyState === 'ended' is unambiguous (the source is gone) → stop now.
        //    It never actually fires on macOS (readyState stays 'live'); it's just
        //    a safety net should polling ever observe the track ending.
        //  - muted is ambiguous on macOS: it flips true both when the meeting ends
        //    AND when nothing is playing system audio (a quiet but live meeting).
        //    So we only treat sustained mute as "meeting over" once we're past the
        //    linked event's scheduled end — a dead audio track after the meeting
        //    was due to finish is a strong signal. With no calendar event, or
        //    before the scheduled end, we DON'T hard-stop on mute; the silence
        //    checker's nudge + backstop handles it, so a quiet stretch can never
        //    silently cut a live meeting short.
        const pollTrack = systemStream.getAudioTracks()[0];
        if (isMac && pollTrack) {
            let mutedPolls = 0;
            if (trackPollingRef.current) clearInterval(trackPollingRef.current);
            trackPollingRef.current = setInterval(() => {
                if (pollTrack.readyState === 'ended') {
                    console.log('[meeting] system-audio track ended (poll) — auto-stopping');
                    onAutoStopRef.current?.();
                    return;
                }
                if (pollTrack.muted) {
                    mutedPolls++;
                    const endMs = calendarEndMsRef.current;
                    const pastCalendarEnd = endMs != null && Date.now() > endMs;
                    if (pastCalendarEnd && mutedPolls >= MUTE_POLLS_TO_STOP) {
                        console.log('[meeting] system-audio track muted past scheduled end (poll) — auto-stopping');
                        onAutoStopRef.current?.();
                    }
                } else {
                    mutedPolls = 0;
                }
            }, TRACK_POLL_INTERVAL_MS);
        }

        // ----- Audio pipeline -----
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

            const micRaw = e.inputBuffer.getChannelData(0);
            const sysRaw = e.inputBuffer.getChannelData(1);

            // RMS of each channel, computed once per frame and reused for
            // silence detection and gating the mic in speaker mode.
            let micSum = 0;
            for (let i = 0; i < micRaw.length; i++) micSum += micRaw[i] * micRaw[i];
            const micRms = Math.sqrt(micSum / micRaw.length);
            let sysSum = 0;
            for (let i = 0; i < sysRaw.length; i++) sysSum += sysRaw[i] * sysRaw[i];
            const sysRms = Math.sqrt(sysSum / sysRaw.length);

            // Reset the silence clock whenever EITHER channel has speech-level
            // audio. Uses the raw mic (pre-gating) so the user's own voice counts
            // even in speaker mode where the outgoing mic gets muted.
            if (micRms > SPEECH_RMS_THRESHOLD || sysRms > SPEECH_RMS_THRESHOLD) {
                lastAudioActivityRef.current = Date.now();
            }

            // Mode 1 (headphones): pass both streams through unmodified
            // Mode 2 (speakers): gate/mute mic when system audio is active
            let micOut: Float32Array;
            if (usingHeadphones) {
                micOut = micRaw;
            } else if (sysRms > SYSTEM_AUDIO_GATE_THRESHOLD) {
                // System audio is playing — mute mic to prevent bleed
                micOut = new Float32Array(micRaw.length); // all zeros
            } else {
                // System audio is silent — pass mic through
                micOut = micRaw;
            }

            // Interleave mic (ch0) + system audio (ch1) into stereo int16 PCM
            const int16 = new Int16Array(micOut.length * 2);
            for (let i = 0; i < micOut.length; i++) {
                const s0 = Math.max(-1, Math.min(1, micOut[i]));
                const s1 = Math.max(-1, Math.min(1, sysRaw[i]));
                int16[i * 2] = s0 < 0 ? s0 * 0x8000 : s0 * 0x7fff;
                int16[i * 2 + 1] = s1 < 0 ? s1 * 0x8000 : s1 * 0x7fff;
            }
            wsRef.current.send(int16.buffer);
        };

        merger.connect(processor);
        processor.connect(audioCtx.destination);

        // Create the note file, organized by date like voice memos
        const now = new Date();
        const dateStr = now.toISOString();
        dateRef.current = dateStr;
        const dateFolder = dateStr.split('T')[0]; // YYYY-MM-DD
        const timestamp = dateStr.replace(/:/g, '-').replace(/\.\d+Z$/, '');
        const filename = calendarEvent?.summary
            ? calendarEvent.summary.replace(/[\\/*?:"<>|]/g, '').replace(/\s+/g, '_').substring(0, 100).trim()
            : `meeting-${timestamp}`;
        const notePath = `knowledge/Meetings/rowboat/${dateFolder}/${filename}.md`;
        notePathRef.current = notePath;
        calendarEventRef.current = calendarEvent;

        // Parse the linked event's end time (timed events only) so the silence
        // window can shorten once the meeting is past its scheduled end.
        const calEndMs = calendarEvent?.end?.dateTime ? Date.parse(calendarEvent.end.dateTime) : NaN;
        calendarEndMsRef.current = Number.isFinite(calEndMs) ? calEndMs : null;

        const initialContent = formatTranscript([], dateStr, calendarEvent);
        await window.ipc.invoke('workspace:writeFile', {
            path: notePath,
            data: initialContent,
            opts: { encoding: 'utf8', mkdirp: true },
        });

        // Arm silence detection. Initialise the activity clock to "now" so the
        // checker is live from the very start of recording — a session that
        // never captures any audio still auto-stops at the backstop instead of
        // running forever.
        lastAudioActivityRef.current = Date.now();
        if (silenceCheckRef.current) clearInterval(silenceCheckRef.current);
        silenceCheckRef.current = setInterval(() => {
            const silentMs = Date.now() - lastAudioActivityRef.current;
            const endMs = calendarEndMsRef.current;
            const pastCalendarEnd = endMs != null && Date.now() > endMs;
            const hardStopMs = pastCalendarEnd ? POST_CALENDAR_END_SILENCE_MS : SILENCE_BACKSTOP_MS;

            if (silentMs >= hardStopMs) {
                console.log(`[meeting] ${Math.round(silentMs / 1000)}s of silence${pastCalendarEnd ? ' (past scheduled end)' : ''} — auto-stopping`);
                onAutoStopRef.current?.();
                return;
            }

            if (silentMs >= SILENCE_NUDGE_MS) {
                // Ask once; the toast persists until dismissed or acted on. Past
                // the scheduled end we skip straight to the hard stop above, so
                // the nudge only ever shows for an in-progress meeting.
                if (nudgeToastIdRef.current === null) {
                    nudgeToastIdRef.current = toast('Still in a meeting?', {
                        description: "It's been quiet for a couple of minutes.",
                        duration: Infinity,
                        action: {
                            label: 'Stop recording',
                            onClick: () => { onAutoStopRef.current?.(); },
                        },
                    });
                }
            } else if (nudgeToastIdRef.current !== null) {
                // Audio resumed before the backstop — retract the nudge.
                toast.dismiss(nudgeToastIdRef.current);
                nudgeToastIdRef.current = null;
            }
        }, SILENCE_CHECK_INTERVAL_MS);

        setState('recording');
        return notePath;
    }, [state, cleanup, scheduleDebouncedWrite, refreshRowboatAccount]);

    const stop = useCallback(async () => {
        if (state !== 'recording') return;
        setState('stopping');

        cleanup();
        interimRef.current = new Map();
        await writeTranscriptToFile();

        setState('idle');
    }, [state, cleanup, writeTranscriptToFile]);

    return { state, start, stop };
}
