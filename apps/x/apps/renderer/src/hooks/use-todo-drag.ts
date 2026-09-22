import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { TodoSectionAction, TodoSectionRef } from '@x/shared/dist/todo.js'

export type TodoDrag = { kind: 'section'; section: TodoSectionRef } | { kind: 'item'; key: string }
export type TodoDrop = { hint: string; action: TodoSectionAction }

/** Keep internal moves in the renderer, without an OS/native drag session. */
export function useTodoDrag(resolve: (source: TodoDrag, x: number, y: number) => TodoDrop | null, commit: (action: TodoSectionAction) => void, disabled: boolean) {
  const [dragged, setDragged] = useState<TodoDrag | null>(null)
  const [dropHint, setDropHint] = useState<string | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const callbacks = useRef({ resolve, commit })
  callbacks.current = { resolve, commit }
  useEffect(() => () => cleanupRef.current?.(), [])

  const dragProps = (source: TodoDrag) => ({
    draggable: false,
    style: { touchAction: 'none' } as const,
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (disabled || event.button !== 0 || event.isPrimary === false) return
      event.preventDefault()
      cleanupRef.current?.()
      const origin = { x: event.clientX, y: event.clientY }
      let point = origin
      let started = false
      let frame = 0
      const scroll = event.currentTarget.closest<HTMLElement>('[data-todo-scroll]')
      const update = () => setDropHint(callbacks.current.resolve(source, point.x, point.y)?.hint ?? null)
      const tick = () => {
        if (scroll) {
          const rect = scroll.getBoundingClientRect()
          if (point.x >= rect.left && point.x <= rect.right && point.y >= rect.top - 32 && point.y <= rect.bottom + 32) {
            const delta = point.y < rect.top + 40 ? -12 : point.y > rect.bottom - 40 ? 12 : 0
            if (delta) { scroll.scrollTop += delta; update() }
          }
        }
        frame = requestAnimationFrame(tick)
      }
      const cleanup = () => {
        document.removeEventListener('pointermove', move)
        document.removeEventListener('pointerup', up)
        document.removeEventListener('pointercancel', cancel)
        document.removeEventListener('keydown', key)
        window.removeEventListener('blur', cleanup)
        cancelAnimationFrame(frame)
        setDragged(null)
        setDropHint(null)
        cleanupRef.current = null
      }
      const move = (e: PointerEvent) => {
        if (e.pointerId !== event.pointerId) return
        point = { x: e.clientX, y: e.clientY }
        if (!started && Math.hypot(point.x - origin.x, point.y - origin.y) < 5) return
        e.preventDefault()
        if (!started) { started = true; setDragged(source); frame = requestAnimationFrame(tick) }
        update()
      }
      const up = (e: PointerEvent) => {
        if (e.pointerId !== event.pointerId) return
        const drop = started ? callbacks.current.resolve(source, e.clientX, e.clientY) : null
        cleanup()
        if (drop) callbacks.current.commit(drop.action)
      }
      const cancel = (e: PointerEvent) => { if (e.pointerId === event.pointerId) cleanup() }
      const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); cleanup() } }
      cleanupRef.current = cleanup
      document.addEventListener('pointermove', move, { passive: false })
      document.addEventListener('pointerup', up)
      document.addEventListener('pointercancel', cancel)
      document.addEventListener('keydown', key)
      window.addEventListener('blur', cleanup)
    },
  })
  return { dragged, dropHint, dragProps }
}
