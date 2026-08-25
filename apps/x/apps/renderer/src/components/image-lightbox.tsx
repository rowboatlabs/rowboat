import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Download, ExternalLink, X } from 'lucide-react'

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
          <img
            src={src}
            alt={name}
            onClick={(e) => e.stopPropagation()}
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
