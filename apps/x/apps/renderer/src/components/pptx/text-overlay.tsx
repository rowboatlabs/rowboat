import { useCallback, useEffect, useRef, type CSSProperties } from 'react'
import type { EditedParagraph } from '@x/shared/dist/pptx/serialize.js'
import type { TextShape } from '@x/shared/dist/pptx/types.js'
import {
  anchorJustify,
  buildEditableHtml,
  caretSelectionAtPoint,
  extractParagraphs,
  type CaretTarget,
  type TextOverlayHandle,
} from './text-dom'

interface TextEditOverlayProps {
  shape: TextShape
  scale: number
  style: CSSProperties
  /** Where the click landed; falls back to the end of the text when absent. */
  caretAt?: CaretTarget | null
  onAttach: (handle: TextOverlayHandle | null) => void
  onCommit: (next: EditedParagraph[] | null) => void
}

/**
 * The contentEditable surface for one text box. Content is built once per
 * editing session — re-rendering it would clobber what the user has typed and
 * reset the caret — and read back through `extractParagraphs` on the way out.
 */
export function TextEditOverlay({
  shape,
  scale,
  style,
  caretAt,
  onAttach,
  onCommit,
}: TextEditOverlayProps) {
  const ref = useRef<HTMLDivElement>(null)
  const committedRef = useRef(false)
  // False between an unmount's cleanup and a possible StrictMode re-setup.
  const aliveRef = useRef(false)
  // The whole {__html} object is cached, not just the string. React 19 diffs
  // dangerouslySetInnerHTML by object identity, so an inline `{{__html}}`
  // makes every parent re-render rewrite innerHTML — destroying the text
  // nodes the selection lives in. The toolbar bumps a selection tick on every
  // selectionchange while editing, so that rewrite would fire on every caret
  // move and typing session: the caret snaps to the start of the box and
  // edits are wiped. A stable object means React never touches the content
  // after mount.
  const htmlRef = useRef<{ __html: string } | null>(null)
  if (htmlRef.current === null) htmlRef.current = { __html: buildEditableHtml(shape, scale) }

  const commitFrom = useCallback(
    (el: HTMLElement | null) => {
      if (committedRef.current) return
      committedRef.current = true
      onCommit(el ? extractParagraphs(el, shape, scale) : null)
    },
    [onCommit, shape, scale],
  )
  const commit = useCallback(() => commitFrom(ref.current), [commitFrom])

  // Focus on open; commit on unmount so switching slides can't drop an edit.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Re-arm: dev StrictMode runs this effect, its cleanup, then this again on
    // mount. A commit from that simulated unmount would close the editor the
    // moment it opens (onCommit clears editingKey) and latch committedRef so
    // the real commit later becomes a no-op — text edits would never land.
    aliveRef.current = true
    committedRef.current = false
    // Resolve the click BEFORE focusing: focus scrolls the editable into view,
    // which moves the text out from under the coordinates it was captured at.
    const clicked = caretAt ? caretSelectionAtPoint(el, caretAt) : null
    el.focus({ preventScroll: true })
    const sel = window.getSelection()
    if (sel) {
      if (clicked !== null) {
        sel.removeAllRanges()
        sel.addRange(clicked)
      } else {
        sel.selectAllChildren(el)
        sel.collapseToEnd()
      }
    }
    onAttach({ root: el, scale, shape })
    return () => {
      aliveRef.current = false
      onAttach(null)
      // Defer one microtask: a StrictMode re-setup flips aliveRef back first
      // and the commit is skipped; on a real unmount it goes through. `el` is
      // captured because React nulls the ref before this cleanup runs, and the
      // detached node still holds the text to commit.
      queueMicrotask(() => {
        if (!aliveRef.current) commitFrom(el)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The flex anchoring lives on a NON-editable wrapper. Chromium cannot drive
  // a native caret inside a flex-container contentEditable: clicks anchor the
  // selection on the container instead of a text node and arrow keys cannot
  // move it, so the caret pins to the start of the box. The editable itself
  // must be a plain block. Anchoring mirrors TextShapeView so the text does
  // not jump when the editor opens.
  return (
    <div
      style={{
        ...style,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: anchorJustify(shape.display?.anchor),
      }}
      className="z-20 cursor-text outline-2 outline-offset-1 outline-[var(--ring)]"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => {
        // A press on the empty band above/below the text would move focus out
        // of the editable and blur-commit the session; keep the focus put.
        if (e.target === e.currentTarget) e.preventDefault()
      }}
      onClick={(e) => {
        e.stopPropagation()
        // Band click: the editable doesn't cover it, so the browser places no
        // caret. Snap to the nearest character instead.
        const el = ref.current
        if (e.target === e.currentTarget && el) {
          const range = caretSelectionAtPoint(el, { x: e.clientX, y: e.clientY, selectWord: false })
          const sel = window.getSelection()
          if (range && sel) {
            sel.removeAllRanges()
            sel.addRange(range)
          }
          el.focus({ preventScroll: true })
        }
      }}
    >
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        dangerouslySetInnerHTML={htmlRef.current}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            commit()
            return
          }
          // Let the browser own undo inside the text box, and keep app-level
          // shortcuts away from typing.
          e.stopPropagation()
        }}
        className="w-full whitespace-pre-wrap outline-none"
      />
    </div>
  )
}
