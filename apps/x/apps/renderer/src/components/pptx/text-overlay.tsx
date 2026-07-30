import { useCallback, useEffect, useRef, type CSSProperties } from 'react'
import type { EditedParagraph } from '@/lib/pptx/serialize'
import type { TextShape } from '@/lib/pptx/types'
import { buildEditableHtml, extractParagraphs, type TextOverlayHandle } from './text-dom'

interface TextEditOverlayProps {
  shape: TextShape
  scale: number
  style: CSSProperties
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
  onAttach,
  onCommit,
}: TextEditOverlayProps) {
  const ref = useRef<HTMLDivElement>(null)
  const committedRef = useRef(false)
  const htmlRef = useRef<string | null>(null)
  if (htmlRef.current === null) htmlRef.current = buildEditableHtml(shape, scale)

  const commit = useCallback(() => {
    if (committedRef.current) return
    committedRef.current = true
    onCommit(ref.current ? extractParagraphs(ref.current, shape, scale) : null)
  }, [onCommit, shape, scale])

  // Focus on open; commit on unmount so switching slides can't drop an edit.
  useEffect(() => {
    const el = ref.current
    if (el) {
      el.focus()
      const sel = window.getSelection()
      if (sel) {
        sel.selectAllChildren(el)
        sel.collapseToEnd()
      }
      onAttach({ root: el, scale, shape })
    }
    return () => {
      onAttach(null)
      commit()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      dangerouslySetInnerHTML={{ __html: htmlRef.current }}
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
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{ ...style, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
      className="z-20 cursor-text overflow-hidden whitespace-pre-wrap outline-2 outline-offset-1 outline-[var(--ring)]"
    />
  )
}
