import { useEffect, useRef, useState } from 'react'
import { MonitorUp, PhoneOff } from 'lucide-react'

import { MascotFaceIcon, TalkingHead } from '@/components/talking-head'
import type { TTSState } from '@/hooks/useVoiceTTS'
import { cn } from '@/lib/utils'

export type VideoCallStatus = 'listening' | 'thinking' | 'speaking'

interface VideoCallViewProps {
  /** Live camera stream from useVideoMode — attached to the user's tile. */
  streamRef: React.MutableRefObject<MediaStream | null>
  /** Live screen-share stream — shown as the presentation tile when sharing. */
  screenStreamRef: React.MutableRefObject<MediaStream | null>
  isScreenSharing: boolean
  onToggleScreenShare: () => void
  ttsState: TTSState
  /** Live TTS output level — drives the mascot's mouth animation. */
  getTtsLevel: () => number
  status: VideoCallStatus
  /** Live transcript of the user's in-progress utterance. */
  interimText?: string
  /** The assistant line currently being spoken aloud. */
  assistantCaption?: string
  onLeave: () => void
}

const STATUS_DISPLAY: Record<VideoCallStatus, { label: string; dotClass: string }> = {
  listening: { label: 'Listening', dotClass: 'bg-green-500 animate-pulse' },
  thinking: { label: 'Thinking…', dotClass: 'bg-amber-400' },
  speaking: { label: 'Speaking', dotClass: 'bg-sky-400 animate-pulse' },
}

/** Attach a MediaStream ref to a <video> element for the lifetime of the mount. */
function StreamVideo({
  streamRef,
  mirrored,
  className,
}: {
  streamRef: React.MutableRefObject<MediaStream | null>
  mirrored?: boolean
  className?: string
}) {
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
    <video
      ref={videoRef}
      muted
      playsInline
      className={className}
      style={mirrored ? { transform: 'scaleX(-1)' } : undefined}
    />
  )
}

/**
 * Full-screen hands-free call: a Meet-style layout with the user's webcam on
 * one side and the mascot as the other participant. While presenting, the
 * shared screen becomes the big tile and the participants shrink into a side
 * rail. The mascot animates with the assistant's speech; dismissing it swaps
 * in a Meet-style letter avatar ("R"). Live captions run along the bottom.
 */
export function VideoCallView({
  streamRef,
  screenStreamRef,
  isScreenSharing,
  onToggleScreenShare,
  ttsState,
  getTtsLevel,
  status,
  interimText,
  assistantCaption,
  onLeave,
}: VideoCallViewProps) {
  const [mascotVisible, setMascotVisible] = useState(true)

  const userSpeaking = status === 'listening' && Boolean(interimText)
  const assistantSpeaking = ttsState === 'speaking'

  const caption = assistantSpeaking && assistantCaption
    ? { who: 'Rowboat', text: assistantCaption }
    : interimText
      ? { who: 'You', text: interimText }
      : null

  const userTile = (
    <div
      className={cn(
        'relative flex items-center justify-center overflow-hidden rounded-2xl bg-neutral-900 transition-shadow',
        userSpeaking && 'ring-2 ring-green-500/80',
        isScreenSharing && 'aspect-video w-full'
      )}
    >
      <StreamVideo streamRef={streamRef} mirrored className="h-full w-full object-cover" />
      <span className="absolute bottom-3 left-3 rounded-md bg-black/50 px-2 py-0.5 text-sm text-white">
        You
      </span>
    </div>
  )

  const assistantTile = (
    <div
      className={cn(
        'group relative flex items-center justify-center overflow-hidden rounded-2xl bg-neutral-900 transition-shadow',
        assistantSpeaking && 'ring-2 ring-sky-400/80',
        isScreenSharing && 'aspect-video w-full'
      )}
    >
      {mascotVisible ? (
        <TalkingHead ttsState={ttsState} getLevel={getTtsLevel} size={isScreenSharing ? 96 : 220} />
      ) : (
        <span
          className={cn(
            'flex items-center justify-center rounded-full bg-sky-600 font-medium text-white',
            isScreenSharing ? 'h-16 w-16 text-3xl' : 'h-40 w-40 text-7xl'
          )}
          aria-label="Rowboat"
        >
          R
        </span>
      )}
      <span className="absolute bottom-3 left-3 rounded-md bg-black/50 px-2 py-0.5 text-sm text-white">
        Rowboat
      </span>
      <button
        type="button"
        onClick={() => setMascotVisible((v) => !v)}
        className="absolute right-3 top-3 rounded-md bg-black/50 px-2 py-1 text-xs text-white/80 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
      >
        {mascotVisible ? 'Hide mascot' : 'Show mascot'}
      </button>
    </div>
  )

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-neutral-950">
      {/* Participant tiles — Meet-style presentation layout while sharing */}
      {isScreenSharing ? (
        <div className="flex min-h-0 flex-1 gap-3 p-4 pb-2">
          <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-2xl bg-neutral-900">
            <StreamVideo streamRef={screenStreamRef} className="h-full w-full object-contain" />
            <span className="absolute bottom-3 left-3 rounded-md bg-black/50 px-2 py-0.5 text-sm text-white">
              Your screen
            </span>
          </div>
          <div className="flex w-52 shrink-0 flex-col gap-3">
            {userTile}
            {assistantTile}
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-4 pb-2 md:grid-cols-2">
          {userTile}
          {assistantTile}
        </div>
      )}

      {/* Captions */}
      <div className="flex h-14 items-center justify-center px-6">
        {caption && (
          <div className="max-w-3xl truncate rounded-lg bg-black/60 px-4 py-2 text-sm text-white/90">
            <span className="mr-2 font-semibold text-white">{caption.who}:</span>
            {caption.text}
          </div>
        )}
      </div>

      {/* Control bar */}
      <div className="flex items-center justify-center gap-4 pb-5">
        <span className="flex items-center gap-2 rounded-full bg-neutral-800 px-3 py-1.5 text-xs font-medium text-white/90">
          <span className={cn('block h-2 w-2 rounded-full', STATUS_DISPLAY[status].dotClass)} />
          {STATUS_DISPLAY[status].label}
        </span>
        <button
          type="button"
          onClick={onToggleScreenShare}
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-full transition-colors',
            isScreenSharing
              ? 'bg-sky-600 text-white hover:bg-sky-500'
              : 'bg-neutral-800 text-white/90 hover:bg-neutral-700'
          )}
          aria-label={isScreenSharing ? 'Stop presenting' : 'Present your screen'}
          title={isScreenSharing ? 'Stop presenting' : 'Present your screen'}
        >
          <MonitorUp className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => setMascotVisible((v) => !v)}
          className="relative flex h-10 w-10 items-center justify-center rounded-full bg-neutral-800 text-white/90 transition-colors hover:bg-neutral-700"
          aria-label={mascotVisible ? 'Hide mascot' : 'Show mascot'}
        >
          <MascotFaceIcon />
          {!mascotVisible && (
            <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="block h-[1.5px] w-6 -rotate-45 rounded-full bg-white/80" />
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onLeave}
          className="flex h-10 w-14 items-center justify-center rounded-full bg-red-600 text-white transition-colors hover:bg-red-500"
          aria-label="Leave call"
        >
          <PhoneOff className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}
