import { useEffect, useRef } from 'react'
import { MonitorUp, User, VideoOff, X } from 'lucide-react'

interface VideoPreviewOverlayProps {
  /** Live camera stream from useVideoMode — attached to the preview element. */
  streamRef: React.MutableRefObject<MediaStream | null>
  onTurnOff: () => void
  /** Hands-free call mode: current phase of the conversation loop. */
  callStatus?: 'listening' | 'thinking' | 'speaking'
  /** Hands-free call mode: live transcript of the in-progress utterance. */
  interimText?: string
  isScreenSharing?: boolean
  onToggleScreenShare?: () => void
  cameraOn?: boolean
  onToggleCamera?: () => void
}

const CALL_STATUS_DISPLAY: Record<NonNullable<VideoPreviewOverlayProps['callStatus']>, { label: string; dotClass: string }> = {
  listening: { label: 'Listening', dotClass: 'bg-green-500 animate-pulse' },
  thinking: { label: 'Thinking…', dotClass: 'bg-amber-400' },
  speaking: { label: 'Speaking', dotClass: 'bg-sky-400 animate-pulse' },
}

/**
 * Floating picture-in-picture webcam preview shown while video chat mode is
 * on. Mirrored like a selfie camera so the user's movements feel natural.
 * Sits above the composer dock, mirroring the talking-head overlay's corner.
 */
export function VideoPreviewOverlay({ streamRef, onTurnOff, callStatus, interimText, isScreenSharing, onToggleScreenShare, cameraOn = true, onToggleCamera }: VideoPreviewOverlayProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    if (!cameraOn) return
    const videoEl = videoRef.current
    if (!videoEl) return
    videoEl.srcObject = streamRef.current
    videoEl.play().catch(() => {})
    return () => {
      videoEl.srcObject = null
    }
  }, [streamRef, cameraOn])

  return (
    <div
      className="group fixed bottom-28 left-8 z-50"
      style={{ animation: 'video-preview-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
    >
      <style>{`
        @keyframes video-preview-pop {
          0% { opacity: 0; scale: 0.4; }
          100% { opacity: 1; scale: 1; }
        }
      `}</style>
      <button
        type="button"
        onClick={onTurnOff}
        className="absolute -right-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground group-hover:opacity-100"
        aria-label="Turn off video chat"
      >
        <X className="h-3 w-3" />
      </button>
      {onToggleScreenShare && (
        <button
          type="button"
          onClick={onToggleScreenShare}
          className={`absolute -left-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full border shadow-sm transition-opacity ${
            isScreenSharing
              ? 'border-sky-500 bg-sky-600 text-white opacity-100'
              : 'border-border bg-background text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100'
          }`}
          aria-label={isScreenSharing ? 'Stop sharing screen' : 'Share your screen'}
          title={isScreenSharing ? 'Stop sharing screen' : 'Share your screen'}
        >
          <MonitorUp className="h-3 w-3" />
        </button>
      )}
      {cameraOn ? (
        <video
          ref={videoRef}
          muted
          playsInline
          className="h-32 w-auto rounded-xl border border-border/70 bg-black shadow-lg"
          style={{ transform: 'scaleX(-1)' }}
        />
      ) : (
        <div className="flex h-32 w-48 items-center justify-center rounded-xl border border-border/70 bg-black shadow-lg">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-700 text-neutral-400">
            <User className="h-7 w-7" />
          </span>
        </div>
      )}
      {onToggleCamera && (
        <button
          type="button"
          onClick={onToggleCamera}
          className={`absolute -left-1.5 top-4 z-10 flex h-5 w-5 items-center justify-center rounded-full border shadow-sm transition-opacity ${
            cameraOn
              ? 'border-border bg-background text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100'
              : 'border-red-500 bg-red-600 text-white opacity-100'
          }`}
          aria-label={cameraOn ? 'Turn off camera' : 'Turn on camera'}
          title={cameraOn ? 'Turn off camera' : 'Turn on camera'}
        >
          <VideoOff className="h-3 w-3" />
        </button>
      )}
      <span className="pointer-events-none absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
        {callStatus ? (
          <>
            <span className={`block h-1.5 w-1.5 rounded-full ${CALL_STATUS_DISPLAY[callStatus].dotClass}`} />
            {CALL_STATUS_DISPLAY[callStatus].label}
          </>
        ) : (
          <>
            <span className="block h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
            Video on
          </>
        )}
      </span>
      {callStatus && interimText && (
        <div className="pointer-events-none absolute inset-x-0 -bottom-1 translate-y-full pt-1">
          <div className="max-h-16 overflow-hidden rounded-lg bg-black/60 px-2 py-1 text-[11px] leading-snug text-white/90">
            {interimText}
          </div>
        </div>
      )}
    </div>
  )
}
