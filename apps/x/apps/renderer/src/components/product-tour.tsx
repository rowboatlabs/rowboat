import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TalkingHead, type MascotHat } from '@/components/talking-head'
import { TourSounds } from '@/lib/tour-sounds'
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
  /** Costume the mascot wears at this stop. */
  hat?: MascotHat
  title: string
  text: string
}

const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'All aboard! ⚓',
    text: "I'm your captain for the next minute. The lights are down and the water's in — let me row you across Rowboat, one stop at a time. Use Next or your arrow keys.",
  },
  {
    id: 'home',
    targetId: 'nav-home',
    navigate: 'home',
    title: 'First stop: Home',
    text: 'Home is your landing spot — a quick overview of what needs your attention to get you back into the flow.',
  },
  {
    id: 'email',
    targetId: 'nav-email',
    navigate: 'email',
    hat: 'mailcap',
    title: 'Email',
    text: 'Read and triage your inbox right here. Rowboat can summarize threads, label messages, and help you draft replies.',
  },
  {
    id: 'meetings',
    targetId: 'nav-meetings',
    navigate: 'meetings',
    hat: 'headphones',
    title: 'Meetings',
    text: 'Record or join meetings, and get transcripts and notes automatically — prep briefs show up before your calls, too.',
  },
  {
    id: 'code',
    targetId: 'nav-code',
    navigate: 'code',
    hat: 'hardhat',
    title: 'Code',
    text: 'The Code section runs coding agents on your projects — point one at a folder and drive it from a chat.',
  },
  {
    id: 'knowledge',
    targetId: 'nav-knowledge',
    navigate: 'knowledge',
    hat: 'gradcap',
    title: 'Brain',
    text: "Brain is your knowledge base — notes, files, and everything Rowboat learns for you, all connected and searchable.",
  },
  {
    id: 'agents',
    targetId: 'nav-agents',
    navigate: 'agents',
    hat: 'captain',
    title: 'Background agents',
    text: 'Background agents work on schedules — they keep your Brain fresh and take care of recurring tasks while you row elsewhere.',
  },
  {
    id: 'workspaces',
    targetId: 'nav-workspaces',
    navigate: 'workspaces',
    hat: 'explorer',
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
    hat: 'party',
    title: "Land ho! 🎉",
    text: "That's the whole bay — and there's my wake to prove it. Take this voyage again anytime from the bottom of the sidebar. Happy rowing!",
  },
]

const MASCOT_SIZE = 120
const VIEWPORT_MARGIN = 16
const BUBBLE_WIDTH = 288
const TARGET_RESOLVE_TIMEOUT_MS = 1500
const ZOOM_SCALE = 1.05
const GLIDE_EASING = 'cubic-bezier(0.45, 0, 0.2, 1)'

type Pt = { x: number; y: number }
type Rect = { left: number; top: number; width: number; height: number }
type Spot = Rect & { round: boolean }

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function quadPoint(p0: Pt, c: Pt, p1: Pt, t: number): Pt {
  const u = 1 - t
  return {
    x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
  }
}

function quadPathLength(d: string): number {
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  p.setAttribute('d', d)
  return p.getTotalLength()
}

// A data-tour-id can legitimately appear on several elements (e.g. the chat
// composer renders in both the full-screen chat and the side pane) — pick the
// one that is actually laid out.
function findTourTarget(targetId: string): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>(`[data-tour-id="${targetId}"]`)
  for (const el of nodes) {
    const rect = el.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) return el
  }
  return null
}

function mascotDestForCenter(): Pt {
  return {
    x: window.innerWidth / 2 - MASCOT_SIZE / 2 - BUBBLE_WIDTH / 2,
    y: window.innerHeight / 2 - MASCOT_SIZE / 2,
  }
}

function mascotDestForRect(rect: Rect): Pt {
  let x: number
  let y: number
  const fitsRight = rect.left + rect.width + MASCOT_SIZE + BUBBLE_WIDTH + VIEWPORT_MARGIN * 3 < window.innerWidth
  if (fitsRight) {
    x = rect.left + rect.width + 20
    y = rect.top + rect.height / 2 - MASCOT_SIZE / 2
  } else if (rect.top > MASCOT_SIZE + VIEWPORT_MARGIN * 2) {
    x = rect.left + rect.width / 2 - MASCOT_SIZE / 2
    y = rect.top - MASCOT_SIZE - 20
  } else {
    x = rect.left - MASCOT_SIZE - 20
    y = rect.top + rect.height / 2 - MASCOT_SIZE / 2
  }
  return {
    x: clamp(x, VIEWPORT_MARGIN, window.innerWidth - MASCOT_SIZE - VIEWPORT_MARGIN),
    y: clamp(y, VIEWPORT_MARGIN, window.innerHeight - MASCOT_SIZE - VIEWPORT_MARGIN),
  }
}

function spotForRect(rect: Rect): Spot {
  return {
    left: rect.left - 6,
    top: rect.top - 6,
    width: rect.width + 12,
    height: rect.height + 12,
    round: false,
  }
}

function spotForMascot(dest: Pt): Spot {
  return {
    left: dest.x - 26,
    top: dest.y - 18,
    width: MASCOT_SIZE + 52,
    height: MASCOT_SIZE + 44,
    round: true,
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
 * The Grand Voyage: a mascot-guided walkthrough where the app dims to a
 * night-time bay, the boat rows curved routes between [data-tour-id] anchors
 * (leaving a dotted wake behind it), a spotlight and gentle camera zoom reveal
 * each section, and a parchment mini-map charts progress. Narrated with TTS
 * lip sync when available; ends in confetti.
 *
 * Rendered through a portal to <body> so the camera zoom applied to the app
 * shell never transforms the tour's own fixed-position layers.
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
  const [arrived, setArrived] = useState(false)
  const [rowing, setRowing] = useState(false)
  const [flipped, setFlipped] = useState(false)
  const [bubbleSide, setBubbleSide] = useState<'left' | 'right'>('right')
  const [spot, setSpot] = useState<Spot | null>(null)
  const [wakes, setWakes] = useState<{ id: number; d: string }[]>([])
  const [activeWake, setActiveWake] = useState<{ d: string; len: number } | null>(null)
  const [confettiOn, setConfettiOn] = useState(false)
  const [resizeNonce, setResizeNonce] = useState(0)

  const reducedMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  )

  // Mascot position is animated by mutating the container's transform directly
  // (60fps travel without re-rendering React); posRef is the source of truth.
  const mascotElRef = useRef<HTMLDivElement>(null)
  const posRef = useRef<Pt>({
    x: window.innerWidth / 2 - MASCOT_SIZE / 2,
    y: window.innerHeight + 60,
  })
  const travelRafRef = useRef(0)
  const wakePathElRef = useRef<SVGPathElement>(null)
  const wakeIdRef = useRef(0)
  const curveSideRef = useRef(1)
  const lastSplashRef = useRef(0)

  const directionRef = useRef(1)
  const enteredStepRef = useRef(-1)
  const stepIndexRef = useRef(stepIndex)

  // Camera zoom state applied to the app shell (outside the portal)
  const shellRef = useRef<HTMLElement | null>(null)
  const zoomRef = useRef<{ ox: number; oy: number; s: number } | null>(null)

  const soundsRef = useRef<TourSounds | null>(null)

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

  useLayoutEffect(() => {
    if (mascotElRef.current) {
      mascotElRef.current.style.transform = `translate(${posRef.current.x}px, ${posRef.current.y}px)`
    }
    soundsRef.current = new TourSounds()
    return () => {
      soundsRef.current?.dispose()
      soundsRef.current = null
    }
  }, [])

  // Grab the app shell for the camera zoom; restore it when the tour ends
  useEffect(() => {
    const shell = document.querySelector<HTMLElement>('.rowboat-shell')
    shellRef.current = shell
    return () => {
      if (shell) {
        shell.style.transform = ''
        shell.style.transformOrigin = ''
        shell.style.transition = ''
      }
      shellRef.current = null
      zoomRef.current = null
    }
  }, [])

  const applyZoom = useCallback((origin: { ox: number; oy: number } | null) => {
    const shell = shellRef.current
    if (!shell || reducedMotion) return
    if (origin) {
      // transform-origin transitions too, so moving between targets pans
      // smoothly instead of jumping when the origin changes
      shell.style.transition = `transform 0.9s ${GLIDE_EASING}, transform-origin 0.9s ${GLIDE_EASING}`
      shell.style.transformOrigin = `${origin.ox}px ${origin.oy}px`
      shell.style.transform = `scale(${ZOOM_SCALE})`
      zoomRef.current = { ox: origin.ox, oy: origin.oy, s: ZOOM_SCALE }
    } else {
      shell.style.transition = `transform 0.9s ${GLIDE_EASING}, transform-origin 0.9s ${GLIDE_EASING}`
      shell.style.transform = 'scale(1)'
      zoomRef.current = null
    }
  }, [reducedMotion])

  // Where the element will sit on screen once this step's zoom settles:
  // undo the current zoom mathematically, then apply the upcoming one (whose
  // origin is the target's own center, so the center never moves).
  const displayedRect = useCallback((el: HTMLElement, willZoom: boolean): { rect: Rect; origin: { ox: number; oy: number } } => {
    const m = el.getBoundingClientRect()
    const z = zoomRef.current
    let cx = m.left + m.width / 2
    let cy = m.top + m.height / 2
    let w = m.width
    let h = m.height
    if (z) {
      cx = z.ox + (cx - z.ox) / z.s
      cy = z.oy + (cy - z.oy) / z.s
      w /= z.s
      h /= z.s
    }
    const s = willZoom && !reducedMotion ? ZOOM_SCALE : 1
    return {
      rect: { left: cx - (w * s) / 2, top: cy - (h * s) / 2, width: w * s, height: h * s },
      origin: { ox: cx, oy: cy },
    }
  }, [reducedMotion])

  const cancelTravel = useCallback(() => {
    cancelAnimationFrame(travelRafRef.current)
  }, [])

  const moveMascot = useCallback((p: Pt) => {
    posRef.current = p
    if (mascotElRef.current) {
      mascotElRef.current.style.transform = `translate(${p.x}px, ${p.y}px)`
    }
  }, [])

  // Row along a curved path from the current position, drawing the wake as we
  // go and splashing the oar; commits the wake as a dotted trail on arrival.
  const startTravel = useCallback((dest: Pt, onArrive: () => void) => {
    cancelTravel()
    const from = { ...posRef.current }
    const dist = Math.hypot(dest.x - from.x, dest.y - from.y)
    if (dist < 6 || reducedMotion) {
      moveMascot(dest)
      setRowing(false)
      onArrive()
      return
    }
    const dur = clamp(dist * 1.1, 550, 1500)
    curveSideRef.current = -curveSideRef.current
    const mx = (from.x + dest.x) / 2
    const my = (from.y + dest.y) / 2
    const nx = -(dest.y - from.y) / dist
    const ny = (dest.x - from.x) / dist
    const mag = Math.min(140, dist * 0.3) * curveSideRef.current
    const c = { x: mx + nx * mag, y: my + ny * mag }

    // Wake follows the stern (bottom-center of the mascot box)
    const sternX = MASCOT_SIZE / 2
    const sternY = MASCOT_SIZE * 0.82
    const d = `M ${from.x + sternX} ${from.y + sternY} Q ${c.x + sternX} ${c.y + sternY} ${dest.x + sternX} ${dest.y + sternY}`
    const len = quadPathLength(d)
    setActiveWake({ d, len })
    setFlipped(dest.x < from.x - 4)
    setRowing(true)
    lastSplashRef.current = 0

    const t0 = performance.now()
    const frame = (now: number) => {
      const raw = Math.min(1, (now - t0) / dur)
      const t = easeInOutCubic(raw)
      moveMascot(quadPoint(from, c, dest, t))
      if (wakePathElRef.current) {
        wakePathElRef.current.style.strokeDashoffset = String(len * (1 - t))
      }
      if (now - lastSplashRef.current > 420) {
        lastSplashRef.current = now
        soundsRef.current?.splash()
      }
      if (raw < 1) {
        travelRafRef.current = requestAnimationFrame(frame)
      } else {
        setRowing(false)
        setActiveWake(null)
        setWakes((ws) => [...ws, { id: wakeIdRef.current++, d }])
        onArrive()
      }
    }
    travelRafRef.current = requestAnimationFrame(frame)
  }, [cancelTravel, moveMascot, reducedMotion])

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

  // Enter the current step: navigate, wait for its anchor, aim the spotlight
  // and camera, row over, then narrate. Re-runs on resize to re-anchor.
  useEffect(() => {
    const step = TOUR_STEPS[stepIndex]
    const entering = enteredStepRef.current !== stepIndex
    let cancelled = false

    if (entering && step.navigate) {
      onNavigateRef.current(step.navigate)
    }

    const settle = (dest: Pt, side: 'left' | 'right', spotlight: Spot, origin: { ox: number; oy: number } | null) => {
      applyZoom(origin)
      setSpot(spotlight)
      setBubbleSide(side)
      if (!entering) {
        // Resize while already at this step: jump, keep the bubble up
        cancelTravel()
        moveMascot(dest)
        return
      }
      enteredStepRef.current = stepIndex
      setArrived(false)
      startTravel(dest, () => {
        if (cancelled) return
        setArrived(true)
        soundsRef.current?.bump()
        cancelSpeechRef.current()
        if (ttsAvailableRef.current) {
          speakRef.current(step.text)
        }
        if (stepIndex === TOUR_STEPS.length - 1) {
          setConfettiOn(true)
          soundsRef.current?.fanfare()
        }
      })
    }

    if (!step.targetId) {
      const dest = mascotDestForCenter()
      applyZoom(null)
      settle(dest, 'right', spotForMascot(dest), null)
      return () => {
        cancelled = true
        cancelTravel()
      }
    }

    const startedAt = performance.now()
    let pollRaf = 0
    const attempt = () => {
      if (cancelled) return
      const el = findTourTarget(step.targetId!)
      if (el) {
        const { rect, origin } = displayedRect(el, true)
        const dest = mascotDestForRect(rect)
        const side: 'left' | 'right' = dest.x + MASCOT_SIZE / 2 < window.innerWidth / 2 ? 'right' : 'left'
        settle(dest, side, spotForRect(rect), origin)
        return
      }
      if (performance.now() - startedAt < TARGET_RESOLVE_TIMEOUT_MS) {
        pollRaf = requestAnimationFrame(attempt)
      } else if (entering) {
        // Anchor never appeared (feature disabled / pane closed) — skip past it
        goTo(stepIndex + directionRef.current, directionRef.current as 1 | -1)
      }
    }
    attempt()
    return () => {
      cancelled = true
      cancelAnimationFrame(pollRaf)
      cancelTravel()
    }
  }, [stepIndex, resizeNonce, goTo, applyZoom, displayedRect, startTravel, cancelTravel, moveMascot])

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

  return createPortal(
    <>
      <style>{`
        @keyframes tour-bubble-in {
          0% { opacity: 0; transform: translateY(6px) scale(0.97); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes tour-wave-drift {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @keyframes tour-stamp-in {
          0% { opacity: 0; transform: scale(2); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>

      {/* night falls: dim everything except the spotlight cutout */}
      {spot && (
        <div
          className="pointer-events-none fixed z-[64]"
          style={{
            left: spot.left,
            top: spot.top,
            width: spot.width,
            height: spot.height,
            borderRadius: spot.round ? 9999 : 14,
            boxShadow: '0 0 0 200vmax rgba(7, 14, 26, 0.52)',
            transition: `all 0.9s ${GLIDE_EASING}`,
          }}
        />
      )}

      <TourWater />

      {/* wake trails: the committed dotted route + the wake being drawn now */}
      <svg className="pointer-events-none fixed inset-0 z-[66] h-full w-full">
        {wakes.map((w) => (
          <path
            key={w.id}
            d={w.d}
            fill="none"
            stroke="#9CCBEA"
            strokeWidth={4}
            strokeLinecap="round"
            strokeDasharray="1 11"
            opacity={0.75}
          />
        ))}
        {activeWake && (
          <path
            ref={wakePathElRef}
            d={activeWake.d}
            fill="none"
            stroke="#BFE0F5"
            strokeWidth={5}
            strokeLinecap="round"
            strokeDasharray={activeWake.len}
            strokeDashoffset={activeWake.len}
            opacity={0.8}
          />
        )}
      </svg>

      <TourMiniMap total={TOUR_STEPS.length} current={stepIndex} arrived={arrived} />

      {/* the boat (position driven imperatively during travel) */}
      <div
        ref={mascotElRef}
        className="fixed left-0 top-0 z-[70]"
        style={{ width: MASCOT_SIZE, pointerEvents: 'none' }}
      >
        <div style={{ transform: flipped ? 'scaleX(-1)' : undefined, transition: 'transform 0.35s ease-in-out' }}>
          <TalkingHead ttsState={ttsState} getLevel={getLevel} size={MASCOT_SIZE} hat={step.hat} rowing={rowing} />
        </div>
        {arrived && (
          <div
            key={step.id}
            className={cn(
              'pointer-events-auto absolute top-0 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg',
              bubbleSide === 'right' ? 'left-full ml-3' : 'right-full mr-3'
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
        )}
      </div>

      {confettiOn && !reducedMotion && <ConfettiBurst />}
    </>,
    document.body
  )
}

/** Animated translucent waves lapping at the bottom of the screen. */
function TourWater() {
  const back = useMemo(() => wavePath(2400, 96, 8, 22), [])
  const front = useMemo(() => wavePath(2400, 96, 12, 30), [])
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[65] h-24 overflow-hidden" aria-hidden="true">
      <svg
        className="absolute bottom-0 left-0 h-full"
        style={{ width: '200%', animation: 'tour-wave-drift 11s linear infinite' }}
        viewBox="0 0 2400 96"
        preserveAspectRatio="none"
      >
        <path d={back} fill="#5F9BC9" opacity={0.3} />
      </svg>
      <svg
        className="absolute bottom-0 left-0 h-full"
        style={{ width: '200%', animation: 'tour-wave-drift 7s linear infinite reverse' }}
        viewBox="0 0 2400 96"
        preserveAspectRatio="none"
      >
        <path d={front} fill="#8FB6D9" opacity={0.35} />
      </svg>
    </div>
  )
}

// Periodic wave: alternating up/down humps so a -50% translate loops seamlessly
// (both hump counts are even, so half the width is a whole number of periods).
function wavePath(width: number, height: number, humps: number, amp: number): string {
  const yTop = 34
  const seg = width / humps
  let d = `M 0 ${yTop}`
  for (let i = 0; i < humps; i++) {
    d += ` q ${seg / 2} ${i % 2 === 0 ? -amp : amp} ${seg} 0`
  }
  d += ` L ${width} ${height} L 0 ${height} Z`
  return d
}

/** Parchment chart in the corner: islands per stop, dotted route, boat marker. */
function TourMiniMap({ total, current, arrived }: { total: number; current: number; arrived: boolean }) {
  const MW = 184
  const MH = 96
  const points = useMemo(
    () =>
      Array.from({ length: total }, (_, i) => {
        const t = total === 1 ? 0 : i / (total - 1)
        return {
          x: 14 + (MW - 28) * t,
          y: MH / 2 + 4 + Math.sin(t * Math.PI * 1.5 + 0.6) * (MH * 0.26),
        }
      }),
    [total]
  )
  const route = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ')
  const boat = points[clamp(current, 0, total - 1)]

  return (
    <div
      className="fixed bottom-5 left-5 z-[71] rounded-lg border-2 border-[#8A6B3D]/60 bg-[#F4E9CE] px-2 pb-1.5 pt-2 shadow-xl"
      style={{ transform: 'rotate(-1.2deg)' }}
      aria-hidden="true"
    >
      <p className="mb-0.5 px-1 text-[9px] font-semibold uppercase tracking-[0.22em] text-[#6B5138]">
        Voyage chart
      </p>
      <svg width={MW} height={MH} viewBox={`0 0 ${MW} ${MH}`}>
        <path d={route} fill="none" stroke="#8A6B3D" strokeWidth={1.5} strokeDasharray="3 4" opacity={0.65} />
        {points.map((p, i) => {
          const visited = i < current || (i === current && arrived)
          return (
            <g key={i}>
              <ellipse cx={p.x} cy={p.y} rx={7} ry={5} fill="#DFC896" stroke="#8A6B3D" strokeWidth={1.5} />
              {visited && (
                <g style={{ animation: 'tour-stamp-in 0.3s ease-out backwards' }}>
                  <line x1={p.x - 1} y1={p.y - 13} x2={p.x - 1} y2={p.y - 3} stroke="#7A4A21" strokeWidth={1.5} />
                  <path d={`M ${p.x - 1} ${p.y - 13} L ${p.x + 6} ${p.y - 10.5} L ${p.x - 1} ${p.y - 8} Z`} fill="#D9534F" />
                </g>
              )}
            </g>
          )
        })}
        {/* boat marker glides between islands in step with the real mascot */}
        <g style={{ transform: `translate(${boat.x}px, ${boat.y - 7}px)`, transition: `transform 0.9s ${GLIDE_EASING}` }}>
          <path d="M -7 0 Q 0 4 7 0 Q 4 6 0 6 Q -4 6 -7 0 Z" fill="#54402F" stroke="#3E2E24" strokeWidth={1} />
          <circle cx={0} cy={-3} r={3} fill="#E8E9F5" stroke="#17171B" strokeWidth={1} />
        </g>
      </svg>
    </div>
  )
}

/** Two confetti cannons firing from the bottom corners, canvas-driven. */
function ConfettiBurst() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const w = window.innerWidth
    const h = window.innerHeight
    const dpr = window.devicePixelRatio || 1
    canvas.width = w * dpr
    canvas.height = h * dpr
    ctx.scale(dpr, dpr)

    const colors = ['#5B8DEF', '#F2B8BE', '#FFD166', '#7AC74F', '#8FB6D9', '#F2699C']
    const parts = Array.from({ length: 150 }, (_, i) => {
      const fromLeft = i % 2 === 0
      return {
        x: fromLeft ? 24 : w - 24,
        y: h - 40,
        vx: (fromLeft ? 1 : -1) * (2.5 + Math.random() * 6.5),
        vy: -(9 + Math.random() * 8),
        size: 5 + Math.random() * 5,
        color: colors[i % colors.length],
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
      }
    })

    let raf = 0
    const t0 = performance.now()
    const frame = (now: number) => {
      ctx.clearRect(0, 0, w, h)
      for (const p of parts) {
        p.vy += 0.18
        p.vx *= 0.99
        p.x += p.vx
        p.y += p.vy
        p.rot += p.vr
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillStyle = p.color
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66)
        ctx.restore()
      }
      if (now - t0 < 3200) {
        raf = requestAnimationFrame(frame)
      } else {
        ctx.clearRect(0, 0, w, h)
      }
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-[72]"
      style={{ width: '100vw', height: '100vh' }}
    />
  )
}
