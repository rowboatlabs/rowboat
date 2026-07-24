import { useCallback, useEffect, useRef, useState } from 'react'
import { Command, CornerDownLeft, Mic } from 'lucide-react'
import { Streamdown } from 'streamdown'

import { useVoiceMode } from '@/hooks/useVoiceMode'

// Window heights the bar asks main for: just the input row, or input +
// answer area. Fixed steps (not content-measured) so the window never
// feedback-loops with its own resize.
const BAR_HEIGHT = 88
const ANSWER_HEIGHT = 380

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

  // Voice input: hold Right ⌘ while the bar is focused. Local dictation via
  // the same Deepgram flow as the composer mic — no global hook needed, the
  // bar has keyboard focus by construction.
  const [recording, setRecording] = useState(false)
  const recordingRef = useRef(false)
  const [micDenied, setMicDenied] = useState(false)
  const voice = useVoiceMode()

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
  const expanded = asked !== null
  useEffect(() => {
    void window.ipc.invoke('quickAsk:resize', { height: expanded ? ANSWER_HEIGHT : BAR_HEIGHT }).catch(() => {})
  }, [expanded])

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

  const dismiss = useCallback(() => {
    void window.ipc.invoke('quickAsk:hide', null).catch(() => {})
  }, [])

  // Hold Right ⌘ to speak; release submits the transcript.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'MetaRight' && !e.repeat && !recordingRef.current) {
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
      if (e.code === 'MetaRight' && recordingRef.current) {
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
      className={`flex h-screen w-screen select-none flex-col overflow-hidden border border-white/10 bg-[#1a1b1e]/95 text-white shadow-2xl ${
        expanded ? 'rounded-[28px]' : 'rounded-full'
      }`}
    >
      {asked && (
        <div className="flex min-h-0 flex-1 flex-col border-b border-white/5 px-7 pb-3 pt-5">
          <div className="mb-2 shrink-0 truncate text-xs text-neutral-500">{asked}</div>
          <div className="min-h-0 flex-1 overflow-y-auto text-sm leading-relaxed text-neutral-100">
            {answer?.text ? (
              <Streamdown className="prose prose-sm prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_pre]:my-2 [&_pre]:text-[11px] [&_code]:text-[11px]">
                {answer.text}
              </Streamdown>
            ) : (
              answer?.processing && (
                <span className="animate-pulse text-neutral-500">{answer.statusText ?? 'Thinking…'}</span>
              )
            )}
            {answer?.processing && answer.text && <span className="animate-pulse">▍</span>}
          </div>
          <div className="mt-2 shrink-0 text-[11px] text-neutral-600">
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
        {/* Mic orb: blue accent with a soft glow; green pulse while live. */}
        <span
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-colors ${
            recording
              ? 'animate-pulse bg-green-500/20 shadow-[0_0_24px_rgba(34,197,94,0.35)] ring-1 ring-green-400/40'
              : 'bg-blue-500/15 shadow-[0_0_24px_rgba(59,130,246,0.3)] ring-1 ring-blue-400/30'
          }`}
        >
          <Mic className={`h-5 w-5 ${recording ? 'text-green-400' : 'text-blue-400'}`} />
        </span>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={recording ? 'Listening…' : 'Ask Rowboat anything…'}
          className="h-full min-w-0 flex-1 bg-transparent text-xl font-light outline-none placeholder:text-neutral-500"
        />
        {micDenied ? (
          <button
            type="button"
            onClick={() => void window.ipc.invoke('app:openPrivacySettings', { section: 'microphone' }).catch(() => {})}
            className="shrink-0 text-[11px] text-red-400 underline-offset-2 hover:underline"
          >
            Mic blocked — open System Settings
          </button>
        ) : (
          <span className="flex shrink-0 items-center gap-3">
            <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-2 text-sm text-neutral-300">
              <Command className="h-4 w-4 text-blue-400" />
              Hold right
            </span>
            <span className="text-sm text-neutral-400">to speak</span>
          </span>
        )}
        <button
          type="submit"
          disabled={!draft.trim()}
          aria-label="Send"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-neutral-200 transition-colors hover:bg-white/10 disabled:opacity-40"
        >
          <CornerDownLeft className="h-5 w-5" />
        </button>
      </form>
    </div>
  )
}
