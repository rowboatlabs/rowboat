import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, MonitorUp, Plus, Volume2 } from 'lucide-react'
import { Streamdown } from 'streamdown'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
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

  // Hold the platform PTT key to speak; release submits the transcript.
  // Esc: cancel recording → clear the answer → dismiss, in that order.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === PTT_CODE && !e.repeat && !recordingRef.current) {
        startRecording()
      } else if (e.key === 'Escape') {
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
      if (e.code === PTT_CODE && recordingRef.current) {
        void submitRecording()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
    }
  }, [asked, startRecording, submitRecording, cancelRecording, reset, dismiss])

  return (
    <div className="flex h-screen w-screen select-none flex-col overflow-hidden">
      {/* The invisible stage: popovers open into this zone; clicking it
          dismisses the bar (the click-away feel, inside our own window). */}
      <div className="min-h-0 flex-1" onMouseDown={dismiss} />

      {/* Light skin (#810): near-white card, hairline dark border, dark
          text. The window's native shadow is off (it would outline the
          whole transparent frame) — the card draws its own. */}
      <div className="qa-card shrink-0 overflow-hidden rounded-[26px] border border-black/10 bg-white/[0.97] text-neutral-900 shadow-[0_24px_60px_rgba(0,0,0,0.22),0_4px_16px_rgba(0,0,0,0.12)]">
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
      <Toaster />
    </div>
  )
}
