import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

interface VideoPreviewOverlayProps {
  /** Live camera stream from useVideoMode — attached to the preview element. */
  streamRef: React.MutableRefObject<MediaStream | null>
  onTurnOff: () => void
}

/**
 * Floating picture-in-picture webcam preview shown while video chat mode is
 * on. Mirrored like a selfie camera so the user's movements feel natural.
 * Sits above the composer dock, mirroring the talking-head overlay's corner.
 */
export function VideoPreviewOverlay({ streamRef, onTurnOff }: VideoPreviewOverlayProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const videoEl = videoRef.current
    if (!videoEl) return
    videoEl.srcObject = streamRef.current
    videoEl.play().catch(() => {})
    return () => {
      videoEl.srcObject = null
    }
  }, [streamRef])

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
      <video
        ref={videoRef}
        muted
        playsInline
        className="h-32 w-auto rounded-xl border border-border/70 bg-black shadow-lg"
        style={{ transform: 'scaleX(-1)' }}
      />
      <span className="pointer-events-none absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
        <span className="block h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
        Video on
      </span>
    </div>
  )
}
