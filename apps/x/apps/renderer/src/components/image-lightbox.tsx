import { useRef, useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Download, ExternalLink, X } from 'lucide-react'
import { cn } from '@/lib/utils'

const ZOOM_MAX = 8
/** What a click on the fitted image zooms to. */
const CLICK_ZOOM = 2.5

/** Translate clamp: the scaled image must always overlap its fitted box. */
function clampPan(value: number, extent: number, scale: number) {
  const max = ((scale - 1) * extent) / 2
  return Math.min(max, Math.max(-max, value))
}

/**
 * Zoomable image for lightboxes: scroll (or pinch) zooms toward the cursor,
 * click toggles fit ⇄ 2.5×, drag pans while zoomed. State lives here, so
 * closing the viewer (which unmounts it) resets the zoom.
 */
export function ZoomableImage({ src, alt, className, onError }: {
  src: string
  alt: string
  className?: string
  onError?: () => void
}) {
  const ref = useRef<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState({ s: 1, x: 0, y: 0 })
  const drag = useRef<{ id: number; startX: number; startY: number; x: number; y: number; moved: boolean } | null>(null)
  // A drag that actually moved must not fire the click toggle on release.
  const suppressClick = useRef(false)
  const [dragging, setDragging] = useState(false)

  /** Rescale around the cursor: the image point under it stays put. */
  const rescale = (z: { s: number; x: number; y: number }, nextScale: number, clientX: number, clientY: number) => {
    const s = Math.min(ZOOM_MAX, Math.max(1, nextScale))
    if (s === 1) return { s: 1, x: 0, y: 0 }
    const el = ref.current
    if (!el) return { ...z, s }
    const r = el.getBoundingClientRect()
    // Scaling is centre-origin, so the transformed rect's centre is the
    // untransformed centre + the translate.
    const px = clientX - (r.left + r.width / 2 - z.x)
    const py = clientY - (r.top + r.height / 2 - z.y)
    const k = s / z.s
    const w = r.width / z.s
    const h = r.height / z.s
    return { s, x: clampPan(px - k * (px - z.x), w, s), y: clampPan(py - k * (py - z.y), h, s) }
  }

  const onWheel = (e: React.WheelEvent) => {
    const factor = Math.exp(-e.deltaY * 0.002)
    setZoom((z) => rescale(z, z.s * factor, e.clientX, e.clientY))
  }
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    setZoom((z) => rescale(z, z.s > 1 ? 1 : CLICK_ZOOM, e.clientX, e.clientY))
  }
  const onPointerDown = (e: React.PointerEvent) => {
    if (zoom.s <= 1 || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, x: zoom.x, y: zoom.y, moved: false }
    setDragging(true)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true
    setZoom((z) => {
      const el = ref.current
      if (!el) return z
      const r = el.getBoundingClientRect()
      return { ...z, x: clampPan(d.x + dx, r.width / z.s, z.s), y: clampPan(d.y + dy, r.height / z.s, z.s) }
    })
  }
  const onPointerEnd = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    suppressClick.current = d.moved
    drag.current = null
    setDragging(false)
  }

  return (
    <img
      ref={ref}
      src={src}
      alt={alt}
      draggable={false}
      onError={onError}
      onWheel={onWheel}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      style={{ transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})`, willChange: 'transform' }}
      className={cn(
        'touch-none select-none',
        zoom.s === 1 ? 'cursor-zoom-in' : dragging ? 'cursor-grabbing' : 'cursor-grab',
        className,
      )}
    />
  )
}

/** Semi-transparent control overlaid on an image (inline hover row, lightbox). */
export function ImageOverlayButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/50 text-white transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
    >
      {children}
    </button>
  )
}

interface ImageLightboxProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Same src the inline image uses — already-loaded bytes, so no refetch. */
  src: string
  name: string
  onDownload: () => void
  onOpenInSystem: () => void
  onError?: () => void
}

// Full-bleed image viewer for inline chat images. Built on the same Radix
// dialog primitive as components/ui/dialog — focus trap, ESC and the portal
// come from it — but bare and dark instead of the card-style modal chrome.
// The content layer covers the viewport, so backdrop dismissal is a click on
// it; the image and control cluster stop propagation.
export function ImageLightbox({
  open,
  onOpenChange,
  src,
  name,
  onDownload,
  onOpenInSystem,
  onError,
}: ImageLightboxProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onClick={() => onOpenChange(false)}
          className="fixed inset-0 z-50 flex items-center justify-center outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        >
          <DialogPrimitive.Title className="sr-only">{name}</DialogPrimitive.Title>
          <ZoomableImage
            src={src}
            alt={name}
            onError={onError}
            className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain"
          />
          <div className="absolute right-4 top-4 flex items-center gap-1.5">
            <ImageOverlayButton label={`Download ${name}`} onClick={onDownload}>
              <Download className="h-3.5 w-3.5" />
            </ImageOverlayButton>
            <ImageOverlayButton label={`Open ${name} in the system viewer`} onClick={onOpenInSystem}>
              <ExternalLink className="h-3.5 w-3.5" />
            </ImageOverlayButton>
            <ImageOverlayButton label="Close image preview" onClick={() => onOpenChange(false)}>
              <X className="h-3.5 w-3.5" />
            </ImageOverlayButton>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
