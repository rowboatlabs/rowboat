import { useCallback, useEffect, useRef, useState } from 'react'
import { Maximize2, MonitorUp, PhoneOff, User, Video, VideoOff } from 'lucide-react'

import { TalkingHead } from '@/components/talking-head'

type PopoutState = {
  ttsState: 'idle' | 'synthesizing' | 'speaking'
  status: 'listening' | 'thinking' | 'speaking' | null
  cameraOn: boolean
  interimText: string | null
}

const STATUS_DISPLAY: Record<NonNullable<PopoutState['status']>, { label: string; dotClass: string }> = {
  listening: { label: 'Listening', dotClass: 'bg-green-500 animate-pulse' },
  thinking: { label: 'Thinking…', dotClass: 'bg-amber-400' },
  speaking: { label: 'Speaking', dotClass: 'bg-sky-400 animate-pulse' },
}

const dragRegion = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDragRegion = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

/**
 * Content of the always-on-top popout window shown for the whole duration of
 * a screen share (Meet-style floating mini-call) — it floats over every app,
 * including Rowboat itself, and is the call's control surface while sharing:
 * camera toggle, stop-share, end-call. Rendered in its own BrowserWindow
 * (see `video:setPopout` in the main process); call state streams in over
 * the `video:popout-state` push channel and control actions round-trip back
 * through `video:popoutAction`. Captures its own webcam feed — MediaStreams
 * can't cross windows.
 */
export function VideoPopout() {
  const [state, setState] = useState<PopoutState>({ ttsState: 'idle', status: null, cameraOn: true, interimText: null })
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

  const sendAction = useCallback((action: 'toggle-camera' | 'stop-share' | 'end-call') => {
    void window.ipc.invoke('video:popoutAction', { action }).catch(() => {})
  }, [])

  const statusDisplay = state.status ? STATUS_DISPLAY[state.status] : null

  return (
    <div
      className="relative flex h-screen w-screen select-none flex-col gap-1.5 bg-neutral-900 p-1.5"
      style={dragRegion}
    >
      <div className="flex min-h-0 flex-1 gap-1.5">
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
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-700 text-neutral-400">
                <User className="h-6 w-6" />
              </span>
            </div>
          )}
          <span className="absolute bottom-1 left-1.5 rounded bg-black/50 px-1 py-px text-[10px] text-white">
            You
          </span>
        </div>
        <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-lg bg-neutral-800">
          <TalkingHead ttsState={state.ttsState} getLevel={getLevel} size={84} />
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
        {/* Live caption of the in-progress utterance, floating over the tiles */}
        {state.interimText && (
          <div className="pointer-events-none absolute inset-x-1.5 bottom-9 flex justify-center">
            <span className="max-w-full truncate rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white/90">
              {state.interimText}
            </span>
          </div>
        )}
      </div>

      {/* Control bar — actions execute in the main app window */}
      <div className="flex h-7 shrink-0 items-center justify-center gap-2" style={noDragRegion}>
        <button
          type="button"
          onClick={() => sendAction('toggle-camera')}
          className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
            state.cameraOn
              ? 'bg-neutral-700 text-white/90 hover:bg-neutral-600'
              : 'bg-red-600 text-white hover:bg-red-500'
          }`}
          aria-label={state.cameraOn ? 'Turn off camera' : 'Turn on camera'}
          title={state.cameraOn ? 'Turn off camera' : 'Turn on camera'}
        >
          {state.cameraOn ? <Video className="h-3.5 w-3.5" /> : <VideoOff className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => sendAction('stop-share')}
          className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-600 text-white transition-colors hover:bg-sky-500"
          aria-label="Stop sharing screen"
          title="Stop sharing screen"
        >
          <MonitorUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => sendAction('end-call')}
          className="flex h-6 w-8 items-center justify-center rounded-full bg-red-600 text-white transition-colors hover:bg-red-500"
          aria-label="End video mode"
          title="End video mode"
        >
          <PhoneOff className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => void window.ipc.invoke('video:focusMain', null)}
          className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-700 text-white/90 transition-colors hover:bg-neutral-600"
          aria-label="Back to Rowboat"
          title="Back to Rowboat"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
