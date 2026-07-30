import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { ExternalLinkIcon, Loader2Icon, PresentationIcon } from 'lucide-react'
import { toast } from 'sonner'
import { disposeDeck, parsePptx } from '@/lib/pptx/parse'
import { writeDeck, type EditedParagraph, type RunFormatOverrides } from '@/lib/pptx/serialize'
import type { NodePath, Paragraph, Shape, Slide, SlideDeck, TextAlign, TextShape } from '@/lib/pptx/types'
import {
  EMPTY_EDIT_SET,
  EMU_PER_PX,
  acceptsFormatting,
  applyEditSet,
  hasEdits,
  runKeyOf,
  shapeKeyOf,
  structureMatches,
  toSlideEdits,
  withShapeEdit,
  type EditSet,
  type RectEmuBox,
  type ShapeKey,
} from '@/components/pptx/edit-model'
import { SlideCanvas, SlideThumbnail } from '@/components/pptx/canvas'
import {
  EditorToolbar,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEPS,
  type SaveStatus,
} from '@/components/pptx/toolbar'
import {
  DEFAULT_TEXT_PT,
  aggregateFormat,
  aggregateFormatOfParagraphs,
  applyAlignToBlocks,
  applyFormatToSpans,
  selectedParagraphBlocks,
  selectedRunSpans,
  type TextOverlayHandle,
} from '@/components/pptx/text-dom'

interface PptxEditorProps {
  path: string
}

type LoadState = 'loading' | 'ready' | 'error'

const SAVE_DEBOUNCE_MS = 800
const MAX_HISTORY = 100

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function baseName(path: string): string {
  const segs = path.split('/')
  return segs[segs.length - 1] || path
}

/** First non-empty line of text on a slide, used to label its rail card. */
function slideTitle(slide: Slide): string | null {
  for (const shape of slide.shapes) {
    if (shape.type !== 'text') continue
    for (const para of shape.paragraphs) {
      const line = para.runs.map((r) => r.text).join('').trim()
      if (line) return line
    }
  }
  return null
}

function findShape(slide: Slide | null, key: ShapeKey | null): Shape | undefined {
  if (!slide || !key) return undefined
  return slide.shapes.find((s) => shapeKeyOf(slide.xmlPath, s.nodePath) === key)
}

function baseParagraphsOf(
  base: SlideDeck | null,
  slidePath: string,
  nodePath: NodePath,
): Paragraph[] | undefined {
  const slide = base?.slides.find((s) => s.xmlPath === slidePath)
  const shape = slide?.shapes.find((s) => s.nodePath.join('.') === nodePath.join('.'))
  return shape?.type === 'text' ? shape.paragraphs : undefined
}

/** Structure + text only; formatting is compared separately. */
function textSignature(paras: readonly { runs: readonly { text: string }[] }[]): string {
  return JSON.stringify(paras.map((p) => p.runs.map((r) => r.text)))
}

export function PptxEditor({ path }: PptxEditorProps) {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [baseDeck, setBaseDeck] = useState<SlideDeck | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [selectedKey, setSelectedKey] = useState<ShapeKey | null>(null)
  const [editingKey, setEditingKey] = useState<ShapeKey | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('clean')
  const [zoomMode, setZoomMode] = useState<'fit' | number>('fit')
  const [zoomPercent, setZoomPercent] = useState(100)
  const [selectionTick, setSelectionTick] = useState(0)

  const [history, setHistory] = useState<EditSet[]>([EMPTY_EDIT_SET])
  const [histIndex, setHistIndex] = useState(0)
  const editSet = history[histIndex] ?? EMPTY_EDIT_SET

  const rootRef = useRef<HTMLDivElement>(null)
  const baseDeckRef = useRef<SlideDeck | null>(null)
  const editSetRef = useRef<EditSet>(EMPTY_EDIT_SET)
  const histIndexRef = useRef(0)
  const overlayRef = useRef<TextOverlayHandle | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savingRef = useRef(false)
  const pendingRef = useRef(false)
  const dirtyRef = useRef(false)
  const lastWrittenRef = useRef<string | null>(null)

  useEffect(() => {
    editSetRef.current = editSet
  }, [editSet])
  useEffect(() => {
    histIndexRef.current = histIndex
  }, [histIndex])

  // ------------------------------------------------------------- persistence

  const persist = useCallback(async () => {
    const base = baseDeckRef.current
    if (!base) return
    if (savingRef.current) {
      pendingRef.current = true
      return
    }
    savingRef.current = true
    try {
      const edits = editSetRef.current
      if (!hasEdits(edits) && lastWrittenRef.current === null) {
        setSaveStatus('clean')
        return
      }
      const bytes = await writeDeck(base, toSlideEdits(edits))
      const b64 = uint8ArrayToBase64(bytes)
      if (b64 !== lastWrittenRef.current) {
        await window.ipc.invoke('workspace:writeFile', {
          path,
          data: b64,
          opts: { encoding: 'base64' },
        })
        lastWrittenRef.current = b64
      }
      dirtyRef.current = false
      setSaveStatus('saved')
    } catch (err) {
      console.error('Failed to save pptx:', err)
      setSaveStatus('error')
    } finally {
      savingRef.current = false
      if (pendingRef.current) {
        pendingRef.current = false
        scheduleSave()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true
    setSaveStatus('saving')
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      void persist()
    }, SAVE_DEBOUNCE_MS)
  }, [persist])

  /** Commits a new edit set: pushes onto the undo stack and schedules a save. */
  const pushEdits = useCallback(
    (next: EditSet) => {
      setHistory((h) => {
        const trimmed = [...h.slice(0, histIndexRef.current + 1), next]
        return trimmed.length > MAX_HISTORY ? trimmed.slice(trimmed.length - MAX_HISTORY) : trimmed
      })
      setHistIndex((i) => Math.min(i + 1, MAX_HISTORY - 1))
      editSetRef.current = next
      scheduleSave()
    },
    [scheduleSave],
  )

  // Flush pending edits on unmount / path change, before blob URLs are revoked.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      if (dirtyRef.current) void persist()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  // App.tsx keys this component by path, so a different file is a fresh mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const result = await window.ipc.invoke('workspace:readFile', { path, encoding: 'base64' })
        const parsed = await parsePptx(base64ToUint8Array(result.data))
        if (cancelled) {
          disposeDeck(parsed)
          return
        }
        baseDeckRef.current = parsed
        setBaseDeck(parsed)
        setLoadState('ready')
      } catch (err) {
        console.error('Failed to open pptx:', err)
        if (!cancelled) setLoadState('error')
      }
    })()
    return () => {
      cancelled = true
      if (baseDeckRef.current) disposeDeck(baseDeckRef.current)
    }
  }, [path])

  // ------------------------------------------------------------ derived deck

  const deck = useMemo(
    () => (baseDeck ? applyEditSet(baseDeck, editSet) : null),
    [baseDeck, editSet],
  )
  const slide = deck?.slides[activeIndex] ?? null
  const selectedShape = findShape(slide, selectedKey)
  const shapeEdit = selectedKey ? editSet[selectedKey] : undefined

  // ------------------------------------------------------------ undo / redo

  const canUndo = histIndex > 0
  const canRedo = histIndex < history.length - 1

  const undo = useCallback(() => {
    if (histIndexRef.current <= 0) return
    const next = histIndexRef.current - 1
    histIndexRef.current = next
    editSetRef.current = history[next] ?? EMPTY_EDIT_SET
    setHistIndex(next)
    setEditingKey(null)
    scheduleSave()
  }, [history, scheduleSave])

  const redo = useCallback(() => {
    if (histIndexRef.current >= history.length - 1) return
    const next = histIndexRef.current + 1
    histIndexRef.current = next
    editSetRef.current = history[next] ?? EMPTY_EDIT_SET
    setHistIndex(next)
    setEditingKey(null)
    scheduleSave()
  }, [history, scheduleSave])

  // ----------------------------------------------------------- edit commits

  const seedFor = useCallback(
    (slidePath: string, shape: Shape) => ({
      slidePath,
      nodePath: shape.nodePath,
      original:
        shape.type === 'text'
          ? baseParagraphsOf(baseDeckRef.current, slidePath, shape.nodePath)
          : undefined,
    }),
    [],
  )

  const handleGeometryCommit = useCallback(
    (shape: Shape, rect: RectEmuBox) => {
      if (!slide) return
      // The serializer writes geometry only for sp/pic/cxnSp. graphicFrame and
      // group placeholders would fail the whole save closed, so their drags
      // snap back instead of committing.
      if (shape.type === 'placeholder' && shape.kind !== 'video') return
      const key = shapeKeyOf(slide.xmlPath, shape.nodePath)
      pushEdits(
        withShapeEdit(editSetRef.current, key, seedFor(slide.xmlPath, shape), (draft) => {
          draft.geometry = rect
        }),
      )
    },
    [slide, pushEdits, seedFor],
  )

  const handleTextCommit = useCallback(
    (shape: TextShape, next: EditedParagraph[] | null) => {
      setEditingKey(null)
      if (!next || !slide) return
      const key = shapeKeyOf(slide.xmlPath, shape.nodePath)
      const original = baseParagraphsOf(baseDeckRef.current, slide.xmlPath, shape.nodePath)
      if (!original) return

      // The text edit carries ORIGINAL formatting so it stays on the
      // in-place splice path; formatting travels as formatRuns / aligns.
      const textNext: EditedParagraph[] = next.map((p) => ({
        align: p.srcPara !== undefined ? original[p.srcPara]?.align : p.align,
        srcPara: p.srcPara,
        runs: p.runs.map((r) => {
          const src =
            r.srcPara !== undefined && r.srcRun !== undefined
              ? original[r.srcPara]?.runs[r.srcRun]
              : undefined
          return {
            text: r.text,
            srcPara: r.srcPara,
            srcRun: r.srcRun,
            bold: src?.bold,
            italic: src?.italic,
            underline: src?.underline,
            sizePt: src?.sizePt,
            colorHex: src?.colorHex,
          }
        }),
      }))

      const structural = !structureMatches(original, textNext)
      const textChanged = textSignature(textNext) !== textSignature(original)

      // Formatting is only addressable while the structure still lines up.
      const formats: Record<string, RunFormatOverrides> = {}
      const aligns: Record<string, TextAlign> = {}
      if (!structural) {
        next.forEach((p, pi) => {
          const srcPara = original[pi]
          if (!srcPara) return
          if (p.align && p.align !== srcPara.align) aligns[String(pi)] = p.align
          p.runs.forEach((r, ri) => {
            if (r.text === '\n') return
            const src = srcPara.runs[ri]
            if (!src) return
            const delta: RunFormatOverrides = {}
            if (Boolean(r.bold) !== Boolean(src.bold)) delta.bold = Boolean(r.bold)
            if (Boolean(r.italic) !== Boolean(src.italic)) delta.italic = Boolean(r.italic)
            if (Boolean(r.underline) !== Boolean(src.underline)) delta.underline = Boolean(r.underline)
            if ((r.sizePt ?? null) !== (src.sizePt ?? null) && r.sizePt !== undefined) {
              delta.sizePt = r.sizePt
            }
            if ((r.colorHex ?? null) !== (src.colorHex ?? null) && r.colorHex !== undefined) {
              delta.colorHex = r.colorHex
            }
            if (Object.keys(delta).length > 0) formats[runKeyOf(pi, ri)] = delta
          })
        })
      }

      const previous = editSetRef.current[key]
      const hadFormatting =
        Boolean(previous?.formats && Object.keys(previous.formats).length) ||
        Boolean(previous?.aligns && Object.keys(previous.aligns).length)
      const nothingChanged =
        !textChanged &&
        Object.keys(formats).length === 0 &&
        Object.keys(aligns).length === 0 &&
        !hadFormatting
      if (nothingChanged) return

      if (structural && hadFormatting) {
        toast.info('Formatting was reset on this text box because its structure changed.')
      }

      pushEdits(
        withShapeEdit(editSetRef.current, key, seedFor(slide.xmlPath, shape), (draft) => {
          draft.original = original
          draft.text = textChanged || structural ? textNext : undefined
          if (structural) {
            // A rebuilt <a:p> range would overlap formatting splices.
            draft.formats = undefined
            draft.aligns = undefined
          } else {
            draft.formats = Object.keys(formats).length > 0 ? formats : undefined
            draft.aligns = Object.keys(aligns).length > 0 ? aligns : undefined
          }
        }),
      )
    },
    [slide, pushEdits, seedFor],
  )

  // ------------------------------------------------------------ formatting

  const canFormat =
    selectedShape?.type === 'text' && acceptsFormatting(shapeEdit) && slide !== null

  const formatDisabledReason = !selectedShape
    ? 'Select a text box first'
    : selectedShape.type !== 'text'
      ? 'This shape has no text'
      : !acceptsFormatting(shapeEdit)
        ? 'Formatting is unavailable after changing this text box’s structure'
        : null

  // Reads live DOM while editing so the toolbar mirrors the caret's run.
  // `selectionTick` is what forces the recompute.
  void selectionTick
  const activeFormat: RunFormatOverrides | null = !canFormat
    ? null
    : overlayRef.current
      ? aggregateFormat(selectedRunSpans(overlayRef.current.root), overlayRef.current.scale)
      : aggregateFormatOfParagraphs((selectedShape as TextShape).paragraphs)

  const activeAlign: TextAlign | null = !canFormat
    ? null
    : overlayRef.current
      ? ((selectedParagraphBlocks(overlayRef.current.root)[0]?.getAttribute('data-algn') ||
          'l') as TextAlign)
      : ((selectedShape as TextShape).paragraphs[0]?.align ?? 'l')

  const applyFormat = useCallback(
    (set: RunFormatOverrides) => {
      if (!slide || !selectedKey) return
      const shape = findShape(slide, selectedKey)
      if (shape?.type !== 'text') return

      const overlay = overlayRef.current
      if (overlay) {
        // Editing: mutate the spans; the commit on blur turns this into edits.
        applyFormatToSpans(selectedRunSpans(overlay.root), set, overlay.scale)
        setSelectionTick((t) => t + 1)
        dirtyRef.current = true
        return
      }

      const original = baseParagraphsOf(baseDeckRef.current, slide.xmlPath, shape.nodePath)
      if (!original) return
      pushEdits(
        withShapeEdit(editSetRef.current, selectedKey, seedFor(slide.xmlPath, shape), (draft) => {
          draft.original = original
          const formats = { ...(draft.formats ?? {}) }
          original.forEach((p, pi) =>
            p.runs.forEach((r, ri) => {
              if (r.text === '\n') return
              const key = runKeyOf(pi, ri)
              formats[key] = { ...formats[key], ...set }
            }),
          )
          draft.formats = formats
        }),
      )
    },
    [slide, selectedKey, pushEdits, seedFor],
  )

  const applyAlign = useCallback(
    (align: TextAlign) => {
      if (!slide || !selectedKey) return
      const shape = findShape(slide, selectedKey)
      if (shape?.type !== 'text') return

      const overlay = overlayRef.current
      if (overlay) {
        applyAlignToBlocks(selectedParagraphBlocks(overlay.root), align)
        setSelectionTick((t) => t + 1)
        dirtyRef.current = true
        return
      }

      const original = baseParagraphsOf(baseDeckRef.current, slide.xmlPath, shape.nodePath)
      if (!original) return
      pushEdits(
        withShapeEdit(editSetRef.current, selectedKey, seedFor(slide.xmlPath, shape), (draft) => {
          draft.original = original
          const aligns = { ...(draft.aligns ?? {}) }
          original.forEach((_, pi) => {
            aligns[String(pi)] = align
          })
          draft.aligns = aligns
        }),
      )
    },
    [slide, selectedKey, pushEdits, seedFor],
  )

  const stepFontSize = useCallback(
    (delta: number) => {
      const current = activeFormat?.sizePt ?? DEFAULT_TEXT_PT
      const next = Math.min(400, Math.max(1, Math.round(current + delta)))
      applyFormat({ sizePt: next })
    },
    [activeFormat, applyFormat],
  )

  // Keep the toolbar in step with the caret while editing.
  useEffect(() => {
    if (!editingKey) return
    const onSelectionChange = () => setSelectionTick((t) => t + 1)
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [editingKey])

  // ------------------------------------------------------------------ zoom

  const zoomTo = useCallback(
    (direction: 1 | -1) => {
      const current = Math.round(zoomPercent)
      const next =
        direction > 0
          ? (ZOOM_STEPS.find((z) => z > current + 0.5) ?? MAX_ZOOM)
          : ([...ZOOM_STEPS].reverse().find((z) => z < current - 0.5) ?? MIN_ZOOM)
      setZoomMode(next)
    },
    [zoomPercent],
  )

  const handleScaleChange = useCallback((_scale: number, percent: number) => {
    setZoomPercent(percent)
  }, [])

  // -------------------------------------------------------------- keyboard

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        // Inside the text overlay the browser owns undo.
        if (editingKey) return
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (e.key === 'Escape') {
        if (editingKey) return // the overlay commits and clears it
        if (selectedKey) {
          e.preventDefault()
          setSelectedKey(null)
        }
        return
      }
      if (editingKey || !selectedKey || !slide) return

      const nudge: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      }
      const dir = nudge[e.key]
      if (!dir) return
      const shape = findShape(slide, selectedKey)
      if (!shape) return
      e.preventDefault()
      const step = EMU_PER_PX * (e.shiftKey ? 10 : 1)
      handleGeometryCommit(shape, {
        x: Math.round(shape.xfrmEmu.x + dir[0] * step),
        y: Math.round(shape.xfrmEmu.y + dir[1] * step),
        w: shape.xfrmEmu.w,
        h: shape.xfrmEmu.h,
      })
    },
    [editingKey, selectedKey, slide, undo, redo, handleGeometryCommit],
  )

  // ---------------------------------------------------------------- render

  const openExternally = useCallback(() => {
    void window.ipc.invoke('shell:openPath', { path })
  }, [path])

  if (loadState === 'error') return <FailurePanel path={path} onOpen={openExternally} />

  if (loadState === 'loading' || !deck) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2Icon className="size-6 animate-spin" />
        <p className="text-sm">Opening presentation…</p>
      </div>
    )
  }

  if (deck.slides.length === 0) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
        <PresentationIcon className="size-6" />
        <p className="text-sm font-medium text-foreground">{baseName(path)}</p>
        <p className="max-w-md text-xs">This presentation has no slides.</p>
      </div>
    )
  }

  return (
    <EditorErrorBoundary path={path} onOpen={openExternally}>
      <div
        ref={rootRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        // The text overlay stops pointer events, so this only fires for the
        // chrome and the canvas — where shortcuts need to reach us.
        onPointerDown={() => rootRef.current?.focus({ preventScroll: true })}
        className="flex h-full w-full min-h-0 flex-col bg-background outline-none"
      >
        <EditorToolbar
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undo}
          onRedo={redo}
          zoomPercent={zoomPercent}
          isFitZoom={zoomMode === 'fit'}
          onZoomIn={() => zoomTo(1)}
          onZoomOut={() => zoomTo(-1)}
          onZoomFit={() => setZoomMode('fit')}
          format={activeFormat}
          formatDisabledReason={formatDisabledReason}
          onToggleBold={() => applyFormat({ bold: !activeFormat?.bold })}
          onToggleItalic={() => applyFormat({ italic: !activeFormat?.italic })}
          onToggleUnderline={() => applyFormat({ underline: !activeFormat?.underline })}
          onFontSizeStep={stepFontSize}
          onColorChange={(hex) => applyFormat({ colorHex: hex })}
          align={activeAlign}
          onAlign={applyAlign}
          slideNumber={activeIndex + 1}
          slideCount={deck.slides.length}
          saveStatus={saveStatus}
        />

        <div className="flex min-h-0 flex-1">
          <nav
            aria-label="Slides"
            className="flex w-56 shrink-0 flex-col gap-2 overflow-y-auto border-r border-border bg-card/40 p-3"
          >
            {deck.slides.map((s, i) => (
              <SlideCard
                key={s.xmlPath}
                index={i}
                slide={s}
                sizeEmu={deck.slideSizeEmu}
                title={slideTitle(s)}
                active={i === activeIndex}
                onSelect={() => {
                  setActiveIndex(i)
                  setSelectedKey(null)
                  setEditingKey(null)
                }}
              />
            ))}
          </nav>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-1.5">
              <PresentationIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate text-sm font-medium text-foreground" title={path}>
                {baseName(path)}
              </span>
            </header>

            {slide && (
              <SlideCanvas
                slide={slide}
                sizeEmu={deck.slideSizeEmu}
                zoomMode={zoomMode}
                onScaleChange={handleScaleChange}
                selectedKey={selectedKey}
                editingKey={editingKey}
                onSelect={setSelectedKey}
                onStartEdit={setEditingKey}
                onGeometryCommit={handleGeometryCommit}
                onOverlayAttach={(h) => {
                  overlayRef.current = h
                  setSelectionTick((t) => t + 1)
                }}
                onTextCommit={handleTextCommit}
              />
            )}
          </div>
        </div>
      </div>
    </EditorErrorBoundary>
  )
}

// --------------------------------------------------------------- slide rail

/** Rail width (w-56 = 224) minus nav padding, button padding, badge + gap. */
const THUMB_WIDTH_PX = 160

interface SlideCardProps {
  index: number
  slide: Slide
  sizeEmu: { w: number; h: number }
  title: string | null
  active: boolean
  onSelect: () => void
}

function SlideCard({ index, slide, sizeEmu, title, active, onSelect }: SlideCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
      aria-label={`Slide ${index + 1}${title ? `: ${title}` : ''}`}
      className={`group flex items-start gap-2 rounded-md border p-2 text-left transition-colors ${
        active
          ? 'border-ring bg-accent text-accent-foreground'
          : 'border-border bg-background hover:border-ring/40 hover:bg-accent/50'
      }`}
    >
      <span
        className={`mt-0.5 w-4 shrink-0 text-right text-[11px] tabular-nums ${
          active ? 'text-foreground' : 'text-muted-foreground'
        }`}
      >
        {index + 1}
      </span>
      <span
        className={`min-w-0 flex-1 overflow-hidden rounded-sm ring-1 transition-shadow ${
          active ? 'ring-[var(--ring)]' : 'ring-border/60 group-hover:ring-border'
        }`}
      >
        <SlideThumbnail slide={slide} sizeEmu={sizeEmu} widthPx={THUMB_WIDTH_PX} />
      </span>
    </button>
  )
}

// ---------------------------------------------------------------- failures

function FailurePanel({ path, onOpen }: { path: string; onOpen: () => void }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
      <PresentationIcon className="size-6" />
      <p className="max-w-md truncate text-sm font-medium text-foreground" title={path}>
        {baseName(path)}
      </p>
      <p className="max-w-md text-xs">
        Cannot open this presentation. The file may be corrupted or not a valid PowerPoint
        document.
      </p>
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
      >
        <ExternalLinkIcon className="size-3.5" />
        Open in system
      </button>
    </div>
  )
}

interface EditorErrorBoundaryProps {
  path: string
  onOpen: () => void
  children: ReactNode
}

/**
 * A deck that parses but hits something unexpected while rendering falls back to
 * "open externally" instead of taking the whole pane down.
 */
class EditorErrorBoundary extends Component<EditorErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error('pptx editor render error:', error)
  }

  render() {
    if (this.state.failed) {
      return <FailurePanel path={this.props.path} onOpen={this.props.onOpen} />
    }
    return this.props.children
  }
}
