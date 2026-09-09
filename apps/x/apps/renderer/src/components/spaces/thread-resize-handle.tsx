import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export const THREAD_MIN_WIDTH = 360
export const THREAD_DEFAULT_WIDTH = 400
export const THREAD_DIVIDER_WIDTH = 6
export const STREAM_MIN_WIDTH = 440

export function ThreadResizeHandle({ width, maxWidth, onResize, onCommit }: {
    width: number
    maxWidth: number
    onResize: (width: number) => void
    onCommit: (width: number) => void
}) {
    const drag = useRef<{ x: number; width: number; current: number } | null>(null)
    const [dragging, setDragging] = useState(false)
    const clamp = (value: number) => Math.round(Math.max(THREAD_MIN_WIDTH, Math.min(maxWidth, value)))
    const finish = () => {
        if (!drag.current) return
        onCommit(clamp(drag.current.current))
        drag.current = null
        setDragging(false)
    }

    return (
        <div
            role="separator"
            aria-label="Resize thread pane"
            aria-orientation="vertical"
            aria-valuemin={THREAD_MIN_WIDTH}
            aria-valuemax={maxWidth}
            aria-valuenow={width}
            aria-valuetext={`${width} pixels`}
            tabIndex={0}
            title="Drag to resize thread · Arrow keys to adjust · Double-click to reset"
            className={cn(
                'relative z-10 w-1.5 shrink-0 cursor-col-resize touch-none select-none border-l border-border hover:bg-primary/20 focus-visible:bg-primary/20 focus-visible:outline-2 focus-visible:outline-primary',
                dragging && 'bg-primary/30',
            )}
            onPointerDown={(event) => {
                if (event.button !== 0) return
                event.preventDefault()
                event.currentTarget.focus()
                event.currentTarget.setPointerCapture(event.pointerId)
                drag.current = { x: event.clientX, width, current: width }
                setDragging(true)
            }}
            onPointerMove={(event) => {
                if (!drag.current) return
                const next = clamp(drag.current.width + drag.current.x - event.clientX)
                drag.current.current = next
                onResize(next)
            }}
            onPointerUp={finish}
            onPointerCancel={finish}
            onLostPointerCapture={finish}
            onDoubleClick={() => {
                const next = clamp(THREAD_DEFAULT_WIDTH)
                onResize(next)
                onCommit(next)
            }}
            onKeyDown={(event) => {
                const step = event.shiftKey ? 40 : 10
                const next = event.key === 'ArrowLeft' ? width + step
                    : event.key === 'ArrowRight' ? width - step
                    : event.key === 'Home' ? THREAD_MIN_WIDTH
                    : event.key === 'End' ? maxWidth : null
                if (next === null) return
                event.preventDefault()
                onResize(clamp(next))
                onCommit(clamp(next))
            }}
        />
    )
}
