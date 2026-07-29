import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
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
import type {
  PlaceholderKind,
  Shape,
  Slide,
  SlideDeck,
  TextShape,
} from '@/lib/pptx/types'

interface PptxEditorProps {
  path: string
}

type LoadState = 'loading' | 'ready' | 'error'

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
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

  // Held separately from state so the cleanup always sees the live deck, even
  // if it is replaced mid-flight by a fast path change.
  const deckRef = useRef<SlideDeck | null>(null)

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
      if (deckRef.current) {
        disposeDeck(deckRef.current)
        deckRef.current = null
      }
    }
  }, [path])

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
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              Slide {activeIndex + 1} of {deck.slides.length} · read-only
            </span>
          </header>

          {slide && (
            <SlideCanvas
              slide={slide}
              sizeEmu={deck.slideSizeEmu}
              selectedShapeId={selectedShapeId}
              onSelectShape={setSelectedShapeId}
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
}

function SlideCanvas({ slide, sizeEmu, selectedShapeId, onSelectShape }: SlideCanvasProps) {
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
          {slide.shapes.map((shape, i) => (
            <ShapeView
              // Ids repeat across some decks; pair with position for uniqueness.
              key={`${shape.id}:${i}`}
              shape={shape}
              scale={scale}
              selected={shape.id === selectedShapeId}
              onSelect={(e) => {
                e.stopPropagation()
                onSelectShape(shape.id)
              }}
            />
          ))}
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
  const style: CSSProperties = {
    position: 'absolute',
    left: shape.xfrmEmu.x * scale,
    top: shape.xfrmEmu.y * scale,
    width: shape.xfrmEmu.w * scale,
    height: shape.xfrmEmu.h * scale,
  }

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
  // Point sizes are relative to the deck page, so they scale with it. 914400 EMU
  // per inch / 72 pt per inch = 12700 EMU per point.
  const ptToPx = (pt: number) => pt * 12700 * scale

  return (
    <div
      onClick={onSelect}
      style={{ ...style, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
      className={`overflow-hidden ${ring}`}
    >
      {shape.paragraphs.map((para, pi) => (
        <p
          key={pi}
          style={{
            textAlign:
              para.align === 'ctr'
                ? 'center'
                : para.align === 'r'
                  ? 'right'
                  : para.align === 'just'
                    ? 'justify'
                    : 'left',
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
                fontSize: run.sizePt ? ptToPx(run.sizePt) : ptToPx(18),
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
