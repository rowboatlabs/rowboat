import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TalkingHead } from '@/components/talking-head'
import type { TTSState } from '@/hooks/useVoiceTTS'
import { cn } from '@/lib/utils'

export type TourNavTarget =
  | 'home'
  | 'email'
  | 'meetings'
  | 'code'
  | 'knowledge'
  | 'agents'
  | 'workspaces'

type TourStep = {
  id: string
  /** Matches a [data-tour-id] element. Steps whose target is absent are skipped. */
  targetId?: string
  /** View to open when the step starts, via App's navigation handlers. */
  navigate?: TourNavTarget
  title: string
  text: string
}

const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'Ahoy! 👋',
    text: "I'm the Rowboat mascot. Let me row you around the app — it only takes a minute. Use the Next button or your arrow keys.",
  },
  {
    id: 'home',
    targetId: 'nav-home',
    navigate: 'home',
    title: 'Home',
    text: 'Home is your landing spot — a quick overview of what needs your attention to get you back into the flow.',
  },
  {
    id: 'email',
    targetId: 'nav-email',
    navigate: 'email',
    title: 'Email',
    text: 'Read and triage your inbox right here. Rowboat can summarize threads, label messages, and help you draft replies.',
  },
  {
    id: 'meetings',
    targetId: 'nav-meetings',
    navigate: 'meetings',
    title: 'Meetings',
    text: 'Record or join meetings, and get transcripts and notes automatically — prep briefs show up before your calls, too.',
  },
  {
    id: 'code',
    targetId: 'nav-code',
    navigate: 'code',
    title: 'Code',
    text: 'The Code section runs coding agents on your projects — point one at a folder and drive it from a chat.',
  },
  {
    id: 'knowledge',
    targetId: 'nav-knowledge',
    navigate: 'knowledge',
    title: 'Brain',
    text: "Brain is your knowledge base — notes, files, and everything Rowboat learns for you, all connected and searchable.",
  },
  {
    id: 'agents',
    targetId: 'nav-agents',
    navigate: 'agents',
    title: 'Background agents',
    text: 'Background agents work on schedules — they keep your Brain fresh and take care of recurring tasks while you row elsewhere.',
  },
  {
    id: 'workspaces',
    targetId: 'nav-workspaces',
    navigate: 'workspaces',
    title: 'Workspaces',
    text: 'Workspaces hold your project folders and files, so related work stays docked together.',
  },
  {
    id: 'chats',
    targetId: 'nav-chats',
    title: 'Chats',
    text: 'Your recent conversations live here — pick any of them back up right where you left off.',
  },
  {
    id: 'composer',
    targetId: 'chat-composer',
    title: 'Talk to Rowboat',
    text: 'And this is where we talk! Type, dictate with the mic, or turn on voice output — tap my face button and I’ll read replies out loud myself.',
  },
  {
    id: 'done',
    title: "That's the lay of the water! 🚣",
    text: 'You can take this tour again anytime from the bottom of the sidebar. Happy rowing!',
  },
]

const MASCOT_SIZE = 120
const VIEWPORT_MARGIN = 16
const BUBBLE_WIDTH = 288
const TARGET_RESOLVE_TIMEOUT_MS = 1500

type TourLayout = {
  mascot: { x: number; y: number }
  ring: { left: number; top: number; width: number; height: number } | null
  bubbleSide: 'left' | 'right'
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

// A data-tour-id can legitimately appear on several elements (e.g. the chat
// composer renders in both the full-screen chat and the side pane) — pick the
// one that is actually laid out.
function findTourTarget(targetId: string): DOMRect | null {
  const nodes = document.querySelectorAll<HTMLElement>(`[data-tour-id="${targetId}"]`)
  for (const el of nodes) {
    const rect = el.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) return rect
  }
  return null
}

function layoutForCenter(): TourLayout {
  return {
    mascot: {
      x: window.innerWidth / 2 - MASCOT_SIZE / 2 - BUBBLE_WIDTH / 2,
      y: window.innerHeight / 2 - MASCOT_SIZE / 2,
    },
    ring: null,
    bubbleSide: 'right',
  }
}

function layoutForTarget(rect: DOMRect): TourLayout {
  let x: number
  let y: number
  const fitsRight = rect.right + MASCOT_SIZE + BUBBLE_WIDTH + VIEWPORT_MARGIN * 3 < window.innerWidth
  if (fitsRight) {
    x = rect.right + 20
    y = rect.top + rect.height / 2 - MASCOT_SIZE / 2
  } else if (rect.top > MASCOT_SIZE + VIEWPORT_MARGIN * 2) {
    x = rect.left + rect.width / 2 - MASCOT_SIZE / 2
    y = rect.top - MASCOT_SIZE - 20
  } else {
    x = rect.left - MASCOT_SIZE - 20
    y = rect.top + rect.height / 2 - MASCOT_SIZE / 2
  }
  x = clamp(x, VIEWPORT_MARGIN, window.innerWidth - MASCOT_SIZE - VIEWPORT_MARGIN)
  y = clamp(y, VIEWPORT_MARGIN, window.innerHeight - MASCOT_SIZE - VIEWPORT_MARGIN)
  return {
    mascot: { x, y },
    ring: {
      left: rect.left - 6,
      top: rect.top - 6,
      width: rect.width + 12,
      height: rect.height + 12,
    },
    bubbleSide: x + MASCOT_SIZE / 2 < window.innerWidth / 2 ? 'right' : 'left',
  }
}

type ProductTourProps = {
  onClose: () => void
  onNavigate: (target: TourNavTarget) => void
  ttsAvailable: boolean
  ttsState: TTSState
  speak: (text: string) => void
  cancelSpeech: () => void
  getLevel: () => number
}

/**
 * Mascot-guided walkthrough. The talking head glides between the app's
 * [data-tour-id] anchors, opening each section as it goes, with a speech
 * bubble (and spoken narration when TTS is configured) describing each stop.
 */
export function ProductTour({
  onClose,
  onNavigate,
  ttsAvailable,
  ttsState,
  speak,
  cancelSpeech,
  getLevel,
}: ProductTourProps) {
  const [stepIndex, setStepIndex] = useState(0)
  // Start below the bottom-right corner so the first layout glides the mascot in
  const [layout, setLayout] = useState<TourLayout>(() => ({
    mascot: { x: window.innerWidth - MASCOT_SIZE - 32, y: window.innerHeight + 40 },
    ring: null,
    bubbleSide: 'left',
  }))
  const [resizeNonce, setResizeNonce] = useState(0)
  const [flipped, setFlipped] = useState(false)

  // Direction of travel through the steps, used when a step's target is
  // missing (e.g. Code mode disabled) and the tour has to skip over it.
  const directionRef = useRef(1)
  const enteredStepRef = useRef(-1)
  const lastXRef = useRef<number | null>(null)
  const stepIndexRef = useRef(stepIndex)

  const onCloseRef = useRef(onClose)
  const onNavigateRef = useRef(onNavigate)
  const speakRef = useRef(speak)
  const cancelSpeechRef = useRef(cancelSpeech)
  const ttsAvailableRef = useRef(ttsAvailable)

  // Keep latest callbacks/state in refs so the step effect and key handlers
  // stay stable. Runs before the step effect below (effect order = call order).
  useEffect(() => {
    stepIndexRef.current = stepIndex
    onCloseRef.current = onClose
    onNavigateRef.current = onNavigate
    speakRef.current = speak
    cancelSpeechRef.current = cancelSpeech
    ttsAvailableRef.current = ttsAvailable
  })

  const finish = useCallback(() => {
    cancelSpeechRef.current()
    onCloseRef.current()
  }, [])

  const goTo = useCallback((index: number, direction: 1 | -1) => {
    directionRef.current = direction
    if (index < 0) return
    if (index >= TOUR_STEPS.length) {
      finish()
      return
    }
    setStepIndex(index)
  }, [finish])

  // Stop any in-flight narration when the tour unmounts
  useEffect(() => () => cancelSpeechRef.current(), [])

  useEffect(() => {
    const handleResize = () => setResizeNonce((n) => n + 1)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Enter the current step: navigate, wait for its anchor to exist, position
  // the mascot, and narrate. Re-runs on resize purely to recompute positions.
  useEffect(() => {
    const step = TOUR_STEPS[stepIndex]
    const entering = enteredStepRef.current !== stepIndex
    let cancelled = false

    if (entering && step.navigate) {
      onNavigateRef.current(step.navigate)
    }

    const applyLayout = (next: TourLayout) => {
      setLayout(next)
      setFlipped(lastXRef.current != null && next.mascot.x < lastXRef.current)
      lastXRef.current = next.mascot.x
      if (entering) {
        enteredStepRef.current = stepIndex
        cancelSpeechRef.current()
        if (ttsAvailableRef.current) {
          speakRef.current(step.text)
        }
      }
    }

    if (!step.targetId) {
      applyLayout(layoutForCenter())
      return
    }

    const startedAt = performance.now()
    const attempt = () => {
      if (cancelled) return
      const rect = findTourTarget(step.targetId!)
      if (rect) {
        applyLayout(layoutForTarget(rect))
        return
      }
      if (performance.now() - startedAt < TARGET_RESOLVE_TIMEOUT_MS) {
        requestAnimationFrame(attempt)
      } else if (entering) {
        // Anchor never appeared (feature disabled / pane closed) — skip past it
        goTo(stepIndex + directionRef.current, directionRef.current as 1 | -1)
      }
    }
    attempt()
    return () => {
      cancelled = true
    }
  }, [stepIndex, resizeNonce, goTo])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        finish()
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault()
        goTo(stepIndexRef.current + 1, 1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goTo(stepIndexRef.current - 1, -1)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [finish, goTo])

  const step = TOUR_STEPS[stepIndex]
  const isFirst = stepIndex === 0
  const isLast = stepIndex === TOUR_STEPS.length - 1

  return (
    <>
      <style>{`
        @keyframes tour-bubble-in {
          0% { opacity: 0; transform: translateY(6px) scale(0.97); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
      {/* highlight ring around the current step's anchor */}
      {layout.ring && (
        <div
          className="pointer-events-none fixed z-[65] rounded-lg border-2 border-primary/70 ring-4 ring-primary/15"
          style={{
            left: layout.ring.left,
            top: layout.ring.top,
            width: layout.ring.width,
            height: layout.ring.height,
            transition: 'all 0.6s cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        />
      )}
      {/* mascot + speech bubble */}
      <div
        className="pointer-events-none fixed left-0 top-0 z-[70]"
        style={{
          transform: `translate(${layout.mascot.x}px, ${layout.mascot.y}px)`,
          transition: 'transform 0.9s cubic-bezier(0.45, 0, 0.2, 1)',
        }}
      >
        <div
          style={{
            transform: flipped ? 'scaleX(-1)' : undefined,
            transition: 'transform 0.4s ease-in-out',
          }}
        >
          <TalkingHead ttsState={ttsState} getLevel={getLevel} size={MASCOT_SIZE} />
        </div>
        <div
          key={step.id}
          className={cn(
            'pointer-events-auto absolute top-0 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg',
            layout.bubbleSide === 'right' ? 'left-full ml-3' : 'right-full mr-3'
          )}
          style={{
            width: BUBBLE_WIDTH,
            animation: 'tour-bubble-in 0.25s ease-out',
          }}
        >
          <button
            type="button"
            onClick={finish}
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="End tour"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <p className="pr-6 text-sm font-semibold">{step.title}</p>
          <p className="mt-1.5 text-sm text-muted-foreground">{step.text}</p>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs tabular-nums text-muted-foreground">
              {stepIndex + 1} / {TOUR_STEPS.length}
            </span>
            <div className="flex items-center gap-1.5">
              {!isFirst && (
                <Button variant="ghost" size="sm" className="h-7 px-2.5" onClick={() => goTo(stepIndex - 1, -1)}>
                  Back
                </Button>
              )}
              <Button
                size="sm"
                className="h-7 px-3"
                onClick={() => (isLast ? finish() : goTo(stepIndex + 1, 1))}
              >
                {isLast ? 'Done' : 'Next'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
