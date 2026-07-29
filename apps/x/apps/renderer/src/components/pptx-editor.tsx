import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import {
  BarChart3Icon,
  ExternalLinkIcon,
  FilmIcon,
  GroupIcon,
  Loader2Icon,
  PresentationIcon,
  ShapesIcon,
  TableIcon,
} from 'lucide-react'
import { disposeDeck, parsePptx } from '@/lib/pptx/parse'
import {
  normalizeParagraphs,
  writeDeck,
  type EditedParagraph,
  type EditedTextRun,
  type ShapeTextEdit,
} from '@/lib/pptx/serialize'
import type {
  PlaceholderKind,
  Shape,
  Slide,
  SlideDeck,
  TextRun,
  TextShape,
} from '@/lib/pptx/types'

interface PptxEditorProps {
  path: string
}

type LoadState = 'loading' | 'ready' | 'error'
type SaveStatus = 'clean' | 'saving' | 'saved' | 'error'

const SAVE_DEBOUNCE_MS = 800
/** 914400 EMU per inch / 72 pt per inch. */
const EMU_PER_PT = 12700
const DEFAULT_TEXT_PT = 18

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

function alignToCss(align: string | undefined): 'left' | 'center' | 'right' | 'justify' {
  return align === 'ctr' ? 'center' : align === 'r' ? 'right' : align === 'just' ? 'justify' : 'left'
}

function rectStyle(shape: Shape, scale: number): CSSProperties {
  return {
    position: 'absolute',
    left: shape.xfrmEmu.x * scale,
    top: shape.xfrmEmu.y * scale,
    width: shape.xfrmEmu.w * scale,
    height: shape.xfrmEmu.h * scale,
  }
}

/** Stable identity for a shape across state updates: slide + node path. */
function editKeyOf(slide: Slide, shape: Shape): string {
  return `${slide.xmlPath}#${shape.nodePath.join('.')}`
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

const PLACEHOLDER_META: Record<PlaceholderKind, { label: string; Icon: typeof ShapesIcon }> = {
  chart: { label: 'Chart', Icon: BarChart3Icon },
  smartart: { label: 'Diagram', Icon: ShapesIcon },
  table: { label: 'Table', Icon: TableIcon },
  group: { label: 'Group', Icon: GroupIcon },
  video: { label: 'Video', Icon: FilmIcon },
  unknown: { label: 'Shape', Icon: ShapesIcon },
}

export function PptxEditor({ path }: PptxEditorProps) {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [deck, setDeck] = useState<SlideDeck | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('clean')
  const [editingKey, setEditingKey] = useState<string | null>(null)

  // Held separately from state so save/cleanup closures always see the live
  // deck. Not cleared on unmount: an in-flight save may still be serializing.
  const deckRef = useRef<SlideDeck | null>(null)
  /** slideXmlPath → (nodePath key → edit). `original` is always the as-parsed model. */
  const editsRef = useRef<Map<string, Map<string, ShapeTextEdit>>>(new Map())
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savingRef = useRef(false)
  const pendingRef = useRef(false)
  const dirtyRef = useRef(false)
  const lastWrittenRef = useRef<string | null>(null)

  // Serialize the deck (original bytes + accumulated edits) and write it back.
  // `path` is constant for this mount (App keys the component by path), so a
  // late-firing save can only ever write its own document.
  const persist = useCallback(async () => {
    const deckNow = deckRef.current
    if (!deckNow) return
    if (savingRef.current) {
      pendingRef.current = true
      return
    }
    savingRef.current = true
    try {
      const editsBySlide = new Map<string, ShapeTextEdit[]>()
      for (const [slidePath, shapeEdits] of editsRef.current) {
        if (shapeEdits.size > 0) editsBySlide.set(slidePath, [...shapeEdits.values()])
      }
      if (editsBySlide.size === 0) {
        setSaveStatus('clean')
        return
      }
      const bytes = await writeDeck(deckNow, editsBySlide)
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
      // A commit landed while we were saving — flush it.
      if (pendingRef.current) {
        pendingRef.current = false
        scheduleSave()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      void persist()
    }, SAVE_DEBOUNCE_MS)
  }, [persist])

  // Flush pending edits when navigating away or unmounting. Declared BEFORE
  // the load effect so this cleanup runs before the deck's blob URLs are
  // revoked (writeDeck reads the zip, not the blob URLs, so even an async
  // in-flight serialization stays valid).
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      if (dirtyRef.current) void persist()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  // App.tsx keys this component by path, so a different file arrives as a fresh
  // mount with fresh state — no synchronous resets needed here.
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const result = await window.ipc.invoke('workspace:readFile', { path, encoding: 'base64' })
        const parsed = await parsePptx(base64ToUint8Array(result.data))
        if (cancelled) {
          // Nobody will render these; release them now.
          disposeDeck(parsed)
          return
        }
        deckRef.current = parsed
        setDeck(parsed)
        setLoadState('ready')
      } catch (err) {
        console.error('Failed to open pptx:', err)
        if (!cancelled) setLoadState('error')
      }
    })()

    return () => {
      cancelled = true
      if (deckRef.current) disposeDeck(deckRef.current)
    }
  }, [path])

  const commitEdit = useCallback(
    (slide: Slide, shape: TextShape, next: EditedParagraph[] | null) => {
      setEditingKey(null)
      if (!next) return
      if (normalizeParagraphs(next) === normalizeParagraphs(shape.paragraphs)) return

      const slideEdits = editsRef.current.get(slide.xmlPath) ?? new Map<string, ShapeTextEdit>()
      editsRef.current.set(slide.xmlPath, slideEdits)
      const key = shape.nodePath.join('.')
      const existing = slideEdits.get(key)
      slideEdits.set(key, {
        nodePath: shape.nodePath,
        // First edit of this shape: its current paragraphs ARE the as-parsed
        // original. Later edits keep the first capture.
        original: existing?.original ?? shape.paragraphs,
        next,
      })

      setDeck(
        (d) =>
          d && {
            ...d,
            slides: d.slides.map((s) =>
              s !== slide
                ? s
                : { ...s, shapes: s.shapes.map((sh) => (sh !== shape ? sh : { ...sh, paragraphs: next })) },
            ),
          },
      )
      dirtyRef.current = true
      setSaveStatus('saving')
      scheduleSave()
    },
    [scheduleSave],
  )

  const slide = deck?.slides[activeIndex] ?? null

  const openExternally = useCallback(() => {
    void window.ipc.invoke('shell:openPath', { path })
  }, [path])

  if (loadState === 'error') {
    return <FailurePanel path={path} onOpen={openExternally} />
  }

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
      <div className="flex h-full w-full min-h-0 bg-background">
        <nav
          aria-label="Slides"
          className="flex w-56 shrink-0 flex-col gap-2 overflow-y-auto border-r border-border bg-card/40 p-3"
        >
          {deck.slides.map((s, i) => (
            <SlideCard
              key={s.xmlPath}
              index={i}
              title={slideTitle(s)}
              active={i === activeIndex}
              aspect={deck.slideSizeEmu.w / deck.slideSizeEmu.h}
              onSelect={() => {
                setActiveIndex(i)
                setSelectedShapeId(null)
              }}
            />
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
            <PresentationIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium text-foreground" title={path}>
              {baseName(path)}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
              {saveStatus !== 'clean' && (
                <span className={saveStatus === 'error' ? 'text-destructive' : undefined}>
                  {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : 'Save failed'}
                </span>
              )}
              <span>
                Slide {activeIndex + 1} of {deck.slides.length}
              </span>
            </span>
          </header>

          {slide && (
            <SlideCanvas
              slide={slide}
              sizeEmu={deck.slideSizeEmu}
              selectedShapeId={selectedShapeId}
              onSelectShape={setSelectedShapeId}
              editingKey={editingKey}
              onStartEdit={(shape) => {
                setSelectedShapeId(shape.id)
                setEditingKey(editKeyOf(slide, shape))
              }}
              onCommitEdit={(shape, next) => commitEdit(slide, shape, next)}
            />
          )}
        </div>
      </div>
    </EditorErrorBoundary>
  )
}

// --------------------------------------------------------------- slide rail

interface SlideCardProps {
  index: number
  title: string | null
  active: boolean
  aspect: number
  onSelect: () => void
}

function SlideCard({ index, title, active, aspect, onSelect }: SlideCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
      className={`flex items-start gap-2 rounded-md border p-2 text-left transition-colors ${
        active
          ? 'border-ring bg-accent text-accent-foreground'
          : 'border-border bg-background hover:bg-accent/50'
      }`}
    >
      <span className="mt-0.5 w-4 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
        {index + 1}
      </span>
      <span
        className="flex min-w-0 flex-1 items-center rounded-sm border border-border/60 bg-muted/40 px-1.5 py-1"
        style={{ aspectRatio: String(aspect) }}
      >
        <span className="line-clamp-3 text-[11px] leading-tight text-foreground/80">
          {title ?? <span className="text-muted-foreground">Untitled slide</span>}
        </span>
      </span>
    </button>
  )
}

// ------------------------------------------------------------------ canvas

interface SlideCanvasProps {
  slide: Slide
  sizeEmu: { w: number; h: number }
  selectedShapeId: string | null
  onSelectShape: (id: string | null) => void
  editingKey: string | null
  onStartEdit: (shape: TextShape) => void
  onCommitEdit: (shape: TextShape, next: EditedParagraph[] | null) => void
}

function SlideCanvas({
  slide,
  sizeEmu,
  selectedShapeId,
  onSelectShape,
  editingKey,
  onStartEdit,
  onCommitEdit,
}: SlideCanvasProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)

  // Fit the deck's EMU page into whatever space the pane has, preserving aspect.
  useLayoutEffect(() => {
    const el = frameRef.current
    if (!el) return
    const fit = () => {
      const { width, height } = el.getBoundingClientRect()
      if (width <= 0 || height <= 0) return
      setScale(Math.min(width / sizeEmu.w, height / sizeEmu.h))
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [sizeEmu.w, sizeEmu.h])

  return (
    <div
      ref={frameRef}
      className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6"
      onClick={() => onSelectShape(null)}
    >
      {scale > 0 && (
        <div
          className="relative overflow-hidden rounded-md bg-white shadow-lg ring-1 ring-border"
          style={{ width: sizeEmu.w * scale, height: sizeEmu.h * scale }}
        >
          {slide.shapes.map((shape, i) => {
            // Ids repeat across some decks; pair with position for uniqueness.
            const reactKey = `${shape.id}:${i}`
            if (shape.type === 'text' && editingKey === editKeyOf(slide, shape)) {
              return (
                <TextEditOverlay
                  key={reactKey}
                  shape={shape}
                  scale={scale}
                  style={rectStyle(shape, scale)}
                  onCommit={(next) => onCommitEdit(shape, next)}
                />
              )
            }
            return (
              <ShapeView
                key={reactKey}
                shape={shape}
                scale={scale}
                selected={shape.id === selectedShapeId}
                onSelect={(e) => {
                  e.stopPropagation()
                  onSelectShape(shape.id)
                  if (shape.type === 'text') onStartEdit(shape)
                }}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

interface ShapeViewProps {
  shape: Shape
  scale: number
  selected: boolean
  onSelect: (e: ReactMouseEvent) => void
}

function ShapeView({ shape, scale, selected, onSelect }: ShapeViewProps) {
  const style = rectStyle(shape, scale)
  const ring = selected ? 'outline outline-2 outline-offset-1 outline-[var(--ring)]' : ''

  if (shape.type === 'image') {
    return (
      <img
        src={shape.blobUrl}
        alt=""
        draggable={false}
        onClick={onSelect}
        style={style}
        className={`object-contain ${ring}`}
      />
    )
  }

  if (shape.type === 'placeholder') {
    const { label, Icon } = PLACEHOLDER_META[shape.kind]
    return (
      <div
        onClick={onSelect}
        style={style}
        className={`flex items-center justify-center gap-1.5 rounded-sm border border-dashed border-neutral-400/70 bg-neutral-500/5 ${ring}`}
      >
        <Icon className="size-3.5 shrink-0 text-neutral-500" />
        <span className="truncate text-[11px] text-neutral-500">{label}</span>
      </div>
    )
  }

  return <TextShapeView shape={shape} scale={scale} style={style} ring={ring} onSelect={onSelect} />
}

interface TextShapeViewProps {
  shape: TextShape
  scale: number
  style: CSSProperties
  ring: string
  onSelect: (e: ReactMouseEvent) => void
}

function TextShapeView({ shape, scale, style, ring, onSelect }: TextShapeViewProps) {
  // Point sizes are relative to the deck page, so they scale with it.
  const ptToPx = (pt: number) => pt * EMU_PER_PT * scale

  return (
    <div
      onClick={onSelect}
      style={{ ...style, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
      className={`cursor-text overflow-hidden ${ring}`}
    >
      {shape.paragraphs.map((para, pi) => (
        <p
          key={pi}
          style={{
            textAlign: alignToCss(para.align),
            margin: 0,
            whiteSpace: 'pre-wrap',
          }}
        >
          {para.runs.map((run, ri) => (
            <span
              key={ri}
              style={{
                fontWeight: run.bold ? 700 : undefined,
                fontStyle: run.italic ? 'italic' : undefined,
                textDecoration: run.underline ? 'underline' : undefined,
                fontSize: ptToPx(run.sizePt ?? DEFAULT_TEXT_PT),
                color: run.colorHex ? `#${run.colorHex}` : '#000',
                lineHeight: 1.2,
              }}
            >
              {run.text}
            </span>
          ))}
        </p>
      ))}
    </div>
  )
}

// ----------------------------------------------------------- editing overlay

/**
 * Rendered HTML for the contentEditable overlay. Every run carries its CURRENT
 * coordinates (data-cp/data-cr — for style lookup at extraction time) and,
 * when known, its ORIGINAL provenance (data-op/data-or — indexes into the
 * shape's as-parsed paragraphs, which the serializer uses to reuse rPr/pPr
 * bytes). When a browser splits a block or span on Enter, it clones these
 * attributes onto both halves — exactly the inheritance we want.
 */
function buildEditableHtml(shape: TextShape, scale: number): string {
  const escapeHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  return shape.paragraphs
    .map((para, pi) => {
      const ep = para as EditedParagraph
      const paraSrc = 'srcPara' in ep ? ep.srcPara : pi
      const paraProv = paraSrc !== undefined ? ` data-op="${paraSrc}"` : ''
      const inner = para.runs
        .map((run, ri) => {
          const er = run as EditedTextRun
          const runSrcPara = 'srcPara' in er ? er.srcPara : pi
          const runSrcRun = 'srcRun' in er ? er.srcRun : ri
          const prov =
            runSrcPara !== undefined && runSrcRun !== undefined
              ? ` data-op="${runSrcPara}" data-or="${runSrcRun}"`
              : ''
          if (run.text === '\n') return `<br data-cp="${pi}" data-cr="${ri}"${prov}>`
          const px = (run.sizePt ?? DEFAULT_TEXT_PT) * EMU_PER_PT * scale
          const style =
            `font-weight:${run.bold ? 700 : 400};font-style:${run.italic ? 'italic' : 'normal'};` +
            `text-decoration:${run.underline ? 'underline' : 'none'};font-size:${px}px;` +
            `color:#${run.colorHex ?? '000000'};line-height:1.2`
          return `<span data-cp="${pi}" data-cr="${ri}"${prov} style="${style}">${escapeHtml(run.text)}</span>`
        })
        .join('')
      return `<div data-cp="${pi}"${paraProv} style="margin:0;text-align:${alignToCss(para.align)}">${inner || '<br>'}</div>`
    })
    .join('')
}

function numAttr(el: Element, name: string): number | undefined {
  const v = el.getAttribute(name)
  if (v === null) return undefined
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 ? n : undefined
}

/** contentEditable output → model text. NBSP and CRLF normalized, zero-widths dropped. */
function normText(s: string): string {
  return s.replace(/\u00A0/g, ' ').replace(/\r\n?/g, '\n').replace(/[\u200B\uFEFF]/g, '')
}

/** Reads the committed paragraphs back out of the overlay's DOM. */
function extractParagraphs(root: HTMLElement, shape: TextShape): EditedParagraph[] {
  const paras: EditedParagraph[] = []
  let loose: EditedTextRun[] = []

  const flushLoose = () => {
    if (loose.length) paras.push({ align: undefined, runs: loose, srcPara: undefined })
    loose = []
  }

  const runFromStyledNode = (el: Element): EditedTextRun | null => {
    const text = normText(el.textContent ?? '')
    if (!text) return null
    const cp = numAttr(el, 'data-cp')
    const cr = numAttr(el, 'data-cr')
    const base: TextRun | undefined =
      cp !== undefined && cr !== undefined ? shape.paragraphs[cp]?.runs[cr] : undefined
    return {
      text,
      bold: base?.bold,
      italic: base?.italic,
      underline: base?.underline,
      sizePt: base?.sizePt,
      colorHex: base?.colorHex,
      srcPara: numAttr(el, 'data-op'),
      srcRun: numAttr(el, 'data-or'),
    }
  }

  const collectInline = (container: Node, into: EditedTextRun[]) => {
    container.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        const t = normText(n.nodeValue ?? '')
        if (t) into.push({ text: t })
      } else if (n instanceof Element) {
        if (n.tagName === 'BR') {
          into.push({ text: '\n', srcPara: numAttr(n, 'data-op'), srcRun: numAttr(n, 'data-or') })
        } else if (n.tagName === 'SPAN' && n.getAttribute('data-cr') !== null) {
          const r = runFromStyledNode(n)
          if (r) into.push(r)
        } else {
          // Pasted markup or browser-inserted wrappers: keep the text, styled
          // by whatever rPr the serializer's fallback picks.
          collectInline(n, into)
        }
      }
    })
  }

  root.childNodes.forEach((n) => {
    if (n instanceof Element && (n.tagName === 'DIV' || n.tagName === 'P')) {
      flushLoose()
      const runs: EditedTextRun[] = []
      collectInline(n, runs)

      // `<div><br></div>` is contentEditable's empty paragraph.
      const onlyBr =
        n.childNodes.length === 1 && n.firstChild instanceof Element && n.firstChild.tagName === 'BR'
      let finalRuns = onlyBr ? [] : runs
      // Browsers keep a placeholder <br> at the end of non-empty blocks.
      if (!onlyBr && finalRuns.length > 1) {
        const lastRun = finalRuns[finalRuns.length - 1]
        const lastChild = n.lastChild
        if (
          lastRun.text === '\n' &&
          lastRun.srcRun === undefined &&
          lastChild instanceof Element &&
          lastChild.tagName === 'BR' &&
          lastChild.getAttribute('data-cr') === null
        ) {
          finalRuns = finalRuns.slice(0, -1)
        }
      }

      const cp = numAttr(n, 'data-cp')
      paras.push({
        align: cp !== undefined ? shape.paragraphs[cp]?.align : undefined,
        runs: finalRuns,
        srcPara: numAttr(n, 'data-op'),
      })
    } else if (n.nodeType === Node.TEXT_NODE) {
      const t = normText(n.nodeValue ?? '')
      if (t) loose.push({ text: t })
    } else if (n instanceof Element) {
      if (n.tagName === 'BR') {
        loose.push({ text: '\n', srcPara: numAttr(n, 'data-op'), srcRun: numAttr(n, 'data-or') })
      } else if (n.tagName === 'SPAN' && n.getAttribute('data-cr') !== null) {
        const r = runFromStyledNode(n)
        if (r) loose.push(r)
      } else {
        collectInline(n, loose)
      }
    }
  })
  flushLoose()

  // Everything replaced by unanchored content (e.g. select-all + type): keep
  // the first original paragraph's formatting rather than none at all.
  if (paras.length > 0 && paras.every((p) => p.srcPara === undefined) && shape.paragraphs.length > 0) {
    paras[0] = { ...paras[0], srcPara: 0, align: paras[0].align ?? shape.paragraphs[0].align }
  }
  if (paras.length === 0) {
    paras.push({ align: shape.paragraphs[0]?.align, runs: [], srcPara: 0 })
  }
  return paras
}

interface TextEditOverlayProps {
  shape: TextShape
  scale: number
  style: CSSProperties
  onCommit: (next: EditedParagraph[] | null) => void
}

function TextEditOverlay({ shape, scale, style, onCommit }: TextEditOverlayProps) {
  const ref = useRef<HTMLDivElement>(null)
  const committedRef = useRef(false)
  const html = useMemo(() => buildEditableHtml(shape, scale), [shape, scale])

  const commit = useCallback(() => {
    if (committedRef.current) return
    committedRef.current = true
    onCommit(ref.current ? extractParagraphs(ref.current, shape) : null)
  }, [onCommit, shape])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    const sel = window.getSelection()
    if (sel) {
      sel.selectAllChildren(el)
      sel.collapseToEnd()
    }
  }, [])

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      dangerouslySetInnerHTML={{ __html: html }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          commit()
        }
        // Keep app-level shortcuts away from typing.
        e.stopPropagation()
      }}
      onClick={(e) => e.stopPropagation()}
      style={{ ...style, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
      className="cursor-text overflow-hidden whitespace-pre-wrap outline-2 outline-offset-1 outline-[var(--ring)]"
    />
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
