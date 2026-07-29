import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Command, CornerDownLeft, Mic, MonitorUp, Plus, Volume2 } from 'lucide-react'
import { Streamdown } from 'streamdown'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useVoiceMode } from '@/hooks/useVoiceMode'

// Window heights the bar asks main for: just the input row, or input +
// answer area. Fixed steps (not content-measured) so the window never
// feedback-loops with its own resize.
const BAR_HEIGHT = 88
const ANSWER_HEIGHT = 380

// Hold-to-speak key by platform. macOS: right ⌘, unchanged. Windows: the
// same physical position is the right Win key, which the OS owns (a tap
// opens the Start menu) — right Ctrl is the safe equivalent there.
const IS_MAC = navigator.platform.startsWith('Mac')
const PTT_CODE = IS_MAC ? 'MetaRight' : 'ControlRight'

/**
 * Content of the quick-ask window (global ⌥⇧Space — see main's quick-ask.ts).
 * A Spotlight-style bar floating over whatever the user is doing: type a
 * question (or hold Right ⌘ to speak it) and it lands in the current chat in
 * the app window; the answer streams back here over `quick-ask:state`.
 * The window is hidden, not destroyed, on dismiss — state survives toggles.
 */
export function QuickAskBar() {
  const [draft, setDraft] = useState('')
  const [asked, setAsked] = useState<string | null>(null)
  const [answer, setAnswer] = useState<{ processing: boolean; text: string; statusText: string | null } | null>(null)
  // Only answer pushes that follow OUR submit render — the app window's chat
  // may show unrelated turns from before the bar was opened.
  const awaitingRef = useRef(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Voice input: hold the platform PTT key (right ⌘ on macOS, right Ctrl on
  // Windows) while the bar is focused. Local dictation via
  // the same Deepgram flow as the composer mic — no global hook needed, the
  // bar has keyboard focus by construction.
  const [recording, setRecording] = useState(false)
  const recordingRef = useRef(false)
  const [micDenied, setMicDenied] = useState(false)
  const voice = useVoiceMode()

  // Transparent window: the page's default (light) background paints the
  // corner areas OUTSIDE the border-radius — white spurs at every corner.
  // Clear every layer so only the rounded capsule is visible.
  useEffect(() => {
    // The bar window skips the app's ThemeProvider — the default (light)
    // tokens are exactly what this light design wants; nothing to claim.
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    // The document must never scroll: during window resize transitions the
    // layout can be a frame taller than the viewport, and a wheel event in
    // that frame scrolls the whole capsule out of place (input row drifting
    // up, content bleeding past it).
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    const root = document.getElementById('root')
    if (root) root.style.background = 'transparent'
  }, [])

  useEffect(() => {
    const focusInput = () => inputRef.current?.focus()
    focusInput()
    window.addEventListener('focus', focusInput)
    return () => window.removeEventListener('focus', focusInput)
  }, [])

  useEffect(() => {
    return window.ipc.on('quick-ask:state', (s) => {
      if (!awaitingRef.current) return
      setAnswer({ processing: s.processing, text: s.responseText ?? '', statusText: s.statusText ?? null })
    })
  }, [])

  // Ask main to grow/shrink the window when the answer area toggles.
  // Content-driven: the panel takes only what the answer needs (short
  // answers get a short panel), up to the unchanged ANSWER_HEIGHT cap.
  // Measured off an inner wrapper so the scroll container's own size can
  // never feed back into the measurement.
  const expanded = asked !== null
  const panelContentRef = useRef<HTMLDivElement | null>(null)
  // Panel chrome around the measured content: pt-5 + pb-3 + footer line +
  // its mt-2 + the divider, in design px.
  const PANEL_CHROME = 62
  useEffect(() => {
    if (!expanded) {
      void window.ipc.invoke('quickAsk:resize', { height: BAR_HEIGHT }).catch(() => {})
      return
    }
    const content = panelContentRef.current?.offsetHeight ?? 0
    const needed = Math.min(ANSWER_HEIGHT, BAR_HEIGHT + PANEL_CHROME + content)
    void window.ipc.invoke('quickAsk:resize', { height: needed }).catch(() => {})
    // Undo any scroll offset a resize frame let slip through.
    window.scrollTo(0, 0)
  }, [expanded, asked, answer?.text, answer?.statusText, answer?.processing])

  const submit = useCallback((raw: string) => {
    const text = raw.trim()
    if (!text) return
    setAsked(text)
    setDraft('')
    awaitingRef.current = true
    setAnswer({ processing: true, text: '', statusText: 'Thinking…' })
    void window.ipc.invoke('quickAsk:submit', { text }).catch(() => {})
  }, [])

  const reset = useCallback(() => {
    awaitingRef.current = false
    setAsked(null)
    setAnswer(null)
    setDraft('')
  }, [])

  // Optional toggles (the standup's "voice and screen share as opt-ins").
  // voiceOut: answers to bar questions are spoken aloud. sharing: the app
  // window's screen capture runs and frames ride along with bar submits —
  // the ACTUAL state comes back over quick-ask:options-state (a denied
  // permission must never leave a lying badge).
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

  // Hold the platform PTT key to speak; release submits the transcript.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === PTT_CODE && !e.repeat && !recordingRef.current) {
        recordingRef.current = true
        setRecording(true)
        void voice.start().then((result) => {
          if (result === 'mic-denied') {
            recordingRef.current = false
            setRecording(false)
            setMicDenied(true)
          }
        })
      } else if (e.key === 'Escape') {
        e.preventDefault()
        if (recordingRef.current) {
          voice.cancel()
          recordingRef.current = false
          setRecording(false)
        } else if (asked) {
          reset()
        } else {
          dismiss()
        }
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === PTT_CODE && recordingRef.current) {
        recordingRef.current = false
        setRecording(false)
        void voice.submit().then((text) => {
          if (text) submit(text)
        })
      }
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
    }
  }, [voice, asked, reset, dismiss, submit])

  const inputValue = recording ? voice.interimText || draft : draft

  return (
    // Bottom-anchored window (grows upward): the answer stacks ABOVE the
    // input row, which stays pinned to the bottom edge. Collapsed, the bar
    // is a full capsule; expanded, the capsule softens so the answer panel
    // reads as one surface.
    <div
      // No CSS shadow here: it would paint into the window's square corner
      // zones (the only area it isn't clipped) as dark smudges — the native
      // window shadow already provides the depth.
      className={`qa-root flex h-screen w-screen select-none flex-col overflow-hidden border border-black/10 bg-[#f6f6f7]/95 text-neutral-900 ${
        expanded ? 'rounded-[44px]' : 'rounded-full'
      }`}
    >
      {/* Liquid Glass experiment: when main confirms the native glass view
          applied (html[data-liquid-glass]), the solid capsule becomes a
          translucent skin over it. Plain CSS so no re-render is needed. */}
      <style>{`
        html[data-liquid-glass="1"] .qa-root {
          background-color: rgba(255, 255, 255, 0.45) !important;
          border-color: rgba(0, 0, 0, 0.12) !important;
        }
      `}</style>
      {asked && (
        <div className="relative flex min-h-0 flex-1 flex-col border-b border-black/5 px-7 pb-3 pt-5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={newChat}
                aria-label="New chat"
                className="absolute right-14 top-4 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/[0.04] text-neutral-500 ring-1 ring-inset ring-black/10 transition-colors hover:bg-black/[0.08] hover:text-neutral-900"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">New chat</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={openInApp}
                aria-label="Open in Rowboat"
                className="absolute right-5 top-4 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/[0.04] text-neutral-500 ring-1 ring-inset ring-black/10 transition-colors hover:bg-black/[0.08] hover:text-neutral-900"
              >
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Open in Rowboat</TooltipContent>
          </Tooltip>
          <div className="min-h-0 flex-1 overflow-y-auto text-sm leading-relaxed text-neutral-800">
            <div ref={panelContentRef}>
            {/* Inside the scroll area — the question scrolls away with the
                answer instead of persisting as a header. */}
            <div className="mb-2 text-sm font-medium text-neutral-500">{asked}</div>
            {answer?.text ? (
              <Streamdown className="prose prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_pre]:my-2 [&_pre]:text-[11px] [&_code]:text-[11px] [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-black/[0.06] [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:text-neutral-800">
                {answer.text}
              </Streamdown>
            ) : (
              answer?.processing && (
                <span className="animate-pulse text-neutral-500">{answer.statusText ?? 'Thinking…'}</span>
              )
            )}
            {answer?.processing && answer.text && <span className="animate-pulse">▍</span>}
            </div>
          </div>
          <div className="mt-2 shrink-0 text-[11px] text-neutral-500">
            Also in your Rowboat chat · Esc to {answer?.processing ? 'dismiss' : 'clear'}
          </div>
        </div>
      )}

      <form
        className="flex h-[88px] shrink-0 items-center gap-4 pl-4 pr-4"
        onSubmit={(e) => {
          e.preventDefault()
          submit(draft)
        }}
      >
        {/* Mic orb: layered like a physical button — a soft vertical
            gradient base, an inset hairline, a top sheen, and a tight halo.
            Green (and breathing) while live. */}
        <span
          className={`relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-inset transition-all duration-300 ${
            recording
              ? 'animate-pulse bg-gradient-to-b from-emerald-400/30 to-emerald-600/10 shadow-[0_0_18px_rgba(52,211,153,0.3)] ring-emerald-500/25'
              : 'bg-gradient-to-b from-sky-400/25 via-blue-500/15 to-indigo-500/10 shadow-[0_0_16px_rgba(96,165,250,0.25)] ring-sky-500/20'
          }`}
        >
          {/* top sheen — a radial fade from the top center, so there is no
              shape edge to see (the previous half-ellipse showed its rim) */}
          <span className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(120%_80%_at_50%_0%,rgba(255,255,255,0.2),transparent_55%)]" />
          <Mic
            className={`relative h-[18px] w-[18px] drop-shadow-[0_1px_1px_rgba(0,0,0,0.12)] ${
              recording ? 'text-emerald-600' : 'text-sky-600'
            }`}
          />
        </span>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={recording ? 'Listening…' : 'Ask Rowboat anything…'}
          className="h-full min-w-0 flex-1 bg-transparent text-lg font-light outline-none placeholder:text-neutral-500"
        />
        {micDenied ? (
          <button
            type="button"
            onClick={() => void window.ipc.invoke('app:openPrivacySettings', { section: 'microphone' }).catch(() => {})}
            className="shrink-0 text-[11px] text-red-600 underline-offset-2 hover:underline"
          >
            Mic blocked — open System Settings
          </button>
        ) : (
          <span className="flex shrink-0 items-center gap-3">
            {/* Same layered construction as the mic orb: gradient base,
                inset hairline, radial top sheen. */}
            <span className="relative flex items-center gap-1.5 overflow-hidden rounded-full bg-gradient-to-b from-black/[0.05] to-black/[0.02] px-3 py-1.5 text-[13px] text-neutral-700 ring-1 ring-inset ring-black/10">
              <span className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(120%_80%_at_50%_0%,rgba(255,255,255,0.12),transparent_55%)]" />
              {/* Platform label (Windows says right Ctrl; the right-cmd
                  position is the Win key there) at main's smaller glyph size. */}
              <span className="relative">{IS_MAC ? 'Hold right' : 'Hold right Ctrl'}</span>
              {IS_MAC && <Command className="relative h-3.5 w-3.5 text-sky-600 drop-shadow-[0_1px_1px_rgba(0,0,0,0.12)]" />}
            </span>
            <span className="text-[13px] text-neutral-500">to speak</span>
          </span>
        )}
        {/* Optional toggles: speak answers aloud, share the screen. Same
            layered chrome as the send button; a lit tint marks active. The
            hover hints are tiny in-capsule labels UNDER each button — a real
            tooltip can't open downward here (the window ends ~24px below,
            and with liquid glass the window must stay exactly capsule-sized),
            so the label lives in that 24px instead. */}
        {/* Hint placement depends on the surface: expanded, the panel above
            gives a normal tooltip room to open upward; collapsed, the window
            is exactly the capsule, so a tiny in-capsule label sits in the
            ~24px under the button instead. */}
        <span className="relative shrink-0">
          <Tooltip open={expanded ? undefined : false}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggleVoiceOut}
                aria-label={voiceOut ? 'Stop speaking answers' : 'Speak answers aloud'}
                className={`peer relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full ring-1 ring-inset transition-all ${
                  voiceOut
                    ? 'bg-gradient-to-b from-sky-400/60 to-sky-500/30 text-sky-800 ring-sky-500/50 shadow-[0_0_14px_rgba(56,189,248,0.45)]'
                    : 'bg-gradient-to-b from-black/[0.05] to-black/[0.02] text-neutral-500 ring-black/10 hover:text-neutral-800'
                }`}
              >
                <span className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(120%_80%_at_50%_0%,rgba(255,255,255,0.1),transparent_55%)]" />
                <Volume2 className="relative h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {voiceOut ? 'Answers are spoken — click to mute' : 'Speak answers aloud'}
            </TooltipContent>
          </Tooltip>
          {!expanded && (
            <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-0.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-neutral-900 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-md opacity-0 transition-opacity peer-hover:opacity-100">
              {voiceOut ? 'Click to mute' : 'Speak answers aloud'}
            </span>
          )}
        </span>
        <span className="relative shrink-0">
          <Tooltip open={expanded ? undefined : false}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggleShare}
                aria-label={sharing ? 'Stop sharing your screen' : 'Share your screen'}
                className={`peer relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full ring-1 ring-inset transition-all ${
                  sharing
                    ? 'bg-gradient-to-b from-emerald-400/60 to-emerald-500/30 text-emerald-800 ring-emerald-500/50 shadow-[0_0_14px_rgba(52,211,153,0.45)]'
                    : 'bg-gradient-to-b from-black/[0.05] to-black/[0.02] text-neutral-500 ring-black/10 hover:text-neutral-800'
                }`}
              >
                <span className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(120%_80%_at_50%_0%,rgba(255,255,255,0.1),transparent_55%)]" />
                <MonitorUp className="relative h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {sharing ? 'Sharing your screen with this chat — click to stop' : 'Share your screen with this chat'}
            </TooltipContent>
          </Tooltip>
          {!expanded && (
            <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-0.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-neutral-900 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-md opacity-0 transition-opacity peer-hover:opacity-100">
              {sharing ? 'Stop sharing' : 'Share your screen'}
            </span>
          )}
        </span>
        <button
          type="submit"
          disabled={!draft.trim()}
          aria-label="Send"
          className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-b from-black/[0.05] to-black/[0.02] text-neutral-700 ring-1 ring-inset ring-black/10 transition-all hover:from-black/[0.08] disabled:opacity-40"
        >
          <span className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(120%_80%_at_50%_0%,rgba(255,255,255,0.12),transparent_55%)]" />
          <CornerDownLeft className="relative h-5 w-5" />
        </button>
      </form>
    </div>
  )
}
