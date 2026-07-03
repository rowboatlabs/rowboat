import { useEffect, useRef, useState } from 'react'
import { PhoneOff } from 'lucide-react'

import { MascotFaceIcon, TalkingHead } from '@/components/talking-head'
import type { TTSState } from '@/hooks/useVoiceTTS'
import { cn } from '@/lib/utils'

export type VideoCallStatus = 'listening' | 'thinking' | 'speaking'

interface VideoCallViewProps {
  /** Live camera stream from useVideoMode — attached to the user's tile. */
  streamRef: React.MutableRefObject<MediaStream | null>
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

/**
 * Full-screen hands-free call: a Meet-style two-tile layout with the user's
 * webcam on one side and the mascot as the other participant. The mascot
 * animates with the assistant's speech; dismissing it swaps in a Meet-style
 * letter avatar ("R"). Live captions run along the bottom.
 */
export function VideoCallView({
  streamRef,
  ttsState,
  getTtsLevel,
  status,
  interimText,
  assistantCaption,
  onLeave,
}: VideoCallViewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [mascotVisible, setMascotVisible] = useState(true)

  useEffect(() => {
    const videoEl = videoRef.current
    if (!videoEl) return
    videoEl.srcObject = streamRef.current
    videoEl.play().catch(() => {})
    return () => {
      videoEl.srcObject = null
    }
  }, [streamRef])

  const userSpeaking = status === 'listening' && Boolean(interimText)
  const assistantSpeaking = ttsState === 'speaking'

  const caption = assistantSpeaking && assistantCaption
    ? { who: 'Rowboat', text: assistantCaption }
    : interimText
      ? { who: 'You', text: interimText }
      : null

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-neutral-950">
      {/* Participant tiles */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-4 pb-2 md:grid-cols-2">
        {/* User */}
        <div
          className={cn(
            'relative flex items-center justify-center overflow-hidden rounded-2xl bg-neutral-900 transition-shadow',
            userSpeaking && 'ring-2 ring-green-500/80'
          )}
        >
          <video
            ref={videoRef}
            muted
            playsInline
            className="h-full w-full object-cover"
            style={{ transform: 'scaleX(-1)' }}
          />
          <span className="absolute bottom-3 left-3 rounded-md bg-black/50 px-2 py-0.5 text-sm text-white">
            You
          </span>
        </div>

        {/* Assistant */}
        <div
          className={cn(
            'group relative flex items-center justify-center overflow-hidden rounded-2xl bg-neutral-900 transition-shadow',
            assistantSpeaking && 'ring-2 ring-sky-400/80'
          )}
        >
          {mascotVisible ? (
            <TalkingHead ttsState={ttsState} getLevel={getTtsLevel} size={220} />
          ) : (
            <span
              className="flex h-40 w-40 items-center justify-center rounded-full bg-sky-600 text-7xl font-medium text-white"
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
      </div>

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
          onClick={() => setMascotVisible((v) => !v)}
          className={cn(
            'relative flex h-10 w-10 items-center justify-center rounded-full bg-neutral-800 text-white/90 transition-colors hover:bg-neutral-700',
          )}
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
