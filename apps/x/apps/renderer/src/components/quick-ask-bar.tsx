import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Plus,
  Square,
  User,
  Video,
  VideoOff,
  Volume2,
} from 'lucide-react'
import { Streamdown } from 'streamdown'
// The raw sonner Toaster, NOT the app's ui/sonner wrapper: the wrapper
// calls useTheme(), which throws outside ThemeProvider — and this window
// deliberately has no ThemeProvider. A render crash here paints the whole
// transparent frame as a giant white sheet.
import { Toaster as SonnerToaster } from 'sonner'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TalkingHead } from '@/components/talking-head'
import { useVoiceMode } from '@/hooks/useVoiceMode'
import { stripKnowledgePrefix } from '@/lib/wiki-links'
import {
  ChatInputWithMentions,
  type PermissionMode,
  type ReasoningEffortLevel,
  type SelectedModel,
  type StagedAttachment,
} from '@/components/chat-input-with-mentions'
import type { FileMention, PromptInputMessage } from '@/components/ai-elements/prompt-input'

// Hold-to-speak key by platform. macOS: right ⌘. Windows: the same physical
// position is the right Win key, which the OS owns (a tap opens the Start
// menu) — right Ctrl is the safe equivalent there.
const IS_MAC = navigator.platform.startsWith('Mac')
const PTT_CODE = IS_MAC ? 'MetaRight' : 'ControlRight'

type CompanionMode = 'hidden' | 'summoned' | 'pinned'

// Call state mirrored from the app window (the old #video-popout contract).
type CallState = {
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
  /** The user message that reply answers. */
  questionText: string | null
}

const IDLE_CALL_STATE: CallState = {
  ttsState: 'idle',
  status: null,
  cameraOn: false,
  micMuted: false,
  screenSharing: false,
  interimText: null,
  pttLocked: false,
  responseText: null,
  questionText: null,
}

type PopoutAction =
  | 'toggle-mic'
  | 'toggle-camera'
  | 'toggle-share'
  | 'stop-speaking'
  | 'ptt-down'
  | 'ptt-up'
  | 'end-call'
  | 'expand'

// Pill window heights the renderer asks main for (design px, clamped by
// main): the base pill, and with the response panel expanded.
const PINNED_BASE_HEIGHT = 320
const PINNED_RESPONSE_HEIGHT = 560

/**
 * Content of the quick-ask window (global ⌥⇧Space — see main's quick-ask.ts).
 * The REAL chat composer (ChatInputWithMentions) in a floating card over
 * whatever the user is doing: type a question with @-mentions, attachments,
 * model picker and all — or hold Right ⌘ to speak it — and it lands in the
 * current chat in the app window; the answer streams back here over
 * `quick-ask:state`. The window is hidden, not destroyed, on dismiss — state
 * survives toggles.
 *
 * Geometry: the window is a fixed tall transparent frame (main never resizes
 * it). The card is bottom-anchored; the transparent zone above is where the
 * composer's popovers (mentions, model picker, menus) open upward, and a
 * click there dismisses the bar — preserving the click-away feel.
 */
export function QuickAskBar() {
  const [asked, setAsked] = useState<string | null>(null)
  const [answer, setAnswer] = useState<{ processing: boolean; text: string; statusText: string | null } | null>(null)
  // Only answer pushes that follow OUR submit render — the app window's chat
  // may show unrelated turns from before the bar was opened.
  const awaitingRef = useRef(false)

  // Transparent window: clear every layer so only the card paints. The bar
  // window skips the app's ThemeProvider — claim the LIGHT tokens explicitly
  // (the light-skin redesign, #810). Removing 'dark' matters: the
  // pre-light-redesign code added it, and the window persists across HMR, so
  // a stale 'dark' class left code blocks rendering dark-theme tokens on the
  // light panel.
  useEffect(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    // The document must never scroll — a wheel event could shove the whole
    // card out of place inside the fixed frame.
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    const root = document.getElementById('root')
    if (root) root.style.background = 'transparent'
  }, [])

  // Focus the composer whenever the window is summoned.
  const [focusSignal, setFocusSignal] = useState(1)
  useEffect(() => {
    const onFocus = () => setFocusSignal((n) => n + 1)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  // Which role the window is playing: summoned Spotlight bar or pinned call
  // pill (the old #video-popout, folded into this window). Pushed by main on
  // every transition; fetched once to cover the load race. 'hidden' renders
  // as summoned — the window is invisible then anyway.
  const [mode, setMode] = useState<CompanionMode>('summoned')
  useEffect(() => {
    const cleanup = window.ipc.on('quick-ask:mode', (m) => {
      setMode(m.mode === 'hidden' ? 'summoned' : m.mode)
    })
    void window.ipc
      .invoke('quickAsk:getMode', null)
      .then((m) => setMode(m.mode === 'hidden' ? 'summoned' : m.mode))
      .catch(() => {})
    return cleanup
  }, [])
  const pinned = mode === 'pinned'

  // Call state mirrored from the app window, which owns the call engine —
  // this window only renders it (same contract as the old popout).
  const [callState, setCallState] = useState<CallState>(IDLE_CALL_STATE)
  useEffect(() => {
    const cleanup = window.ipc.on('video:popout-state', (next) => setCallState(next))
    // Main replays the cached state on did-finish-load, but that can race
    // this listener's registration — fetch it explicitly too.
    void window.ipc
      .invoke('video:getPopoutState', null)
      .then(({ state }) => {
        if (state) setCallState(state)
      })
      .catch(() => {})
    return cleanup
  }, [])

  // Relay a call control action to the app window (mic/camera/capture live
  // there; the pill is a dumb terminal).
  const sendAction = useCallback((action: PopoutAction) => {
    void window.ipc.invoke('video:popoutAction', { action }).catch(() => {})
  }, [])

  // The summoned mascot has no audio pipeline — its mouth stays closed; the
  // thinking bubbles (driven by ttsState) are its only active state here.
  const zeroLevel = useCallback(() => 0, [])

  // Knowledge files for @-mentions, fetched over IPC (this window has no
  // App-owned tree). Refreshed on every summon — notes change while the bar
  // is hidden.
  const [knowledgeFiles, setKnowledgeFiles] = useState<string[]>([])
  useEffect(() => {
    const refresh = () => {
      void window.ipc
        .invoke('workspace:readdir', {
          path: 'knowledge',
          opts: { recursive: true, includeHidden: false },
        })
        .then((entries) => {
          const files = entries
            .filter((e) => e.kind === 'file' && e.path.endsWith('.md'))
            .map((e) => stripKnowledgePrefix(e.path))
          setKnowledgeFiles(Array.from(new Set(files)))
        })
        .catch(() => {})
    }
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  useEffect(() => {
    return window.ipc.on('quick-ask:state', (s) => {
      if (!awaitingRef.current) return
      setAnswer({ processing: s.processing, text: s.responseText ?? '', statusText: s.statusText ?? null })
    })
  }, [])

  // Model/effort picked in the bar's composer ride along with each submit —
  // the app window applies them to the active chat before submitting.
  const modelRef = useRef<SelectedModel | null>(null)
  const effortRef = useRef<ReasoningEffortLevel | null>(null)

  const processing = answer?.processing ?? false

  const submit = useCallback(
    (
      message: PromptInputMessage,
      mentions?: FileMention[],
      attachments?: StagedAttachment[],
      searchEnabled?: boolean,
      codeMode?: 'claude' | 'codex',
      permissionMode?: PermissionMode,
    ) => {
      const text = message.text.trim()
      if (!text && !attachments?.length) return
      setAsked(text || (attachments ?? []).map((a) => a.filename).join(', '))
      awaitingRef.current = true
      setAnswer({ processing: true, text: '', statusText: 'Thinking…' })
      void window.ipc
        .invoke('quickAsk:submit', {
          text,
          mentions,
          attachments,
          searchEnabled,
          codeMode,
          permissionMode,
          model: modelRef.current,
          reasoningEffort: effortRef.current,
        })
        .catch(() => {})
    },
    [],
  )

  const stop = useCallback(() => {
    void window.ipc.invoke('quickAsk:stop', null).catch(() => {})
  }, [])

  const reset = useCallback(() => {
    awaitingRef.current = false
    setAsked(null)
    setAnswer(null)
  }, [])

  // Voice input: the composer's mic button, or hold the platform PTT key
  // (right ⌘ on macOS, right Ctrl on Windows) while the bar is focused.
  // Local dictation via the same Deepgram flow as the app composer — no
  // global hook needed, the bar has keyboard focus by construction.
  const voice = useVoiceMode()
  const [recording, setRecording] = useState(false)
  const recordingRef = useRef(false)
  const [voiceAvailable, setVoiceAvailable] = useState(false)
  useEffect(() => {
    Promise.all([
      window.ipc.invoke('voice:getConfig', null),
      window.ipc.invoke('oauth:getState', null),
    ])
      .then(([config, oauthState]) => {
        const rowboatConnected = oauthState.config?.rowboat?.connected ?? false
        setVoiceAvailable(!!config.deepgram || rowboatConnected)
      })
      .catch(() => setVoiceAvailable(false))
  }, [])

  const startRecording = useCallback(() => {
    if (recordingRef.current) return
    recordingRef.current = true
    setRecording(true)
    void voice.start().then((result) => {
      if (result === 'mic-denied') {
        recordingRef.current = false
        setRecording(false)
        void window.ipc.invoke('app:openPrivacySettings', { section: 'microphone' }).catch(() => {})
      }
    })
  }, [voice])

  const submitRecording = useCallback(async () => {
    if (!recordingRef.current) return
    recordingRef.current = false
    setRecording(false)
    const text = await voice.submit()
    if (text) submit({ text, files: [] })
  }, [voice, submit])

  const cancelRecording = useCallback(() => {
    voice.cancel()
    recordingRef.current = false
    setRecording(false)
  }, [voice])

  // Optional toggles. voiceOut: answers to bar questions are spoken aloud.
  // sharing: the app window's screen capture runs and frames ride along with
  // bar submits — the ACTUAL state comes back over quick-ask:options-state
  // (a denied permission must never leave a lying badge).
  const [voiceOut, setVoiceOut] = useState(false)
  const [sharing, setSharing] = useState(false)
  const pushOptions = useCallback((voiceOutput: boolean, screenShare: boolean) => {
    void window.ipc.invoke('quickAsk:setOptions', { voiceOutput, screenShare }).catch(() => {})
  }, [])
  useEffect(() => {
    return window.ipc.on('quick-ask:options-state', (s) => {
      setSharing(s.screenSharing)
      setVoiceOut(s.voiceOutput)
    })
  }, [])
  const toggleVoiceOut = useCallback(() => {
    const next = !voiceOut
    setVoiceOut(next)
    pushOptions(next, sharing)
  }, [voiceOut, sharing, pushOptions])
  const toggleShare = useCallback(() => {
    const next = !sharing
    setSharing(next)
    pushOptions(voiceOut, next)
  }, [voiceOut, sharing, pushOptions])
  // The bar owns the share's consent surface — when it goes away (blur,
  // Esc, jump to the app), the share it started must stop with it. Nothing
  // may keep capturing the screen with no indicator in sight.
  const stopShareIfOn = useCallback(() => {
    if (!sharing) return
    setSharing(false)
    pushOptions(voiceOut, false)
  }, [sharing, voiceOut, pushOptions])
  useEffect(() => {
    const onBlur = () => stopShareIfOn()
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [stopShareIfOn])

  const dismiss = useCallback(() => {
    stopShareIfOn()
    void window.ipc.invoke('quickAsk:hide', null).catch(() => {})
  }, [stopShareIfOn])

  // Jump to the full conversation: the question already lives in the app's
  // active chat (the bar relays into it), so focusing the app window lands
  // on this exact exchange. The bar gets out of the way.
  const openInApp = useCallback(() => {
    stopShareIfOn()
    void window.ipc.invoke('quickAsk:openChat', null).catch(() => {})
    void window.ipc.invoke('quickAsk:hide', null).catch(() => {})
  }, [stopShareIfOn])

  // Fresh conversation for the next question: resets the app's active chat
  // (in the background) and clears the panel. The bar stays up.
  const newChat = useCallback(() => {
    void window.ipc.invoke('quickAsk:newChat', null).catch(() => {})
    reset()
  }, [reset])

  // Hold the platform PTT key to speak. Outside a call: local dictation,
  // release submits the transcript. During a call (pinned): the app's PTT
  // machine owns the mic — relay the key edges to it instead (this works
  // even without the Input Monitoring grant, since the pill has focus).
  // Esc: cancel recording → clear the answer → dismiss, in that order —
  // but never dismiss a live call surface.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === PTT_CODE && !e.repeat) {
        if (pinned) {
          sendAction('ptt-down')
        } else if (!recordingRef.current) {
          startRecording()
        }
      } else if (e.key === 'Escape') {
        if (pinned) return
        e.preventDefault()
        if (recordingRef.current) {
          cancelRecording()
        } else if (asked) {
          reset()
        } else {
          dismiss()
        }
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== PTT_CODE) return
      if (pinned) {
        sendAction('ptt-up')
      } else if (recordingRef.current) {
        void submitRecording()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
    }
  }, [asked, pinned, sendAction, startRecording, submitRecording, cancelRecording, reset, dismiss])

  // Pinned role: the call pill (old #video-popout), with the real composer
  // as its typed input. The window is pill-sized in this mode — no
  // transparent stage.
  if (pinned) {
    return (
      <>
        <PinnedPill
          state={callState}
          sendAction={sendAction}
          composer={
            <ChatInputWithMentions
              knowledgeFiles={knowledgeFiles}
              recentFiles={[]}
              visibleFiles={knowledgeFiles}
              onSubmit={submit}
              onStop={() => sendAction('stop-speaking')}
              isProcessing={callState.status === 'thinking'}
              runId={null}
              placeholder="Type instead — @ mentions work too…"
              onSelectedModelChange={(m) => {
                modelRef.current = m ?? null
              }}
              onReasoningEffortChange={(effort) => {
                effortRef.current = effort ?? null
              }}
            />
          }
        />
        <SonnerToaster theme="dark" />
      </>
    )
  }

  return (
    <div className="flex h-screen w-screen select-none flex-col overflow-hidden">
      {/* The invisible stage: popovers open into this zone; clicking it
          dismisses the bar (the click-away feel, inside our own window). */}
      <div className="min-h-0 flex-1" onMouseDown={dismiss} />

      {/* Bottom row: card + the mascot riding alongside on the transparent
          stage. The row is PADDED so the card's CSS shadow fades inside the
          window instead of clipping at its rectangular edge (which read as
          a grey rectangle around the card). */}
      <div className="flex shrink-0 items-end gap-1 px-6 pb-5">
      {/* Light skin (#810): near-white card, hairline dark border, dark
          text. The window's native shadow is off (it would outline the
          whole transparent frame) — the card draws its own. */}
      <div className="qa-card min-w-0 flex-1 shrink-0 overflow-hidden rounded-[26px] border border-black/10 bg-white/[0.97] text-neutral-900 shadow-[0_12px_32px_rgba(0,0,0,0.18),0_2px_10px_rgba(0,0,0,0.10)]">
        {/* Charcoal code blocks. Streamdown's own dark rule is
            background: var(--shiki-dark-bg) !important inside Tailwind's
            utilities layer — layered !important outranks any override we
            write, and with the variable undefined it computed to transparent
            (the washed-out grey). Supplying the variable lets THEIR rule
            paint the charcoal. */}
        <style>{`
          .qa-card [data-streamdown="code-block-body"] {
            --shiki-dark-bg: #202124;
            background-color: #202124;
          }
          .qa-card [data-streamdown="code-block"] {
            border-color: rgba(0, 0, 0, 0.3) !important;
          }
        `}</style>
        {/* Action strip: bar-level controls that aren't the composer's job.
            Always visible so voice-out/share can be set before asking. */}
        <div className="flex items-center justify-end gap-2 px-4 pt-3">
          {asked && (
            <span className="mr-auto text-[11px] text-neutral-400">
              Also in your Rowboat chat · Esc to {processing ? 'dismiss' : 'clear'}
            </span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggleVoiceOut}
                aria-label={voiceOut ? 'Stop speaking answers' : 'Speak answers aloud'}
                className={`flex h-7 w-7 items-center justify-center rounded-full ring-1 ring-inset transition-colors ${
                  voiceOut
                    ? 'bg-sky-500/15 text-sky-700 ring-sky-500/30'
                    : 'bg-black/[0.04] text-neutral-500 ring-black/10 hover:bg-black/[0.08] hover:text-neutral-900'
                }`}
              >
                <Volume2 className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {voiceOut ? 'Answers are spoken — click to mute' : 'Speak answers aloud'}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggleShare}
                aria-label={sharing ? 'Stop sharing your screen' : 'Share your screen'}
                className={`flex h-7 w-7 items-center justify-center rounded-full ring-1 ring-inset transition-colors ${
                  sharing
                    ? 'bg-emerald-500/15 text-emerald-700 ring-emerald-500/30'
                    : 'bg-black/[0.04] text-neutral-500 ring-black/10 hover:bg-black/[0.08] hover:text-neutral-900'
                }`}
              >
                <MonitorUp className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {sharing ? 'Sharing your screen with this chat — click to stop' : 'Share your screen with this chat'}
            </TooltipContent>
          </Tooltip>
          {asked && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={newChat}
                    aria-label="New chat"
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-black/[0.04] text-neutral-500 ring-1 ring-inset ring-black/10 transition-colors hover:bg-black/[0.08] hover:text-neutral-900"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">New chat</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={openInApp}
                    aria-label="Open in Rowboat"
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-black/[0.04] text-neutral-500 ring-1 ring-inset ring-black/10 transition-colors hover:bg-black/[0.08] hover:text-neutral-900"
                  >
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Open in Rowboat</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>

        {asked && (
          <div className="max-h-[280px] overflow-y-auto px-6 pb-3 pt-2 text-sm leading-relaxed text-neutral-800">
            {/* Inside the scroll area — the question scrolls away with the
                answer instead of persisting as a header. */}
            <div className="mb-2 text-sm font-medium text-neutral-500">{asked}</div>
            {answer?.text ? (
              /* `.dark` scoped to the markdown only: shiki's token colors key
                 off a .dark ancestor, so this flips code to its dark palette
                 (matching the charcoal block bg) without darkening the rest
                 of the light panel — the prose classes here are explicit. */
              <Streamdown className="dark prose prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_pre]:my-2 [&_pre]:text-[11px] [&_code]:text-[11px] [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-black/[0.06] [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:text-neutral-800">
                {answer.text}
              </Streamdown>
            ) : (
              answer?.processing && (
                <span className="animate-pulse text-neutral-500">{answer.statusText ?? 'Thinking…'}</span>
              )
            )}
            {answer?.processing && answer.text && <span className="animate-pulse">▍</span>}
          </div>
        )}

        {/* The real composer. Submits relay the FULL payload (mentions,
            attachments, search/code/permissions, model/effort) to the app
            window, which submits into the active chat exactly like an
            in-app composer message. */}
        <div className="border-t border-black/5 p-3">
          <ChatInputWithMentions
            knowledgeFiles={knowledgeFiles}
            recentFiles={[]}
            visibleFiles={knowledgeFiles}
            onSubmit={submit}
            onStop={stop}
            isProcessing={processing}
            runId={null}
            placeholder="Ask Rowboat anything…"
            focusSignal={focusSignal}
            onSelectedModelChange={(m) => {
              modelRef.current = m ?? null
            }}
            onReasoningEffortChange={(effort) => {
              effortRef.current = effort ?? null
            }}
            isRecording={recording}
            recordingText={voice.interimText}
            recordingState={
              voice.state === 'submitting' ? 'stopping' : voice.state === 'connecting' ? 'connecting' : 'listening'
            }
            audioLevelsRef={voice.audioLevelsRef}
            onStartRecording={startRecording}
            onSubmitRecording={submitRecording}
            onCancelRecording={cancelRecording}
            voiceAvailable={voiceAvailable}
          />
        </div>
      </div>

      {/* The mascot, full silhouette on the transparent stage — the same
          TalkingHead the product tour and call tiles render. Thinking
          bubbles while a question is processing; gentle bob otherwise.
          pointer-events-none: clicks on it neither dismiss nor do anything
          (hush/tuck gestures come with the voice-rule work). */}
      <div className="pointer-events-none w-[124px] shrink-0 select-none" aria-hidden="true">
        <TalkingHead ttsState={processing ? 'synthesizing' : 'idle'} getLevel={zeroLevel} size={124} />
      </div>
      </div>
      <SonnerToaster theme="light" />
    </div>
  )
}

const STATUS_DISPLAY: Record<NonNullable<CallState['status']>, { label: string; dotClass: string }> = {
  idle: { label: 'Hold right ⌘ to talk', dotClass: 'bg-neutral-500' },
  listening: { label: 'Listening', dotClass: 'bg-green-500 animate-pulse' },
  thinking: { label: 'Thinking…', dotClass: 'bg-amber-400' },
  speaking: { label: 'Speaking', dotClass: 'bg-sky-400 animate-pulse' },
}

const dragRegion = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDragRegion = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

/**
 * The pinned role's layout: the Meet-style floating mini-call pill (absorbed
 * from the old #video-popout window) — camera tile when on + mascot tile,
 * live caption, control bar, collapsible response panel, and the REAL
 * composer as its typed input. All call state arrives over
 * `video:popout-state`; control actions round-trip through
 * `video:popoutAction` to the app window, which owns the devices. Captures
 * its own webcam preview — MediaStreams can't cross windows.
 *
 * Wrapped in `.dark`: the pill keeps its dark skin even though the summoned
 * bar claims light tokens, so the composer inside renders dark too.
 */
function PinnedPill({
  state,
  sendAction,
  composer,
}: {
  state: CallState
  sendAction: (action: PopoutAction) => void
  composer: React.ReactNode
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  // Response panel: auto-opens when a new turn starts generating, user can
  // fold it away. The reply is also spoken — this is the readable half.
  const [responseOpen, setResponseOpen] = useState(true)
  const responseRef = useRef<HTMLDivElement | null>(null)

  // A new turn re-opens the panel and rewinds to the top — the reply reads
  // from its beginning, not wherever the last one left off. The re-open is
  // a render-time state adjustment (React's sanctioned previous-state
  // pattern); the scroll rewind is a DOM mutation, so it stays in an effect.
  const [prevStatus, setPrevStatus] = useState(state.status)
  if (prevStatus !== state.status) {
    setPrevStatus(state.status)
    if (state.status === 'thinking') setResponseOpen(true)
  }
  useEffect(() => {
    if (state.status === 'thinking' && responseRef.current) {
      responseRef.current.scrollTop = 0
    }
  }, [state.status])

  // Grow/shrink the window with the panel (design px; main clamps).
  const showResponse = Boolean(state.responseText || state.questionText) && responseOpen
  useEffect(() => {
    void window.ipc
      .invoke('video:popoutResize', { height: showResponse ? PINNED_RESPONSE_HEIGHT : PINNED_BASE_HEIGHT })
      .catch(() => {})
  }, [showResponse])

  // Own camera feed, following the app window's camera-on/off state.
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
      .catch((err) => console.error('[companion] camera failed:', err))
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
      if (videoRef.current) videoRef.current.srcObject = null
    }
  }, [state.cameraOn])

  // No TTS audio pipeline in this window — synthesize a plausible mouth
  // level so the mascot still animates while the assistant speaks in the
  // app window.
  const getLevel = useCallback(() => 0.45 + 0.35 * Math.sin(performance.now() / 90), [])

  const statusDisplay = state.status ? STATUS_DISPLAY[state.status] : null

  return (
    <div
      className="dark relative flex h-screen w-screen select-none flex-col gap-1.5 overflow-hidden rounded-2xl bg-neutral-900 p-1.5 text-white ring-1 ring-inset ring-white/10"
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
          className={`flex h-6 select-none items-center gap-1 rounded-full px-2 text-[10px] font-medium transition-colors ${
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

      {/* The current exchange, readable in the pill: the question plus its
          streaming reply. Auto-opens each turn, collapsible, sits between
          the controls and the composer. */}
      {(state.responseText || state.questionText) && (
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
              className="h-[150px] overflow-y-auto rounded-md bg-neutral-800 px-2 py-1.5 text-[11px] leading-relaxed"
            >
              {state.questionText && (
                <div className="mb-1.5 whitespace-pre-wrap border-l-2 border-sky-500/70 pl-1.5 text-neutral-400">
                  {state.questionText}
                </div>
              )}
              <div className="text-neutral-100">
                {state.responseText && (
                  <Streamdown className="prose prose-sm prose-invert max-w-none text-[11px] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0 [&_pre]:my-1.5 [&_pre]:text-[10px] [&_code]:text-[10px]">
                    {state.responseText}
                  </Streamdown>
                )}
                {state.status === 'thinking' && <span className="animate-pulse">▍</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* The real composer as the pill's typed input — messages land in the
          chat exactly like composer messages, current frames riding along
          (the app attaches them to any submit while a call is live). */}
      <div className="shrink-0" style={noDragRegion}>
        {composer}
      </div>
    </div>
  )
}
