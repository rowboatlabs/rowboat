import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  BarChart3Icon,
  FilmIcon,
  GroupIcon,
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
  displayAlign,
  displayRunStyle,
  type TextOverlayHandle,
} from './text-dom'
import { TextEditOverlay } from './text-overlay'

const PLACEHOLDER_META: Record<PlaceholderKind, { label: string; Icon: typeof ShapesIcon }> = {
  chart: { label: 'Chart', Icon: BarChart3Icon },
  smartart: { label: 'Diagram', Icon: ShapesIcon },
  table: { label: 'Table', Icon: TableIcon },
  group: { label: 'Group', Icon: GroupIcon },
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

interface ShapeViewProps {
  shape: Shape
  rect: RectEmuBox
  scale: number
  selected: boolean
  transform?: string
  onPointerDown: (e: ReactPointerEvent) => void
}

function ShapeView({ shape, rect, scale, selected, transform, onPointerDown }: ShapeViewProps) {
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
}: {
  shape: TextShape
  rect: RectEmuBox
  scale: number
  style: CSSProperties
  selected: boolean
  onPointerDown: (e: ReactPointerEvent) => void
}) {
  const ptToPx = (pt: number) => pt * EMU_PER_PT * scale
  // Auto-number counters accumulate down the shape; deeper levels reset when
  // a shallower numbered paragraph appears.
  const counters: Record<number, number> = {}

  return (
    <div
      onPointerDown={onPointerDown}
      style={{
        ...style,
        cursor: selected ? 'move' : 'text',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        ...fillCss(shape.visual?.fill),
        ...lineCss(shape.visual?.line, scale),
        ...radiusCss(shape.visual?.geom, rect, scale),
      }}
      className="group/pptx-shape overflow-hidden"
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

          return (
            <p
              key={pi}
              style={{
                textAlign: alignToCss(displayAlign(shape, pi, para)),
                margin: 0,
                whiteSpace: 'pre-wrap',
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
                    lineHeight: 1.2,
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
                      lineHeight: 1.2,
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
  onHandleDown,
}: {
  rect: RectEmuBox
  scale: number
  transform?: string
  onHandleDown: (handle: HandleId, e: ReactPointerEvent) => void
}) {
  return (
    <div
      style={{ ...rectStyle(rect, scale), transform }}
      className="pointer-events-none z-10 outline-2 outline-offset-1 outline-[var(--ring)]"
    >
      {HANDLES.map((h) => (
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

const CSS_PX_PER_EMU = 96 / EMU_PER_INCH

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

  const beginGesture = useCallback(
    (shape: Shape, mode: 'move' | 'resize', handle: HandleId, e: ReactPointerEvent) => {
      e.stopPropagation()
      if (e.button !== 0) return
      const key = shapeKeyOf(slide.xmlPath, shape.nodePath)
      const wasSelected = selectedKey === key
      onSelect(key)
      // Editing already: let the overlay keep the pointer.
      if (editingKey === key) return
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

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const g = gestureRef.current
      const s = scaleRef.current
      if (!g || s <= 0) return
      const dx = snapToGrid((e.clientX - g.startX) / s)
      const dy = snapToGrid((e.clientY - g.startY) / s)
      const moved =
        g.moved || Math.abs(e.clientX - g.startX) > 3 || Math.abs(e.clientY - g.startY) > 3
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
      onStartEdit(g.key)
    }
  }, [slide, onGeometryCommit, onStartEdit, setGesture])

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
          style={{ width: sizeEmu.w * scale, height: sizeEmu.h * scale }}
        >
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
