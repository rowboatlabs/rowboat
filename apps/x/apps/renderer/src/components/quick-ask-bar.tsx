import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpRight,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ChevronsDown,
  Anchor,
  ChevronsUp,
  Loader,
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { COMMAND_CENTER_CHAT_SENTINEL } from '@x/shared/src/home-threads.js'
import { reduceTurn } from '@x/shared/src/turns.js'
import * as quickAskShortcut from '@x/shared/src/quick-ask-shortcut.js'
import * as pttKey from '@x/shared/src/ptt-key.js'
import { useQuickAskShortcut } from '@/hooks/use-quick-ask-shortcut'
import { useWindowTheme } from '@/hooks/use-window-theme'

import { TalkingHead } from '@/components/talking-head'
import { isMac } from '@/lib/shortcut'
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

// Hold-to-speak key by platform (shared/ptt-key.ts is the one place that
// decides): macOS right ⌘, elsewhere right Ctrl — the same physical position
// on a PC is the right Win key, which the OS owns (a tap opens the Start
// menu). The LABELS come from there too: this window used to bind Ctrl and
// still say ⌘, which is the worst of both.
const PTT_CODE = pttKey.pttEventCode(isMac)
const PTT_LABEL = pttKey.pttKeyLabel(isMac)

type CompanionMode = 'hidden' | 'pinned'

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
  /** A quick talk-key tap locked hands-free capture (until the next tap). */
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
  | 'ptt-cancel'
  | 'end-call'
  | 'expand'

// The card's chip recipe, in both skins: a translucent tint of the OPPOSITE
// ink over a translucent card. Tokens can't say that — `bg-accent` is a flat
// colour, and flattening these would cost the card the frosted look it is
// built on — so the pairs are spelled out, once, here.
//
// Surface and resting ink are separate because the labelled destination chip
// rests a shade darker than the icon-only buttons beside it. Only that
// resting shade differs, so the hover and dark inks stay with the surface.
// The ring WIDTH (`ring-1 ring-inset`) stays at each call site — those
// controls differ in shape, not in colour.
const CHIP_SURFACE =
  'active:scale-95 bg-black/[0.04] ring-black/10 hover:bg-black/[0.08] hover:text-neutral-900' +
  ' dark:bg-white/[0.06] dark:ring-white/10 dark:hover:bg-white/[0.12] dark:hover:text-neutral-100'
const CHIP_INK = 'text-neutral-500 dark:text-neutral-400'
const CHIP_INK_LABELLED = 'text-neutral-600 dark:text-neutral-400'
const CHIP_IDLE = `${CHIP_SURFACE} ${CHIP_INK}`
const CHIP_ACTIVE =
  'active:scale-95 bg-black/[0.08] text-neutral-900 ring-black/15' +
  ' dark:bg-white/[0.12] dark:text-neutral-100 dark:ring-white/20'
const CHIP_DISABLED =
  'cursor-default bg-black/[0.04] text-neutral-300 ring-black/5' +
  ' dark:bg-white/[0.04] dark:text-neutral-600 dark:ring-white/5'

/**
 * Content of the companion window (global ⌥⇧Space — see main's quick-ask.ts).
 * ONE surface: the SKIPPER — a self-contained composer card hosting a live
 * voice session: the top strip (logo · destination · window actions · share
 * · talk/stop · a small ✕ dismiss) over the real composer, which flips to
 * the app composer's recording bar (live waveform + interim transcript)
 * while the mic gate is open. Two presentations of that one surface, both
 * driven by main over `quick-ask:mode`: card open, or tucked down to the
 * mini call pill (logo · status lane · share · talk/stop · end); a live
 * CAMERA swaps the card for the self-view pill instead. The window is
 * hidden, not destroyed, when the session ends.
 *
 * (The old `summoned` role — a standalone Spotlight-style ask bar with its
 * own answer panel, dictation, and voice/share toggles — is GONE. It existed
 * only as a fallback surface, and every glitch report about hover mode was
 * really that bar appearing where the Skipper belonged. The MASCOT is gone
 * from this surface too — it lives on in the camera pill — replaced by the
 * strip, panel and composer, which carry the same signals in the card:
 * waveform = mic gate open, shimmering activity = thinking, glow = working.)
 *
 * Geometry: a fixed transparent frame with the card bottom-anchored. The
 * transparent zone above is where the composer's popovers (mentions, model
 * picker, menus) open upward; clicking it near the card tucks the text away.
 */
export function QuickAskBar() {
  // This window skips the app's ThemeProvider (main.tsx renders it on a hash
  // route, outside the tree), so it resolves the shared setting itself and
  // owns the light/dark class on <html>. It used to hard-force 'light' for
  // the light-skin redesign (#810) — which meant the theme toggle could never
  // reach the companion at all.
  useWindowTheme()
  // Transparent window: clear every layer so only the card paints.
  useEffect(() => {
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    // The document must never scroll — a wheel event could shove the whole
    // card out of place inside the fixed frame.
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    const root = document.getElementById('root')
    if (root) root.style.background = 'transparent'
  }, [])

  // Focus the composer whenever the window is (re)focused.
  const [focusSignal, setFocusSignal] = useState(1)
  useEffect(() => {
    const onFocus = () => setFocusSignal((n) => n + 1)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  // The window's role, pushed by main on every transition and fetched once
  // to cover the load race. There is exactly ONE visible role — `pinned`,
  // the hover companion — plus `hidden`. UNKNOWN until the first push/fetch
  // lands, and nothing paints before then.
  const [role, setRole] = useState<{ seq: number; mode: CompanionMode; collapsed: boolean; surface: 'card' | 'pill' } | null>(null)
  useEffect(() => {
    const apply = (m: { seq: number; mode: CompanionMode; collapsed: boolean; surface: 'card' | 'pill' }) => {
      // Pushes and the fetch can interleave — the highest seq is the truth.
      setRole((prev) => (prev && prev.seq > m.seq ? prev : m))
    }
    const cleanup = window.ipc.on('quick-ask:mode', apply)
    void window.ipc.invoke('quickAsk:getMode', null).then(apply).catch(() => {})
    return cleanup
  }, [])
  // Paint ack: once the pushed role is on screen, tell main — it reveals
  // (or resizes) the window only then, never mid-transition. Two frames in:
  // the first rAF runs before this commit is painted, the second after it
  // has been.
  const roleSeq = role?.seq ?? 0
  useEffect(() => {
    if (!roleSeq) return
    let cancelled = false
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return
        void window.ipc.invoke('quickAsk:modeApplied', { seq: roleSeq }).catch(() => {})
      })
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(raf1)
    }
  }, [roleSeq])
  const pinned = role?.mode === 'pinned'
  // Presentation: expanded vs tucked down to just the mascot, and WHICH
  // surface expanded means — the Skipper card, or the pill when a live
  // camera needs its self-view. Main owns both (it resizes the window);
  // pushes keep us in sync.
  const collapsed = role?.collapsed ?? false
  const surface = role?.surface ?? 'card'
  // The Skipper's text panel is open (mascot + card, the default landing).
  const callCard = pinned && !collapsed && surface === 'card'
  // The frame is mostly transparent stage — hand the clicks that land on it
  // back to whatever the user has underneath.
  useClickThrough(pinned)
  useDragCursor()

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

  // The card's fold is animated, so it outlives `collapsed` by the length of
  // its exit (usePresence) — everything below keys off `card.mounted`, not
  // `!collapsed`.
  const card = usePresence(!collapsed, CARD_EXIT_MS)

  // The visible card, for hit-testing stage clicks: the window is a tall
  // transparent frame, so "clicked outside" often lands INSIDE its invisible
  // stage. Tuck-on-stage-click only counts near the card — clicks in
  // visually-empty space must not steal the panel.
  const cardRef = useRef<HTMLDivElement | null>(null)
  // Reached only where the window is still SOLID, i.e. the grace ring just
  // outside the card (useClickThrough) — further out the click belongs to
  // whatever is behind us. The band stays generous so the gesture never
  // depends on the ring's exact width.
  const TUCK_BAND_PX = 80
  const stageTuck = useCallback((e: React.MouseEvent) => {
    const card = cardRef.current?.getBoundingClientRect()
    if (!card) {
      requestCollapsed(true)
      return
    }
    const nearCard =
      e.clientY >= card.top - TUCK_BAND_PX &&
      e.clientX >= card.left - 24 &&
      e.clientX <= card.right + 24
    if (nearCard) requestCollapsed(true)
    // Anywhere else on the invisible stage: inert — an invisible surface
    // must not carry a surprising gesture.
  }, [requestCollapsed])

  // Call state mirrored from the app window, which owns the call engine —
  // this window only renders it (same contract as the old popout).
  const [callState, setCallState] = useState<CallState>(IDLE_CALL_STATE)
  speakerMutedRef.current = callState.speakerMuted
  // Leaving the pinned role ends this window's view of the call: drop the
  // mirror so a later summon never paints the previous call's status or
  // reply for a frame (main replays the live state on every pin). Render-
  // time previous-state adjustment (React's no-effect pattern).
  const [prevPinned, setPrevPinned] = useState(pinned)
  if (prevPinned !== pinned) {
    setPrevPinned(pinned)
    if (!pinned) setCallState(IDLE_CALL_STATE)
  }
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
  // there; this window is a dumb terminal).
  const sendAction = useCallback((action: PopoutAction) => {
    void window.ipc.invoke('video:popoutAction', { action }).catch(() => {})
  }, [])

  // The mic gate is open — the composer flips to its recording bar.
  const micOpen = !callState.micMuted && (callState.status === 'listening' || callState.pttLocked)

  // Levels feeding the composer's recording waveform — the REAL per-frame
  // amplitudes from the app window's voice hook (one auto-gained level per
  // captured audio frame, ~16/s), relayed over video:popout-levels: the
  // bars move at the app composer's cadence and track actual speech.
  // (Audio itself can't cross windows; a few numbers a second can — this
  // replaced a synthesized envelope that neither tracked the voice nor
  // matched the pace.) Cleared when the gate closes, so the next capture
  // starts a fresh strip.
  const levelsRef = useRef<number[]>([])
  useEffect(() => {
    return window.ipc.on('video:popout-levels', ({ levels }) => {
      const arr = levelsRef.current
      arr.push(...levels)
      if (arr.length > 4800) arr.splice(0, arr.length - 4800)
    })
  }, [])
  useEffect(() => {
    if (!micOpen) levelsRef.current = []
  }, [micOpen])

  // Knowledge files for @-mentions, fetched over IPC (this window has no
  // App-owned tree). Refreshed on focus — notes change while it's hidden.
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

  // The composer's ModelSelection (model + effort, one value — main's
  // unified shape) rides along with each submit; the app window applies it
  // to the companion's session before submitting.
  const selectionRef = useRef<ModelSelection | null>(null)

  // Typed input during a session: the FULL composer payload relays to the
  // app window, which submits it into the companion's chat exactly like an
  // in-app message. The reply comes back through the call mirror
  // (`video:popout-state`), same as a spoken one.
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

  // History peek — display is EXPLICIT (the no-history default is right for
  // ~90% of asks), but the DATA is prefetched eagerly on switch so the click
  // is instant: a local IPC read of a few KB, no downside.
  const [historyData, setHistoryData] = useState<{ role: 'user' | 'assistant'; content: string }[] | null>(null)
  const [showHistory, setShowHistory] = useState(false)

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
  const selectChat = useCallback((rid: string) => {
    void window.ipc.invoke('quickAsk:selectChat', { runId: rid }).catch(() => {})
  }, [])

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

  // Prefetch on switch so the peek opens instantly.
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
    // made since the prefetch (including from here) must show up.
    void fetchHistory(activeRunId).then((items) => setHistoryData(items))
  }, [showHistory, activeRunId, fetchHistory])

  // Fresh conversation for the next question: rebinds the companion's chat
  // (in the app window). The session keeps going.
  const newChat = useCallback(() => {
    void window.ipc.invoke('quickAsk:newChat', null).catch(() => {})
  }, [])

  // Jump to the full conversation in the app's side pane. The session keeps
  // going — this window stays exactly as it is.
  const openInApp = useCallback(() => {
    void window.ipc.invoke('quickAsk:openChat', null).catch(() => {})
  }, [])

  // Hold the platform PTT key to speak: the app's PTT machine owns the mic,
  // so relay the key edges to it (this works even without the Input
  // Monitoring grant, since this window has focus). While the mic gate is
  // open, Enter sends and Escape discards — the same keys the app
  // composer's dictation binds — and only otherwise does Esc tuck the text
  // (it never ends a session).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === PTT_CODE && !e.repeat) {
        sendAction('ptt-down')
      } else if (micOpen && e.key === 'Enter') {
        e.preventDefault()
        sendAction('ptt-up')
      } else if (micOpen && e.key === 'Escape') {
        e.preventDefault()
        sendAction('ptt-cancel')
      } else if (e.key === 'Escape' && callCard) {
        e.preventDefault()
        requestCollapsed(true)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === PTT_CODE) sendAction('ptt-up')
    }
    // Capture phase: the talk key must work even while the embedded composer
    // (or any popover) has focus — "press and speak" is promised in BOTH
    // Skipper states, and bubble-phase listeners can be swallowed below.
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('keyup', onKeyUp, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('keyup', onKeyUp, true)
    }
  }, [callCard, micOpen, requestCollapsed, sendAction])

  // --- Derived values for the card layout. Computed BEFORE the early
  // returns below: the useMemo is a hook, and a hook after a conditional
  // return changes the hook count between renders (React throws "rendered
  // more/fewer hooks" and unmounts the whole window — the old pill ⇄ card
  // crash on camera toggles).
  const panelAsked = callState.questionText
  const panelText = callState.responseText ?? ''
  const panelProcessing = callState.status === 'thinking'
  const panelStatusText = heldActivity ?? 'Thinking…'

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

  // No role yet, or no session: paint NOTHING. The window is hidden in that
  // state anyway — and painting a placeholder is exactly how the retired
  // summoned bar used to flash before the Skipper landed.
  if (!pinned) return null

  // Tucked PILL (camera calls): the standalone mini call pill in its own
  // frame (main resizes to the TUCKED bounds). The card surface does NOT
  // branch here — its folded state renders inside the one Skipper layout
  // below, so fold/unfold swaps card ⇄ dock in place in the same frame.
  if (collapsed && surface !== 'card') {
    return (
      <div
        data-qa-passthrough
        className="flex h-screen w-screen select-none flex-col items-end justify-end overflow-hidden px-3 pb-3"
      >
        <style>{COMPANION_MOTION_CSS}</style>
        <TuckedDock
          state={callState}
          activity={heldActivity}
          sendAction={sendAction}
          onExpand={() => requestCollapsed(false)}
        />
      </div>
    )
  }

  // Expanded to the PILL (camera calls): the call pill with the real
  // composer as its typed input. Voice sessions use the card below.
  if (surface === 'pill') {
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

  // THE SKIPPER — the one hover surface: a single self-contained card
  // (destination strip, composer, footer dock). Folded, the same corner
  // shows the mini call pill instead (TuckedDock below) — the two swap in
  // place, anchored on the bottom-right corner main keeps fixed.
  return (
    <div data-qa-passthrough className="flex h-screen w-screen select-none flex-col overflow-hidden">
      <style>{COMPANION_MOTION_CSS}</style>
      {/* The invisible stage: popovers open into this zone. It is marked
          passthrough, so clicks that land on it go to whatever the user has
          BEHIND this window (useClickThrough) instead of being swallowed by
          a transparent rectangle. The only gesture it still carries is
          tucking the panel, and only NEAR the visible card (stageTuck
          hit-test) — reachable because the grace ring keeps the window
          solid just outside the card's edge. (It is deliberately NOT a drag
          region — a screen-sized invisible drag area is exactly how a click
          on empty desktop once ended up moving the Skipper; the card is the
          drag handle.) */}
      <div
        data-qa-passthrough
        className="min-h-0 flex-1"
        onMouseDown={collapsed ? undefined : stageTuck}
      />

      {/* Bottom row: the card (or, folded, the mini pill) on the transparent
          stage. The row is PADDED so the card's CSS shadow fades inside the
          window instead of clipping at its rectangular edge (which read as
          a grey rectangle around the card). The paddings are IDENTICAL in
          both states — with the corner-anchored window, that keeps the
          fold/unfold swap on the exact same screen pixels. */}
      <div data-qa-passthrough className="flex shrink-0 items-end justify-end px-6 pb-5">
      {card.mounted && (
      <div
        data-qa-passthrough
        className={`relative min-w-0 flex-1 ${card.exiting ? 'qa-card-out pointer-events-none' : 'qa-card-in'}`}
      >
      {/* Near-white card with a hairline dark border in light; near-black
          with a hairline light one in dark. #810 introduced the light skin as
          the only skin — it follows the app's theme setting now (see
          useWindowTheme above). The window's native shadow is off (it would
          outline the whole transparent frame) — the card draws its own, and
          draws it heavier in dark, where a soft grey haze would just vanish
          into whatever is behind the window. */}
      <div ref={cardRef} style={dragRegion} className="qa-card relative w-full cursor-grab overflow-hidden rounded-[26px] border border-black/10 bg-white/[0.97] text-neutral-900 shadow-[0_12px_32px_rgba(0,0,0,0.18),0_2px_10px_rgba(0,0,0,0.10)] dark:border-white/15 dark:bg-neutral-900/[0.97] dark:text-neutral-100 dark:shadow-[0_12px_32px_rgba(0,0,0,0.55),0_2px_10px_rgba(0,0,0,0.4)]">
        {/* The card is a drag handle, like the mascot: every bit of bare
            surface — the border, the gutters around the action strip, the
            frame around the composer — picks the Skipper up. The CONTROLS
            punch holes in it (noDragRegion below): Electron makes children
            draggable unless they opt out, so each chip, the response panel
            (its scrollbar rides the card's edge, and a scrollbar that moved
            the window instead of the text would be a trap) and the composer
            say so explicitly. */}
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
          /* Same charcoal block, but a dark hairline on a dark card is an
             invisible one — the edge has to come from the light side. */
          .dark .qa-card [data-streamdown="code-block"] {
            border-color: rgba(255, 255, 255, 0.15) !important;
          }
        `}</style>
        {/* Action strip: the logo (the thinking beacon — it glows while a
            turn runs) and the destination affordances on the left (where
            the answer will land); window actions, the device controls
            (share, talk/stop) and the small ✕ dismiss on the right. */}
        <div className="flex items-center gap-2 px-4 pt-3">
          <LogoTile size={28} glow={callState.status === 'thinking'} />
          {/* Destination chip: WHICH chat this session is continuing — click
              for the recents switcher (opens upward into the transparent
              stage). Retargets subsequent questions mid-session. */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    style={noDragRegion}
                    className={`flex min-w-0 items-center gap-1.5 rounded-full py-1 pl-2.5 pr-2 text-[11px] font-medium ring-1 ring-inset transition ${CHIP_SURFACE} ${CHIP_INK_LABELLED}`}
                  >
                    <MessageCircle className="h-3 w-3 shrink-0" />
                    <span className="max-w-[220px] truncate">{chatContext?.activeTitle ?? 'New chat'}</span>
                    <ChevronDown className="h-3 w-3 shrink-0 text-neutral-400" />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="top">
                Questions continue this chat — click to switch · Esc tucks the text away
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start" side="top" className="max-h-72 w-72 overflow-y-auto">
              {/* The standing operator channel, always first: pick it and
                  every utterance operates Home — to-dos, dispatch, status —
                  with no "this is about my command center" preamble. */}
              <DropdownMenuItem onSelect={() => selectChat(COMMAND_CENTER_CHAT_SENTINEL)}>
                <Anchor className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium">Command Center</span>
                {chatContext?.activeTitle === 'Command Center' && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">current</span>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
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
              choice too. The session keeps going; the next questions land
              in the fresh chat. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                style={noDragRegion}
                onClick={newChat}
                aria-label="New chat"
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ring-inset transition ${CHIP_IDLE}`}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">New chat</TooltipContent>
          </Tooltip>
          {/* Destination on the left, window actions on the right. */}
          <span className="min-w-0 flex-1" />
          {/* History peek — display is explicit (data prefetched, shown
              only on click). */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                style={noDragRegion}
                onClick={activeRunId ? toggleHistory : undefined}
                aria-label={showHistory ? 'Hide history' : 'Peek at recent history'}
                aria-disabled={!activeRunId}
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ring-inset transition ${
                  showHistory
                    ? CHIP_ACTIVE
                    : activeRunId
                      ? CHIP_IDLE
                      : CHIP_DISABLED
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
          {/* The speaker mute — a "read instead of listen" choice that only
              exists while the text panel does (folding auto-unmutes). */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                style={noDragRegion}
                onClick={() => sendAction('toggle-speaker')}
                aria-label={callState.speakerMuted ? 'Unmute spoken replies' : 'Mute spoken replies'}
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ring-inset transition ${
                  callState.speakerMuted
                    ? CHIP_IDLE
                    : 'bg-sky-500/15 text-sky-700 ring-sky-500/30 dark:bg-sky-400/20 dark:text-sky-300 dark:ring-sky-400/30'
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
          {/* Jump-to-app stays on the right — it's a window action, not a
              destination choice: the one bridge from hover to the app's
              side pane. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                style={noDragRegion}
                onClick={openInApp}
                aria-label="Open in Rowboat"
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ring-inset transition ${CHIP_IDLE}`}
              >
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Open this chat in Rowboat's side pane</TooltipContent>
          </Tooltip>
          {/* Device controls — the call owns them. The lit share button IS
              the consent badge (sky + pulsing dot while broadcasting). */}
          <ShareButton state={callState} sendAction={sendAction} className="h-7 w-7" />
          <TalkButton state={callState} sendAction={sendAction} className="h-7 w-7" />
          {/* End & close, as a small window-dismiss ✕ in the corner. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                style={noDragRegion}
                onClick={() => sendAction('end-call')}
                aria-label="End the voice session and close"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-neutral-400 transition hover:bg-red-500/10 hover:text-red-600 active:scale-95 dark:text-neutral-500 dark:hover:bg-red-400/10 dark:hover:text-red-400"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">End & close (a live session can't be hidden while it keeps listening)</TooltipContent>
          </Tooltip>
        </div>

        {(panelAsked || panelText || showHistory) && (
          <div
            ref={panelScrollRef}
            style={noDragRegion}
            className="qa-rise max-h-[280px] cursor-text select-text overflow-y-auto px-6 pb-3 pt-2 text-sm leading-relaxed text-neutral-800 dark:text-neutral-200"
          >
            {showHistory && historyData === null && (
              <div className="mb-2 animate-pulse text-xs text-neutral-400">Loading history…</div>
            )}
            {/* Peeked history and the live exchange are the SAME two turn
                shapes in the same order — the only thing between them is the
                rule saying where the past stops. (They used to diverge: the
                history was blanket-dimmed, its questions were bare grey
                text, and the rule between them was labelled "earlier" while
                sitting above the newest turn of all.) */}
            {showHistory && earlierItems !== null && (
              <div className="mb-1">
                {earlierItems.length === 0 ? (
                  <div className="mb-2 text-xs text-neutral-400">No earlier messages in this chat.</div>
                ) : (
                  earlierItems.map((m, i) =>
                    m.role === 'user' ? (
                      <UserTurn key={i}>{m.content}</UserTurn>
                    ) : (
                      <AssistantTurn key={i}>{m.content}</AssistantTurn>
                    ),
                  )
                )}
                {(panelAsked || panelText) && earlierItems.length > 0 && <TurnDivider>now</TurnDivider>}
              </div>
            )}
            {/* Inside the scroll area — the question scrolls away with the
                answer instead of persisting as a header. */}
            {panelAsked && <UserTurn>{panelAsked}</UserTurn>}
            {panelText ? (
              <AssistantTurn>{panelText}</AssistantTurn>
            ) : (
              panelProcessing && (
                /* The thinking/searching animation lives here now (the
                   footer status lane is gone): the running activity as
                   shimmer text behind a slow spinner. */
                <span className="flex items-center gap-2">
                  <Loader className="qa-spin h-3.5 w-3.5 flex-none text-sky-500 dark:text-sky-400" />
                  <span className="qa-shimmer font-medium">{panelStatusText}</span>
                </span>
              )
            )}
            {panelProcessing && panelText && <span className="animate-pulse">▍</span>}
          </div>
        )}

        {/* The real composer. Submits relay the FULL payload (mentions,
            attachments, search/code/permissions, model/effort) to the app
            window, which submits into the companion's chat exactly like an
            in-app composer message. While the mic gate is open it flips to
            its own recording bar — the SAME waveform + interim transcript
            as the app composer's dictation — wired to the call's PTT
            machine: ↑ sends (ptt-up), ✕ discards (ptt-cancel). */}
        <div className="p-3">
          {/* The composer opts out of the card's drag region — the frame
              around it stays a grab handle. */}
          <div style={noDragRegion}>
            <ChatInputWithMentions
              knowledgeFiles={knowledgeFiles}
              recentFiles={[]}
              visibleFiles={knowledgeFiles}
              onSubmit={submit}
              onStop={() => sendAction('stop-speaking')}
              isProcessing={panelProcessing}
              runId={null}
              placeholder={`Ask anything. Hold ${PTT_LABEL} to speak`}
              focusSignal={focusSignal}
              onSelectionChange={(sel) => {
                selectionRef.current = sel ?? null
              }}
              voiceAvailable={false}
              isRecording={micOpen}
              recordingText={callState.interimText ?? ''}
              recordingState="listening"
              audioLevelsRef={levelsRef}
              onSubmitRecording={() => sendAction('ptt-up')}
              onCancelRecording={() => sendAction('ptt-cancel')}
            />
          </div>
        </div>
      </div>

      {/* Tuck handle on the card's right edge: fold the card down to the
          mini call pill. The session keeps going.

          This wrapper is the DRAG-REGION HOLE, so it is static and
          transform-free (placed with calc, not -translate-y-1/2). The button
          used to BE the hole while carrying three transforms — the centring
          translate plus hover:translate-x and active:scale — and Electron
          punches holes from the rect Blink last computed on style/layout
          invalidation, not once per composited frame. So the hole sat
          wherever the last animation left it while the art painted
          elsewhere, and a press on the visible circle landed on the card's
          drag region instead: on Windows that is HTCAPTION, the window
          enters the OS move loop and the click never happens. That is the
          "sometimes it works" report.

          The hole is deliberately bigger than the art — 32px around a 24px
          circle, the same oversized-target trick as the dock's buttons. It
          hangs 16px past the card edge into the frame's own padding;
          pointer-events-none here (with the button opting back in) keeps
          the overhang from swallowing presses meant for whatever paints
          beneath it. */}
      <span
        className="pointer-events-none absolute z-10 flex h-8 w-8 items-center justify-center"
        style={{ ...noDragRegion, top: 'calc(50% - 16px)', right: '-16px' }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => requestCollapsed(true)}
              aria-label="Tuck the text away"
              className="pointer-events-auto flex h-6 w-6 items-center justify-center rounded-full border border-black/10 bg-white text-neutral-500 shadow-[0_2px_8px_rgba(0,0,0,0.15)] transition hover:translate-x-0.5 hover:bg-neutral-50 hover:text-neutral-900 active:scale-90 dark:border-white/15 dark:bg-neutral-800 dark:text-neutral-400 dark:shadow-[0_2px_8px_rgba(0,0,0,0.5)] dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
            >
              <ChevronsRight className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Tuck the text away — the session keeps going</TooltipContent>
        </Tooltip>
      </span>
      </div>
      )}

      {/* Folded: the mini call pill takes the card's corner — the whole
          card compressed to one row (its lane keeps narrating, and a live
          share's consent badge never folds away). Mounted only after the
          card's exit finishes (usePresence), so the two never fight over
          the row. */}
      {!card.mounted && (
        <TuckedDock
          state={callState}
          activity={heldActivity}
          sendAction={sendAction}
          onExpand={() => requestCollapsed(false)}
        />
      )}
      </div>
      <SonnerToaster theme="light" />
    </div>
  )
}

const STATUS_DISPLAY: Record<NonNullable<CallState['status']>, { label: string; dotClass: string }> = {
  idle: { label: `Hold ${PTT_LABEL} to talk`, dotClass: 'bg-neutral-500' },
  listening: { label: 'Listening', dotClass: 'bg-[var(--rowboat-success)] animate-pulse' },
  thinking: { label: 'Thinking…', dotClass: 'bg-amber-400' },
  speaking: { label: 'Speaking', dotClass: 'bg-sky-400 animate-pulse' },
}

/**
 * Marks a container that only ever covers EMPTY space — the transparent
 * frame's own scaffolding. See `useClickThrough`.
 */
const PASSTHROUGH_ATTR = 'data-qa-passthrough'

/**
 * Per-region click-through for the transparent frame.
 *
 * The window is far bigger than anything it paints: a tall invisible stage
 * sits above the card so popovers can open upward without resizing, and the
 * tucked Skipper is just the mascot in that same frame. But a transparent
 * pixel is still a CLICKABLE pixel — macOS routes a click to the topmost
 * window by its RECT, not by alpha — so that stage used to swallow every
 * click that landed on it: a ~500px square of dead desktop.
 *
 * Main therefore keeps the window click-through and this hook flips it solid
 * while the cursor is over something actually drawn.
 *
 * The cursor position comes from MAIN (`quick-ask:cursor`, polled from the
 * OS), not from mouse events. Events cannot be trusted for this: on macOS a
 * `-webkit-app-region: drag` area is a native view layered over the page, so
 * moves across it never reach us — and the mascot is exactly that area. Off
 * events alone it stayed click-through, so the Skipper could be neither
 * clicked nor dragged. Local mousemoves are still handled, purely because
 * they arrive sooner than the next poll where they do arrive at all.
 *
 * The test is INVERTED on purpose: only the frame's own containers are
 * marked passthrough, so anything else under the cursor — including menus
 * portaled to <body>, and anything added later — counts as solid and stays
 * clickable by default. Getting it wrong that way costs a dead pixel;
 * getting it wrong the other way costs an unclickable control.
 */
function useClickThrough(active: boolean) {
  useEffect(() => {
    if (!active) return
    let sent: boolean | null = null
    const push = (interactive: boolean) => {
      if (interactive === sent) return
      sent = interactive
      void window.ipc.invoke('quickAsk:setInteractive', { interactive }).catch(() => {})
    }
    const solidAt = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y)
      if (!el || el === document.documentElement || el === document.body) return false
      if (el.id === 'root') return false
      return !el.hasAttribute(PASSTHROUGH_ATTR)
    }
    // The flip is an IPC round-trip, so turn solid slightly BEFORE the
    // cursor reaches paint: a fast move landing straight on a control must
    // not have its click fall through the window.
    const GRACE = 12
    // A menu, picker or dialog is open somewhere: stay solid wherever the
    // cursor is, or the click that should DISMISS it would land in the app
    // behind us and leave it open. Tooltips are excluded — they carry no
    // dismiss gesture, and they are on screen exactly while the cursor is
    // already over a control.
    const dismissableOpen = () =>
      Array.from(document.querySelectorAll('[data-radix-popper-content-wrapper]')).some(
        (wrapper) => !wrapper.querySelector('[role="tooltip"]'),
      )
    const evaluate = (x: number, y: number) => {
      // The cursor left the frame (main pushes one out-of-viewport point as
      // it goes): hand the mouse straight back. Checked before anything
      // else so the grace ring can't hold the window solid on the way out.
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
        push(false)
        return
      }
      if (dismissableOpen()) {
        push(true)
        return
      }
      push(
        solidAt(x, y) ||
          solidAt(x - GRACE, y) ||
          solidAt(x + GRACE, y) ||
          solidAt(x, y - GRACE) ||
          solidAt(x, y + GRACE),
      )
    }
    const onMove = (e: MouseEvent) => evaluate(e.clientX, e.clientY)
    const offCursor = window.ipc.on('quick-ask:cursor', (p) => evaluate(p.x, p.y))
    document.addEventListener('mousemove', onMove, true)
    return () => {
      offCursor()
      document.removeEventListener('mousemove', onMove, true)
      push(false)
    }
  }, [active])
}

/**
 * Grab → GRABBING while the Skipper is actually moving.
 *
 * The handles (the card and the mascot column) are drag regions, and a drag
 * region is native: on Windows the hit test answers HTCAPTION, on macOS it is
 * a view layered over the page. Neither ever delivers the mousedown, so
 * `:active` — the obvious way to write this — is never true here. Main
 * watches the window's own 'move' instead and pushes the edges of the drag
 * (quick-ask:dragging); this flips a class on <html> that the rule below
 * turns into the closed-hand cursor everywhere, since during a drag the
 * pointer is over a handle by definition.
 *
 * The rule is injected rather than rendered: the window has several
 * presentations (card, pill, tucked mascot) and each is an early return, so
 * a <style> in any one of them would be missing from the others.
 */
function useDragCursor() {
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = 'html.qa-dragging, html.qa-dragging * { cursor: grabbing !important; }'
    document.head.appendChild(style)
    const off = window.ipc.on('quick-ask:dragging', ({ dragging }) => {
      document.documentElement.classList.toggle('qa-dragging', dragging)
    })
    return () => {
      off()
      style.remove()
      document.documentElement.classList.remove('qa-dragging')
    }
  }, [])
}

/**
 * How long the card's fold-away runs. The node has to stay mounted for it
 * (see usePresence), so main and the renderer must agree on one number.
 */
const CARD_EXIT_MS = 200

/**
 * Keep a node on screen for its exit animation.
 *
 * The card's `collapsed` comes from MAIN — the renderer never flips it
 * optimistically, because main owns the window geometry with it — so the
 * card would otherwise vanish between one commit and the next, with nothing
 * to animate. This holds the node for `exitMs` after it goes away and says
 * which half of the motion it is in.
 */
function usePresence(visible: boolean, exitMs: number) {
  const [mounted, setMounted] = useState(visible)
  // Coming back is instant — remount in the SAME commit that flips visible,
  // so the entry animation starts on the frame the fold was undone. (Render-
  // time previous-state adjustment, React's no-effect pattern: an effect here
  // would cost a blank frame first.)
  const [prevVisible, setPrevVisible] = useState(visible)
  if (prevVisible !== visible) {
    setPrevVisible(visible)
    if (visible) setMounted(true)
  }
  // Going away waits for the animation.
  useEffect(() => {
    if (visible) return
    const t = setTimeout(() => setMounted(false), exitMs)
    return () => clearTimeout(t)
  }, [visible, exitMs])
  return { mounted, exiting: mounted && !visible }
}

/**
 * The window's motion, in one place. It is deliberately small and quick:
 * this thing floats over the user's actual work, so anything showy here is
 * a distraction rather than a delight. The card folds TOWARD the mascot
 * (transform-origin at the corner the window is anchored by), which is
 * where the text is going.
 */
const COMPANION_MOTION_CSS = `
  @keyframes qa-card-in {
    from { opacity: 0; transform: translateX(28px) scale(0.94); }
    to { opacity: 1; transform: none; }
  }
  @keyframes qa-card-out {
    from { opacity: 1; transform: none; }
    to { opacity: 0; transform: translateX(28px) scale(0.94); }
  }
  @keyframes qa-rise {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: none; }
  }
  @keyframes qa-pop-in {
    from { opacity: 0; transform: translateY(10px) scale(0.7); }
    to { opacity: 1; transform: none; }
  }
  @keyframes qa-wave {
    0%, 100% { transform: scaleY(0.45); }
    50% { transform: scaleY(1); }
  }
  @keyframes qa-speak {
    0%, 100% { transform: scaleY(0.2); opacity: 0.55; }
    50% { transform: scaleY(1); opacity: 1; }
  }
  @keyframes qa-shim {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
  @keyframes qa-glow {
    0%, 100% { box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.16), 0 0 12px rgba(14, 165, 233, 0.28); }
    50% { box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.30), 0 0 22px rgba(14, 165, 233, 0.52); }
  }
  @keyframes qa-spin-slow {
    to { transform: rotate(360deg); }
  }
  /* Both halves name their own easing rather than a shared ease: the card
     should LEAVE with gathering speed and ARRIVE with none, which is the
     difference between a fold that snaps and one that settles. Both classes
     sit on the card's WRAPPER, never on the card itself: the card is a drag
     region, and a region that animates its transform leaves Electron
     punching the hole where the animation started. */
  .qa-card-in,
  .qa-card-out { transform-origin: 100% 80%; }
  .qa-card-in { animation: qa-card-in 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
  .qa-card-out { animation: qa-card-out ${CARD_EXIT_MS}ms cubic-bezier(0.4, 0, 0.9, 0.3) forwards; }
  .qa-rise { animation: qa-rise 0.2s cubic-bezier(0.16, 1, 0.3, 1); }
  /* The dock's entry. No extra delay: it mounts only after the card's exit
     (usePresence gates it), so it always arrives into space the card has
     already left. Like qa-card-in, it sits on a WRAPPER of the drag
     regions, never on one. */
  .qa-pop { transform-origin: 100% 100%; animation: qa-pop-in 0.26s cubic-bezier(0.34, 1.56, 0.64, 1); }
  /* Status-lane dressing: the waveform's bars, the resting dotted line, the
     thinking shimmer, and the logo's working glow. All of it lives INSIDE
     drag regions and none of it is a drag-region hole, so animating here is
     safe — and the glow moves box-shadow only, never the rect. */
  .qa-wave-bar { animation: qa-wave 1.05s ease-in-out infinite; }
  .qa-speak-bar { animation: qa-speak 1.2s ease-in-out infinite; }
  .qa-shimmer {
    background-image: linear-gradient(90deg, #9ca3af 25%, #303030 50%, #9ca3af 75%);
    background-size: 200% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: qa-shim 1.6s linear infinite;
  }
  html.dark .qa-shimmer {
    background-image: linear-gradient(90deg, #6b7280 25%, #e5e5e5 50%, #6b7280 75%);
  }
  .qa-spin { animation: qa-spin-slow 2.4s linear infinite; }
  .qa-logo-glow { animation: qa-glow 1.8s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) {
    .qa-card-in, .qa-rise, .qa-pop, .qa-wave-bar, .qa-speak-bar, .qa-logo-glow, .qa-spin { animation: none; }
    .qa-card-out { animation: none; opacity: 0; }
    .qa-shimmer { animation: none; background: none; -webkit-text-fill-color: currentColor; }
  }
`

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
 * One prose recipe for every assistant turn the panel shows — a peeked
 * message and the reply streaming in are the same object.
 *
 * `.dark` is scoped to the markdown only: shiki's token colors key off a
 * .dark ancestor, so this flips code to its dark palette (matching the
 * charcoal block bg) whichever skin the card is wearing — the code block is
 * charcoal in both. It does NOT darken the surrounding panel: the prose
 * classes are explicit, and Tailwind's `dark:` needs a .dark ANCESTOR, so
 * the class sitting on this very element doesn't trigger the dark half of
 * the pairs in it.
 */
const PANEL_PROSE =
  'dark prose prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-1.5' +
  ' [&_ul]:my-1.5 [&_ol]:my-1.5 [&_pre]:my-2 [&_pre]:text-[11px] [&_code]:text-[11px]' +
  ' [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-black/[0.06] [&_:not(pre)>code]:px-1' +
  ' [&_:not(pre)>code]:text-neutral-800 dark:[&_:not(pre)>code]:bg-white/[0.10]' +
  ' dark:[&_:not(pre)>code]:text-neutral-200'

function AssistantTurn({ children }: { children: string }) {
  return <Streamdown className={PANEL_PROSE}>{children}</Streamdown>
}

/**
 * A question the user asked — the same tinted bubble whether it is the one
 * just spoken or one peeked out of the history, so "mine" is a shape rather
 * than a shade the reader has to infer.
 */
function UserTurn({ children }: { children: string }) {
  return (
    <div className="mt-3 mb-2 flex justify-end first:mt-0">
      <span className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-black/[0.06] px-2.5 py-1.5 text-left text-sm text-neutral-700 dark:bg-white/[0.10] dark:text-neutral-200">
        {children}
      </span>
    </div>
  )
}

/** Hairline rule with a word in it — where the peeked past stops. */
function TurnDivider({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-2 flex items-center gap-2 text-[10px] uppercase tracking-wider text-neutral-400">
      <span className="h-px flex-1 bg-black/10 dark:bg-white/15" />
      {children}
      <span className="h-px flex-1 bg-black/10 dark:bg-white/15" />
    </div>
  )
}

/**
 * The pinned role's layout: the Meet-style floating mini-call pill (absorbed
 * from the old #video-popout window) — camera tile when on + mascot tile,
 * control bar, and the REAL composer as its typed input. NO transcript
 * renders here — minimized surfaces show none, in either direction (the
 * reply is spoken aloud; expand to read). All call state arrives over
 * `video:popout-state`; control actions round-trip through
 * `video:popoutAction` to the app window, which owns the devices. Captures
 * its own webcam preview — MediaStreams can't cross windows.
 *
 * Wrapped in `.dark`: the pill keeps its dark skin even though the Skipper
 * card claims light tokens, so the composer inside renders dark too.
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
              mic gate is open (talk key held / hands-free), green rings pulse
              around the head. The corner chip alone is too easy to miss. */}
          {!state.micMuted && (state.status === 'listening' || state.pttLocked) && (
            <>
              <span
                className="pointer-events-none absolute left-1/2 top-1/2 z-10 rounded-full border-[3px] border-[var(--rowboat-success)]/90"
                style={{ width: 88, height: 88, marginLeft: -44, marginTop: -44, animation: 'listen-ring 1.5s cubic-bezier(0, 0, 0.2, 1) infinite' }}
              />
              <span
                className="pointer-events-none absolute left-1/2 top-1/2 z-10 rounded-full border-[3px] border-[var(--rowboat-success)]/90"
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
                  <span className="block h-1.5 w-1.5 rounded-full bg-[var(--rowboat-success)] animate-pulse" />
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
      </div>

      {/* Control bar — actions execute in the main app window */}
      <div className="flex h-7 shrink-0 items-center justify-center gap-2" style={noDragRegion}>
        {/* Push-to-talk: hold to talk, quick tap to lock hands-free —
            mirrors the talk key. Pointer capture keeps the release edge
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
              ? 'bg-[var(--rowboat-success)] text-white hover:bg-[var(--rowboat-success)]/85'
              : 'bg-neutral-700 text-white/90 hover:bg-neutral-600'
          } ${state.micMuted ? 'opacity-50' : ''}`}
          aria-label={`Hold to talk — or hold the ${PTT_LABEL} key from any app`}
          title={`Hold to talk (tap to go hands-free) — or hold the ${PTT_LABEL} key from any app`}
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

      {/* The real composer as the pill's typed input — messages land in the
          chat exactly like composer messages, current frames riding along
          (the app attaches them to any submit while a call is live). No
          transcript renders in this pill — minimized surfaces show none
          (the reply is spoken; expand to read it). */}
      <div className="shrink-0" style={noDragRegion}>
        {composer}
      </div>
    </div>
  )
}

/**
 * The Rowboat mark, filled — the logo tile's glyph. Same artwork path as
 * MascotFaceIcon (talking-head.tsx), but inked solid: the 1.5px-outline
 * version goes wispy at tile sizes over a solid plate.
 */
function RowboatMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <g transform="translate(12 12) scale(0.0245) translate(-497 -489)">
        <path d="M 158 487 C 330 330, 620 180, 837 148 C 820 480, 640 720, 498 830 Q 550 720, 569 623 C 560 540, 450 440, 352 413 Q 250 440, 158 487 Z" />
      </g>
    </svg>
  )
}

/**
 * The logo tile — the Skipper's face now that the mascot has left this
 * surface: a solid plate that inverts with the skin so the mark always
 * reads. `glow` is the thinking beacon (a breathing sky halo, box-shadow
 * only — a transform here would go stale as a drag-region rect).
 */
function LogoTile({ size = 36, glow = false }: { size?: number; glow?: boolean }) {
  return (
    <span
      className={`flex flex-none items-center justify-center rounded-[11px] bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 ${glow ? 'qa-logo-glow' : ''}`}
      style={{ width: size, height: size }}
    >
      <RowboatMark className="h-[62%] w-[62%]" />
    </span>
  )
}

/**
 * What the status lane is saying right now. One slot, four meanings, in
 * priority order: an open mic gate outranks everything (the user is
 * speaking), then a running turn, then the spoken reply, then rest.
 */
function laneKind(state: CallState): 'listening' | 'thinking' | 'speaking' | 'idle' {
  if (!state.micMuted && (state.status === 'listening' || state.pttLocked)) return 'listening'
  if (state.status === 'thinking') return 'thinking'
  if (state.ttsState !== 'idle' || state.status === 'speaking') return 'speaking'
  return 'idle'
}

/**
 * Waveform for the status lane. The bars are CSS-driven (staggered
 * bounce with deterministic pseudo-random heights), not level-driven: the
 * real audio lives in the app window and MediaStreams can't cross windows —
 * the same reason the mascot lip-synced off a synthesized level.
 */
function WaveLane({ bars, className = '' }: { bars: number; className?: string }) {
  const heights = useMemo(
    () =>
      Array.from({ length: bars }, (_, i) =>
        7 + Math.round(13 * Math.abs(Math.sin(0.4 + i * 0.9) * Math.cos(i * 0.37))),
      ),
    [bars],
  )
  return (
    <span className={`flex min-w-0 items-center gap-[3px] overflow-hidden ${className}`}>
      {heights.map((h, i) => (
        <span
          key={i}
          className="qa-wave-bar w-[3px] flex-none rounded-full bg-sky-500 dark:bg-sky-400"
          style={{ height: h, animationDelay: `${-((i * 137) % 900)}ms` }}
        />
      ))}
    </span>
  )
}

/**
 * The speak wave — the reply being read aloud. Same bars as the listening
 * waveform, but a COHERENT rolling wave: uniform heights with a linear
 * phase offset, so a single crest travels across the lane. Listening is
 * jittery (pseudo-random heights and delays — a voice), speaking is
 * orderly (a synthesized one); the two read differently at a glance.
 */
function SpeakLane({ bars, className = '' }: { bars: number; className?: string }) {
  return (
    <span className={`flex min-w-0 items-center gap-[3px] overflow-hidden ${className}`}>
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          className="qa-speak-bar w-[3px] flex-none rounded-full bg-sky-400 dark:bg-sky-300"
          style={{ height: 16, animationDelay: `${-((i * 90) % 1200)}ms` }}
        />
      ))}
    </span>
  )
}

/**
 * The status lane — the mini call pill's one slot that says what's
 * happening: a live waveform while the mic gate is open, the running
 * activity ("Searching the web…", flicker-held by the caller) as shimmer
 * text while a turn thinks, the rolling speak wave while the reply is
 * spoken, and the talk-key hint ("Hold right ⌘" / "Hold right Ctrl", from
 * shared/ptt-key.ts) at rest — the invitation, not decoration. (The open
 * card carries these signals elsewhere: the composer's recording bar, the
 * panel's shimmer row, and the strip logo's glow.)
 */
function StatusLane({
  state,
  activity,
  bars,
  className = '',
}: {
  state: CallState
  activity?: string | null
  bars: number
  className?: string
}) {
  const kind = laneKind(state)
  return (
    <span className={`flex h-7 min-w-0 items-center ${className}`}>
      {kind === 'listening' ? (
        <WaveLane bars={bars} className="w-full" />
      ) : kind === 'speaking' ? (
        <SpeakLane bars={bars} className="w-full" />
      ) : kind === 'thinking' ? (
        <span className="flex min-w-0 items-center gap-2">
          <Loader className="qa-spin h-3.5 w-3.5 flex-none text-sky-500 dark:text-sky-400" />
          <span className="qa-shimmer min-w-0 truncate text-[12.5px] font-medium">
            {activity ?? 'Thinking…'}
          </span>
        </span>
      ) : (
        <span className="truncate whitespace-nowrap text-[12px] text-neutral-400 dark:text-neutral-500">
          Hold {PTT_LABEL}
        </span>
      )}
    </span>
  )
}

/**
 * The share toggle — the bow light, relocated from the mascot's hull to the
 * footer dock: lit sky + pulsing dot = broadcasting (the lit button IS the
 * consent badge). The choice is STICKY — future summons start already
 * sharing until it's turned off (persisted app-side).
 */
function ShareButton({
  state,
  sendAction,
  className,
}: {
  state: CallState
  sendAction: (action: PopoutAction) => void
  className: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          style={noDragRegion}
          onClick={() => sendAction('toggle-share')}
          aria-label={state.screenSharing ? 'Stop sharing your screen' : 'Share your screen'}
          className={`relative flex flex-none items-center justify-center rounded-full ring-1 ring-inset transition active:scale-95 ${
            state.screenSharing
              ? 'bg-sky-500/15 text-sky-600 ring-sky-500/30 hover:bg-sky-500/25 dark:bg-sky-400/20 dark:text-sky-300 dark:ring-sky-400/30'
              : CHIP_IDLE
          } ${className}`}
        >
          <MonitorUp className="h-4 w-4" />
          {state.screenSharing && (
            <span className="absolute -right-0.5 -top-0.5 block h-2 w-2 animate-pulse rounded-full bg-sky-500 ring-2 ring-white dark:bg-sky-400 dark:ring-neutral-900" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {state.screenSharing
          ? 'Sharing screen — click to stop'
          : 'Share your screen — frames ride along with every question'}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * The talk control — mic, stop, and mute-aware, in one button (the mascot's
 * mic pin, relocated). Clicking it works exactly like the app composer's
 * mic: one click starts the capture (a programmatic tap — down+up — locks
 * the PTT machine's hands-free mode, so the mic stays open with the
 * recording bar showing), then the bar's ↑ (or this button again, or
 * Enter) sends and its ✕ (or Esc) discards. Holding the talk key is the
 * other route into the same capture. While a turn is in flight the mic is
 * dead anyway, so it morphs into Stop; muted it becomes the unmute
 * affordance.
 */
function TalkButton({
  state,
  sendAction,
  className,
}: {
  state: CallState
  sendAction: (action: PopoutAction) => void
  className: string
}) {
  const busy = state.status === 'thinking' || state.status === 'speaking'
  const micOpen = !state.micMuted && (state.status === 'listening' || state.pttLocked)
  if (busy) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            style={noDragRegion}
            onClick={() => sendAction('stop-speaking')}
            aria-label="Stop the assistant"
            className={`flex flex-none items-center justify-center rounded-full bg-sky-500 text-white transition hover:bg-sky-400 active:scale-95 ${className}`}
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">Stop — cut the reply short (the session keeps going)</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          style={noDragRegion}
          onClick={() => {
            if (state.micMuted) {
              sendAction('toggle-mic')
              return
            }
            if (micOpen) {
              // Same as the recording bar's ↑ — finish and send.
              sendAction('ptt-up')
              return
            }
            // Click-to-record: a programmatic tap. The PTT machine reads a
            // sub-tap-threshold down→up as "lock hands-free", which is
            // exactly the open-until-sent capture the app composer's mic
            // gives.
            sendAction('ptt-down')
            sendAction('ptt-up')
          }}
          aria-label={
            micOpen ? 'Send voice input' : state.micMuted ? 'Unmute the mic' : 'Voice input'
          }
          className={`flex flex-none select-none items-center justify-center rounded-full ring-1 ring-inset transition active:scale-95 ${
            micOpen
              ? 'bg-sky-500 text-white ring-sky-500'
              : state.micMuted
                ? 'bg-red-500/10 text-red-500 ring-red-500/30 hover:bg-red-500/20'
                : CHIP_IDLE
          } ${className}`}
        >
          {micOpen ? (
            <Square className="h-3.5 w-3.5 fill-current" />
          ) : state.micMuted ? (
            <MicOff className="h-4 w-4" />
          ) : (
            <Mic className="h-4 w-4" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {micOpen
          ? 'Listening — click to send (✕ or Esc cancels)'
          : state.micMuted
            ? 'Mic muted — click to unmute'
            : `Voice input — click and speak, or hold the ${PTT_LABEL} key`}
      </TooltipContent>
    </Tooltip>
  )
}

/** End & close — a live session can't be hidden while it keeps listening. */
function EndButton({
  sendAction,
  className,
}: {
  sendAction: (action: PopoutAction) => void
  className: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          style={noDragRegion}
          onClick={() => sendAction('end-call')}
          aria-label="End the voice session and close"
          className={`flex flex-none items-center justify-center rounded-full text-neutral-400 ring-1 ring-inset ring-black/10 transition hover:bg-red-500/10 hover:text-red-600 active:scale-95 dark:text-neutral-500 dark:ring-white/10 dark:hover:bg-red-400/10 dark:hover:text-red-400 ${className}`}
        >
          <X className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">End & close (a live session can't be hidden while it keeps listening)</TooltipContent>
    </Tooltip>
  )
}

/**
 * The folded Skipper: the MINI CALL PILL — the card compressed to one row,
 * always (a bare logo chip hid the session's life; the pill wears it):
 * logo (click to unfold) · status lane · share · talk/stop · end, plus the
 * « unfold handle on the left edge — the visible way back to the text
 * input, mirroring the card's » tuck handle. The lane keeps narrating
 * while folded — waveform while the user speaks, the running activity
 * while a turn thinks, the rolling speak wave while the reply is read
 * aloud, the talk-key hint at rest — and beyond that hint the MOTION is
 * the whole story: the pill deliberately shows no transcript in either
 * direction (the user tucked the text away; unfold to read).
 */
function TuckedDock({
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
  const shortcutState = useQuickAskShortcut()
  const shortcutLabel = quickAskShortcut.formatShortcut(shortcutState.accelerator, isMac)
  const expandTip = `Bring the text back (${shortcutLabel} works too)`
  return (
    <div data-qa-passthrough className="qa-pop flex min-w-0 flex-col items-end">
      <div className="relative">
        <div
          style={dragRegion}
          title="Drag to move your Skipper"
          className="flex cursor-grab items-center gap-2.5 rounded-full border border-black/10 bg-white/[0.97] p-2 pr-2.5 shadow-[0_12px_32px_rgba(0,0,0,0.18),0_2px_10px_rgba(0,0,0,0.10)] dark:border-white/15 dark:bg-neutral-900/[0.97] dark:shadow-[0_12px_32px_rgba(0,0,0,0.55),0_2px_10px_rgba(0,0,0,0.4)]"
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                style={noDragRegion}
                onClick={onExpand}
                aria-label="Bring the text back"
                className="flex-none transition active:scale-95"
              >
                <LogoTile size={34} glow={state.status === 'thinking'} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{expandTip}</TooltipContent>
          </Tooltip>
          <StatusLane state={state} activity={activity} bars={20} className="w-[112px]" />
          <ShareButton state={state} sendAction={sendAction} className="h-7 w-7" />
          <TalkButton state={state} sendAction={sendAction} className="h-8 w-8" />
          <EndButton sendAction={sendAction} className="h-7 w-7" />
        </div>
        {/* Unfold handle on the pill's left edge — the MIRROR of the card's
            tuck handle (same circle, chevrons pointing the other way), so
            hiding and un-hiding read as one gesture with two directions.
            Same drag-region-hole discipline as that handle: the wrapper is
            the static, transform-free hole, oversized around the art, with
            pointer-events-none + the button opting back in; the motion
            lives on the button. */}
        <span
          className="pointer-events-none absolute z-10 flex h-8 w-8 items-center justify-center"
          style={{ ...noDragRegion, top: 'calc(50% - 16px)', left: '-16px' }}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onExpand}
                aria-label="Bring the text back"
                className="pointer-events-auto flex h-6 w-6 items-center justify-center rounded-full border border-black/10 bg-white text-neutral-500 shadow-[0_2px_8px_rgba(0,0,0,0.15)] transition hover:-translate-x-0.5 hover:bg-neutral-50 hover:text-neutral-900 active:scale-90 dark:border-white/15 dark:bg-neutral-800 dark:text-neutral-400 dark:shadow-[0_2px_8px_rgba(0,0,0,0.5)] dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
              >
                <ChevronsLeft className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{expandTip}</TooltipContent>
          </Tooltip>
        </span>
      </div>
    </div>
  )
}
