import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { TTSState } from '@/hooks/useVoiceTTS'
import { cn } from '@/lib/utils'

const POSITION_STORAGE_KEY = 'talking-head-position'

// Must match the overlay's `bottom-28 right-8` anchor classes.
const ANCHOR_RIGHT_PX = 32
const ANCHOR_BOTTOM_PX = 112
const VIEWPORT_MARGIN_PX = 8

// Palette pulled from the mascot artwork: pale lavender body, dark walnut boat.
const BODY_FILL = '#E8E9F5'
const BODY_STROKE = '#17171B'
const CHEEK_FILL = '#F2B8BE'
const BOAT_DARK = '#3E2E24'
const BOAT_MID = '#54402F'
const BOAT_LIGHT = '#6B5138'
const MOUTH_FILL = '#2A1E19'

type TalkingHeadProps = {
  ttsState: TTSState
  getLevel: () => number
  size?: number
}

/**
 * The Rowboat mascot as an animated inline SVG: a round pale character sitting
 * in a wooden rowboat holding an oar. The mouth is driven every animation
 * frame from the live TTS audio level; eyes blink on a randomized timer.
 */
export function TalkingHead({ ttsState, getLevel, size = 160 }: TalkingHeadProps) {
  const mouthOpenRef = useRef<SVGEllipseElement>(null)
  const mouthSmileRef = useRef<SVGPathElement>(null)
  const oarRef = useRef<SVGGElement>(null)
  const smoothedRef = useRef(0)
  const [blinking, setBlinking] = useState(false)

  const speaking = ttsState === 'speaking'
  const thinking = ttsState === 'synthesizing'

  // Lip sync + oar paddle loop. Writes SVG attributes directly to avoid
  // re-rendering React at 60fps. Stops itself once speech has ended and the
  // mouth has settled closed; restarts when `speaking` flips this effect.
  useEffect(() => {
    let raf = 0
    let t = 0
    const tick = () => {
      const target = speaking ? getLevel() : 0
      const prev = smoothedRef.current
      // Fast attack, slower decay reads as natural mouth movement
      const smoothed = target > prev ? prev + (target - prev) * 0.5 : prev + (target - prev) * 0.2
      const settled = !speaking && smoothed < 0.005
      smoothedRef.current = settled ? 0 : smoothed
      const open = settled ? 0 : Math.min(1, smoothed * 1.6)

      const mouthOpen = mouthOpenRef.current
      const mouthSmile = mouthSmileRef.current
      if (mouthOpen && mouthSmile) {
        if (open > 0.06) {
          mouthOpen.setAttribute('rx', String(6.5 + open * 4))
          mouthOpen.setAttribute('ry', String(1.5 + open * 9))
          mouthOpen.style.opacity = '1'
          mouthSmile.style.opacity = '0'
        } else {
          mouthOpen.style.opacity = '0'
          mouthSmile.style.opacity = '1'
        }
      }

      const oar = oarRef.current
      if (oar) {
        if (speaking) {
          t += 0.045
          const angle = Math.sin(t) * 7
          oar.setAttribute('transform', `rotate(${angle.toFixed(2)} 128 118)`)
        } else {
          oar.setAttribute('transform', 'rotate(0 128 118)')
        }
      }

      if (!settled) {
        raf = requestAnimationFrame(tick)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [speaking, getLevel])

  // Randomized blinking
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>
    let cancelled = false
    const scheduleBlink = () => {
      timeout = setTimeout(() => {
        if (cancelled) return
        setBlinking(true)
        setTimeout(() => {
          if (cancelled) return
          setBlinking(false)
          scheduleBlink()
        }, 140)
      }, 2400 + Math.random() * 2600)
    }
    scheduleBlink()
    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [])

  return (
    <div
      className="talking-head-bob relative select-none"
      style={{
        width: size,
        height: size,
        animationDuration: speaking ? '1.6s' : '3.2s',
      }}
    >
      <style>{`
        @keyframes talking-head-bob {
          0%, 100% { transform: translateY(0) rotate(-1.6deg); }
          50% { transform: translateY(-4px) rotate(1.6deg); }
        }
        .talking-head-bob {
          animation-name: talking-head-bob;
          animation-timing-function: ease-in-out;
          animation-iteration-count: infinite;
        }
        @keyframes talking-head-ripple {
          0% { transform: scale(0.6); opacity: 0.5; }
          100% { transform: scale(1.25); opacity: 0; }
        }
        .talking-head-ripple {
          transform-origin: center;
          transform-box: fill-box;
          animation: talking-head-ripple 2.6s ease-out infinite;
        }
        @keyframes talking-head-bubble {
          0%, 100% { opacity: 0.25; transform: translateY(0); }
          50% { opacity: 1; transform: translateY(-2px); }
        }
        .talking-head-bubble {
          animation: talking-head-bubble 1.2s ease-in-out infinite;
        }
      `}</style>
      <svg viewBox="0 0 200 190" width={size} height={size} aria-hidden="true">
        {/* water ripples under the boat */}
        <g>
          <ellipse className="talking-head-ripple" cx="100" cy="168" rx="62" ry="9" fill="none" stroke="#8FB6D9" strokeWidth="2" style={{ animationDelay: '0s' }} />
          <ellipse className="talking-head-ripple" cx="100" cy="168" rx="62" ry="9" fill="none" stroke="#8FB6D9" strokeWidth="2" style={{ animationDelay: '1.3s' }} />
          <ellipse cx="100" cy="168" rx="52" ry="7" fill="#8FB6D9" opacity="0.18" />
        </g>

        {/* thinking bubbles while synthesizing */}
        {thinking && (
          <g fill={BODY_STROKE} opacity="0.75">
            <circle className="talking-head-bubble" cx="146" cy="34" r="3" style={{ animationDelay: '0s' }} />
            <circle className="talking-head-bubble" cx="157" cy="26" r="4.2" style={{ animationDelay: '0.2s' }} />
            <circle className="talking-head-bubble" cx="170" cy="16" r="5.4" style={{ animationDelay: '0.4s' }} />
          </g>
        )}

        {/* character: head + body blob */}
        <g>
          <path
            d="M 100 22
               C 129 22 148 43 148 68
               C 148 82 141 93 131 100
               C 141 107 147 117 148 128
               L 52 128
               C 53 115 60 105 69 99
               C 59 92 52 81 52 68
               C 52 43 71 22 100 22 Z"
            fill={BODY_FILL}
            stroke={BODY_STROKE}
            strokeWidth="5"
            strokeLinejoin="round"
          />
          {/* eyes */}
          <g style={{ transform: thinking ? 'translateY(-2.5px)' : undefined, transition: 'transform 0.3s' }}>
            <ellipse
              cx="84" cy="64" rx="5" ry={blinking ? 0.8 : 7}
              fill={BODY_STROKE}
              style={{ transition: 'ry 0.06s' }}
            />
            <ellipse
              cx="116" cy="64" rx="5" ry={blinking ? 0.8 : 7}
              fill={BODY_STROKE}
              style={{ transition: 'ry 0.06s' }}
            />
            <circle cx="86" cy="61" r="1.6" fill="#FFFFFF" opacity={blinking ? 0 : 0.9} />
            <circle cx="118" cy="61" r="1.6" fill="#FFFFFF" opacity={blinking ? 0 : 0.9} />
          </g>
          {/* cheeks */}
          <ellipse cx="72" cy="76" rx="6.5" ry="4" fill={CHEEK_FILL} opacity="0.85" />
          <ellipse cx="128" cy="76" rx="6.5" ry="4" fill={CHEEK_FILL} opacity="0.85" />
          {/* mouth: smile when quiet, open ellipse driven by audio level */}
          <path
            ref={mouthSmileRef}
            d="M 91 80 Q 100 88 109 80"
            fill="none"
            stroke={BODY_STROKE}
            strokeWidth="4"
            strokeLinecap="round"
          />
          <ellipse
            ref={mouthOpenRef}
            cx="100" cy="84" rx="7" ry="2"
            fill={MOUTH_FILL}
            stroke={BODY_STROKE}
            strokeWidth="3"
            style={{ opacity: 0 }}
          />
        </g>

        {/* oar (rotates while speaking) */}
        <g ref={oarRef}>
          <line x1="158" y1="88" x2="88" y2="152" stroke={BODY_STROKE} strokeWidth="12" strokeLinecap="round" />
          <line x1="158" y1="88" x2="88" y2="152" stroke={BOAT_MID} strokeWidth="7" strokeLinecap="round" />
          <path
            d="M 84 148 L 56 170 C 52 173 52 178 57 178 L 90 165 Z"
            fill={BOAT_DARK}
            stroke={BODY_STROKE}
            strokeWidth="4"
            strokeLinejoin="round"
          />
        </g>

        {/* hand resting over the oar */}
        <ellipse cx="121" cy="120" rx="10" ry="8" fill={BODY_FILL} stroke={BODY_STROKE} strokeWidth="4" />

        {/* boat hull (drawn last so it overlaps the body) */}
        <g>
          <path
            d="M 30 120
               C 50 132 150 132 170 120
               C 168 142 152 160 100 160
               C 48 160 32 142 30 120 Z"
            fill={BOAT_MID}
            stroke={BODY_STROKE}
            strokeWidth="5"
            strokeLinejoin="round"
          />
          {/* plank lines */}
          <path d="M 36 133 C 60 143 140 143 164 133" fill="none" stroke={BOAT_DARK} strokeWidth="3" strokeLinecap="round" />
          <path d="M 44 145 C 66 153 134 153 156 145" fill="none" stroke={BOAT_DARK} strokeWidth="3" strokeLinecap="round" />
          {/* gunwale highlight */}
          <path d="M 33 121 C 52 131 148 131 167 121" fill="none" stroke={BOAT_LIGHT} strokeWidth="4" strokeLinecap="round" />
        </g>
      </svg>
    </div>
  )
}

type TalkingHeadOverlayProps = {
  ttsState: TTSState
  getLevel: () => number
  onDismiss?: () => void
}

// Keep the widget fully on-screen relative to its bottom-right CSS anchor.
// Falls back to the default render size when the element isn't mounted yet.
function clampPositionToViewport(pos: { x: number; y: number }, el: HTMLDivElement | null): { x: number; y: number } {
  const width = el?.offsetWidth ?? 160
  const height = el?.offsetHeight ?? 160
  const baseLeft = window.innerWidth - ANCHOR_RIGHT_PX - width
  const baseTop = window.innerHeight - ANCHOR_BOTTOM_PX - height
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
  return {
    x: clamp(pos.x, VIEWPORT_MARGIN_PX - baseLeft, window.innerWidth - VIEWPORT_MARGIN_PX - width - baseLeft),
    y: clamp(pos.y, VIEWPORT_MARGIN_PX - baseTop, window.innerHeight - VIEWPORT_MARGIN_PX - height - baseTop),
  }
}

function loadStoredPosition(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(POSITION_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
        return parsed
      }
    }
  } catch {
    // ignore corrupt stored position
  }
  return { x: 0, y: 0 }
}

/**
 * Floating, draggable widget that hosts the talking head. Anchored to the
 * bottom-right of the window (above the composer) and offset by a persisted
 * drag position, so it hovers over whatever view is active.
 */
export function TalkingHeadOverlay({ ttsState, getLevel, onDismiss }: TalkingHeadOverlayProps) {
  // Clamp the stored offset at init so a stale position (e.g. saved on a
  // bigger window) can't leave the widget stranded off-screen.
  const [offset, setOffset] = useState(() => clampPositionToViewport(loadStoredPosition(), null))
  const [dragging, setDragging] = useState(false)
  const dragStartRef = useRef<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const clampToViewport = useCallback(
    (pos: { x: number; y: number }) => clampPositionToViewport(pos, containerRef.current),
    []
  )

  // Re-clamp when the window shrinks
  useEffect(() => {
    const handleResize = () => setOffset(prev => clampToViewport(prev))
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [clampToViewport])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    dragStartRef.current = { pointerX: e.clientX, pointerY: e.clientY, x: offset.x, y: offset.y }
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [offset])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current
    if (!start) return
    setOffset({
      x: start.x + (e.clientX - start.pointerX),
      y: start.y + (e.clientY - start.pointerY),
    })
  }, [])

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return
    dragStartRef.current = null
    setDragging(false)
    setOffset(prev => clampToViewport(prev))
    e.currentTarget.releasePointerCapture(e.pointerId)
  }, [clampToViewport])

  useEffect(() => {
    if (dragging) return
    try {
      localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(offset))
    } catch {
      // best-effort persistence
    }
  }, [offset, dragging])

  return (
    <div
      ref={containerRef}
      className={cn(
        'group fixed bottom-28 right-8 z-50 touch-none',
        dragging ? 'cursor-grabbing' : 'cursor-grab'
      )}
      style={{
        transform: `translate(${offset.x}px, ${offset.y}px)`,
        // Constant value so the entrance animation runs once on mount and
        // never restarts (re-applying it after a drag would replay the pop).
        animation: 'talking-head-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      role="img"
      aria-label="Rowboat talking head"
    >
      <style>{`
        @keyframes talking-head-pop {
          0% { opacity: 0; scale: 0.4; }
          100% { opacity: 1; scale: 1; }
        }
      `}</style>
      {onDismiss && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onDismiss}
          className="absolute -right-1 -top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground group-hover:opacity-100"
          aria-label="Hide talking head"
        >
          <X className="h-3 w-3" />
        </button>
      )}
      <TalkingHead ttsState={ttsState} getLevel={getLevel} />
    </div>
  )
}

/** Small static mascot face used as the toolbar toggle icon. */
export function MascotFaceIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <ellipse cx="8.6" cy="10.5" rx="1.3" ry="1.8" fill="currentColor" />
      <ellipse cx="15.4" cy="10.5" rx="1.3" ry="1.8" fill="currentColor" />
      <path d="M 9 14.5 Q 12 17 15 14.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}
