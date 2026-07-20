import { useCallback, useEffect, useRef, useState } from 'react'
import { Maximize2, Mic, MicOff, MonitorUp, PhoneOff, Square, User, Video, VideoOff } from 'lucide-react'

import { TalkingHead } from '@/components/talking-head'

type PopoutState = {
  ttsState: 'idle' | 'synthesizing' | 'speaking'
  status: 'listening' | 'thinking' | 'speaking' | null
  cameraOn: boolean
  /** User mute = full input pause: no mic audio AND no frame capture. */
  micMuted: boolean
  /** Push-to-talk hold in progress — listening even while muted. */
  pttActive: boolean
  screenSharing: boolean
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
 * camera toggle, share toggle, end-call. Rendered in its own BrowserWindow
 * (see `video:setPopout` in the main process); call state streams in over
 * the `video:popout-state` push channel and control actions round-trip back
 * through `video:popoutAction`. Captures its own webcam feed — MediaStreams
 * can't cross windows.
 */
export function VideoPopout() {
  // Camera defaults OFF: guessing "on" would flash the user's video for a
  // beat before the real state arrives — which reads as a bug. The true
  // state is fetched immediately below.
  const [state, setState] = useState<PopoutState>({ ttsState: 'idle', status: null, cameraOn: false, micMuted: false, pttActive: false, screenSharing: false, interimText: null })
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const cleanup = window.ipc.on('video:popout-state', (next) => setState(next))
    // The main process replays the cached state on did-finish-load, but that
    // can race this listener's registration — fetch it explicitly too.
    window.ipc
      .invoke('video:getPopoutState', null)
      .then(({ state: cached }) => {
        if (cached) setState(cached)
      })
      .catch(() => {})
    return cleanup
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

  const sendAction = useCallback((action: 'toggle-mic' | 'mic-down' | 'mic-up' | 'toggle-camera' | 'toggle-share' | 'stop-speaking' | 'end-call' | 'expand') => {
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
          {/* Persistent consent badge — the user must always be able to see
              at a glance that their screen is going out. Muted pauses frame
              capture while keeping the share stream open, so say so. */}
          {state.screenSharing && (
            <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-sky-600/90 px-1.5 py-0.5 text-[10px] font-medium text-white">
              <span className={`block h-1.5 w-1.5 rounded-full bg-white ${state.micMuted ? '' : 'animate-pulse'}`} />
              {state.micMuted ? 'Sharing paused' : 'Sharing screen'}
            </span>
          )}
          {state.pttActive ? (
            <span className="absolute bottom-1 right-1.5 flex items-center gap-1 rounded bg-green-600/90 px-1.5 py-0.5 text-[10px] font-medium text-white">
              <Mic className="h-2.5 w-2.5" />
              Listening
            </span>
          ) : state.micMuted ? (
            <span className="absolute bottom-1 right-1.5 flex items-center gap-1 rounded bg-red-600/90 px-1.5 py-0.5 text-[10px] font-medium text-white">
              <MicOff className="h-2.5 w-2.5" />
              Muted
            </span>
          ) : null}
        </div>
        <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-lg bg-neutral-800">
          <TalkingHead ttsState={state.ttsState} getLevel={getLevel} size={84} />
          <span className="absolute bottom-1 left-1.5 rounded bg-black/50 px-1 py-px text-[10px] text-white">
            Rowboat
          </span>
          {statusDisplay && (
            <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white">
              {/* A push-to-talk hold overrides everything; muted overrides
                  "Listening" — the green pulse would be a lie. */}
              {state.pttActive ? (
                <>
                  <span className="block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                  Release to send
                </>
              ) : state.micMuted && state.status === 'listening' ? (
                <>
                  <span className="block h-1.5 w-1.5 rounded-full bg-red-500" />
                  Muted
                </>
              ) : (
                <>
                  <span className={`block h-1.5 w-1.5 rounded-full ${statusDisplay.dotClass}`} />
                  {statusDisplay.label}
                </>
              )}
            </span>
          )}
          {(state.status === 'speaking' || state.status === 'thinking') && (
            <button
              type="button"
              onClick={() => sendAction('stop-speaking')}
              className="absolute bottom-1 right-1.5 flex items-center gap-1 rounded bg-red-600/90 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-red-500"
              style={noDragRegion}
              aria-label="Stop the assistant"
              title={state.status === 'speaking' ? 'Stop speaking' : 'Stop responding'}
            >
              <Square className="h-2.5 w-2.5 fill-current" />
              Stop
            </button>
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
          onPointerDown={(e) => {
            // Raw press/release — the app window turns a quick press into the
            // mute toggle and a sustained one into a push-to-talk hold.
            // Capture the pointer so the release always lands here.
            e.currentTarget.setPointerCapture(e.pointerId)
            sendAction('mic-down')
          }}
          onPointerUp={() => sendAction('mic-up')}
          onPointerCancel={() => sendAction('mic-up')}
          onClick={(e) => {
            // Keyboard activation (Enter/Space) emits click with detail 0 and
            // no pointer events — treat it as a quick press (mute toggle).
            if (e.detail === 0) {
              sendAction('mic-down')
              sendAction('mic-up')
            }
          }}
          className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
            state.pttActive
              ? 'bg-green-600 text-white'
              : state.micMuted
                ? 'bg-red-600 text-white hover:bg-red-500'
                : 'bg-neutral-700 text-white/90 hover:bg-neutral-600'
          }`}
          aria-label={state.micMuted ? 'Unmute (hold to talk)' : 'Mute (hold to talk)'}
          title={
            state.micMuted
              ? 'Click to unmute · hold to talk, release to send'
              : 'Click to mute · hold to talk, release to send'
          }
        >
          {state.micMuted && !state.pttActive ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
        </button>
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
          onClick={() => sendAction('toggle-share')}
          className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
            state.screenSharing
              ? 'bg-sky-600 text-white hover:bg-sky-500'
              : 'bg-neutral-700 text-white/90 hover:bg-neutral-600'
          }`}
          aria-label={state.screenSharing ? 'Stop sharing screen' : 'Share your screen'}
          title={state.screenSharing ? 'Stop sharing screen' : 'Share your screen'}
        >
          <MonitorUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => sendAction('end-call')}
          className="flex h-6 w-8 items-center justify-center rounded-full bg-red-600 text-white transition-colors hover:bg-red-500"
          aria-label="End call"
          title="End call"
        >
          <PhoneOff className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => sendAction('expand')}
          className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-700 text-white/90 transition-colors hover:bg-neutral-600"
          aria-label="Expand to full screen (stops screen sharing)"
          title="Expand to full screen (stops sharing)"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
