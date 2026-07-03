import { useCallback, useEffect, useRef, useState } from 'react'
import { Maximize2, User } from 'lucide-react'

import { TalkingHead } from '@/components/talking-head'

type PopoutState = {
  ttsState: 'idle' | 'synthesizing' | 'speaking'
  status: 'listening' | 'thinking' | 'speaking' | null
  cameraOn: boolean
}

const STATUS_DISPLAY: Record<NonNullable<PopoutState['status']>, { label: string; dotClass: string }> = {
  listening: { label: 'Listening', dotClass: 'bg-green-500 animate-pulse' },
  thinking: { label: 'Thinking…', dotClass: 'bg-amber-400' },
  speaking: { label: 'Speaking', dotClass: 'bg-sky-400 animate-pulse' },
}

const dragRegion = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDragRegion = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

/**
 * Content of the always-on-top popout window shown while screen sharing when
 * the main app window loses focus (Meet-style floating mini-call). Rendered
 * in its own BrowserWindow (see `video:setPopout` in the main process); call
 * state streams in over the `video:popout-state` push channel. Captures its
 * own webcam feed — MediaStreams can't cross windows.
 */
export function VideoPopout() {
  const [state, setState] = useState<PopoutState>({ ttsState: 'idle', status: null, cameraOn: true })
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    return window.ipc.on('video:popout-state', (next) => setState(next))
  }, [])

  // Own camera feed, following the main window's camera-on/off state.
  useEffect(() => {
    if (!state.cameraOn) return
    let stream: MediaStream | null = null
    let cancelled = false
    navigator.mediaDevices
      .getUserMedia({ video: { width: { ideal: 640 }, facingMode: 'user' }, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        if (videoRef.current) {
          videoRef.current.srcObject = s
          videoRef.current.play().catch(() => {})
        }
      })
      .catch((err) => console.error('[popout] camera failed:', err))
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
      if (videoRef.current) videoRef.current.srcObject = null
    }
  }, [state.cameraOn])

  // The popout has no TTS audio pipeline — synthesize a plausible mouth level
  // so the mascot still animates while the assistant speaks in the main window.
  const getLevel = useCallback(() => 0.45 + 0.35 * Math.sin(performance.now() / 90), [])

  const statusDisplay = state.status ? STATUS_DISPLAY[state.status] : null

  return (
    <div
      className="flex h-screen w-screen select-none gap-1.5 bg-neutral-900 p-1.5"
      style={dragRegion}
    >
      <div className="relative flex-1 overflow-hidden rounded-lg bg-neutral-800">
        {state.cameraOn ? (
          <video
            ref={videoRef}
            muted
            playsInline
            className="h-full w-full object-cover"
            style={{ transform: 'scaleX(-1)' }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-700 text-neutral-400">
              <User className="h-7 w-7" />
            </span>
          </div>
        )}
        <span className="absolute bottom-1 left-1.5 rounded bg-black/50 px-1 py-px text-[10px] text-white">
          You
        </span>
      </div>
      <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-lg bg-neutral-800">
        <TalkingHead ttsState={state.ttsState} getLevel={getLevel} size={92} />
        <span className="absolute bottom-1 left-1.5 rounded bg-black/50 px-1 py-px text-[10px] text-white">
          Rowboat
        </span>
        {statusDisplay && (
          <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white">
            <span className={`block h-1.5 w-1.5 rounded-full ${statusDisplay.dotClass}`} />
            {statusDisplay.label}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => void window.ipc.invoke('video:focusMain', null)}
        className="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded bg-black/50 text-white/80 hover:text-white"
        style={noDragRegion}
        aria-label="Back to Rowboat"
        title="Back to Rowboat"
      >
        <Maximize2 className="h-3 w-3" />
      </button>
    </div>
  )
}
