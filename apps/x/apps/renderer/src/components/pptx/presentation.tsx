import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from 'lucide-react'
import type { Slide } from '@/lib/pptx/types'
import { SlideThumbnail } from './canvas'

/** How long the control bar lingers after the pointer stops moving. */
const CONTROLS_HIDE_MS = 2000

function ControlButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      // Keep focus on the overlay so the arrow keys keep working.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="inline-flex size-7 items-center justify-center rounded-full text-neutral-200 transition-colors hover:bg-white/15 disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  )
}

interface PresentationOverlayProps {
  slides: Slide[]
  sizeEmu: { w: number; h: number }
  /** Slide to open on — whichever one the editor had selected. */
  startIndex: number
  onExit: () => void
}

/**
 * Full-screen slideshow. Renders through the same inert `SlideThumbnail`
 * pipeline the canvas and the rail use, so what you present is exactly what the
 * editor draws — just scaled to the viewport, with no editing chrome.
 *
 * Portaled to `document.body` so it escapes the editor's stacking context, and
 * it stops its own pointer/key events from reaching the editor underneath.
 */
export function PresentationOverlay({
  slides,
  sizeEmu,
  startIndex,
  onExit,
}: PresentationOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const last = slides.length - 1
  const [index, setIndex] = useState(() => Math.min(Math.max(startIndex, 0), Math.max(last, 0)))
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [controlsOn, setControlsOn] = useState(true)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Held in a ref so the fullscreen effect can stay mount-only.
  const onExitRef = useRef(onExit)
  useEffect(() => {
    onExitRef.current = onExit
  }, [onExit])

  const go = useCallback((to: number) => setIndex(Math.min(last, Math.max(0, to))), [last])
  // Clamped, not wrapped: the deck stops at both ends.
  const step = useCallback(
    (delta: number) => setIndex((i) => Math.min(last, Math.max(0, i + delta))),
    [last],
  )

  // Focus for keyboard control, measure for fit, and hand focus back on exit.
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const previous = document.activeElement as HTMLElement | null
    el.focus({ preventScroll: true })
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => {
      observer.disconnect()
      previous?.focus?.({ preventScroll: true })
    }
  }, [])

  // Real fullscreen when the platform allows it; the fixed overlay is already a
  // complete fallback, so a rejection is not an error.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    let entered = false
    void Promise.resolve(el.requestFullscreen?.())
      .then(() => {
        entered = document.fullscreenElement === el
      })
      .catch(() => {})
    // Esc inside real fullscreen is eaten by the browser, so leaving fullscreen
    // is what ends the presentation.
    const onFullscreenChange = () => {
      if (entered && document.fullscreenElement === null) onExitRef.current()
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      if (entered && document.fullscreenElement !== null) {
        void document.exitFullscreen().catch(() => {})
      }
    }
  }, [])

  const bumpControls = useCallback(() => {
    setControlsOn(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => setControlsOn(false), CONTROLS_HIDE_MS)
  }, [])

  // The bar starts visible and fades on its own; a mouse move brings it back.
  useEffect(() => {
    hideTimerRef.current = setTimeout(() => setControlsOn(false), CONTROLS_HIDE_MS)
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    }
  }, [])

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // Nothing reaches the editor's shortcuts while presenting.
    e.stopPropagation()
    let handled = true
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') step(1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') step(-1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(last)
    else if (e.key === 'Escape') onExit()
    else handled = false
    if (handled) e.preventDefault()
  }

  // Fit the deck's page into the viewport, preserving its aspect ratio.
  const scale =
    box.w > 0 && box.h > 0 ? Math.min(box.w / sizeEmu.w, box.h / sizeEmu.h) : 0
  const current = slides[index]

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Presentation, slide ${index + 1} of ${slides.length}`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onMouseMove={bumpControls}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => step(1)}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black outline-none"
    >
      {current && scale > 0 && (
        <SlideThumbnail slide={current} sizeEmu={sizeEmu} widthPx={sizeEmu.w * scale} />
      )}

      <div
        onClick={(e) => e.stopPropagation()}
        className={`absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-white/10 bg-neutral-900/80 px-1.5 py-1 shadow-lg backdrop-blur transition-opacity duration-300 ${
          controlsOn ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <ControlButton label="Previous slide" onClick={() => step(-1)} disabled={index === 0}>
          <ChevronLeftIcon className="size-4" />
        </ControlButton>
        <span className="px-1.5 text-xs tabular-nums text-neutral-300">
          {index + 1} of {slides.length}
        </span>
        <ControlButton label="Next slide" onClick={() => step(1)} disabled={index === last}>
          <ChevronRightIcon className="size-4" />
        </ControlButton>
        <span className="mx-1 h-4 w-px bg-white/15" aria-hidden="true" />
        <ControlButton label="Exit presentation" onClick={onExit}>
          <XIcon className="size-4" />
        </ControlButton>
      </div>
    </div>,
    document.body,
  )
}
