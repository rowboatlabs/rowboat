import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Maximize2, Mic, MicOff, MonitorUp, PhoneOff, SendHorizontal, Square, User, Video, VideoOff } from 'lucide-react'

import { TalkingHead } from '@/components/talking-head'

type PopoutState = {
  ttsState: 'idle' | 'synthesizing' | 'speaking'
  status: 'idle' | 'listening' | 'thinking' | 'speaking' | null
  cameraOn: boolean
  /** User mute = full input pause: no mic audio AND no frame capture. */
  micMuted: boolean
  screenSharing: boolean
  interimText: string | null
  /** A quick ⌘ tap locked hands-free capture (until the next tap). */
  pttLocked: boolean
  /** Latest assistant reply of this call (streams while generating). */
  responseText: string | null
}

// Window heights the pill asks main for: the base pill, and with the
// response panel expanded. Fixed steps so the window never feedback-loops
// with its own resize.
const BASE_HEIGHT = 218
const RESPONSE_HEIGHT = 400

const STATUS_DISPLAY: Record<NonNullable<PopoutState['status']>, { label: string; dotClass: string }> = {
  idle: { label: 'Hold right ⌘ to talk', dotClass: 'bg-neutral-500' },
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
  const [state, setState] = useState<PopoutState>({ ttsState: 'idle', status: null, cameraOn: false, micMuted: false, screenSharing: false, interimText: null, pttLocked: false, responseText: null })
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [draft, setDraft] = useState('')
  // Response panel: auto-opens when a new turn starts generating, user can
  // fold it away. The reply is also spoken — this is the readable half.
  const [responseOpen, setResponseOpen] = useState(true)
  const responseRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (state.status === 'thinking') setResponseOpen(true)
  }, [state.status])

  // Grow/shrink the window with the panel; keep the streaming text pinned
  // to the bottom so the newest words stay visible.
  const showResponse = Boolean(state.responseText) && responseOpen
  useEffect(() => {
    void window.ipc.invoke('video:popoutResize', { height: showResponse ? RESPONSE_HEIGHT : BASE_HEIGHT }).catch(() => {})
  }, [showResponse])
  useEffect(() => {
    if (showResponse && responseRef.current) {
      responseRef.current.scrollTop = responseRef.current.scrollHeight
    }
  }, [showResponse, state.responseText])

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

  const sendAction = useCallback((action: 'toggle-mic' | 'toggle-camera' | 'toggle-share' | 'stop-speaking' | 'ptt-down' | 'ptt-up' | 'end-call' | 'expand') => {
    void window.ipc.invoke('video:popoutAction', { action }).catch(() => {})
  }, [])

  const sendText = useCallback(() => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    void window.ipc.invoke('video:popoutAction', { action: 'send-text', text }).catch(() => {})
  }, [draft])

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
          {state.micMuted && (
            <span className="absolute bottom-1 right-1.5 flex items-center gap-1 rounded bg-red-600/90 px-1.5 py-0.5 text-[10px] font-medium text-white">
              <MicOff className="h-2.5 w-2.5" />
              Muted
            </span>
          )}
        </div>
        <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-lg bg-neutral-800">
          <TalkingHead ttsState={state.ttsState} getLevel={getLevel} size={84} />
          <span className="absolute bottom-1 left-1.5 rounded bg-black/50 px-1 py-px text-[10px] text-white">
            Rowboat
          </span>
          {statusDisplay && (
            <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white">
              {/* Muted overrides the listening/PTT states — the green pulse
                  (or the "hold to talk" invite) would be a lie. */}
              {state.micMuted && (state.status === 'listening' || state.status === 'idle') ? (
                <>
                  <span className="block h-1.5 w-1.5 rounded-full bg-red-500" />
                  Muted
                </>
              ) : state.pttLocked ? (
                <>
                  <span className="block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                  Hands-free
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

      {/* Assistant reply, readable in the pill ("drop-down"): auto-opens
          when a turn starts, collapsible, streams while generating. */}
      {state.responseText && (
        <div className="flex min-h-0 shrink-0 flex-col gap-1" style={noDragRegion}>
          <button
            type="button"
            onClick={() => setResponseOpen((v) => !v)}
            className="flex items-center gap-1 self-start text-[10px] font-medium text-neutral-400 transition-colors hover:text-white"
          >
            {responseOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {responseOpen ? 'Hide response' : 'Show response'}
          </button>
          {responseOpen && (
            <div
              ref={responseRef}
              className="h-[150px] overflow-y-auto whitespace-pre-wrap rounded-md bg-neutral-800 px-2 py-1.5 text-[11px] leading-relaxed text-neutral-100"
            >
              {state.responseText}
              {state.status === 'thinking' && <span className="animate-pulse">▍</span>}
            </div>
          )}
        </div>
      )}

      {/* Control bar — actions execute in the main app window */}
      <div className="flex h-7 shrink-0 items-center justify-center gap-2" style={noDragRegion}>
        {/* Push-to-talk: hold to talk, quick tap to lock hands-free —
            mirrors the Right ⌘ key. Pointer capture keeps the release edge
            even if the cursor slides off mid-hold. */}
        <button
          type="button"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            sendAction('ptt-down')
          }}
          onPointerUp={() => sendAction('ptt-up')}
          onPointerCancel={() => sendAction('ptt-up')}
          disabled={state.micMuted}
          className={`flex h-6 items-center gap-1 rounded-full px-2 text-[10px] font-medium transition-colors select-none ${
            state.status === 'listening' || state.pttLocked
              ? 'bg-green-600 text-white hover:bg-green-500'
              : 'bg-neutral-700 text-white/90 hover:bg-neutral-600'
          } ${state.micMuted ? 'opacity-50' : ''}`}
          aria-label="Hold to talk — or hold the right ⌘ key from any app"
          title="Hold to talk (tap to go hands-free) — or hold the right ⌘ key from any app"
        >
          <Mic className="h-3 w-3" />
          {state.pttLocked ? 'Tap to send' : state.status === 'listening' ? 'Release to send' : 'Hold to talk'}
        </button>
        <button
          type="button"
          onClick={() => sendAction('toggle-mic')}
          className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
            state.micMuted
              ? 'bg-red-600 text-white hover:bg-red-500'
              : 'bg-neutral-700 text-white/90 hover:bg-neutral-600'
          }`}
          aria-label={state.micMuted ? 'Unmute' : 'Mute (pauses mic and frame capture)'}
          title={state.micMuted ? 'Unmute' : 'Mute — pauses your mic and all frame capture'}
        >
          {state.micMuted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
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

      {/* Typed input — lands in the chat exactly like a composer message
          (current frames ride along), so the user can ask without speaking
          or switching back to the app. */}
      <form
        className="flex h-7 shrink-0 items-center gap-1"
        style={noDragRegion}
        onSubmit={(e) => {
          e.preventDefault()
          sendText()
        }}
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a message…"
          className="h-full min-w-0 flex-1 rounded-md bg-neutral-800 px-2 text-[11px] text-white placeholder:text-neutral-500 outline-none focus:ring-1 focus:ring-sky-500"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="flex h-full w-7 items-center justify-center rounded-md bg-sky-600 text-white transition-colors hover:bg-sky-500 disabled:opacity-40"
          aria-label="Send"
          title="Send"
        >
          <SendHorizontal className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  )
}
