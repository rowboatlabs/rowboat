import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Minimize2, MonitorUp, PhoneOff, Presentation, Square, User, Video, VideoOff } from 'lucide-react'

import { MascotFaceIcon, TalkingHead } from '@/components/talking-head'
import type { TTSState } from '@/hooks/useVoiceTTS'
import { cn } from '@/lib/utils'

export type VideoCallStatus = 'listening' | 'thinking' | 'speaking'

interface VideoCallViewProps {
  /** Live camera stream from useVideoMode — attached to the user's tile. */
  streamRef: React.MutableRefObject<MediaStream | null>
  cameraOn: boolean
  onToggleCamera: () => void
  /** User mute = full input pause: no mic audio AND no frame capture. */
  micMuted: boolean
  /** Push-to-talk hold in progress — listening even while muted. */
  pttActive: boolean
  /** Raw mic-button press/release — App.tsx decides click (mute toggle) vs
   *  push-to-talk hold (release sends the utterance immediately). */
  onMicDown: () => void
  onMicUp: () => void
  /** Starting a share collapses this view into the floating popout (the
   *  surface is derived from devices — see App.tsx). */
  onToggleScreenShare: () => void
  /** Practice preset: the assistant is coaching this session. */
  practiceMode?: boolean
  /** Shrink to the floating pill without touching any devices. */
  onMinimize: () => void
  /** Stop the assistant: silence speech and abort the run if still going. */
  onInterrupt: () => void
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
 * Full-screen call surface: a Meet-style two-tile layout with the user's
 * webcam on one side and the mascot as the other participant. Shown only
 * while the camera is on with no screen share (the derived-surface rule in
 * App.tsx) — sharing or muting the camera moves the call into the floating
 * popout. The mascot animates with the assistant's speech; dismissing it
 * swaps in a Meet-style letter avatar ("R"). Live captions run along the
 * bottom.
 */
export function VideoCallView({
  streamRef,
  cameraOn,
  onToggleCamera,
  micMuted,
  pttActive,
  onMicDown,
  onMicUp,
  onToggleScreenShare,
  practiceMode,
  onMinimize,
  onInterrupt,
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
    if (!cameraOn) return
    const videoEl = videoRef.current
    if (!videoEl) return
    videoEl.srcObject = streamRef.current
    videoEl.play().catch(() => {})
    return () => {
      videoEl.srcObject = null
    }
  }, [streamRef, cameraOn])

  const userSpeaking = status === 'listening' && Boolean(interimText)
  const assistantSpeaking = ttsState === 'speaking'

  const caption = assistantSpeaking && assistantCaption
    ? { who: 'Rowboat', text: assistantCaption }
    : interimText
      ? { who: 'You', text: interimText }
      : null

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-neutral-950">
      {practiceMode && (
        <span className="absolute left-4 top-4 z-10 flex items-center gap-1.5 rounded-full bg-violet-600/90 px-3 py-1 text-xs font-medium text-white">
          <Presentation className="h-3.5 w-3.5" />
          Practice session
        </span>
      )}
      <button
        type="button"
        onClick={onMinimize}
        className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-neutral-800 text-white/80 transition-colors hover:bg-neutral-700 hover:text-white"
        aria-label="Minimize call (shares your screen)"
        title="Minimize — shares your screen so it can help you work"
      >
        <Minimize2 className="h-4 w-4" />
      </button>

      {/* Participant tiles */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-4 pb-2 md:grid-cols-2">
        {/* User */}
        <div
          className={cn(
            'relative flex items-center justify-center overflow-hidden rounded-2xl bg-neutral-900 transition-shadow',
            userSpeaking && 'ring-2 ring-green-500/80'
          )}
        >
          {cameraOn ? (
            <video
              ref={videoRef}
              muted
              playsInline
              className="h-full w-full object-cover"
              style={{ transform: 'scaleX(-1)' }}
            />
          ) : (
            <span className="flex h-40 w-40 items-center justify-center rounded-full bg-neutral-700 text-neutral-400" aria-label="Camera off">
              <User className="h-20 w-20" />
            </span>
          )}
          <span className="absolute bottom-3 left-3 rounded-md bg-black/50 px-2 py-0.5 text-sm text-white">
            You
          </span>
          {pttActive ? (
            <span className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-md bg-green-600/90 px-2 py-0.5 text-sm font-medium text-white">
              <Mic className="h-3.5 w-3.5" />
              Listening — release to send
            </span>
          ) : micMuted ? (
            <span className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-md bg-red-600/90 px-2 py-0.5 text-sm font-medium text-white">
              <MicOff className="h-3.5 w-3.5" />
              Muted — nothing is heard or captured
            </span>
          ) : null}
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
          {status !== 'listening' && (
            <button
              type="button"
              onClick={onInterrupt}
              className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-md bg-red-600/90 px-2.5 py-1 text-sm font-medium text-white transition-colors hover:bg-red-500"
              aria-label="Stop the assistant"
              title={status === 'speaking' ? 'Stop speaking' : 'Stop responding'}
            >
              <Square className="h-3 w-3 fill-current" />
              Stop
            </button>
          )}
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
        {caption ? (
          <div className="max-w-3xl truncate rounded-lg bg-black/60 px-4 py-2 text-sm text-white/90">
            <span className="mr-2 font-semibold text-white">{caption.who}:</span>
            {caption.text}
          </div>
        ) : micMuted && !pttActive ? (
          <span className="text-sm text-white/40">
            Hold the mic button — or hold Ctrl — to talk; release to send
          </span>
        ) : null}
      </div>

      {/* Control bar */}
      <div className="flex items-center justify-center gap-4 pb-5">
        <span className="flex items-center gap-2 rounded-full bg-neutral-800 px-3 py-1.5 text-xs font-medium text-white/90">
          {/* A push-to-talk hold overrides everything — the user IS being
              heard right now. Muted overrides "Listening" — the green pulse
              would be a lie. Thinking/speaking still show: output continues
              while muted. */}
          {pttActive ? (
            <>
              <span className="block h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              Release to send
            </>
          ) : micMuted && status === 'listening' ? (
            <>
              <span className="block h-2 w-2 rounded-full bg-red-500" />
              Muted
            </>
          ) : (
            <>
              <span className={cn('block h-2 w-2 rounded-full', STATUS_DISPLAY[status].dotClass)} />
              {STATUS_DISPLAY[status].label}
            </>
          )}
        </span>
        <button
          type="button"
          onPointerDown={(e) => {
            // Capture the pointer so the release always lands here, even if
            // the cursor drifts off the button mid-hold.
            e.currentTarget.setPointerCapture(e.pointerId)
            onMicDown()
          }}
          onPointerUp={onMicUp}
          onPointerCancel={onMicUp}
          onClick={(e) => {
            // Keyboard activation (Enter/Space) emits click with detail 0 and
            // no pointer events — treat it as a quick press (mute toggle).
            // Mouse clicks (detail > 0) already went through pointerdown/up.
            if (e.detail === 0) {
              onMicDown()
              onMicUp()
            }
          }}
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-full transition-colors',
            pttActive
              ? 'bg-green-600 text-white'
              : micMuted
                ? 'bg-red-600 text-white hover:bg-red-500'
                : 'bg-neutral-800 text-white/90 hover:bg-neutral-700'
          )}
          aria-label={micMuted ? 'Unmute (hold to talk)' : 'Mute (hold to talk)'}
          title={
            micMuted
              ? 'Click to unmute · hold to talk (or hold Ctrl)'
              : 'Click to mute · hold to talk, release to send (or hold Ctrl)'
          }
        >
          {micMuted && !pttActive ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </button>
        <button
          type="button"
          onClick={onToggleCamera}
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-full transition-colors',
            cameraOn
              ? 'bg-neutral-800 text-white/90 hover:bg-neutral-700'
              : 'bg-red-600 text-white hover:bg-red-500'
          )}
          aria-label={cameraOn ? 'Turn off camera' : 'Turn on camera'}
          title={cameraOn ? 'Turn off camera' : 'Turn on camera'}
        >
          {cameraOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
        </button>
        <button
          type="button"
          onClick={onToggleScreenShare}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-800 text-white/90 transition-colors hover:bg-neutral-700"
          aria-label="Present your screen"
          title="Present your screen"
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
          aria-label="End call"
        >
          <PhoneOff className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}
