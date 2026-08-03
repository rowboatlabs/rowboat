import {
  memo,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  BarChart3Icon,
  FilmIcon,
  ShapesIcon,
  TableIcon,
} from 'lucide-react'
import type {
  Fill,
  LineStyle,
  PlaceholderKind,
  PresetGeometry,
  Shape,
  Slide,
  TextShape,
} from '@/lib/pptx/types'
import type { EditedParagraph } from '@/lib/pptx/serialize'
import { isLinePreset } from '@/lib/pptx/geometry'
import { autoNumText } from '@/lib/pptx/textstyle'
import {
  EMU_PER_INCH,
  EMU_PER_PT,
  GRID_EMU,
  MIN_EXTENT_EMU,
  shapeKeyOf,
  type RectEmuBox,
  type ShapeKey,
} from './edit-model'
import {
  DEFAULT_TEXT_PT,
  alignToCss,
  anchorJustify,
  displayAlign,
  displayRunStyle,
  fontScaleOf,
  paragraphMetrics,
  type CaretTarget,
  type TextOverlayHandle,
} from './text-dom'
import { TextEditOverlay } from './text-overlay'

const PLACEHOLDER_META: Record<PlaceholderKind, { label: string; Icon: typeof ShapesIcon }> = {
  chart: { label: 'Chart', Icon: BarChart3Icon },
  smartart: { label: 'Diagram', Icon: ShapesIcon },
  table: { label: 'Table', Icon: TableIcon },
  video: { label: 'Video', Icon: FilmIcon },
  unknown: { label: 'Shape', Icon: ShapesIcon },
}

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

const HANDLES: Array<{ id: HandleId; cursor: string; x: number; y: number }> = [
  { id: 'nw', cursor: 'nwse-resize', x: 0, y: 0 },
  { id: 'n', cursor: 'ns-resize', x: 0.5, y: 0 },
  { id: 'ne', cursor: 'nesw-resize', x: 1, y: 0 },
  { id: 'e', cursor: 'ew-resize', x: 1, y: 0.5 },
  { id: 'se', cursor: 'nwse-resize', x: 1, y: 1 },
  { id: 's', cursor: 'ns-resize', x: 0.5, y: 1 },
  { id: 'sw', cursor: 'nesw-resize', x: 0, y: 1 },
  { id: 'w', cursor: 'ew-resize', x: 0, y: 0.5 },
]

interface Gesture {
  key: ShapeKey
  mode: 'move' | 'resize'
  handle: HandleId
  startRect: RectEmuBox
  startX: number
  startY: number
  rect: RectEmuBox
  moved: boolean
  /** Set when the pointer went down on an already-selected text box. */
  wantsEdit: boolean
}

/** Scale at which one EMU maps to one CSS pixel — i.e. 100% zoom at 96 dpi. */
const CSS_PX_PER_EMU = 96 / EMU_PER_INCH
/** Pointer travel a press may drift and still count as a click, not a drag. */
const CLICK_SLOP_PX = 4
/** Window in which a second press is part of a double-click. */
const DOUBLE_CLICK_MS = 400

const snapToGrid = (emu: number): number => Math.round(emu / GRID_EMU) * GRID_EMU

function computeResize(
  start: RectEmuBox,
  handle: HandleId,
  dx: number,
  dy: number,
  shift: boolean,
): RectEmuBox {
  const hasE = handle.includes('e')
  const hasW = handle.includes('w')
  const hasS = handle.includes('s')
  const hasN = handle.includes('n')
  let { x, y, w, h } = start

  if (hasE) w = start.w + dx
  if (hasW) {
    x = start.x + dx
    w = start.w - dx
  }
  if (hasS) h = start.h + dy
  if (hasN) {
    y = start.y + dy
    h = start.h - dy
  }

  // Shift preserves the starting aspect ratio on corner handles.
  if (shift && (hasE || hasW) && (hasN || hasS) && start.w > 0 && start.h > 0) {
    const aspect = start.w / start.h
    if (Math.abs(w - start.w) >= Math.abs(h - start.h)) h = w / aspect
    else w = h * aspect
    if (hasW) x = start.x + start.w - w
    if (hasN) y = start.y + start.h - h
  }

  if (w < MIN_EXTENT_EMU) {
    if (hasW) x = start.x + start.w - MIN_EXTENT_EMU
    w = MIN_EXTENT_EMU
  }
  if (h < MIN_EXTENT_EMU) {
    if (hasN) y = start.y + start.h - MIN_EXTENT_EMU
    h = MIN_EXTENT_EMU
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }
}

const inches = (emu: number): string => (emu / EMU_PER_INCH).toFixed(2)

// ------------------------------------------------------------------ shapes

function rectStyle(rect: RectEmuBox, scale: number): CSSProperties {
  return {
    position: 'absolute',
    left: rect.x * scale,
    top: rect.y * scale,
    width: rect.w * scale,
    height: rect.h * scale,
  }
}

const isEmptyText = (shape: TextShape): boolean =>
  shape.paragraphs.every((p) => p.runs.every((r) => r.text.trim() === ''))

// ------------------------------------------------------------ shape visuals

function cssColor(hex: string, alpha?: number): string {
  if (alpha === undefined) return `#${hex}`
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function fillCss(fill: Fill | undefined): CSSProperties {
  if (!fill || fill.kind === 'none') return {}
  if (fill.kind === 'solid') return { backgroundColor: cssColor(fill.hex, fill.alpha) }
  // OOXML angles: 0° points right, clockwise. CSS: 0° points up, clockwise.
  const stops = fill.stops
    .map((s) => `${cssColor(s.hex, s.alpha)} ${Math.round(s.pos * 100)}%`)
    .join(', ')
  return { backgroundImage: `linear-gradient(${fill.angleDeg + 90}deg, ${stops})` }
}

const DASH_CSS: Record<LineStyle['dash'], string> = {
  solid: 'solid',
  dash: 'dashed',
  dot: 'dotted',
}

function lineCss(line: LineStyle | undefined, scale: number): CSSProperties {
  if (!line) return {}
  const w = Math.max(1, line.widthEmu * scale)
  return { border: `${w}px ${DASH_CSS[line.dash]} ${cssColor(line.hex, line.alpha)}` }
}

function radiusCss(
  geom: PresetGeometry | undefined,
  rect: RectEmuBox,
  scale: number,
): CSSProperties {
  if (!geom) return {}
  if (geom.preset === 'ellipse') return { borderRadius: '50%' }
  if (geom.preset === 'roundRect') {
    const adj = geom.adj.adj ?? 16667
    const r = Math.min(rect.w, rect.h) * (adj / 100000) * scale
    return { borderRadius: `${Math.max(0, r)}px` }
  }
  return {}
}

/** Rotation and flips as a CSS transform fragment, applied about the center. */
function visualTransform(shape: Shape): string {
  const v = shape.visual
  if (!v) return ''
  const parts: string[] = []
  if (v.rotDeg) parts.push(`rotate(${v.rotDeg}deg)`)
  if (v.flipH) parts.push('scaleX(-1)')
  if (v.flipV) parts.push('scaleY(-1)')
  return parts.join(' ')
}

function composeTransform(...parts: Array<string | undefined>): string | undefined {
  const s = parts.filter(Boolean).join(' ')
  return s === '' ? undefined : s
}

/** A preset drawn as one stroked segment (`line`, connectors). */
function LineShapeView({
  rect,
  scale,
  line,
  style,
  onPointerDown,
}: {
  rect: RectEmuBox
  scale: number
  line: LineStyle | undefined
  style: CSSProperties
  onPointerDown: (e: ReactPointerEvent) => void
}) {
  const w = Math.max(rect.w * scale, 1)
  const h = Math.max(rect.h * scale, 1)
  const strokeW = Math.max(1, (line?.widthEmu ?? 9525) * scale)
  const dashArray =
    line?.dash === 'dash' ? `${strokeW * 3} ${strokeW * 2}` : line?.dash === 'dot' ? `${strokeW} ${strokeW * 1.5}` : undefined
  return (
    <svg
      onPointerDown={onPointerDown}
      style={{ ...style, overflow: 'visible' }}
      width={w}
      height={h}
      className="select-none"
    >
      <line
        x1={0}
        y1={0}
        x2={rect.w * scale}
        y2={rect.h * scale}
        stroke={line ? cssColor(line.hex, line.alpha) : '#666666'}
        strokeWidth={strokeW}
        strokeDasharray={dashArray}
      />
    </svg>
  )
}

const groupChildNoop = () => {}

interface ShapeViewProps {
  shape: Shape
  rect: RectEmuBox
  scale: number
  selected: boolean
  transform?: string
  onPointerDown: (e: ReactPointerEvent) => void
  /** Text shapes only: opens the editor with the caret at the click point. */
  onDoubleClick?: (e: ReactMouseEvent) => void
}

function ShapeView({
  shape,
  rect,
  scale,
  selected,
  transform,
  onPointerDown,
  onDoubleClick,
}: ShapeViewProps) {
  const style: CSSProperties = { ...rectStyle(rect, scale), transform }
  const cursor = selected ? 'move' : 'default'

  if (shape.type === 'image') {
    return (
      <img
        src={shape.blobUrl}
        alt=""
        draggable={false}
        onPointerDown={onPointerDown}
        style={{ ...style, cursor, ...lineCss(shape.visual?.line, scale) }}
        className="object-contain select-none"
      />
    )
  }

  if (shape.type === 'group') {
    // Children carry final slide-space rects, so they render as ordinary
    // ShapeViews inside a layer that cancels the group box's own offset.
    // The layer is inert: clicks land on the group box, which selects the
    // group as one read-only unit — children are never individually
    // interactive and never enter text editing.
    return (
      <div onPointerDown={onPointerDown} style={{ ...style, cursor: 'default' }}>
        <div
          className="pointer-events-none absolute"
          style={{ left: -rect.x * scale, top: -rect.y * scale }}
        >
          {shape.children.map((child, i) => (
            <ShapeView
              key={`${child.id}:${i}`}
              shape={child}
              rect={child.xfrmEmu}
              scale={scale}
              selected={false}
              transform={composeTransform(visualTransform(child))}
              onPointerDown={groupChildNoop}
            />
          ))}
        </div>
      </div>
    )
  }

  if (shape.type === 'placeholder') {
    // Only content we genuinely can't draw keeps the dashed treatment.
    const { label, Icon } = PLACEHOLDER_META[shape.kind]
    return (
      <div
        onPointerDown={onPointerDown}
        style={{ ...style, cursor }}
        className="flex select-none items-center justify-center gap-1.5 rounded-sm border border-dashed border-neutral-400/70 bg-neutral-500/5"
      >
        <Icon className="size-3.5 shrink-0 text-neutral-500" />
        <span className="truncate text-[11px] text-neutral-500">{label}</span>
      </div>
    )
  }

  const geom = shape.visual?.geom
  if (shape.type === 'drawing') {
    if (geom && isLinePreset(geom.preset)) {
      return (
        <LineShapeView
          rect={rect}
          scale={scale}
          line={shape.visual?.line}
          style={{ ...style, cursor }}
          onPointerDown={onPointerDown}
        />
      )
    }
    return (
      <div
        onPointerDown={onPointerDown}
        style={{
          ...style,
          cursor,
          ...fillCss(shape.visual?.fill),
          ...lineCss(shape.visual?.line, scale),
          ...radiusCss(geom, rect, scale),
        }}
        className="select-none"
      />
    )
  }

  return (
    <TextShapeView
      shape={shape}
      rect={rect}
      scale={scale}
      style={style}
      selected={selected}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    />
  )
}

function TextShapeView({
  shape,
  rect,
  scale,
  style,
  selected,
  onPointerDown,
  onDoubleClick,
}: {
  shape: TextShape
  rect: RectEmuBox
  scale: number
  style: CSSProperties
  selected: boolean
  onPointerDown: (e: ReactPointerEvent) => void
  onDoubleClick?: (e: ReactMouseEvent) => void
}) {
  // normAutofit scales every rendered size; the model's pt values stay raw.
  const fontScale = fontScaleOf(shape)
  const ptToPx = (pt: number) => pt * fontScale * EMU_PER_PT * scale
  // Auto-number counters accumulate down the shape; deeper levels reset when
  // a shallower numbered paragraph appears.
  const counters: Record<number, number> = {}

  return (
    <div
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      style={{
        ...style,
        cursor: selected ? 'move' : 'text',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: anchorJustify(shape.display?.anchor),
        ...fillCss(shape.visual?.fill),
        ...lineCss(shape.visual?.line, scale),
        ...radiusCss(shape.visual?.geom, rect, scale),
      }}
      className="group/pptx-shape"
    >
      {isEmptyText(shape) ? (
        <span
          className={`select-none text-neutral-400 transition-opacity ${
            selected ? 'opacity-70' : 'opacity-0 group-hover/pptx-shape:opacity-50'
          }`}
          style={{ fontSize: ptToPx(shape.display?.defaultRun.sizePt ?? DEFAULT_TEXT_PT) }}
        >
          Add text
        </span>
      ) : (
        shape.paragraphs.map((para, pi) => {
          const dp = shape.display?.paragraphs[(para as EditedParagraph).srcPara ?? pi]
          const hasText = para.runs.some((r) => r.text.trim() !== '')

          let bulletText: string | null = null
          if (dp && hasText) {
            if (dp.bullet.kind === 'char') bulletText = dp.bullet.char
            else if (dp.bullet.kind === 'auto') {
              for (const k of Object.keys(counters)) {
                if (Number(k) > dp.level) delete counters[Number(k)]
              }
              counters[dp.level] = (counters[dp.level] ?? dp.bullet.startAt - 1) + 1
              bulletText = autoNumText(dp.bullet.scheme, counters[dp.level])
            }
          }

          const marLPx = (dp?.marLEmu ?? 0) * scale
          const indentPx = (dp?.indentEmu ?? 0) * scale
          const bulletStyle = dp?.defaultRun ?? shape.display?.defaultRun
          const metrics = paragraphMetrics(dp, shape.display?.autofit, scale)

          return (
            <p
              key={pi}
              style={{
                textAlign: alignToCss(displayAlign(shape, pi, para)),
                margin: 0,
                whiteSpace: 'pre-wrap',
                lineHeight: metrics.lineHeight,
                paddingTop: metrics.padTopPx > 0 ? metrics.padTopPx : undefined,
                paddingBottom: metrics.padBottomPx > 0 ? metrics.padBottomPx : undefined,
                paddingLeft: marLPx > 0 ? marLPx : undefined,
                textIndent: indentPx !== 0 ? indentPx : undefined,
              }}
            >
              {bulletText !== null && (
                <span
                  style={{
                    display: 'inline-block',
                    textIndent: 0,
                    minWidth: indentPx < 0 ? -indentPx : undefined,
                    marginRight: indentPx < 0 ? undefined : '0.35em',
                    fontSize: ptToPx(bulletStyle?.sizePt ?? DEFAULT_TEXT_PT),
                    color: `#${bulletStyle?.colorHex ?? '000000'}`,
                    fontFamily: bulletStyle?.fontFamily,
                  }}
                >
                  {bulletText}
                </span>
              )}
              {para.runs.map((run, ri) => {
                const rs = displayRunStyle(shape, pi, ri, run)
                return (
                  <span
                    key={ri}
                    style={{
                      fontWeight: rs.bold ? 700 : 400,
                      fontStyle: rs.italic ? 'italic' : 'normal',
                      textDecoration: rs.underline ? 'underline' : 'none',
                      fontSize: ptToPx(rs.sizePt),
                      color: `#${rs.colorHex}`,
                      fontFamily: rs.fontFamily,
                    }}
                  >
                    {run.text}
                  </span>
                )
              })}
            </p>
          )
        })
      )}
    </div>
  )
}

function SelectionFrame({
  rect,
  scale,
  transform,
  resizable,
  onHandleDown,
}: {
  rect: RectEmuBox
  scale: number
  transform?: string
  /** False for read-only selections (groups): outline only, no handles. */
  resizable: boolean
  onHandleDown: (handle: HandleId, e: ReactPointerEvent) => void
}) {
  return (
    <div
      style={{ ...rectStyle(rect, scale), transform }}
      className="pointer-events-none z-10 outline-2 outline-offset-1 outline-[var(--ring)]"
    >
      {resizable &&
        HANDLES.map((h) => (
        <span
          key={h.id}
          onPointerDown={(e) => onHandleDown(h.id, e)}
          style={{
            position: 'absolute',
            left: `calc(${h.x * 100}% - 4px)`,
            top: `calc(${h.y * 100}% - 4px)`,
            cursor: h.cursor,
          }}
          className="pointer-events-auto size-2 rounded-[2px] border border-white bg-[var(--ring)] shadow-sm"
        />
      ))}
    </div>
  )
}

/**
 * Decoration inherited from the layout/master, painted beneath the slide's
 * own shapes. Inert by construction: no selection, no editing, no pointer
 * events — these shapes live in other parts and must never produce edits.
 */
function UnderlayView({ shapes, scale }: { shapes: Shape[]; scale: number }) {
  return (
    <div className="pointer-events-none" aria-hidden="true">
      {shapes.map((shape, i) => (
        <ShapeView
          key={`u:${shape.id}:${i}`}
          shape={shape}
          rect={shape.xfrmEmu}
          scale={scale}
          selected={false}
          transform={composeTransform(visualTransform(shape))}
          onPointerDown={groupChildNoop}
        />
      ))}
    </div>
  )
}

// --------------------------------------------------------------- thumbnail

const thumbNoop = () => {}

/**
 * A miniature of one slide, rendered through the same ShapeView pipeline as
 * the canvas so the rail shows the real slide and tracks live edits. Fully
 * inert: pointer-events none, no selection chrome, no text overlay. Memoized —
 * applyEditSet keeps untouched slides referentially stable, so only an edited
 * slide's thumbnail re-renders.
 *
 * The slide is laid out at 100% (96 dpi) and the finished render is scaled to
 * `widthPx`, rather than shrinking every length into the target box directly.
 * Direct scaling puts body text at ~2px in a 160px-wide rail thumbnail, which
 * Chromium renders as an invisible smear — most of the slide's content simply
 * vanishes from the preview. Laying out full size and letting the compositor
 * shrink the result keeps every run legible, and the outer box is unchanged
 * because the transform is exactly `widthPx / referenceWidth`.
 */
export const SlideThumbnail = memo(function SlideThumbnail({
  slide,
  sizeEmu,
  widthPx,
}: {
  slide: Slide
  sizeEmu: { w: number; h: number }
  widthPx: number
}) {
  const refW = sizeEmu.w * CSS_PX_PER_EMU
  const refH = sizeEmu.h * CSS_PX_PER_EMU
  const zoom = widthPx / refW
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none select-none overflow-hidden bg-white"
      style={{ width: widthPx, height: refH * zoom }}
    >
      <div
        className="relative bg-white"
        style={{
          width: refW,
          height: refH,
          transform: `scale(${zoom})`,
          transformOrigin: 'top left',
          // Resolved page background paints over the white base.
          ...fillCss(slide.background),
        }}
      >
        {slide.underlay && <UnderlayView shapes={slide.underlay} scale={CSS_PX_PER_EMU} />}
        {slide.shapes.map((shape, i) => (
          <ShapeView
            key={`${shape.id}:${i}`}
            shape={shape}
            rect={shape.xfrmEmu}
            scale={CSS_PX_PER_EMU}
            selected={false}
            transform={composeTransform(visualTransform(shape))}
            onPointerDown={thumbNoop}
          />
        ))}
      </div>
    </div>
  )
})

// ------------------------------------------------------------------ canvas

interface SlideCanvasProps {
  slide: Slide
  sizeEmu: { w: number; h: number }
  /** 'fit' or a zoom percentage. */
  zoomMode: 'fit' | number
  onScaleChange: (scale: number, percent: number) => void
  selectedKey: ShapeKey | null
  editingKey: ShapeKey | null
  onSelect: (key: ShapeKey | null) => void
  onStartEdit: (key: ShapeKey) => void
  onGeometryCommit: (shape: Shape, rect: RectEmuBox) => void
  onOverlayAttach: (handle: TextOverlayHandle | null) => void
  onTextCommit: (shape: TextShape, next: EditedParagraph[] | null) => void
}

export function SlideCanvas({
  slide,
  sizeEmu,
  zoomMode,
  onScaleChange,
  selectedKey,
  editingKey,
  onSelect,
  onStartEdit,
  onGeometryCommit,
  onOverlayAttach,
  onTextCommit,
}: SlideCanvasProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)
  // The gesture lives in a ref and is mirrored into state for rendering, so
  // pointer handlers never have to run side effects inside a state updater.
  const gestureRef = useRef<Gesture | null>(null)
  const [gesture, setGestureState] = useState<Gesture | null>(null)
  const scaleRef = useRef(0)
  scaleRef.current = scale
  // Where the caret should land when the next editing session opens.
  const [caretPoint, setCaretPoint] = useState<CaretTarget | null>(null)
  // Last press, for spotting the second half of a double-click.
  const lastPressRef = useRef<{ t: number; x: number; y: number } | null>(null)

  const setGesture = useCallback((next: Gesture | null) => {
    gestureRef.current = next
    setGestureState(next)
  }, [])

  // Fit the deck's EMU page into the pane, or honour an explicit zoom.
  useLayoutEffect(() => {
    const el = frameRef.current
    if (!el) return
    const fit = () => {
      const { width, height } = el.getBoundingClientRect()
      if (width <= 0 || height <= 0) return
      const padding = 48
      const next =
        zoomMode === 'fit'
          ? Math.min((width - padding) / sizeEmu.w, (height - padding) / sizeEmu.h)
          : (zoomMode / 100) * CSS_PX_PER_EMU
      setScale(next)
      onScaleChange(next, (next / CSS_PX_PER_EMU) * 100)
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizeEmu.w, sizeEmu.h, zoomMode])

  /** Opens the text editor with the caret where the click landed. */
  const enterEdit = useCallback(
    (key: ShapeKey, clientX: number, clientY: number, selectWord: boolean) => {
      setCaretPoint({ x: clientX, y: clientY, selectWord })
      onStartEdit(key)
    },
    [onStartEdit],
  )

  const beginGesture = useCallback(
    (shape: Shape, mode: 'move' | 'resize', handle: HandleId, e: ReactPointerEvent) => {
      e.stopPropagation()
      if (e.button !== 0) return
      const key = shapeKeyOf(slide.xmlPath, shape.nodePath)
      const wasSelected = selectedKey === key
      onSelect(key)
      // Editing already: let the overlay keep the pointer.
      if (editingKey === key) return
      // Groups select as one read-only unit — no move/resize gesture, so no
      // geometry ever reaches the serializer for them.
      if (shape.type === 'group') return

      if (mode === 'move' && shape.type === 'text') {
        const last = lastPressRef.current
        const isSecondPress =
          last !== null &&
          e.timeStamp - last.t >= 0 &&
          e.timeStamp - last.t < DOUBLE_CLICK_MS &&
          Math.abs(e.clientX - last.x) <= CLICK_SLOP_PX &&
          Math.abs(e.clientY - last.y) <= CLICK_SLOP_PX
        lastPressRef.current = { t: e.timeStamp, x: e.clientX, y: e.clientY }
        // The second press of a double-click belongs to onDoubleClick: starting
        // a gesture here would swallow it, because the pointerup swaps this
        // shape for the overlay before the dblclick is ever dispatched.
        if (isSecondPress) return
      }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      setGesture({
        key,
        mode,
        handle,
        startRect: { ...shape.xfrmEmu },
        startX: e.clientX,
        startY: e.clientY,
        rect: { ...shape.xfrmEmu },
        moved: false,
        wantsEdit: mode === 'move' && wasSelected && shape.type === 'text',
      })
    },
    [slide.xmlPath, selectedKey, editingKey, onSelect, setGesture],
  )

  const handleDoubleClick = useCallback(
    (shape: TextShape, e: ReactMouseEvent) => {
      e.stopPropagation()
      const key = shapeKeyOf(slide.xmlPath, shape.nodePath)
      if (editingKey === key) return
      // Any gesture the presses left behind would fight the overlay.
      setGesture(null)
      lastPressRef.current = null
      onSelect(key)
      // Double-click takes the word, the way it does in any other editor.
      enterEdit(key, e.clientX, e.clientY, true)
    },
    [slide.xmlPath, editingKey, onSelect, enterEdit, setGesture],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const g = gestureRef.current
      const s = scaleRef.current
      if (!g || s <= 0) return
      const dx = snapToGrid((e.clientX - g.startX) / s)
      const dy = snapToGrid((e.clientY - g.startY) / s)
      const moved =
        g.moved ||
        Math.abs(e.clientX - g.startX) > CLICK_SLOP_PX ||
        Math.abs(e.clientY - g.startY) > CLICK_SLOP_PX
      const rect =
        g.mode === 'move'
          ? { ...g.startRect, x: g.startRect.x + dx, y: g.startRect.y + dy }
          : computeResize(g.startRect, g.handle, dx, dy, e.shiftKey)
      setGesture({ ...g, rect, moved })
    },
    [setGesture],
  )

  const endGesture = useCallback(() => {
    const g = gestureRef.current
    setGesture(null)
    if (!g) return
    if (g.moved) {
      const shape = slide.shapes.find((s) => shapeKeyOf(slide.xmlPath, s.nodePath) === g.key)
      const changed =
        g.rect.x !== g.startRect.x ||
        g.rect.y !== g.startRect.y ||
        g.rect.w !== g.startRect.w ||
        g.rect.h !== g.startRect.h
      if (shape && changed) onGeometryCommit(shape, g.rect)
    } else if (g.wantsEdit) {
      // A click that didn't drag, on a box that was already selected.
      enterEdit(g.key, g.startX, g.startY, false)
    }
  }, [slide, onGeometryCommit, enterEdit, setGesture])

  const selectedShape = slide.shapes.find(
    (s) => shapeKeyOf(slide.xmlPath, s.nodePath) === selectedKey,
  )
  const gestureRect = gesture?.rect
  const liveRect = (key: ShapeKey, shape: Shape): RectEmuBox =>
    gesture && gesture.key === key && gesture.mode === 'resize' && gestureRect
      ? gestureRect
      : shape.xfrmEmu
  const liveTransform = (key: ShapeKey): string | undefined => {
    if (!gesture || gesture.key !== key || gesture.mode !== 'move') return undefined
    const dx = (gesture.rect.x - gesture.startRect.x) * scale
    const dy = (gesture.rect.y - gesture.startRect.y) * scale
    return `translate3d(${dx}px, ${dy}px, 0)`
  }

  return (
    <div
      ref={frameRef}
      className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-neutral-900/40 p-6"
      onPointerDown={() => onSelect(null)}
      onPointerMove={gesture ? onPointerMove : undefined}
      onPointerUp={gesture ? endGesture : undefined}
      onPointerCancel={gesture ? endGesture : undefined}
    >
      {scale > 0 && (
        <div
          className="relative overflow-hidden rounded-md bg-white shadow-2xl ring-1 ring-black/20"
          style={{
            width: sizeEmu.w * scale,
            height: sizeEmu.h * scale,
            // Resolved page background paints over the white base.
            ...fillCss(slide.background),
          }}
        >
          {slide.underlay && <UnderlayView shapes={slide.underlay} scale={scale} />}
          {slide.shapes.map((shape, i) => {
            const key = shapeKeyOf(slide.xmlPath, shape.nodePath)
            const reactKey = `${shape.id}:${i}`
            if (shape.type === 'text' && editingKey === key) {
              return (
                <TextEditOverlay
                  key={reactKey}
                  shape={shape}
                  scale={scale}
                  style={{
                    ...rectStyle(shape.xfrmEmu, scale),
                    transform: composeTransform(visualTransform(shape)),
                  }}
                  caretAt={caretPoint}
                  onAttach={onOverlayAttach}
                  onCommit={(next) => onTextCommit(shape, next)}
                />
              )
            }
            return (
              <ShapeView
                key={reactKey}
                shape={shape}
                rect={liveRect(key, shape)}
                scale={scale}
                selected={selectedKey === key}
                transform={composeTransform(liveTransform(key), visualTransform(shape))}
                onPointerDown={(e) => beginGesture(shape, 'move', 'se', e)}
                onDoubleClick={
                  shape.type === 'text' ? (e) => handleDoubleClick(shape, e) : undefined
                }
              />
            )
          })}

          {selectedShape && editingKey === null && (
            <SelectionFrame
              rect={liveRect(selectedKey as ShapeKey, selectedShape)}
              scale={scale}
              transform={composeTransform(
                liveTransform(selectedKey as ShapeKey),
                visualTransform(selectedShape),
              )}
              resizable={selectedShape.type !== 'group'}
              onHandleDown={(handle, e) => beginGesture(selectedShape, 'resize', handle, e)}
            />
          )}
        </div>
      )}

      {gesture?.moved && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-30 -translate-x-1/2 rounded-md border border-border bg-background/90 px-2 py-1 text-[11px] tabular-nums text-muted-foreground shadow-sm backdrop-blur">
          x {inches(gesture.rect.x)}″ · y {inches(gesture.rect.y)}″ · w {inches(gesture.rect.w)}″ · h{' '}
          {inches(gesture.rect.h)}″
        </div>
      )}
    </div>
  )
}
