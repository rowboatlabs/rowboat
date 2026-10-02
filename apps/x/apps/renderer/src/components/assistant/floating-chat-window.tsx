import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { GripHorizontal, Minus, X } from 'lucide-react'
import { fitWindow, type FloatingChat, type WindowSize } from '@/lib/assistant-layout'

/** Pegged to the bottom, so a window grows from its left edge and from the
 *  bar that appears above it on hover; the bar's left end is the corner. */
const handles = [
  ['w', 'left-0 top-0 bottom-0 w-2 cursor-w-resize'],
  ['nw', '-top-[21px] -left-px z-20 h-5 w-7 cursor-nw-resize opacity-0 group-hover/window:opacity-100 focus-visible:opacity-100'],
] as const

/** The grip in a window's hover bar or a minimized tab: drag it sideways (or
 *  press the arrow keys) to move the chat along the row. */
export function RowGrip({ className, ...handlers }: { className?: string } & Pick<React.HTMLAttributes<HTMLDivElement>, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onKeyDown'>) {
  return <div role="button" tabIndex={0} aria-label="Reorder chat" title="Drag to reorder"
    className={`flex cursor-grab touch-none items-center justify-center rounded px-2 text-muted-foreground hover:text-foreground focus-visible:outline-2 active:cursor-grabbing ${className ?? ''}`}
    {...handlers}><GripHorizontal className="size-4" /></div>
}

export function FloatingChatWindow({ entry, viewport, grip, children, onFocus, onSize, onResizePreview, onMinimize, onClose }: {
  entry: FloatingChat; viewport: WindowSize; grip: ReactNode; children: ReactNode
  onFocus: () => void; onSize: (size: WindowSize) => void; onMinimize: () => void; onClose: () => void
  onResizePreview: (id: string, size: WindowSize | null) => void
}) {
  const [dragSize, setDragSize] = useState<WindowSize | null>(null)
  const gesture = useRef<{ x: number; y: number; size: WindowSize; direction: string } | null>(null)
  const size = fitWindow(dragSize ?? entry, viewport.width, viewport.height)
  useEffect(() => () => onResizePreview(entry.id, null), [entry.id, onResizePreview])
  function start(event: PointerEvent<HTMLDivElement>, direction: string) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = { x: event.clientX, y: event.clientY, size, direction }
    onFocus()
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const from = gesture.current
    if (!from) return
    const next = { ...from.size }
    if (from.direction.includes('w')) next.width += from.x - event.clientX
    if (from.direction.includes('n')) next.height += from.y - event.clientY
    const preview = fitWindow(next, viewport.width, viewport.height)
    setDragSize(preview)
    onResizePreview(entry.id, preview)
  }
  function finish() {
    if (!gesture.current) return
    onSize(size)
    gesture.current = null
    setDragSize(null)
    onResizePreview(entry.id, null)
  }
  return <div
    role="region" aria-label="Floating chat" hidden={entry.minimized} data-floating-chat={entry.id} data-row-item={entry.id}
    className="group/window titlebar-no-drag pointer-events-auto relative flex shrink-0 flex-col rounded-t-xl transition-[border-radius] hover:rounded-t-none focus-within:rounded-t-none border-b-0 bg-background border border-black/10 shadow-[0_-6px_28px_-6px_rgba(0,0,0,0.28),0_0_0_1px_rgba(255,255,255,0.6)_inset] dark:border-white/15 dark:shadow-[0_-8px_32px_-6px_rgba(0,0,0,0.7),0_0_0_1px_rgba(255,255,255,0.04)_inset]"
    style={{ width: size.width, height: size.height, display: entry.minimized ? 'none' : undefined }}
    onPointerDown={onFocus}
    onKeyDown={(event) => {
      if ((event.target as HTMLElement).closest('[role="menu"], [role="dialog"], [role="listbox"]')) return
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); onMinimize() }
    }}
  >
    <span className="sr-only">Resize from the bar above, the left edge, or with arrow keys on a handle. Escape minimizes this chat.</span>
    {children}
    {/* Hover bar in the row's headroom, flush with the window's outer edge: the
        window's own controls. Drag it up or down to resize; its grip moves the
        window along the row; minimize and close sit at its right end. */}
    <div role="toolbar" aria-label="Floating chat controls" tabIndex={0}
      className="absolute -inset-x-px -top-[21px] z-10 flex h-5 cursor-n-resize touch-none items-center justify-center rounded-t-xl border border-b-0 border-black/10 bg-muted opacity-0 transition-opacity group-hover/window:opacity-100 focus-within:opacity-100 focus-visible:opacity-100 dark:border-white/15"
      onPointerDown={(event) => start(event, 'n')} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        const dh = event.key === 'ArrowUp' ? 20 : event.key === 'ArrowDown' ? -20 : 0
        if (!dh) return
        event.preventDefault()
        onSize(fitWindow({ width: size.width, height: size.height + dh }, viewport.width, viewport.height))
      }}>
      {grip}
      <div className="absolute inset-y-0 right-1 flex items-center" onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" aria-label="Minimize chat" title="Minimize" onClick={onMinimize} className="flex h-full w-6 cursor-default items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"><Minus className="size-3.5" /></button>
        <button type="button" aria-label="Close chat" title="Close — conversation stays in history" onClick={onClose} className="flex h-full w-6 cursor-default items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"><X className="size-3.5" /></button>
      </div>
    </div>
    {handles.map(([direction, className]) => <div key={direction}
      role="separator" aria-label={`Resize chat ${direction}`} tabIndex={0}
      className={`absolute z-10 touch-none ${className} hover:bg-primary/20 focus-visible:bg-primary/20 rounded-sm`}
      onPointerDown={(event) => start(event, direction)} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}
      onKeyDown={(event) => {
        // Arrow keys move the top-left corner: left/up grow, right/down shrink.
        const dw = event.key === 'ArrowLeft' ? 20 : event.key === 'ArrowRight' ? -20 : 0
        const dh = event.key === 'ArrowUp' ? 20 : event.key === 'ArrowDown' ? -20 : 0
        if (!dw && !dh) return
        event.preventDefault()
        onSize(fitWindow({ width: size.width + dw, height: size.height + dh }, viewport.width, viewport.height))
      }}
    >{direction === 'nw' && <span aria-hidden className="absolute left-2 top-1.5 size-2.5 rounded-tl-sm border-l-2 border-t-2 border-muted-foreground" />}</div>)}
  </div>
}
