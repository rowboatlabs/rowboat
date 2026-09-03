import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpRight,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ChevronsDown,
  Anchor,
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
const PTT_KEYCAP = pttKey.pttKeycap(isMac)

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
  | 'end-call'
  | 'expand'

// Pill window heights the renderer asks main for (design px, clamped by
// main): the base pill, and with the response panel expanded.
const PINNED_BASE_HEIGHT = 320
const PINNED_RESPONSE_HEIGHT = 560

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
 * ONE surface: the SKIPPER — the mascot with its text panel, hosting a live
 * voice session. Two presentations of that one surface, both driven by main
 * over `quick-ask:mode`: text panel open (mascot + card) or tucked to just
 * the mascot; a live CAMERA swaps the card for the pill, where the self-view
 * lives. The window is hidden, not destroyed, when the session ends.
 *
 * (The old `summoned` role — a standalone Spotlight-style ask bar with its
 * own answer panel, dictation, and voice/share toggles — is GONE. It existed
 * only as a fallback surface, and every glitch report about hover mode was
 * really that bar appearing where the Skipper belonged.)
 *
 * Geometry: a fixed transparent frame with the card bottom-anchored and the
 * mascot at the corner. The transparent zone above is where the composer's
 * popovers (mentions, model picker, menus) open upward; clicking it near the
 * card tucks the text away.
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

  // The mascot lip-syncs off a synthesized level — the real audio plays in
  // the app window, and MediaStreams can't cross windows.
  const synthLevel = useCallback(() => 0.45 + 0.35 * Math.sin(performance.now() / 90), [])

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
  // Monitoring grant, since this window has focus). Esc never ends a
  // session — it tucks the text back into the mascot.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === PTT_CODE && !e.repeat) {
        sendAction('ptt-down')
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
  }, [callCard, requestCollapsed, sendAction])

  // --- Derived values for the card layout. Computed BEFORE the early
  // returns below: the useMemo is a hook, and a hook after a conditional
  // return changes the hook count between renders (React throws "rendered
  // more/fewer hooks" and unmounts the whole window — the old pill ⇄ card
  // crash on camera toggles).
  const panelAsked = callState.questionText
  const panelText = callState.responseText ?? ''
  const panelProcessing = callState.status === 'thinking'
  const panelStatusText = heldActivity ?? 'Thinking…'
  // One-line caption under the Skipper's mascot: the in-flight utterance
  // wins; otherwise the tail of the reply while it speaks.
  const skipperReplyTail =
    callState.ttsState !== 'idle' || callState.status === 'thinking'
      ? (callState.responseText ?? '')
          .replace(/[#*_`>[\]]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(-90)
      : ''
  const skipperCaption = callState.interimText || skipperReplyTail

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

  // Tucked PILL (camera calls): just the mascot (voice-to-voice). The card
  // surface does NOT branch here — its folded state renders inside the one
  // Skipper layout below, so the mascot never remounts (and never moves) on
  // fold/unfold.
  if (collapsed && surface !== 'card') {
    return (
      <TuckedMascot
        state={callState}
        activity={heldActivity}
        sendAction={sendAction}
        onExpand={() => requestCollapsed(false)}
      />
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

  // THE SKIPPER — the one hover surface. One layout for both of its states:
  // the mascot column below is the SAME mounted node whether the text panel
  // is open or folded, so fold/unfold only adds/removes the card beside it
  // and the mascot never moves, resizes, or replays its entry animation.
  return (
    <div data-qa-passthrough className="flex h-screen w-screen select-none flex-col overflow-hidden">
      <style>{COMPANION_MOTION_CSS}</style>
      {/* The invisible stage: popovers open into this zone. It is marked
          passthrough, so clicks that land on it go to whatever the user has
          BEHIND this window (useClickThrough) instead of being swallowed by
          a transparent rectangle. The only gesture it still carries is
          tucking the panel, and only NEAR the visible card (stageTuck
          hit-test) — reachable because the grace ring keeps the window
          solid just outside the card's edge. (It used to be a drag region
          when folded; the mascot column is the drag handle in both states,
          and a screen-sized invisible drag area is exactly how a click on
          empty desktop ended up moving the Skipper.) */}
      <div
        data-qa-passthrough
        className="min-h-0 flex-1"
        onMouseDown={collapsed ? undefined : stageTuck}
      />

      {/* Bottom row: card + the mascot riding alongside on the transparent
          stage. The row is PADDED so the card's CSS shadow fades inside the
          window instead of clipping at its rectangular edge (which read as
          a grey rectangle around the card). The paddings are IDENTICAL in
          both states — with the corner-anchored window, that pins the
          mascot to the exact same screen pixels across fold/unfold. */}
      <div data-qa-passthrough className="flex shrink-0 items-end justify-end gap-1 px-6 pb-5">
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
        {/* Action strip: the destination affordances plus the speaker mute.
            Device controls live on the MASCOT (the same pins as the folded
            Skipper) — the call owns them. */}
        <div className="flex items-center justify-end gap-2 px-4 pt-3">
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
                <span className="animate-pulse text-neutral-500 dark:text-neutral-400">{panelStatusText}</span>
              )
            )}
            {panelProcessing && panelText && <span className="animate-pulse">▍</span>}
          </div>
        )}

        {/* The real composer. Submits relay the FULL payload (mentions,
            attachments, search/code/permissions, model/effort) to the app
            window, which submits into the companion's chat exactly like an
            in-app composer message. */}
        <div className="p-3">
          {/* The composer opts out of the card's drag region — the p-3 frame
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
              placeholder="Type instead — @ mentions work too…"
              focusSignal={focusSignal}
              onSelectionChange={(sel) => {
                selectionRef.current = sel ?? null
              }}
              voiceAvailable={false}
            />
          </div>
        </div>
      </div>

      {/* Tuck handle on the card's mascot-side edge: push the text into the
          mascot → voice-to-voice. The session keeps going.

          Built like UnfoldBubble, and for the same reason: this wrapper is
          the DRAG-REGION HOLE, so it is static and transform-free (placed
          with calc, not -translate-y-1/2). The button used to BE the hole
          while carrying three transforms — the centring translate plus
          hover:translate-x and active:scale — and Electron punches holes
          from the rect Blink last computed on style/layout invalidation,
          not once per composited frame. So the hole sat wherever the last
          animation left it while the art painted elsewhere, and a press on
          the visible circle landed on the card's drag region instead: on
          Windows that is HTCAPTION, the window enters the OS move loop and
          the click never happens. That is the "sometimes it works" report.

          The hole is deliberately bigger than the art — 40px around a 32px
          circle, the same oversized-target trick as the bubble and pins. */}
      <span
        className="absolute z-10 flex h-10 w-10 items-center justify-center"
        style={{ ...noDragRegion, top: 'calc(50% - 20px)', right: '-18px' }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => requestCollapsed(true)}
              aria-label="Tuck the text away"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-white text-neutral-500 shadow-[0_2px_8px_rgba(0,0,0,0.15)] transition hover:translate-x-0.5 hover:bg-neutral-50 hover:text-neutral-900 active:scale-90 dark:border-white/15 dark:bg-neutral-800 dark:text-neutral-400 dark:shadow-[0_2px_8px_rgba(0,0,0,0.5)] dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Tuck the text away — the session keeps going</TooltipContent>
        </Tooltip>
      </span>
      </div>
      )}

      {/* The mascot column — the Skipper's CONSTANT. One mounted node for
          both states (text open or folded): identical size, pins, caption
          slot, and status chip, at identical offsets from the window's
          bottom-right corner — which the corner-anchored window keeps fixed
          on screen, so fold/unfold moves NOTHING here; only the card beside
          it comes and goes. It is the control surface AND the drag
          handle — which is why the column is deliberately NOT marked
          passthrough (useClickThrough): the whole SKIPPER_SIZE footprint stays
          solid so the Skipper can be grabbed anywhere on it, exactly as
          before, instead of only where the artwork happens to paint. */}
      <div
        className="relative flex shrink-0 cursor-grab select-none flex-col items-center"
        style={{ ...dragRegion, width: SKIPPER_SIZE }}
        title="Drag to move your Skipper"
      >
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
        <div
          className="relative -mb-4"
          style={{ animation: 'skipper-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
        >
          {/* Tucked: the one way back, over the head. */}
          {collapsed && <UnfoldBubble onExpand={() => requestCollapsed(false)} />}
          {/* Listening halo — rings pulse around the head while the mic
              gate is open, so "press the talk key and speak" is visibly working in
              both states. */}
          {!callState.micMuted && (callState.status === 'listening' || callState.pttLocked) && (
            <>
              <span
                className="pointer-events-none absolute left-1/2 z-10 rounded-full border-[3px] border-[var(--rowboat-success)]/90"
                style={{ top: '42%', width: HALO_SIZE, height: HALO_SIZE, marginLeft: -HALO_SIZE / 2, marginTop: -HALO_SIZE / 2, animation: 'listen-ring 1.5s cubic-bezier(0, 0, 0.2, 1) infinite' }}
              />
              <span
                className="pointer-events-none absolute left-1/2 z-10 rounded-full border-[3px] border-[var(--rowboat-success)]/90"
                style={{ top: '42%', width: HALO_SIZE, height: HALO_SIZE, marginLeft: -HALO_SIZE / 2, marginTop: -HALO_SIZE / 2, animation: 'listen-ring 1.5s cubic-bezier(0, 0, 0.2, 1) 0.5s infinite' }}
              />
            </>
          )}
          <TalkingHead
            ttsState={
              callState.status === 'thinking' && callState.ttsState === 'idle'
                ? 'synthesizing'
                : callState.ttsState
            }
            getLevel={synthLevel}
            size={SKIPPER_SIZE}
            hat="cowboy"
            hatOverlay={
              <SkipperPins state={callState} sendAction={sendAction} />
            }
          />
        </div>
        {/* Fixed-height caption + chip slots: present in BOTH states so the
            head never shifts when a caption appears or the text folds. Both
            are single-line and CENTERED on the mascot — wider than the
            mascot column they overflow it symmetrically (the column doesn't
            clip), which reads as a caption under the head instead of a
            squeezed left-ragged wrap. */}
        <div className="flex h-5 items-center">
          {skipperCaption && (
            <span className="max-w-[220px] truncate whitespace-nowrap rounded bg-black/70 px-2 py-0.5 text-[11px] text-white/90">{skipperCaption}</span>
          )}
        </div>
        <div className="flex h-7 items-center">
          <SkipperStatusChip state={callState} activity={heldActivity} />
        </div>
      </div>
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
 * The Skipper's rendered size, in design px — shared by BOTH presentations
 * (card-side column and tucked) so the mascot is the same object either way,
 * and by the listening halo, whose rings are sized as a fraction of it.
 */
const SKIPPER_SIZE = 164
const HALO_SIZE = Math.round(SKIPPER_SIZE * 0.79)

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
  @keyframes qa-bubble-in {
    from { opacity: 0; transform: translateY(10px) scale(0.7); }
    to { opacity: 1; transform: none; }
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
  /* Delayed past the fold (backwards = held invisible until then), so the
     bubble arrives into space the card has already left. */
  .qa-bubble { animation: qa-bubble-in 0.26s cubic-bezier(0.34, 1.56, 0.64, 1) ${CARD_EXIT_MS}ms backwards; }
  @media (prefers-reduced-motion: reduce) {
    .qa-card-in, .qa-rise, .qa-bubble { animation: none; }
    .qa-card-out { animation: none; opacity: 0; }
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
 * The Skipper's control pins — ONE cluster for both presentations (text
 * panel open or folded), riding TalkingHead's hatOverlay so they bob with
 * the artwork.
 *
 * They all ride the BOAT now, left to right: the mic (morphing into Stop
 * while a turn is in flight), the share bow light, ✕ end. The mic used to
 * sit on the hat band, a reach away from the other two — one row of three
 * on the deck is the whole control surface at a glance. The text's fold and
 * unfold are NOT here: folding is the handle on the card's edge, unfolding
 * the bubble above the head (UnfoldBubble), each living where the gesture
 * actually points. The speaker mute isn't here either — with the text
 * folded, voice is the only output channel, so the mute belongs to the text
 * panel.
 *
 * no-drag sits on EACH button: Electron punches drag-region holes from
 * painted bounds, and a zero-size wrapper excludes nothing.
 */
function SkipperPins({
  state,
  sendAction,
}: {
  state: CallState
  sendAction: (action: PopoutAction) => void
}) {
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
          className="group/pin absolute flex h-[38px] w-[38px] appearance-none items-center justify-center border-0 bg-transparent p-0 outline-none -translate-x-1/2 -translate-y-1/2"
          style={{ ...noDragRegion, left: '18%', top: '68%' }}
        >
          <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-red-600 shadow-sm ring-2 ring-[#17171B] transition-transform group-hover/pin:scale-110">
            <Square className="h-3 w-3 fill-current text-white" />
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
          title={`Hold to talk (tap for hands-free) — or hold the ${PTT_LABEL} key`}
          className="group/pin absolute flex h-[38px] w-[38px] appearance-none items-center justify-center border-0 bg-transparent p-0 outline-none -translate-x-1/2 -translate-y-1/2"
          style={{ ...noDragRegion, left: '18%', top: '68%' }}
        >
          <span
            className={`flex h-[22px] w-[22px] select-none items-center justify-center rounded-full shadow-sm ring-2 ring-[#17171B] transition-transform group-hover/pin:scale-110 ${
              state.status === 'listening' || state.pttLocked ? 'bg-[var(--rowboat-success)]' : 'bg-amber-400'
            }`}
          >
            <Mic
              className={`h-3.5 w-3.5 ${
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
        className="group/pin absolute flex h-[38px] w-[38px] appearance-none items-center justify-center border-0 bg-transparent p-0 outline-none -translate-x-1/2 -translate-y-1/2"
        style={{ ...noDragRegion, left: '50%', top: '73%' }}
      >
        <span
          className={`relative flex h-[22px] w-[22px] items-center justify-center rounded-full shadow-sm ring-2 ring-[#17171B] transition-transform group-hover/pin:scale-110 ${
            state.screenSharing ? 'bg-sky-500' : 'bg-neutral-600'
          }`}
        >
          <MonitorUp className="h-3.5 w-3.5 text-white" />
          {state.screenSharing && (
            <span className="absolute -right-1 -top-1 block h-[8px] w-[8px] animate-pulse rounded-full bg-sky-300 ring-1 ring-[#17171B]" />
          )}
        </span>
        <span className="pointer-events-none absolute left-1/2 top-full mt-0.5 -translate-x-1/2 whitespace-nowrap rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white opacity-0 transition-opacity group-hover/pin:opacity-100">
          {state.screenSharing ? 'Sharing screen — click to stop' : 'Share your screen'}
        </span>
      </button>
      <button
        type="button"
        onClick={() => sendAction('end-call')}
        aria-label="End the voice session and close"
        title="End & close (a live session can't be hidden while it keeps listening)"
        className="group/pin absolute flex h-[32px] w-[32px] appearance-none items-center justify-center border-0 bg-transparent p-0 outline-none -translate-x-1/2 -translate-y-1/2"
        style={{ ...noDragRegion, left: '82%', top: '68%' }}
      >
        <span className="flex h-[20px] w-[20px] items-center justify-center rounded-full bg-neutral-700 shadow-sm ring-2 ring-[#17171B] transition-colors transition-transform group-hover/pin:scale-125 group-hover/pin:bg-red-600">
          <X className="h-3 w-3 text-white" />
        </span>
      </button>
    </div>
  )
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
 * The way back, while the text is tucked: a chevron bubble floating just
 * above the boat, in the gap between the Skipper and the gunwale.
 *
 * It is the mirror of the card's tuck handle — same circle, same size, the
 * chevron pointing the other way — so hiding and un-hiding are visibly one
 * gesture with two directions. It used to be a blue enamel pin on the boat,
 * which put "where does my text go" in the middle of the DEVICE controls and
 * left the hull with four things competing for a glance. Above the head it
 * points at the space the card unfolds into.
 *
 * The entry waits out the card's fold (COMPANION_MOTION_CSS delays it), so
 * the two never animate over each other.
 *
 * 55% is measured off the artwork, not eyeballed: TalkingHead's viewBox is
 * 200x190 and the hull's rim runs along y=120, so a centred 28px bubble
 * ends just shy of the planking and clears the share pin below it.
 */
function UnfoldBubble({ onExpand }: { onExpand: () => void }) {
  const shortcutState = useQuickAskShortcut()
  const shortcutLabel = quickAskShortcut.formatShortcut(shortcutState.accelerator, isMac)
  return (
    // The wrapper is the DRAG-REGION HOLE, and it must never move: Electron
    // punches holes from the rect Blink last computed for the element, on
    // style/layout invalidation — not once per composited frame. Put
    // `no-drag` on something whose transform is animating (as the button's
    // is) and the hole stays wherever the animation STARTED — a 0.7-scaled
    // box 10px low — so pressing the bubble where it paints lands on the
    // drag region instead. On Windows that means HTCAPTION: the window
    // enters the OS move loop, the click never happens, and the companion
    // looks frozen until the button comes back up.
    //
    // So: the hole is static and transform-free (centred with calc, not
    // translate — a static transform is one more thing that can go stale),
    // and it is DELIBERATELY bigger than the art it covers, 40px around a
    // 28px bubble, the same way the pins carry oversized targets. The motion
    // lives on the button inside it.
    <span
      className="absolute z-30 flex h-10 w-10 items-center justify-center"
      style={{ ...noDragRegion, top: 'calc(55% - 20px)', left: 'calc(50% - 20px)' }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onExpand}
            aria-label="Bring the text back"
            className="qa-bubble flex h-7 w-7 items-center justify-center rounded-full bg-white text-neutral-500 shadow-[0_4px_14px_rgba(0,0,0,0.18)] transition hover:-translate-y-0.5 hover:bg-neutral-50 hover:text-neutral-900 active:scale-90 dark:bg-neutral-800 dark:text-neutral-400 dark:shadow-[0_4px_14px_rgba(0,0,0,0.5)] dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">Bring the text back ({shortcutLabel} works too)</TooltipContent>
      </Tooltip>
    </span>
  )
}

/**
 * The Skipper's status line — the same words under the mascot in both
 * presentations. While the mic gate is open it goes loud (green, mic icon):
 * paired with the listening halo, holding the talk key is unmistakably working.
 * While a turn runs, the generic "Thinking…" upgrades to the current
 * activity ("Searching the web…") when one is known — flicker-held by the
 * caller via useHeldLabel.
 */
function SkipperStatusChip({ state, activity }: { state: CallState; activity?: string | null }) {
  const statusDisplay = state.status ? STATUS_DISPLAY[state.status] : null
  const micOpen = !state.micMuted && (state.status === 'listening' || state.pttLocked)
  return (
    <span
      className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 font-medium text-white shadow-md ${
        micOpen ? 'bg-[var(--rowboat-success)] text-[12px] font-semibold' : 'bg-black/60 text-[11px]'
      }`}
    >
      {state.micMuted && (state.status === 'listening' || state.status === 'idle') ? (
        <>
          <span className="block h-2 w-2 rounded-full bg-red-500" />
          Muted
        </>
      ) : state.pttLocked ? (
        <>
          <Mic className="h-3.5 w-3.5 animate-pulse" />
          Hands-free — tap {PTT_KEYCAP} to send
        </>
      ) : state.status === 'listening' ? (
        <>
          <Mic className="h-3.5 w-3.5 animate-pulse" />
          Listening — release to send
        </>
      ) : statusDisplay ? (
        <>
          <span className={`block h-2 w-2 rounded-full ${statusDisplay.dotClass}`} />
          {state.status === 'idle'
            ? `Hold the mic — or ${PTT_LABEL}`
            : state.status === 'thinking' && activity
              ? activity
              : statusDisplay.label}
        </>
      ) : (
        <>
          <span className="block h-2 w-2 rounded-full bg-neutral-500" />
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

  // Mic gate open (holding the talk key / the pin, or hands-free lock): the ONE
  // state the user must never have to squint for — without visible feedback
  // there is no way to tell a working hold from a dead key hook.
  const micOpen = !state.micMuted && (state.status === 'listening' || state.pttLocked)

  return (
    <div
      data-qa-passthrough
      className="group relative flex h-screen w-screen cursor-grab select-none flex-col items-center justify-end overflow-hidden pb-2"
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
          detach from the hat. Pin art is small; each sits in an oversized
          no-drag hit target that grows on hover. */}
      {/* -mb pulls the caption/chip up under the boat: the SVG box has dead
          space below the ripples that read as a big gap. */}
      <div className="relative -mb-4" style={{ animation: 'tucked-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
        <UnfoldBubble onExpand={onExpand} />
        {/* Listening halo: expanding green rings around the head while the
            mic gate is open. Peripheral-vision feedback — the user is
            usually looking at their own work, not at the chip's small text. */}
        {micOpen && (
          <>
            <span
              className="pointer-events-none absolute left-1/2 z-10 rounded-full border-[3px] border-[var(--rowboat-success)]/90"
              style={{ top: '42%', width: HALO_SIZE, height: HALO_SIZE, marginLeft: -HALO_SIZE / 2, marginTop: -HALO_SIZE / 2, animation: 'listen-ring 1.5s cubic-bezier(0, 0, 0.2, 1) infinite' }}
            />
            <span
              className="pointer-events-none absolute left-1/2 z-10 rounded-full border-[3px] border-[var(--rowboat-success)]/90"
              style={{ top: '42%', width: HALO_SIZE, height: HALO_SIZE, marginLeft: -HALO_SIZE / 2, marginTop: -HALO_SIZE / 2, animation: 'listen-ring 1.5s cubic-bezier(0, 0, 0.2, 1) 0.5s infinite' }}
            />
          </>
        )}
        <TalkingHead
          // Thinking = thought bubbles (the calm version — rowing on every
          // turn wore thin): status 'thinking' with idle TTS maps to the
          // 'synthesizing' state, which renders bubbles + raised eyes.
          ttsState={state.status === 'thinking' && state.ttsState === 'idle' ? 'synthesizing' : state.ttsState}
          getLevel={getLevel}
          size={SKIPPER_SIZE}
          hat="cowboy"
          hatOverlay={
            <SkipperPins state={state} sendAction={sendAction} />
          }
        />
      </div>

      {/* Caption + status chip, readable over any desktop. */}
      <div data-qa-passthrough className="flex h-5 max-w-full items-center px-2">
        {caption && (
          <span className="truncate rounded bg-black/70 px-2 py-0.5 text-[11px] text-white/90">{caption}</span>
        )}
      </div>
      {/* Pure status line — the CONTROLS are the pins. */}
      <div data-qa-passthrough className="flex h-7 items-center">
        <SkipperStatusChip state={state} activity={activity} />
      </div>
    </div>
  )
}
