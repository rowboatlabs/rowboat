import { useCallback, useEffect, useRef, useState } from 'react';

export type VideoModeState = 'idle' | 'starting' | 'live';

export interface CapturedVideoFrame {
    /** base64-encoded JPEG bytes (no data: prefix) — shape of the UserImagePart wire format */
    data: string;
    mediaType: string;
    capturedAt: string; // ISO timestamp
    /** data: URL of the same frame, for direct display in the transcript */
    dataUrl: string;
}

// Frames are grabbed once per second — dense enough to catch expression and
// posture changes while the user talks. Per message we attach at most
// MAX_FRAMES_PER_MESSAGE frames, evenly sampled across the window since the
// last send, so long monologues don't balloon the request.
const CAPTURE_INTERVAL_MS = 1000;
const MAX_FRAMES_PER_MESSAGE = 12;
// Rolling buffer bound (~2 minutes). The buffer only needs to cover the gap
// between two sends; anything older is stale context anyway.
const MAX_BUFFERED_FRAMES = 120;
// Downscale target. 512px wide JPEG keeps a frame around 20-40KB — cheap
// enough to inline a dozen per message as multimodal image parts.
const FRAME_WIDTH = 512;
const JPEG_QUALITY = 0.65;

interface BufferedFrame {
    dataUrl: string;
    capturedAt: string;
    ts: number;
}

export function useVideoMode() {
    const [state, setState] = useState<VideoModeState>('idle');
    const streamRef = useRef<MediaStream | null>(null);
    const videoElRef = useRef<HTMLVideoElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const framesRef = useRef<BufferedFrame[]>([]);
    const lastCollectTsRef = useRef(0);
    const stateRef = useRef<VideoModeState>('idle');
    stateRef.current = state;

    const captureFrame = useCallback(() => {
        const videoEl = videoElRef.current;
        if (!videoEl || videoEl.readyState < 2 || videoEl.videoWidth === 0) return;
        let canvas = canvasRef.current;
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvasRef.current = canvas;
        }
        const scale = FRAME_WIDTH / videoEl.videoWidth;
        canvas.width = FRAME_WIDTH;
        canvas.height = Math.round(videoEl.videoHeight * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
        // A near-empty data URL means the frame was blank (camera still warming up)
        if (dataUrl.length < 100) return;
        const frames = framesRef.current;
        frames.push({ dataUrl, capturedAt: new Date().toISOString(), ts: Date.now() });
        if (frames.length > MAX_BUFFERED_FRAMES) {
            frames.splice(0, frames.length - MAX_BUFFERED_FRAMES);
        }
    }, []);

    const stop = useCallback(() => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
        if (videoElRef.current) {
            videoElRef.current.srcObject = null;
            videoElRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
        }
        framesRef.current = [];
        lastCollectTsRef.current = 0;
        setState('idle');
    }, []);

    const start = useCallback(async (): Promise<boolean> => {
        if (stateRef.current !== 'idle') return true;
        setState('starting');

        // Settle the macOS TCC camera permission before getUserMedia, same as
        // voice mode does for the mic — otherwise the first click silently
        // fails while the native prompt is still up.
        const access = await window.ipc
            .invoke('voice:ensureCameraAccess', null)
            .catch(() => ({ granted: true }));
        if (!access.granted) {
            console.error('[video] Camera access denied');
            setState('idle');
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
            setState('idle');
            return false;
        }

        streamRef.current = stream;
        // Offscreen <video> that feeds the capture canvas; the visible preview
        // attaches to the same MediaStream separately.
        const videoEl = document.createElement('video');
        videoEl.muted = true;
        videoEl.playsInline = true;
        videoEl.srcObject = stream;
        videoElRef.current = videoEl;
        videoEl.play().catch(() => {});
        // First frame as soon as the camera delivers data, then steady-state cadence.
        videoEl.addEventListener('loadeddata', () => captureFrame(), { once: true });
        intervalRef.current = setInterval(captureFrame, CAPTURE_INTERVAL_MS);
        setState('live');
        return true;
    }, [captureFrame]);

    /**
     * Drain frames captured since the previous collection, evenly sampled down
     * to MAX_FRAMES_PER_MESSAGE (always keeping the newest). Falls back to the
     * single most recent frame when nothing new accumulated (rapid-fire
     * messages), so every video-mode message carries at least one frame once
     * the camera has warmed up.
     */
    const collectFrames = useCallback((): CapturedVideoFrame[] => {
        if (stateRef.current !== 'live') return [];
        // Grab a frame right now so the message always includes the moment of send.
        captureFrame();
        const all = framesRef.current;
        if (all.length === 0) return [];

        let window_ = all.filter((f) => f.ts > lastCollectTsRef.current);
        if (window_.length === 0) {
            window_ = [all[all.length - 1]];
        }
        lastCollectTsRef.current = window_[window_.length - 1].ts;

        let sampled: BufferedFrame[];
        if (window_.length <= MAX_FRAMES_PER_MESSAGE) {
            sampled = window_;
        } else {
            sampled = [];
            const step = (window_.length - 1) / (MAX_FRAMES_PER_MESSAGE - 1);
            for (let i = 0; i < MAX_FRAMES_PER_MESSAGE; i++) {
                sampled.push(window_[Math.round(i * step)]);
            }
        }

        return sampled.map((f) => ({
            data: f.dataUrl.slice(f.dataUrl.indexOf(',') + 1),
            mediaType: 'image/jpeg',
            capturedAt: f.capturedAt,
            dataUrl: f.dataUrl,
        }));
    }, [captureFrame]);

    // Release the camera if the component unmounts with video mode on.
    useEffect(() => stop, [stop]);

    return { state, streamRef, start, stop, collectFrames };
}
