import { useCallback, useEffect, useRef, useState } from 'react';

export type VideoModeState = 'idle' | 'starting' | 'live';
export type ScreenShareState = 'idle' | 'starting' | 'live';

export interface CapturedVideoFrame {
    /** base64-encoded JPEG bytes (no data: prefix) — shape of the UserImagePart wire format */
    data: string;
    mediaType: string;
    capturedAt: string; // ISO timestamp
    /** data: URL of the same frame, for direct display in the transcript */
    dataUrl: string;
    source: 'camera' | 'screen';
}

// Frames are grabbed once per second — dense enough to catch expression and
// posture changes while the user talks. Per message we attach at most
// MAX_*_FRAMES_PER_MESSAGE frames, evenly sampled across the window since the
// last send, so long monologues don't balloon the request.
const CAPTURE_INTERVAL_MS = 1000;
const MAX_CAMERA_FRAMES_PER_MESSAGE = 12;
// Screen frames are ~4x the resolution (and tokens) of camera frames, and the
// latest view matters far more than the trajectory — keep the cap small.
const MAX_SCREEN_FRAMES_PER_MESSAGE = 4;
// Rolling buffer bound (~2 minutes). The buffer only needs to cover the gap
// between two sends; anything older is stale context anyway.
const MAX_BUFFERED_FRAMES = 120;
// Downscale targets. 512px wide JPEG keeps a webcam frame around 20-40KB —
// cheap enough to inline a dozen per message as multimodal image parts.
// Screen captures keep 1280px so on-screen text stays legible to the model.
const CAMERA_FRAME_WIDTH = 512;
const SCREEN_FRAME_WIDTH = 1280;
const CAMERA_JPEG_QUALITY = 0.65;
const SCREEN_JPEG_QUALITY = 0.7;

interface BufferedFrame {
    dataUrl: string;
    capturedAt: string;
    ts: number;
}

// One capture pipeline: stream → offscreen <video> → canvas JPEG → ring buffer.
interface CapturePipe {
    stream: MediaStream | null;
    videoEl: HTMLVideoElement | null;
    canvas: HTMLCanvasElement | null;
    interval: ReturnType<typeof setInterval> | null;
    frames: BufferedFrame[];
    lastCollectTs: number;
}

const emptyPipe = (): CapturePipe => ({
    stream: null,
    videoEl: null,
    canvas: null,
    interval: null,
    frames: [],
    lastCollectTs: 0,
});

function capturePipeFrame(pipe: CapturePipe, width: number, quality: number) {
    const videoEl = pipe.videoEl;
    if (!videoEl || videoEl.readyState < 2 || videoEl.videoWidth === 0) return;
    if (!pipe.canvas) {
        pipe.canvas = document.createElement('canvas');
    }
    const canvas = pipe.canvas;
    const scale = Math.min(1, width / videoEl.videoWidth);
    canvas.width = Math.round(videoEl.videoWidth * scale);
    canvas.height = Math.round(videoEl.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    // A near-empty data URL means the frame was blank (source still warming up)
    if (dataUrl.length < 100) return;
    pipe.frames.push({ dataUrl, capturedAt: new Date().toISOString(), ts: Date.now() });
    if (pipe.frames.length > MAX_BUFFERED_FRAMES) {
        pipe.frames.splice(0, pipe.frames.length - MAX_BUFFERED_FRAMES);
    }
}

function attachPipeSource(pipe: CapturePipe, stream: MediaStream, grab: () => void) {
    pipe.stream = stream;
    // Offscreen <video> that feeds the capture canvas; any visible preview
    // attaches to the same MediaStream separately.
    const videoEl = document.createElement('video');
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.srcObject = stream;
    pipe.videoEl = videoEl;
    videoEl.play().catch(() => {});
    // First frame as soon as the source delivers data, then steady-state cadence.
    videoEl.addEventListener('loadeddata', () => grab(), { once: true });
    pipe.interval = setInterval(grab, CAPTURE_INTERVAL_MS);
}

function teardownPipe(pipe: CapturePipe) {
    if (pipe.interval) {
        clearInterval(pipe.interval);
        pipe.interval = null;
    }
    if (pipe.videoEl) {
        pipe.videoEl.srcObject = null;
        pipe.videoEl = null;
    }
    if (pipe.stream) {
        pipe.stream.getTracks().forEach((t) => t.stop());
        pipe.stream = null;
    }
    pipe.frames = [];
    pipe.lastCollectTs = 0;
}

/**
 * Drain frames captured since the previous collection, evenly sampled down to
 * `max` (always keeping the newest). Falls back to the single most recent
 * frame when nothing new accumulated (rapid-fire messages), so every message
 * carries at least one frame once the source has warmed up.
 */
function drainPipe(pipe: CapturePipe, max: number, source: CapturedVideoFrame['source']): CapturedVideoFrame[] {
    const all = pipe.frames;
    if (all.length === 0) return [];

    let window_ = all.filter((f) => f.ts > pipe.lastCollectTs);
    if (window_.length === 0) {
        window_ = [all[all.length - 1]];
    }
    pipe.lastCollectTs = window_[window_.length - 1].ts;

    let sampled: BufferedFrame[];
    if (window_.length <= max) {
        sampled = window_;
    } else {
        sampled = [];
        const step = (window_.length - 1) / (max - 1);
        for (let i = 0; i < max; i++) {
            sampled.push(window_[Math.round(i * step)]);
        }
    }

    return sampled.map((f) => ({
        data: f.dataUrl.slice(f.dataUrl.indexOf(',') + 1),
        mediaType: 'image/jpeg',
        capturedAt: f.capturedAt,
        dataUrl: f.dataUrl,
        source,
    }));
}

export function useVideoMode() {
    const [state, setState] = useState<VideoModeState>('idle');
    const [screenState, setScreenState] = useState<ScreenShareState>('idle');
    // Camera can be turned off mid-session (Meet-style) while the mode — and
    // any screen share — keeps running. Resets to on for the next session.
    const [cameraOn, setCameraOn] = useState(true);
    const cameraPipeRef = useRef<CapturePipe>(emptyPipe());
    const screenPipeRef = useRef<CapturePipe>(emptyPipe());
    // Stable stream refs for preview components (<video srcObject>).
    const streamRef = useRef<MediaStream | null>(null);
    const screenStreamRef = useRef<MediaStream | null>(null);
    const stateRef = useRef<VideoModeState>('idle');
    stateRef.current = state;
    const screenStateRef = useRef<ScreenShareState>('idle');
    screenStateRef.current = screenState;

    const captureCameraFrame = useCallback(() => {
        capturePipeFrame(cameraPipeRef.current, CAMERA_FRAME_WIDTH, CAMERA_JPEG_QUALITY);
    }, []);

    const captureScreenFrame = useCallback(() => {
        capturePipeFrame(screenPipeRef.current, SCREEN_FRAME_WIDTH, SCREEN_JPEG_QUALITY);
    }, []);

    const stopScreenShare = useCallback(() => {
        teardownPipe(screenPipeRef.current);
        screenStreamRef.current = null;
        setScreenState('idle');
    }, []);

    const stop = useCallback(() => {
        teardownPipe(cameraPipeRef.current);
        streamRef.current = null;
        setState('idle');
        setCameraOn(true);
        stopScreenShare();
    }, [stopScreenShare]);

    // Acquire the webcam and start its capture pipeline. Shared by start()
    // and by re-enabling the camera mid-session.
    const acquireCamera = useCallback(async (): Promise<boolean> => {
        // Settle the macOS TCC camera permission before getUserMedia, same as
        // voice mode does for the mic — otherwise the first click silently
        // fails while the native prompt is still up.
        const access = await window.ipc
            .invoke('voice:ensureCameraAccess', null)
            .catch(() => ({ granted: true }));
        if (!access.granted) {
            console.error('[video] Camera access denied');
            return false;
        }

        let stream: MediaStream | null = null;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
                audio: false,
            });
        } catch (err) {
            console.error('[video] Camera access failed:', err);
            return false;
        }

        streamRef.current = stream;
        attachPipeSource(cameraPipeRef.current, stream, captureCameraFrame);
        return true;
    }, [captureCameraFrame]);

    /**
     * Turn the camera off/on without leaving video mode (Meet-style). While
     * off, no webcam frames are captured or attached; screen-share frames
     * (if presenting) keep flowing.
     */
    const setCameraEnabled = useCallback(async (enabled: boolean): Promise<boolean> => {
        if (stateRef.current !== 'live') return false;
        if (enabled) {
            const ok = await acquireCamera();
            if (ok) setCameraOn(true);
            return ok;
        }
        teardownPipe(cameraPipeRef.current);
        streamRef.current = null;
        setCameraOn(false);
        return true;
    }, [acquireCamera]);

    /**
     * Start video mode. `camera: false` starts a camera-less session (voice
     * call / screen-share-only) — the mode is live so frames can flow from
     * other sources, and the camera can be enabled later via setCameraEnabled.
     */
    const start = useCallback(async ({ camera = true }: { camera?: boolean } = {}): Promise<boolean> => {
        if (stateRef.current !== 'idle') return true;
        setState('starting');
        if (camera) {
            const ok = await acquireCamera();
            if (!ok) {
                setState('idle');
                return false;
            }
        }
        setCameraOn(camera);
        setState('live');
        return true;
    }, [acquireCamera]);

    /**
     * Share the screen. The main process auto-approves getDisplayMedia with
     * the primary screen (see setDisplayMediaRequestHandler in main.ts), so
     * no source picker appears. Returns false if capture couldn't start
     * (usually the macOS Screen Recording permission).
     */
    const startScreenShare = useCallback(async (): Promise<boolean> => {
        if (screenStateRef.current !== 'idle') return true;
        setScreenState('starting');

        // Surfaces the macOS Screen Recording permission state and, on first
        // use, registers the app in System Settings (same flow meetings use).
        await window.ipc.invoke('meeting:checkScreenPermission', null).catch(() => null);

        let stream: MediaStream | null = null;
        try {
            stream = await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: { ideal: 5 } },
                audio: false,
            });
        } catch (err) {
            console.error('[video] Screen share failed:', err);
            setScreenState('idle');
            return false;
        }

        screenStreamRef.current = stream;
        // The capture can end outside our UI (display unplugged, OS revokes) —
        // tear down cleanly so the UI doesn't show a dead share.
        stream.getVideoTracks()[0]?.addEventListener('ended', () => stopScreenShare(), { once: true });
        attachPipeSource(screenPipeRef.current, stream, captureScreenFrame);
        setScreenState('live');
        return true;
    }, [captureScreenFrame, stopScreenShare]);

    /**
     * Drain webcam + screen-share frames buffered since the last send, tagged
     * by source. Webcam frames come first, then screen frames.
     */
    const collectFrames = useCallback((): CapturedVideoFrame[] => {
        if (stateRef.current !== 'live') return [];
        // Grab a frame right now so the message always includes the moment of send.
        captureCameraFrame();
        const frames = drainPipe(cameraPipeRef.current, MAX_CAMERA_FRAMES_PER_MESSAGE, 'camera');
        if (screenStateRef.current === 'live') {
            captureScreenFrame();
            frames.push(...drainPipe(screenPipeRef.current, MAX_SCREEN_FRAMES_PER_MESSAGE, 'screen'));
        }
        return frames;
    }, [captureCameraFrame, captureScreenFrame]);

    // Release the camera/screen if the component unmounts with video mode on.
    useEffect(() => stop, [stop]);

    return { state, screenState, cameraOn, streamRef, screenStreamRef, start, stop, startScreenShare, stopScreenShare, setCameraEnabled, collectFrames };
}
