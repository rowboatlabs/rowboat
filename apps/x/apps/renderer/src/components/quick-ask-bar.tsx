import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpRight,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ChevronsDown,
  ChevronsUp,
  ChevronUp,
  Maximize2,
  MessageCircle,
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
  VolumeX,
  X,
} from 'lucide-react'
import { Streamdown } from 'streamdown'
// The raw sonner Toaster, NOT the app's ui/sonner wrapper: the wrapper
// calls useTheme(), which throws outside ThemeProvider — and this window
// deliberately has no ThemeProvider. A render crash here paints the whole
// transparent frame as a giant white sheet.
import { Toaster as SonnerToaster } from 'sonner'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { reduceTurn } from '@x/shared/src/turns.js'
import * as quickAskShortcut from '@x/shared/src/quick-ask-shortcut.js'
import { useQuickAskShortcut } from '@/hooks/use-quick-ask-shortcut'

import { TalkingHead } from '@/components/talking-head'
import { useVoiceMode } from '@/hooks/useVoiceMode'
import { isChatMessage } from '@/lib/chat-conversation'
import { runLogToConversation } from '@/lib/run-to-conversation'
import { buildTurnConversation, stripVoiceTags } from '@/lib/session-chat/turn-view'
import { stripKnowledgePrefix } from '@/lib/wiki-links'
import {
  ChatInputWithMentions,
  type ModelSelection,
  type PermissionMode,
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
  /** Output mute (the speaker pin): replies are not spoken while set. */
  speakerMuted: boolean
  /** Tool-name-level "what's happening" while a turn runs, else null. */
  activityText: string | null
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
  speakerMuted: false,
  activityText: null,
  interimText: null,
  pttLocked: false,
  responseText: null,
  questionText: null,
}

type PopoutAction =
  | 'toggle-mic'
  | 'toggle-camera'
  | 'toggle-share'
  | 'toggle-speaker'
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
  // The global summon chord (customizable) — drives hold-to-talk release
  // detection, so it must track rebinds live.
  const shortcut = useQuickAskShortcut()
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
  // Pinned presentation: expanded vs tucked down to just the mascot, and
  // WHICH surface expanded means — untuck returns you to the surface you
  // tucked from ('card' for bar-originated voice calls, 'pill' for calls
  // with live pixels). Main owns both (it resizes the window); pushes keep
  // us in sync.
  const [collapsed, setCollapsed] = useState(false)
  const [surface, setSurface] = useState<'card' | 'pill'>('pill')
  useEffect(() => {
    const cleanup = window.ipc.on('quick-ask:mode', (m) => {
      setMode(m.mode === 'hidden' ? 'summoned' : m.mode)
      setCollapsed(m.collapsed)
      setSurface(m.surface)
    })
    void window.ipc
      .invoke('quickAsk:getMode', null)
      .then((m) => {
        setMode(m.mode === 'hidden' ? 'summoned' : m.mode)
        setCollapsed(m.collapsed)
        setSurface(m.surface)
      })
      .catch(() => {})
    return cleanup
  }, [])
  const pinned = mode === 'pinned'
  // The bar-style card hosting a LIVE voice call ("bring the text back"
  // from a bar-originated tuck): same layout, call-aware contents.
  const callCard = pinned && !collapsed && surface === 'card'

  // Mirrors callState.speakerMuted for the fold callback below (which is
  // deliberately dependency-free).
  const speakerMutedRef = useRef(false)

  const requestCollapsed = useCallback((next: boolean) => {
    // Folding the text makes VOICE the only output channel — a muted
    // speaker there would mean no answer arrives at all, so folding always
    // unmutes. (The toggle itself lives on the text panel for the same
    // reason: it's a "read instead of listen" choice.)
    if (next && speakerMutedRef.current) {
      void window.ipc.invoke('video:popoutAction', { action: 'toggle-speaker' }).catch(() => {})
    }
    // No optimistic local flip: main owns collapsed state and window
    // geometry as one unit, and answers with a quick-ask:mode push. A local
    // flip could disagree with the window size (the squeezed-card wedge
    // where every control looks dead) — one IPC round-trip is imperceptible.
    void window.ipc.invoke('quickAsk:setPinnedCollapsed', { collapsed: next }).catch(() => {})
  }, [])

  // Call state mirrored from the app window, which owns the call engine —
  // this window only renders it (same contract as the old popout).
  const [callState, setCallState] = useState<CallState>(IDLE_CALL_STATE)
  speakerMutedRef.current = callState.speakerMuted
  // Flicker-held activity label shared by every surface this window renders
  // (Skipper chip + panel, tucked chip, pill chip).
  const heldActivity = useHeldLabel(callState.activityText)
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
  // During a call-card session the mascot lip-syncs off a synthesized level
  // instead (the real audio plays in the app window).
  const zeroLevel = useCallback(() => 0, [])
  const synthLevel = useCallback(() => 0.45 + 0.35 * Math.sin(performance.now() / 90), [])

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

  // The bar composer's ModelSelection (model + effort, one value — main's
  // unified shape) rides along with each submit; the app window applies it
  // to the active chat before submitting. Hover asks default to FAST
  // thinking at the submit boundary when the selection carries no effort.
  const selectionRef = useRef<ModelSelection | null>(null)

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
          model: selectionRef.current
            ? { provider: selectionRef.current.provider, model: selectionRef.current.model }
            : null,
          reasoningEffort: selectionRef.current?.effort ?? 'low',
        })
        .catch(() => {})
    },
    [],
  )

  const stop = useCallback(() => {
    void window.ipc.invoke('quickAsk:stop', null).catch(() => {})
  }, [])

  // History peek — display is EXPLICIT (the no-history default is right for
  // ~90% of asks), but the DATA is prefetched eagerly on summon/switch so
  // the click is instant: a local IPC read of a few KB, no downside.
  const [historyData, setHistoryData] = useState<{ role: 'user' | 'assistant'; content: string }[] | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  const reset = useCallback(() => {
    awaitingRef.current = false
    setAsked(null)
    setAnswer(null)
    setShowHistory(false)
  }, [])

  // Destination-chat context: which chat submits land in (title chip) plus
  // recents for the chip's switcher. Pushed by the app window; cached in
  // main and replayed on load.
  const [chatContext, setChatContext] = useState<{
    activeRunId: string | null
    activeTitle: string | null
    recent: { id: string; title: string }[]
  } | null>(null)
  useEffect(() => {
    return window.ipc.on('quick-ask:chat-context', (ctx) => setChatContext(ctx))
  }, [])
  const selectChat = useCallback(
    (rid: string) => {
      // The panel's exchange belongs to the previous chat — clear it.
      reset()
      void window.ipc.invoke('quickAsk:selectChat', { runId: rid }).catch(() => {})
    },
    [reset],
  )

  // A destination change from ANY side (chip, app tab switch, new chat)
  // invalidates a shown history — it belonged to the previous chat.
  // Render-time previous-state adjustment (React's no-effect pattern).
  const activeRunId = chatContext?.activeRunId ?? null
  const [prevRunId, setPrevRunId] = useState(activeRunId)
  if (prevRunId !== activeRunId) {
    setPrevRunId(activeRunId)
    setHistoryData(null)
    setShowHistory(false)
  }

  // Fetch the last few text exchanges of a session. Session chats hydrate
  // via sessions:get → getTurn → reduceTurn → buildTurnConversation (the
  // same path the app's chat uses — the legacy Run.log is EMPTY for them);
  // pre-session chats fall back to runs:fetch + the log converter.
  const fetchHistory = useCallback(async (rid: string) => {
    try {
      const state = await window.ipc.invoke('sessions:get', { sessionId: rid })
      const refs = (state.turns ?? []).slice(-4)
      const turns = await Promise.all(
        refs.map((r) => window.ipc.invoke('sessions:getTurn', { turnId: r.turnId })),
      )
      const items = turns
        .flatMap((t) => buildTurnConversation(reduceTurn(t.events)))
        .filter(isChatMessage)
        .map((m) => ({ role: m.role, content: stripVoiceTags(m.content ?? '').trim() }))
        .filter((m) => m.content)
        .slice(-6)
      if (items.length > 0) return items
    } catch {
      // fall through to the legacy path
    }
    try {
      const run = await window.ipc.invoke('runs:fetch', { runId: rid })
      return runLogToConversation(run.log)
        .filter(isChatMessage)
        .map((m) => ({ role: m.role, content: stripVoiceTags(m.content ?? '').trim() }))
        .filter((m) => m.content)
        .slice(-6)
    } catch {
      return []
    }
  }, [])

  // Prefetch on summon/switch so the peek opens instantly.
  useEffect(() => {
    if (!activeRunId) return
    let stale = false
    void fetchHistory(activeRunId).then((items) => {
      if (!stale) setHistoryData(items)
    })
    return () => {
      stale = true
    }
  }, [activeRunId, fetchHistory])

  // Land at the bottom when history opens: newest first in view, scroll UP
  // for older — matching how the chat itself reads.
  const panelScrollRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (showHistory && panelScrollRef.current) {
      panelScrollRef.current.scrollTop = panelScrollRef.current.scrollHeight
    }
  }, [showHistory, historyData])

  const toggleHistory = useCallback(() => {
    if (showHistory) {
      setShowHistory(false)
      return
    }
    if (!activeRunId) return
    setShowHistory(true)
    // Show the prefetched copy immediately, refresh behind it — exchanges
    // made since the prefetch (including from this bar) must show up.
    void fetchHistory(activeRunId).then((items) => setHistoryData(items))
  }, [showHistory, activeRunId, fetchHistory])

  // Voice input: the composer's mic button, or hold the platform PTT key
  // (right ⌘ on macOS, right Ctrl on Windows) while the bar is focused.
  // Local dictation via the same Deepgram flow as the app composer — no
  // global hook needed, the bar has keyboard focus by construction.
  const voice = useVoiceMode()
  const [recording, setRecording] = useState(false)
  const recordingRef = useRef(false)
  const [voiceAvailable, setVoiceAvailable] = useState(false)
  const [ttsAvailable, setTtsAvailable] = useState(false)
  useEffect(() => {
    Promise.all([
      window.ipc.invoke('voice:getConfig', null),
      window.ipc.invoke('oauth:getState', null),
    ])
      .then(([config, oauthState]) => {
        const rowboatConnected = oauthState.config?.rowboat?.connected ?? false
        setVoiceAvailable(!!config.deepgram || rowboatConnected)
        setTtsAvailable(!!config.elevenlabs || rowboatConnected)
      })
      .catch(() => {
        setVoiceAvailable(false)
        setTtsAvailable(false)
      })
  }, [])
  // Tucking starts a voice call — same gate as the call button.
  const callAvailable = voiceAvailable && ttsAvailable

  const tuck = useCallback(() => {
    void window.ipc.invoke('quickAsk:tuck', null).catch(() => {})
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

  // Hold-chord-to-talk (the Wispr gesture, default ⌥⇧Space — the chord is
  // customizable in Settings → Shortcuts): a chord summon starts
  // capturing IMMEDIATELY — one gesture from anywhere to a spoken question.
  // Electron's global shortcut can't see the key-UP, so the release is
  // detected here once the window has focus: any chord key's keyup, or any
  // event whose modifier state shows the chord's modifiers are no
  // longer held, finalizes and submits. A quick TAP falls out for free —
  // nothing was said, the transcript comes back empty, and an empty
  // transcript doesn't submit, leaving the composer focused for typing.
  // Typing, Esc, or blur cancels; a hard cap ends a stuck session.
  const chordRef = useRef(false)
  const capStartedAtRef = useRef<number | null>(null)
  const voiceAvailableRef = useRef(false)
  useEffect(() => {
    voiceAvailableRef.current = voiceAvailable
  }, [voiceAvailable])
  const endChord = useCallback(
    (how: 'submit' | 'cancel') => {
      if (!chordRef.current) return
      chordRef.current = false
      if (how === 'submit') void submitRecording()
      else cancelRecording()
    },
    [submitRecording, cancelRecording],
  )
  useEffect(() => {
    return window.ipc.on('quick-ask:summoned', ({ viaShortcut }) => {
      if (!viaShortcut || pinned || recordingRef.current || !voiceAvailableRef.current) return
      chordRef.current = true
      startRecording()
    })
  }, [pinned, startRecording])
  useEffect(() => {
    const chordCodes = quickAskShortcut.shortcutChordCodes(shortcut.accelerator)
    const chordModifiers = quickAskShortcut.shortcutModifierStates(shortcut.accelerator)
    const onKeyUp = (e: KeyboardEvent) => {
      if (chordRef.current && chordCodes.includes(e.code)) endChord('submit')
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (!chordRef.current) return
      if (e.key === 'Escape') {
        endChord('cancel')
        return
      }
      // A non-chord key means they're typing — get out of the way.
      if (!chordCodes.includes(e.code)) endChord('cancel')
    }
    const onMouseMove = (e: MouseEvent) => {
      // Backup release signal: the chord's modifiers are no longer held
      // (its keyups were delivered before this window took focus).
      if (chordRef.current && chordModifiers.every((m) => !e.getModifierState(m))) {
        endChord('submit')
      }
    }
    const onBlur = () => endChord('cancel')
    document.addEventListener('keyup', onKeyUp)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousemove', onMouseMove)
    window.addEventListener('blur', onBlur)
    const cap = setInterval(() => {
      // Stuck-session cap: no release signal for 45s means we missed it.
      if (chordRef.current && capStartedAtRef.current && Date.now() - capStartedAtRef.current > 45_000) {
        endChord('submit')
      }
    }, 5_000)
    return () => {
      document.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('blur', onBlur)
      clearInterval(cap)
    }
  }, [endChord, shortcut.accelerator])
  useEffect(() => {
    capStartedAtRef.current = recording ? Date.now() : null
  }, [recording])

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
        if (pinned) {
          // Esc never ends a call — on the call card it tucks the text
          // back into the mascot; on the pill it does nothing.
          if (surface === 'card' && !collapsed) {
            e.preventDefault()
            requestCollapsed(true)
          }
          return
        }
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
    // Capture phase: right ⌘ must work even while the embedded composer (or
    // any popover) has focus — "press ⌘ and speak" is promised in BOTH
    // Skipper states, and bubble-phase listeners can be swallowed below.
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('keyup', onKeyUp, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('keyup', onKeyUp, true)
    }
  }, [asked, pinned, surface, collapsed, requestCollapsed, sendAction, startRecording, submitRecording, cancelRecording, reset, dismiss])

  // Pinned PILL role, tucked: just the mascot (voice-to-voice). The card
  // surface does NOT branch here — its folded state renders inside the one
  // Skipper layout below, so the mascot never remounts (and never moves) on
  // fold/unfold.
  if (pinned && collapsed && surface !== 'card') {
    return (
      <TuckedMascot
        state={callState}
        activity={heldActivity}
        sendAction={sendAction}
        onExpand={() => requestCollapsed(false)}
      />
    )
  }

  // Pinned role, expanded to the PILL (camera/share calls): the call pill
  // with the real composer as its typed input. Bar-originated voice calls
  // fall through to the card layout below instead (callCard).
  if (pinned && surface === 'pill') {
    return (
      <>
        <PinnedPill
          state={callState}
          activity={heldActivity}
          sendAction={sendAction}
          onCollapse={() => requestCollapsed(true)}
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
              onSelectionChange={(sel) => {
                selectionRef.current = sel ?? null
              }}
            />
          }
        />
        <SonnerToaster theme="dark" />
      </>
    )
  }

  // The bar-style card — summoned (no call), or the SKIPPER (a live voice
  // call on the card surface, text panel open or folded). One layout: the
  // mascot column below is the SAME mounted node in both Skipper states —
  // fold/unfold only adds/removes the card beside it, so the mascot never
  // moves, resizes, or replays its entry animation. The exchange comes from
  // the call's mirror on the call card, from the quick-ask mirror summoned.
  const skipper = pinned && surface === 'card'
  const panelAsked = callCard ? callState.questionText : asked
  const panelText = callCard ? (callState.responseText ?? '') : (answer?.text ?? '')
  const panelProcessing = callCard ? callState.status === 'thinking' : processing
  const panelStatusText = callCard
    ? (heldActivity ?? 'Thinking…')
    : (answer?.statusText || 'Thinking…')
  // One-line caption under the Skipper's mascot: the in-flight utterance
  // wins; otherwise the tail of the reply while it speaks.
  const skipperReplyTail =
    skipper && (callState.ttsState !== 'idle' || callState.status === 'thinking')
      ? (callState.responseText ?? '')
          .replace(/[#*_`>[\]]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(-90)
      : ''
  const skipperCaption = skipper ? (callState.interimText || skipperReplyTail) : ''

  // History includes the chat's LATEST messages — but the current exchange
  // is already rendered below the "earlier" divider, so trim it off the
  // tail. Matched on the question text (the reliable key: a streaming reply
  // can differ from its stored copy): drop the newest user message and
  // everything after it iff it IS the question on display.
  const earlierItems = useMemo(() => {
    if (!historyData) return historyData
    const current = (panelAsked ?? '').trim()
    if (!current) return historyData
    for (let i = historyData.length - 1; i >= 0; i--) {
      if (historyData[i].role !== 'user') continue
      if (historyData[i].content.trim() === current) return historyData.slice(0, i)
      break
    }
    return historyData
  }, [historyData, panelAsked])

  return (
    <div className="flex h-screen w-screen select-none flex-col overflow-hidden">
      {/* The invisible stage: popovers open into this zone; clicking it
          dismisses the bar — or, on the call card, tucks the text back into
          the mascot (the call keeps going). Folded Skipper: the stage is a
          drag area, part of "carry it around". */}
      <div
        className="min-h-0 flex-1"
        style={skipper && collapsed ? dragRegion : undefined}
        onMouseDown={callCard ? () => requestCollapsed(true) : skipper ? undefined : dismiss}
      />

      {/* Bottom row: card + the mascot riding alongside on the transparent
          stage. The row is PADDED so the card's CSS shadow fades inside the
          window instead of clipping at its rectangular edge (which read as
          a grey rectangle around the card). The paddings are IDENTICAL in
          both Skipper states — with the corner-anchored window, that pins
          the mascot to the exact same screen pixels across fold/unfold. */}
      <div className="flex shrink-0 items-end justify-end gap-1 px-6 pb-5">
      {!(skipper && collapsed) && (
      <div className="relative min-w-0 flex-1">
      {/* Light skin (#810): near-white card, hairline dark border, dark
          text. The window's native shadow is off (it would outline the
          whole transparent frame) — the card draws its own. */}
      <div className="qa-card w-full overflow-hidden rounded-[26px] border border-black/10 bg-white/[0.97] text-neutral-900 shadow-[0_12px_32px_rgba(0,0,0,0.18),0_2px_10px_rgba(0,0,0,0.10)]">
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
            Summoned: voice-out/share toggles (set before asking). Call
            card: live-call status + mute + end — the call owns the devices,
            replies are always spoken. */}
        <div className="flex items-center justify-end gap-2 px-4 pt-3">
          {/* Destination chip: WHICH chat this bar is continuing — click
              for the recents switcher (opens upward into the transparent
              stage). Rendered in BOTH card modes: text mode mid-call
              retargets subsequent questions just like the summoned bar. */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-1.5 rounded-full bg-black/[0.04] py-1 pl-2.5 pr-2 text-[11px] font-medium text-neutral-600 ring-1 ring-inset ring-black/10 transition-colors hover:bg-black/[0.08] hover:text-neutral-900"
                  >
                    <MessageCircle className="h-3 w-3 shrink-0" />
                    <span className="max-w-[220px] truncate">{chatContext?.activeTitle ?? 'New chat'}</span>
                    <ChevronDown className="h-3 w-3 shrink-0 text-neutral-400" />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="top">
                Questions continue this chat — click to switch · Esc {panelProcessing ? 'dismisses' : 'clears'}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start" side="top" className="max-h-72 w-72 overflow-y-auto">
              {(chatContext?.recent ?? []).map((r) => (
                <DropdownMenuItem key={r.id} onSelect={() => selectChat(r.id)}>
                  <span className={`min-w-0 flex-1 truncate ${r.id === chatContext?.activeRunId ? 'font-semibold' : ''}`}>
                    {r.title}
                  </span>
                  {r.id === chatContext?.activeRunId && (
                    <span className="shrink-0 text-[10px] text-muted-foreground">current</span>
                  )}
                </DropdownMenuItem>
              ))}
              {(chatContext?.recent.length ?? 0) === 0 && <DropdownMenuItem disabled>No recent chats</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
          {/* New chat rides RIGHT NEXT to the selector — it's a destination
              choice too. Works mid-call: the session keeps going, the next
              questions land in the fresh chat. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={newChat}
                aria-label="New chat"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/[0.04] text-neutral-500 ring-1 ring-inset ring-black/10 transition-colors hover:bg-black/[0.08] hover:text-neutral-900"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">New chat</TooltipContent>
          </Tooltip>
          {/* History peek — display is explicit (data prefetched, shown
              only on click). */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={activeRunId ? toggleHistory : undefined}
                aria-label={showHistory ? 'Hide history' : 'Peek at recent history'}
                aria-disabled={!activeRunId}
                className={`${callCard ? '' : 'mr-auto '}flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ring-inset transition-colors ${
                  showHistory
                    ? 'bg-black/[0.08] text-neutral-900 ring-black/15'
                    : activeRunId
                      ? 'bg-black/[0.04] text-neutral-500 ring-black/10 hover:bg-black/[0.08] hover:text-neutral-900'
                      : 'cursor-default bg-black/[0.04] text-neutral-300 ring-black/5'
                }`}
              >
                {showHistory ? <ChevronsDown className="h-3.5 w-3.5" /> : <ChevronsUp className="h-3.5 w-3.5" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {showHistory
                ? 'Hide history'
                : activeRunId
                  ? 'Peek at this chat’s recent messages'
                  : 'No history yet — this is a new chat'}
            </TooltipContent>
          </Tooltip>
          {/* Call controls live on the MASCOT (the same pins as the folded
              Skipper); this strip keeps chat-destination affordances plus
              the speaker mute — a "read instead of listen" choice that only
              exists while the text panel does (folding auto-unmutes). */}
          {callCard && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => sendAction('toggle-speaker')}
                  aria-label={callState.speakerMuted ? 'Unmute spoken replies' : 'Mute spoken replies'}
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ring-inset transition-colors ${
                    callState.speakerMuted
                      ? 'bg-black/[0.04] text-neutral-500 ring-black/10 hover:bg-black/[0.08] hover:text-neutral-900'
                      : 'bg-sky-500/15 text-sky-700 ring-sky-500/30'
                  }`}
                >
                  {callState.speakerMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {callState.speakerMuted
                  ? 'Replies are silent while the text is open — click to speak them again'
                  : 'Spoken questions are answered aloud — click to read replies silently instead'}
              </TooltipContent>
            </Tooltip>
          )}
          {!callCard && (
            <>
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
            </>
          )}
          {/* Jump-to-app stays on the right — it's a window action, not a
              destination choice. Present on EVERY surface (Skipper card
              included): the one bridge from hover to the app's side pane. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={openInApp}
                aria-label="Open in Rowboat"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/[0.04] text-neutral-500 ring-1 ring-inset ring-black/10 transition-colors hover:bg-black/[0.08] hover:text-neutral-900"
              >
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Open this chat in Rowboat's side pane</TooltipContent>
          </Tooltip>
        </div>

        {(panelAsked || panelText || showHistory) && (
          <div
            ref={panelScrollRef}
            className="max-h-[280px] cursor-text select-text overflow-y-auto px-6 pb-3 pt-2 text-sm leading-relaxed text-neutral-800"
          >
            {showHistory && historyData === null && (
              <div className="mb-2 animate-pulse text-xs text-neutral-400">Loading history…</div>
            )}
            {showHistory && earlierItems !== null && (
              <div className="mb-1">
                {earlierItems.length === 0 ? (
                  <div className="mb-2 text-xs text-neutral-400">No earlier messages in this chat.</div>
                ) : (
                  <div className="opacity-75">
                    {earlierItems.map((m, i) =>
                      m.role === 'user' ? (
                        <div key={i} className="mb-1.5 mt-3 text-sm font-medium text-neutral-500 first:mt-0">
                          {m.content}
                        </div>
                      ) : (
                        <Streamdown
                          key={i}
                          className="dark prose prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_pre]:my-2 [&_pre]:text-[11px] [&_code]:text-[11px] [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-black/[0.06] [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:text-neutral-800"
                        >
                          {m.content}
                        </Streamdown>
                      ),
                    )}
                  </div>
                )}
                {(panelAsked || panelText) && earlierItems.length > 0 && (
                  <div className="my-2 flex items-center gap-2 text-[9px] uppercase tracking-wider text-neutral-400">
                    <span className="h-px flex-1 bg-black/10" />
                    earlier
                    <span className="h-px flex-1 bg-black/10" />
                  </div>
                )}
              </div>
            )}
            {/* Inside the scroll area — the question scrolls away with the
                answer instead of persisting as a header. */}
            {panelAsked && <div className="mb-2 text-sm font-medium text-neutral-500">{panelAsked}</div>}
            {panelText ? (
              /* `.dark` scoped to the markdown only: shiki's token colors key
                 off a .dark ancestor, so this flips code to its dark palette
                 (matching the charcoal block bg) without darkening the rest
                 of the light panel — the prose classes here are explicit. */
              <Streamdown className="dark prose prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_pre]:my-2 [&_pre]:text-[11px] [&_code]:text-[11px] [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-black/[0.06] [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:text-neutral-800">
                {panelText}
              </Streamdown>
            ) : (
              panelProcessing && (
                <span className="animate-pulse text-neutral-500">{panelStatusText}</span>
              )
            )}
            {panelProcessing && panelText && <span className="animate-pulse">▍</span>}
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
            onStop={callCard ? () => sendAction('stop-speaking') : stop}
            isProcessing={panelProcessing}
            runId={null}
            placeholder={callCard ? 'Type instead — @ mentions work too…' : 'Ask Rowboat anything…'}
            focusSignal={focusSignal}
            onSelectionChange={(sel) => {
              selectionRef.current = sel ?? null
            }}
            isRecording={callCard ? undefined : recording}
            recordingText={callCard ? undefined : voice.interimText}
            recordingState={
              callCard
                ? undefined
                : voice.state === 'submitting'
                  ? 'stopping'
                  : voice.state === 'connecting'
                    ? 'connecting'
                    : 'listening'
            }
            audioLevelsRef={voice.audioLevelsRef}
            onStartRecording={callCard ? undefined : startRecording}
            onSubmitRecording={callCard ? undefined : submitRecording}
            onCancelRecording={callCard ? undefined : cancelRecording}
            voiceAvailable={callCard ? false : voiceAvailable}
          />
        </div>
      </div>

      {/* Tuck handle on the card's mascot-side edge: push the text into the
          mascot → voice-to-voice. Summoned it STARTS the voice-preset call;
          on the call card it just tucks (the call keeps going). Dimmed —
          never hidden — when voice isn't configured, so the feature stays
          discoverable without dead-end clicks. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={callCard ? () => requestCollapsed(true) : callAvailable ? tuck : undefined}
            aria-label="Tuck into the mascot — voice-to-voice"
            aria-disabled={!callCard && !callAvailable}
            className={`absolute -right-3 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-black/10 bg-white text-neutral-500 shadow-[0_2px_8px_rgba(0,0,0,0.15)] transition-colors ${
              callCard || callAvailable ? 'hover:bg-neutral-50 hover:text-neutral-900' : 'cursor-default opacity-40'
            }`}
          >
            <ChevronsRight className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          {callCard
            ? 'Tuck the text away — the call keeps going'
            : callAvailable
              ? 'Tuck into the mascot — talk instead of type'
              : 'Voice-to-voice needs voice input & output configured in Settings'}
        </TooltipContent>
      </Tooltip>
      </div>
      )}

      {/* The mascot column — the Skipper's CONSTANT. One mounted node for
          both Skipper states (text open or folded): identical size, pins,
          caption slot, and status chip, at identical offsets from the
          window's bottom-right corner — which the corner-anchored window
          keeps fixed on screen, so fold/unfold moves NOTHING here; only the
          card beside it comes and goes. It is the control surface AND the
          drag handle. Summoned (no call) it stays the inert 124px bobbing
          silhouette. */}
      <div
        className={`relative flex w-[132px] shrink-0 select-none flex-col items-center ${skipper ? 'cursor-grab' : 'pointer-events-none'}`}
        style={skipper ? dragRegion : undefined}
        aria-hidden={skipper ? undefined : true}
        title={skipper ? 'Drag to move your Skipper' : undefined}
      >
        {skipper && (
          <style>{`
            @keyframes listen-ring {
              0% { transform: scale(0.72); opacity: 0.9; }
              100% { transform: scale(1.28); opacity: 0; }
            }
            @keyframes skipper-pop {
              0% { opacity: 0; transform: scale(0.5); }
              100% { opacity: 1; transform: scale(1); }
            }
          `}</style>
        )}
        <div
          className="relative -mb-4"
          style={skipper ? { animation: 'skipper-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)' } : undefined}
        >
          {/* Listening halo — rings pulse around the head while the mic
              gate is open, so "press ⌘ and speak" is visibly working in
              both states. */}
          {skipper && !callState.micMuted && (callState.status === 'listening' || callState.pttLocked) && (
            <>
              <span
                className="pointer-events-none absolute left-1/2 z-10 rounded-full border-[3px] border-green-400/90"
                style={{ top: '42%', width: 104, height: 104, marginLeft: -52, marginTop: -52, animation: 'listen-ring 1.5s cubic-bezier(0, 0, 0.2, 1) infinite' }}
              />
              <span
                className="pointer-events-none absolute left-1/2 z-10 rounded-full border-[3px] border-green-400/90"
                style={{ top: '42%', width: 104, height: 104, marginLeft: -52, marginTop: -52, animation: 'listen-ring 1.5s cubic-bezier(0, 0, 0.2, 1) 0.5s infinite' }}
              />
            </>
          )}
          <TalkingHead
            ttsState={
              skipper
                ? callState.status === 'thinking' && callState.ttsState === 'idle'
                  ? 'synthesizing'
                  : callState.ttsState
                : processing
                  ? 'synthesizing'
                  : 'idle'
            }
            getLevel={skipper ? synthLevel : zeroLevel}
            size={skipper ? 132 : 124}
            hat={skipper ? 'cowboy' : undefined}
            hatOverlay={
              skipper ? (
                <SkipperPins
                  state={callState}
                  sendAction={sendAction}
                  textPin={collapsed ? 'expand' : 'collapse'}
                  onTextPin={() => requestCollapsed(!collapsed)}
                />
              ) : undefined
            }
          />
        </div>
        {skipper && (
          <>
            {/* Fixed-height caption + chip slots: present in BOTH states so
                the head never shifts when a caption appears or the text
                folds. Both are single-line and CENTERED on the mascot —
                wider than the 132px column they overflow it symmetrically
                (the column doesn't clip), which reads as a caption under
                the head instead of a squeezed left-ragged wrap. */}
            <div className="flex h-4 items-center">
              {skipperCaption && (
                <span className="max-w-[176px] truncate whitespace-nowrap rounded bg-black/70 px-1.5 py-px text-[10px] text-white/90">{skipperCaption}</span>
              )}
            </div>
            <div className="flex h-6 items-center">
              <SkipperStatusChip state={callState} activity={heldActivity} />
            </div>
          </>
        )}
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
 * Anti-flicker hold for the activity label: agent turns fire tool calls in
 * quick bursts, and mirroring them raw makes the chip strobe. Each shown
 * label holds for a minimum beat; the newest value wins once it elapses.
 */
function useHeldLabel(next: string | null, holdMs = 800): string | null {
  const [shown, setShown] = useState<string | null>(next)
  const shownAtRef = useRef(0)
  useEffect(() => {
    if (next === shown) return
    const apply = () => {
      shownAtRef.current = Date.now()
      setShown(next)
    }
    const elapsed = Date.now() - shownAtRef.current
    if (shown === null || elapsed >= holdMs) {
      apply()
      return
    }
    const timer = setTimeout(apply, holdMs - elapsed)
    return () => clearTimeout(timer)
  }, [next, shown, holdMs])
  return shown
}

/**
 * The Skipper's control pins — ONE cluster for both presentations (text
 * panel open or folded), riding TalkingHead's hatOverlay so they bob with
 * the artwork. Hat = voice: the mic pin, morphing into Stop while a turn is
 * in flight. Boat = surface: the share bow light, the text fold/unfold pin
 * on the left edge, ✕ end on the right. The speaker mute deliberately does
 * NOT live here — with the text folded, voice is the only output channel,
 * so the mute is the text panel's affordance. no-drag sits on EACH button:
 * Electron punches drag-region holes from painted bounds, and a zero-size
 * wrapper excludes nothing.
 */
function SkipperPins({
  state,
  sendAction,
  textPin,
  onTextPin,
}: {
  state: CallState
  sendAction: (action: PopoutAction) => void
  /** 'expand' = bring the text back (tucked); 'collapse' = fold it away. */
  textPin: 'expand' | 'collapse'
  onTextPin: () => void
}) {
  const shortcutState = useQuickAskShortcut()
  const shortcutLabel = quickAskShortcut.formatShortcut(
    shortcutState.accelerator,
    typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac'),
  )
  // The mic and Stop are exclusive states of ONE control: while a turn is
  // in flight the mic is dead anyway, so the hat's single pin morphs.
  const busy = state.status === 'thinking' || state.status === 'speaking'
  return (
    <div>
      {busy ? (
        <button
          type="button"
          onClick={() => sendAction('stop-speaking')}
          aria-label="Stop the assistant"
          title="Stop — cut the reply short (the session keeps going)"
          className="group/pin absolute flex h-[30px] w-[30px] appearance-none items-center justify-center border-0 bg-transparent p-0 outline-none -translate-x-1/2 -translate-y-1/2"
          style={{ ...noDragRegion, left: '50%', top: '17.3%' }}
        >
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-red-600 shadow-sm ring-2 ring-[#17171B] transition-transform group-hover/pin:scale-110">
            <Square className="h-2.5 w-2.5 fill-current text-white" />
          </span>
        </button>
      ) : (
        <button
          type="button"
          onPointerDown={(e) => {
            if (state.micMuted) return
            e.currentTarget.setPointerCapture(e.pointerId)
            sendAction('ptt-down')
          }}
          onPointerUp={() => {
            if (!state.micMuted) sendAction('ptt-up')
          }}
          onPointerCancel={() => {
            if (!state.micMuted) sendAction('ptt-up')
          }}
          aria-label="Hold to talk — tap for hands-free"
          title="Hold to talk (tap for hands-free) — or hold the right ⌘ key"
          className="group/pin absolute flex h-[30px] w-[30px] appearance-none items-center justify-center border-0 bg-transparent p-0 outline-none -translate-x-1/2 -translate-y-1/2"
          style={{ ...noDragRegion, left: '50%', top: '17.3%' }}
        >
          <span
            className={`flex h-[18px] w-[18px] select-none items-center justify-center rounded-full shadow-sm ring-2 ring-[#17171B] transition-transform group-hover/pin:scale-110 ${
              state.status === 'listening' || state.pttLocked ? 'bg-green-500' : 'bg-amber-400'
            }`}
          >
            <Mic
              className={`h-3 w-3 ${
                state.status === 'listening' || state.pttLocked ? 'text-white' : 'text-[#17171B]'
              }`}
            />
          </span>
        </button>
      )}
      {/* The BOW LIGHT — share pin, front and center on the hull: lit sky +
          pulsing dot = broadcasting (the lit pin IS the consent badge). The
          choice is STICKY — future summons start already sharing until it's
          turned off (persisted app-side). */}
      <button
        type="button"
        onClick={() => sendAction('toggle-share')}
        aria-label={state.screenSharing ? 'Stop sharing your screen' : 'Share your screen'}
        className="group/pin absolute flex h-[30px] w-[30px] appearance-none items-center justify-center border-0 bg-transparent p-0 outline-none -translate-x-1/2 -translate-y-1/2"
        style={{ ...noDragRegion, left: '50%', top: '73%' }}
      >
        <span
          className={`relative flex h-[18px] w-[18px] items-center justify-center rounded-full shadow-sm ring-2 ring-[#17171B] transition-transform group-hover/pin:scale-110 ${
            state.screenSharing ? 'bg-sky-500' : 'bg-neutral-600'
          }`}
        >
          <MonitorUp className="h-3 w-3 text-white" />
          {state.screenSharing && (
            <span className="absolute -right-1 -top-1 block h-[7px] w-[7px] animate-pulse rounded-full bg-sky-300 ring-1 ring-[#17171B]" />
          )}
        </span>
        <span className="pointer-events-none absolute left-1/2 top-full mt-0.5 -translate-x-1/2 whitespace-nowrap rounded bg-black/75 px-1.5 py-0.5 text-[9px] font-medium text-white opacity-0 transition-opacity group-hover/pin:opacity-100">
          {state.screenSharing ? 'Sharing screen — click to stop' : 'Share your screen'}
        </span>
      </button>
      <button
        type="button"
        onClick={onTextPin}
        aria-label={textPin === 'expand' ? 'Bring the text back' : 'Tuck the text away'}
        title={textPin === 'expand' ? `Bring the text back (${shortcutLabel} works too)` : 'Tuck the text away — the session keeps going'}
        className="group/pin absolute flex h-[26px] w-[26px] appearance-none items-center justify-center border-0 bg-transparent p-0 outline-none -translate-x-1/2 -translate-y-1/2"
        style={{ ...noDragRegion, left: '18%', top: '68%' }}
      >
        <span className="flex h-[16px] w-[16px] items-center justify-center rounded-full bg-sky-500 shadow-sm ring-2 ring-[#17171B] transition-transform group-hover/pin:scale-125">
          {textPin === 'expand' ? (
            <ChevronsLeft className="h-2.5 w-2.5 text-white" />
          ) : (
            <ChevronsRight className="h-2.5 w-2.5 text-white" />
          )}
        </span>
      </button>
      <button
        type="button"
        onClick={() => sendAction('end-call')}
        aria-label="End the voice session and close"
        title="End & close (a live session can't be hidden while it keeps listening)"
        className="group/pin absolute flex h-[26px] w-[26px] appearance-none items-center justify-center border-0 bg-transparent p-0 outline-none -translate-x-1/2 -translate-y-1/2"
        style={{ ...noDragRegion, left: '82%', top: '68%' }}
      >
        <span className="flex h-[16px] w-[16px] items-center justify-center rounded-full bg-neutral-700 shadow-sm ring-2 ring-[#17171B] transition-colors transition-transform group-hover/pin:scale-125 group-hover/pin:bg-red-600">
          <X className="h-2.5 w-2.5 text-white" />
        </span>
      </button>
    </div>
  )
}

/**
 * The Skipper's status line — the same words under the mascot in both
 * presentations. While the mic gate is open it goes loud (green, mic icon):
 * paired with the listening halo, holding right ⌘ is unmistakably working.
 * While a turn runs, the generic "Thinking…" upgrades to the current
 * activity ("Searching the web…") when one is known — flicker-held by the
 * caller via useHeldLabel.
 */
function SkipperStatusChip({ state, activity }: { state: CallState; activity?: string | null }) {
  const statusDisplay = state.status ? STATUS_DISPLAY[state.status] : null
  const micOpen = !state.micMuted && (state.status === 'listening' || state.pttLocked)
  return (
    <span
      className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 font-medium text-white shadow-md ${
        micOpen ? 'bg-green-600 text-[11px] font-semibold' : 'bg-black/60 text-[10px]'
      }`}
    >
      {state.micMuted && (state.status === 'listening' || state.status === 'idle') ? (
        <>
          <span className="block h-1.5 w-1.5 rounded-full bg-red-500" />
          Muted
        </>
      ) : state.pttLocked ? (
        <>
          <Mic className="h-3 w-3 animate-pulse" />
          Hands-free — tap ⌘ to send
        </>
      ) : state.status === 'listening' ? (
        <>
          <Mic className="h-3 w-3 animate-pulse" />
          Listening — release to send
        </>
      ) : statusDisplay ? (
        <>
          <span className={`block h-1.5 w-1.5 rounded-full ${statusDisplay.dotClass}`} />
          {state.status === 'idle'
            ? 'Hold the mic — or right ⌘'
            : state.status === 'thinking' && activity
              ? activity
              : statusDisplay.label}
        </>
      ) : (
        <>
          <span className="block h-1.5 w-1.5 rounded-full bg-neutral-500" />
          Connecting…
        </>
      )}
    </span>
  )
}

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
  activity,
  sendAction,
  onCollapse,
  composer,
}: {
  state: CallState
  activity?: string | null
  sendAction: (action: PopoutAction) => void
  /** Tuck the pill down to just the mascot (voice-to-voice presentation). */
  onCollapse: () => void
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

  // Tiles show live pixels; controls show capabilities. A voice-only call
  // (no camera, no share) has no pixels to show, so it gets NO "You" tile —
  // just the mascot with the text below. Untucking a voice call must never
  // read as a video call the user didn't start; turning the camera or share
  // on morphs the tile in, in place.
  const voiceOnly = !state.cameraOn && !state.screenSharing

  return (
    <div
      className="dark relative flex h-screen w-screen select-none flex-col gap-1.5 overflow-hidden rounded-2xl bg-neutral-900 p-1.5 text-white ring-1 ring-inset ring-white/10"
      style={dragRegion}
    >
      <div className="flex min-h-0 flex-1 gap-1.5">
        {!voiceOnly && (
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
        )}
        <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-lg bg-neutral-800">
          <style>{`
            @keyframes listen-ring {
              0% { transform: scale(0.72); opacity: 0.9; }
              100% { transform: scale(1.28); opacity: 0; }
            }
          `}</style>
          {/* Listening halo — same signal as the tucked mascot: while the
              mic gate is open (right ⌘ held / hands-free), green rings pulse
              around the head. The corner chip alone is too easy to miss. */}
          {!state.micMuted && (state.status === 'listening' || state.pttLocked) && (
            <>
              <span
                className="pointer-events-none absolute left-1/2 top-1/2 z-10 rounded-full border-[3px] border-green-400/90"
                style={{ width: 88, height: 88, marginLeft: -44, marginTop: -44, animation: 'listen-ring 1.5s cubic-bezier(0, 0, 0.2, 1) infinite' }}
              />
              <span
                className="pointer-events-none absolute left-1/2 top-1/2 z-10 rounded-full border-[3px] border-green-400/90"
                style={{ width: 88, height: 88, marginLeft: -44, marginTop: -44, animation: 'listen-ring 1.5s cubic-bezier(0, 0, 0.2, 1) 0.5s infinite' }}
              />
            </>
          )}
          {/* On a call = hat on (the companion's on-duty signal); thinking
              shows the thought bubbles. */}
          <TalkingHead
            ttsState={state.status === 'thinking' && state.ttsState === 'idle' ? 'synthesizing' : state.ttsState}
            getLevel={getLevel}
            size={voiceOnly ? 96 : 84}
            hat="cowboy"
          />
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
                  {state.status === 'thinking' && activity ? activity : statusDisplay.label}
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
          onClick={() => sendAction('toggle-speaker')}
          className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
            state.speakerMuted
              ? 'bg-red-600 text-white hover:bg-red-500'
              : 'bg-neutral-700 text-white/90 hover:bg-neutral-600'
          }`}
          aria-label={state.speakerMuted ? 'Unmute spoken replies' : 'Mute spoken replies'}
          title={state.speakerMuted ? 'Replies muted — click to speak them' : 'Spoken replies on — click to mute'}
        >
          {state.speakerMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
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
        <button
          type="button"
          onClick={onCollapse}
          className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-700 text-white/90 transition-colors hover:bg-neutral-600"
          aria-label="Tuck down to just the mascot"
          title="Tuck down to just the mascot — the call keeps going"
        >
          <ChevronsRight className="h-3.5 w-3.5" />
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
              className="h-[150px] cursor-text select-text overflow-y-auto rounded-md bg-neutral-800 px-2 py-1.5 text-[11px] leading-relaxed"
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

/**
 * The tucked presentation of the pinned role: just the mascot, floating on
 * a transparent window — voice-to-voice with the call engine. The mascot is
 * the drag handle (Electron drag regions swallow clicks, so gestures live
 * on hover controls instead): hover reveals hold-to-talk, expand, and
 * end-call. A live screen share keeps its consent badge here — the mascot
 * must never hide an active share. Interim speech and the spoken reply's
 * tail run as a one-line caption under the mascot.
 */
function TuckedMascot({
  state,
  activity,
  sendAction,
  onExpand,
}: {
  state: CallState
  activity?: string | null
  sendAction: (action: PopoutAction) => void
  onExpand: () => void
}) {
  // No TTS audio pipeline in this window — synthesize the mouth level, same
  // as the pill's mascot tile.
  const getLevel = useCallback(() => 0.45 + 0.35 * Math.sin(performance.now() / 90), [])

  // One-line caption: the user's in-flight utterance wins; otherwise the
  // tail of the reply while it's being spoken (markdown stripped).
  const replyTail =
    state.ttsState !== 'idle' || state.status === 'thinking'
      ? (state.responseText ?? '')
          .replace(/[#*_`>[\]]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(-90)
      : ''
  const caption = state.interimText || replyTail

  // Mic gate open (holding right ⌘ / the pin, or hands-free lock): the ONE
  // state the user must never have to squint for — without visible feedback
  // there is no way to tell a working hold from a dead key hook.
  const micOpen = !state.micMuted && (state.status === 'listening' || state.pttLocked)

  return (
    <div
      className="group relative flex h-screen w-screen select-none flex-col items-center justify-end overflow-hidden pb-2"
      style={dragRegion}
    >
      <style>{`
        @keyframes tucked-pop {
          0% { opacity: 0; transform: scale(0.5); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes listen-ring {
          0% { transform: scale(0.72); opacity: 0.9; }
          100% { transform: scale(1.28); opacity: 0; }
        }
      `}</style>

      {/* On duty = cowboy hat on; the controls are enamel pins on the hat
          band, drawn in the artwork's own ink and always visible. They ride
          inside TalkingHead's bobbing container (hatOverlay) so they never
          detach from the hat. Pin art is small; each sits in a 26px no-drag
          hit target that grows on hover. */}
      {/* -mb pulls the caption/chip up under the boat: the SVG box has dead
          space below the ripples that read as a big gap. */}
      <div className="relative -mb-4" style={{ animation: 'tucked-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
        {/* Listening halo: expanding green rings around the head while the
            mic gate is open. Peripheral-vision feedback — the user is
            usually looking at their own work, not at the chip's 10px text. */}
        {micOpen && (
          <>
            <span
              className="pointer-events-none absolute left-1/2 z-10 rounded-full border-[3px] border-green-400/90"
              style={{ top: '42%', width: 104, height: 104, marginLeft: -52, marginTop: -52, animation: 'listen-ring 1.5s cubic-bezier(0, 0, 0.2, 1) infinite' }}
            />
            <span
              className="pointer-events-none absolute left-1/2 z-10 rounded-full border-[3px] border-green-400/90"
              style={{ top: '42%', width: 104, height: 104, marginLeft: -52, marginTop: -52, animation: 'listen-ring 1.5s cubic-bezier(0, 0, 0.2, 1) 0.5s infinite' }}
            />
          </>
        )}
        <TalkingHead
          // Thinking = thought bubbles (the calm version — rowing on every
          // turn wore thin): status 'thinking' with idle TTS maps to the
          // 'synthesizing' state, which renders bubbles + raised eyes.
          ttsState={state.status === 'thinking' && state.ttsState === 'idle' ? 'synthesizing' : state.ttsState}
          getLevel={getLevel}
          size={132}
          hat="cowboy"
          hatOverlay={
            <SkipperPins state={state} sendAction={sendAction} textPin="expand" onTextPin={onExpand} />
          }
        />
      </div>

      {/* Caption + status chip, readable over any desktop. */}
      <div className="flex h-4 max-w-full items-center px-2">
        {caption && (
          <span className="truncate rounded bg-black/70 px-1.5 py-px text-[10px] text-white/90">{caption}</span>
        )}
      </div>
      {/* Pure status line — the CONTROLS are the pins. */}
      <div className="flex h-6 items-center">
        <SkipperStatusChip state={state} activity={activity} />
      </div>
    </div>
  )
}
