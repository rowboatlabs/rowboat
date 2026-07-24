import { useCallback, useEffect, useRef, useState } from 'react'
import { CornerDownLeft, Mic } from 'lucide-react'

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
  const [answer, setAnswer] = useState<{ processing: boolean; text: string } | null>(null)
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
      setAnswer({ processing: s.processing, text: s.responseText ?? '' })
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
    setAnswer({ processing: true, text: '' })
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
    <div className="flex h-screen w-screen select-none flex-col overflow-hidden bg-neutral-900 text-white">
      <form
        className="flex h-[88px] shrink-0 items-center gap-3 px-5"
        onSubmit={(e) => {
          e.preventDefault()
          submit(draft)
        }}
      >
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
            recording ? 'bg-green-600 animate-pulse' : 'bg-sky-600'
          }`}
        >
          <Mic className="h-4 w-4" />
        </span>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={recording ? 'Listening…' : 'Ask Rowboat anything…'}
          className="h-full min-w-0 flex-1 bg-transparent text-lg outline-none placeholder:text-neutral-500"
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
          <span className="flex shrink-0 items-center gap-2 text-[11px] text-neutral-500">
            <kbd className="rounded border border-neutral-700 px-1.5 py-0.5">hold right ⌘</kbd>
            to speak
            <kbd className="rounded border border-neutral-700 px-1.5 py-0.5">
              <CornerDownLeft className="h-3 w-3" />
            </kbd>
          </span>
        )}
      </form>

      {asked && (
        <div className="flex min-h-0 flex-1 flex-col border-t border-neutral-800 px-5 py-3">
          <div className="mb-2 shrink-0 truncate text-xs text-neutral-500">You asked: {asked}</div>
          <div className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-neutral-100">
            {answer?.text ? (
              answer.text
            ) : (
              <span className="text-neutral-500">{answer?.processing ? 'Thinking…' : ''}</span>
            )}
            {answer?.processing && answer.text && <span className="animate-pulse">▍</span>}
          </div>
          <div className="mt-2 shrink-0 text-[11px] text-neutral-600">
            Also in your Rowboat chat · Esc to {answer?.processing ? 'dismiss' : 'clear'}
          </div>
        </div>
      )}
    </div>
  )
}
