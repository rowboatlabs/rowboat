import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BoldIcon,
  CheckIcon,
  ChevronDownIcon,
  DownloadIcon,
  ItalicIcon,
  MinusIcon,
  PlayIcon,
  PlusIcon,
  PresentationIcon,
  Redo2Icon,
  UnderlineIcon,
  Undo2Icon,
} from 'lucide-react'
import { PaletteIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { isFontAvailable } from '@/components/pptx/text-dom'
import { DECK_PALETTES } from '@/lib/pptx/new-deck'
import type { RunFormatOverrides } from '@/lib/pptx/serialize'
import type { TextAlign } from '@/lib/pptx/types'
import { cn } from '@/lib/utils'

export type SaveStatus = 'clean' | 'saving' | 'saved' | 'error'

export const ZOOM_STEPS = [50, 75, 100, 125, 150, 175, 200] as const
export const MIN_ZOOM = ZOOM_STEPS[0]
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]

interface ToolButtonProps {
  label: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  children: ReactNode
}

function ToolButton({ label, onClick, disabled, active, children }: ToolButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          // Keep focus in the text overlay so the selection survives the click.
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClick}
          className={`inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors disabled:pointer-events-none disabled:opacity-40 ${
            active
              ? 'bg-primary/12 text-foreground'
              : 'hover:bg-accent hover:text-accent-foreground'
          }`}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

function Group({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 items-center gap-0.5">{children}</div>
}

/** Families offered on every deck, beneath the ones the deck already uses. */
export const COMMON_FONTS = [
  'Arial',
  'Helvetica',
  'Tahoma',
  'Verdana',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Calibri',
] as const

/** Shown only for a family this machine cannot actually render. */
const MISSING_SUFFIX =
  'is not installed on this machine, so it renders with a substitute and its spacing may differ from PowerPoint.'

interface FontPickerProps {
  /** Resolved family of the selection; undefined means a mixed selection. */
  value: string | undefined
  /** Typefaces already used in this deck, listed first. */
  deckFonts: readonly string[]
  disabled: boolean
  disabledReason: string | null
  onChange: (family: string) => void
}

/** w-56 / max-h-72, needed up front to place and clamp the portaled menu. */
const FONT_MENU_W = 224
const FONT_MENU_MAX_H = 288
const VIEWPORT_PAD = 8

interface MenuPos {
  left: number
  top: number
  maxHeight: number
}

/**
 * Font family picker.
 *
 * The menu is PORTALED to document.body, not positioned inside the picker.
 * The toolbar row is `overflow-x-auto`, and per CSS a non-visible overflow on
 * one axis forces the other axis from `visible` to `auto` — so an absolutely
 * positioned menu inside the row was clipped by the row's own scrollport and
 * never appeared, even though it was mounted and `aria-expanded` was true.
 *
 * Every control in it is still a plain button that `preventDefault`s on
 * mousedown, portal included: taking focus would blur the text overlay, which
 * commits the edit and ends the session, so the pick would land on the whole
 * shape instead of the selected runs.
 */
function FontPicker({ value, deckFonts, disabled, disabledReason, onChange }: FontPickerProps) {
  const [pos, setPos] = useState<MenuPos | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const open = pos !== null

  const close = useCallback(() => setPos(null), [])

  const openMenu = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const left = Math.max(
      VIEWPORT_PAD,
      Math.min(rect.left, window.innerWidth - FONT_MENU_W - VIEWPORT_PAD),
    )
    const below = window.innerHeight - rect.bottom - VIEWPORT_PAD
    const above = rect.top - VIEWPORT_PAD
    // Flip up only when below is genuinely too cramped to be usable.
    const flip = below < 160 && above > below
    const maxHeight = Math.max(120, Math.min(FONT_MENU_MAX_H, flip ? above : below))
    setPos({
      left,
      top: flip ? Math.max(VIEWPORT_PAD, rect.top - 4 - maxHeight) : rect.bottom + 4,
      maxHeight,
    })
  }, [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      // The menu lives outside this component's DOM subtree now, so both the
      // trigger and the portal have to count as "inside".
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    // Capture, so a scroll in any nested container (the toolbar row, the
    // canvas) closes the menu rather than leaving it stranded mid-air.
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open, close])

  // Deck fonts first, then the common list minus anything already shown.
  const extras = COMMON_FONTS.filter((f) => !deckFonts.includes(f))
  const label = disabled ? '—' : (value ?? 'Mixed')
  // Only warn about a font that genuinely does not resolve here. Saying it
  // unconditionally read as a claim about the CURRENT font, which was wrong
  // whenever that font was installed — the common case.
  const missing = !disabled && value !== undefined && !isFontAvailable(value)
  const tip = disabledReason ?? (missing ? `${value} ${MISSING_SUFFIX}` : 'Font')

  const pick = (family: string): void => {
    onChange(family)
    close()
  }

  return (
    <div className="relative shrink-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            aria-label="Font"
            aria-haspopup="listbox"
            aria-expanded={open}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (open ? close() : openMenu())}
            className="inline-flex h-7 w-32 items-center justify-between gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <span className="truncate" style={value ? { fontFamily: `'${value}'` } : undefined}>
              {label}
            </span>
            {missing && <span className="shrink-0 text-[10px] text-amber-500">•</span>}
            <ChevronDownIcon className="size-3 shrink-0" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{tip}</TooltipContent>
      </Tooltip>

      {pos !== null &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label="Font"
            onMouseDown={(e) => e.preventDefault()}
            style={{
              position: 'fixed',
              left: pos.left,
              top: pos.top,
              width: FONT_MENU_W,
              maxHeight: pos.maxHeight,
            }}
            className="z-[100] overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md"
          >
            {deckFonts.length > 0 && (
              <>
                <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  In this presentation
                </div>
                {deckFonts.map((f) => (
                  <FontOption key={`deck:${f}`} family={f} selected={f === value} onPick={pick} />
                ))}
              </>
            )}
            {extras.length > 0 && (
              <>
                <div className="mt-1 border-t border-border px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Common
                </div>
                {extras.map((f) => (
                  <FontOption key={`common:${f}`} family={f} selected={f === value} onPick={pick} />
                ))}
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}

function FontOption({
  family,
  selected,
  onPick,
}: {
  family: string
  selected: boolean
  onPick: (family: string) => void
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      // Portal or not, focus must stay in the contentEditable.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onPick(family)}
      className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground ${
        selected ? 'text-foreground' : 'text-muted-foreground'
      }`}
    >
      <span className="truncate" style={{ fontFamily: `'${family}'` }}>
        {family}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {!isFontAvailable(family) && (
          <span className="text-[10px] text-amber-500" title={`${family} ${MISSING_SUFFIX}`}>
            substituted
          </span>
        )}
        {selected && <CheckIcon className="size-3" />}
      </span>
    </button>
  )
}

interface ColorSwatchProps {
  label: string
  /** Glyph drawn above the colour bar. */
  glyph: ReactNode
  /** `#RRGGBB`. */
  value: string
  disabled: boolean
  onChange: (hex: string) => void
}

/** The toolbar's colour control: a glyph over a colour bar, backed by an
 * `<input type="color">` filling the whole hit area. */
function ColorSwatch({ label, glyph, value, disabled, onChange }: ColorSwatchProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <label
          className={`relative inline-flex size-7 shrink-0 items-center justify-center rounded-md ${
            disabled ? 'pointer-events-none opacity-40' : 'hover:bg-accent'
          }`}
        >
          {glyph}
          <span
            className="absolute bottom-1 h-1 w-4 rounded-sm ring-1 ring-black/20"
            style={{ backgroundColor: value }}
          />
          <input
            type="color"
            aria-label={label}
            value={value}
            disabled={disabled}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => onChange(e.target.value.slice(1).toUpperCase())}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

/** What the Insert menu offers. */
export type InsertChoice = 'textbox' | 'rect' | 'roundRect' | 'ellipse' | 'line' | 'image'

const INSERT_ITEMS: ReadonlyArray<{ choice: InsertChoice; label: string }> = [
  { choice: 'textbox', label: 'Text box' },
  { choice: 'rect', label: 'Rectangle' },
  { choice: 'roundRect', label: 'Rounded rectangle' },
  { choice: 'ellipse', label: 'Ellipse' },
  { choice: 'line', label: 'Line' },
  { choice: 'image', label: 'Image…' },
]

/**
 * Insert menu. Portaled for the same reason the font picker is: the toolbar
 * row is `overflow-x-auto`, which forces overflow-y to `auto` and clips any
 * absolutely positioned child.
 */
function InsertMenu({ onInsert }: { onInsert: (choice: InsertChoice) => void }) {
  const [pos, setPos] = useState<MenuPos | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const open = pos !== null
  const close = useCallback(() => setPos(null), [])

  const openMenu = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setPos({
      left: Math.max(VIEWPORT_PAD, Math.min(rect.left, window.innerWidth - 200 - VIEWPORT_PAD)),
      top: rect.bottom + 4,
      maxHeight: Math.max(120, window.innerHeight - rect.bottom - VIEWPORT_PAD),
    })
  }, [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open, close])

  return (
    <div className="relative shrink-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            aria-label="Insert"
            aria-haspopup="menu"
            aria-expanded={open}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (open ? close() : openMenu())}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <PlusIcon className="size-3.5" />
            Insert
            <ChevronDownIcon className="size-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Insert a shape, text box or image</TooltipContent>
      </Tooltip>

      {pos !== null &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Insert"
            onMouseDown={(e) => e.preventDefault()}
            style={{ position: 'fixed', left: pos.left, top: pos.top, width: 200, maxHeight: pos.maxHeight }}
            className="z-[100] overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md"
          >
            {INSERT_ITEMS.map((item) => (
              <button
                key={item.choice}
                type="button"
                role="menuitem"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onInsert(item.choice)
                  close()
                }}
                className="flex w-full items-center rounded px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}

function Divider() {
  return <div className="mx-1.5 h-4 w-px shrink-0 bg-border" aria-hidden="true" />
}

const SAVE_LABEL: Record<SaveStatus, string> = {
  clean: 'All changes saved',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed',
}

/** Quiet status text — nothing to say until the deck has actually been touched. */
function SaveState({ status }: { status: SaveStatus }) {
  if (status === 'clean') return null
  return (
    <span
      className={`shrink-0 text-[11px] ${
        status === 'error' ? 'text-destructive' : 'text-muted-foreground'
      }`}
    >
      {SAVE_LABEL[status]}
    </span>
  )
}

export interface EditorHeaderProps {
  fileName: string
  /** Full path, shown on hover. */
  filePath: string
  saveStatus: SaveStatus
  onPlay: () => void
  onExport: () => void
  /** The deck's current palette id, highlighted in the picker; null = unknown. */
  paletteId: string | null
  /** Swap the deck's theme to the chosen built-in palette. */
  onChangeTheme: (paletteId: string) => void
  /** True while a swap is in flight, so the picker disables. */
  themeBusy: boolean
}

/** A row of the built-in palettes; the deck's current one is highlighted. */
function ThemePalettePicker({
  paletteId,
  onChangeTheme,
  busy,
}: {
  paletteId: string | null
  onChangeTheme: (paletteId: string) => void
  busy: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Change theme"
              disabled={busy}
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            >
              <PaletteIcon className="size-4" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Change theme</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-auto p-2">
        <div className="mb-1.5 px-1 text-[11px] font-medium text-muted-foreground">Theme</div>
        {/* Nine palettes: a compact grid, not a row. */}
        <div className="grid grid-cols-3 gap-2">
          {DECK_PALETTES.map((p) => {
            const selected = p.id === paletteId
            return (
              <button
                key={p.id}
                type="button"
                aria-label={p.name}
                aria-pressed={selected}
                disabled={busy}
                onClick={() => {
                  setOpen(false)
                  if (!selected) onChangeTheme(p.id)
                }}
                className={cn(
                  'w-16 rounded-md border p-1.5 text-left transition-colors disabled:opacity-50',
                  selected ? 'border-primary ring-2 ring-primary/40' : 'border-border hover:border-primary/50',
                )}
              >
                <div
                  className="flex h-9 flex-col justify-between rounded border border-black/5 p-1"
                  style={{ backgroundColor: `#${p.scheme.lt1}` }}
                >
                  <div className="h-1.5 w-2/3 rounded-sm" style={{ backgroundColor: `#${p.scheme.dk1}` }} />
                  <div className="flex gap-0.5">
                    {[p.scheme.accent1, p.scheme.accent2, p.scheme.accent3].map((hex, i) => (
                      <div key={i} className="size-1.5 rounded-full" style={{ backgroundColor: `#${hex}` }} />
                    ))}
                  </div>
                </div>
                <div className="mt-1 text-[11px] font-medium">{p.name}</div>
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * The slim identity row above the toolbar. Present is deliberately the only
 * accent-coloured control on the whole surface, so Export sits beside it as a
 * quiet icon button.
 */
export function EditorHeader({
  fileName,
  filePath,
  saveStatus,
  onPlay,
  onExport,
  paletteId,
  onChangeTheme,
  themeBusy,
}: EditorHeaderProps) {
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
      <PresentationIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate text-sm font-medium text-foreground" title={filePath}>
        {fileName}
      </span>
      <Badge
        variant="outline"
        className="rounded px-1 py-0 text-[10px] font-medium tracking-wide text-muted-foreground"
      >
        PPTX
      </Badge>
      <SaveState status={saveStatus} />
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <ThemePalettePicker paletteId={paletteId} onChangeTheme={onChangeTheme} busy={themeBusy} />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Export a copy"
              onClick={onExport}
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <DownloadIcon className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Export a copy</TooltipContent>
        </Tooltip>
        <Button size="xs" onClick={onPlay}>
          <PlayIcon />
          Present
        </Button>
      </div>
    </header>
  )
}

export interface ToolbarProps {
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void

  zoomPercent: number
  isFitZoom: boolean
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomFit: () => void

  /** Null when the selection can't take text formatting. */
  format: RunFormatOverrides | null
  formatDisabledReason: string | null
  /** Resolved typeface of the selection; undefined renders as "Mixed". */
  onInsert: (choice: InsertChoice) => void
  /** Shape fill / outline as `#RRGGBB`; null hides the control entirely. */
  shapeFill: string | null
  shapeLine: string | null
  onShapeFillChange: (hex: string) => void
  onShapeLineChange: (hex: string) => void
  font: string | undefined
  /** Typefaces already used in the deck, offered above the common list. */
  deckFonts: readonly string[]
  onFontChange: (family: string) => void
  onToggleBold: () => void
  onToggleItalic: () => void
  onToggleUnderline: () => void
  onFontSizeStep: (delta: number) => void
  onColorChange: (hex: string) => void

  align: TextAlign | null
  onAlign: (align: TextAlign) => void

  slideNumber: number
  slideCount: number
}

export function EditorToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  zoomPercent,
  isFitZoom,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  format,
  formatDisabledReason,
  onInsert,
  shapeFill,
  shapeLine,
  onShapeFillChange,
  onShapeLineChange,
  font,
  deckFonts,
  onFontChange,
  onToggleBold,
  onToggleItalic,
  onToggleUnderline,
  onFontSizeStep,
  onColorChange,
  align,
  onAlign,
  slideNumber,
  slideCount,
}: ToolbarProps) {
  const fmtOff = format === null
  const sizeLabel = format?.sizePt !== undefined ? String(Math.round(format.sizePt)) : '—'
  const colorValue = `#${format?.colorHex ?? '000000'}`
  const fmtHint = formatDisabledReason ?? undefined

  return (
    <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border px-3 py-1">
      <Group>
        <ToolButton label="Undo (⌘Z)" onClick={onUndo} disabled={!canUndo}>
          <Undo2Icon className="size-4" />
        </ToolButton>
        <ToolButton label="Redo (⇧⌘Z)" onClick={onRedo} disabled={!canRedo}>
          <Redo2Icon className="size-4" />
        </ToolButton>
      </Group>

      <Divider />

      <Group>
        <ToolButton label="Zoom out" onClick={onZoomOut} disabled={zoomPercent <= MIN_ZOOM}>
          <MinusIcon className="size-4" />
        </ToolButton>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={onZoomFit}
              className={`min-w-14 rounded-md px-1.5 py-1 text-xs tabular-nums transition-colors hover:bg-accent hover:text-accent-foreground ${
                isFitZoom ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              {isFitZoom ? 'Fit' : `${Math.round(zoomPercent)}%`}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Fit slide to window</TooltipContent>
        </Tooltip>
        <ToolButton label="Zoom in" onClick={onZoomIn} disabled={zoomPercent >= MAX_ZOOM}>
          <PlusIcon className="size-4" />
        </ToolButton>
      </Group>

      <Divider />

      <InsertMenu onInsert={onInsert} />

      <Divider />

      <FontPicker
        value={font}
        deckFonts={deckFonts}
        disabled={fmtOff}
        disabledReason={formatDisabledReason}
        onChange={onFontChange}
      />

      <Group>
        <ToolButton
          label={fmtHint ?? 'Decrease font size'}
          onClick={() => onFontSizeStep(-2)}
          disabled={fmtOff}
        >
          <MinusIcon className="size-4" />
        </ToolButton>
        <span
          className="min-w-7 text-center text-xs tabular-nums text-muted-foreground"
          title={fmtOff ? undefined : 'Font size (pt)'}
        >
          {fmtOff ? '—' : sizeLabel}
        </span>
        <ToolButton
          label={fmtHint ?? 'Increase font size'}
          onClick={() => onFontSizeStep(2)}
          disabled={fmtOff}
        >
          <PlusIcon className="size-4" />
        </ToolButton>
      </Group>

      <Group>
        <ToolButton
          label={fmtHint ?? 'Bold'}
          onClick={onToggleBold}
          disabled={fmtOff}
          active={Boolean(format?.bold)}
        >
          <BoldIcon className="size-4" />
        </ToolButton>
        <ToolButton
          label={fmtHint ?? 'Italic'}
          onClick={onToggleItalic}
          disabled={fmtOff}
          active={Boolean(format?.italic)}
        >
          <ItalicIcon className="size-4" />
        </ToolButton>
        <ToolButton
          label={fmtHint ?? 'Underline'}
          onClick={onToggleUnderline}
          disabled={fmtOff}
          active={Boolean(format?.underline)}
        >
          <UnderlineIcon className="size-4" />
        </ToolButton>
        <ColorSwatch
          label="Text color"
          glyph={<span className="text-[13px] font-semibold leading-none text-foreground">A</span>}
          value={colorValue}
          disabled={fmtOff}
          onChange={onColorChange}
        />
      </Group>

      {(shapeFill !== null || shapeLine !== null) && (
        <>
          <Divider />
          <Group>
            {shapeFill !== null && (
              <ColorSwatch
                label="Shape fill"
                glyph={
                  <span
                    className="size-3 rounded-[2px] ring-1 ring-black/20"
                    style={{ backgroundColor: shapeFill }}
                  />
                }
                value={shapeFill}
                disabled={false}
                onChange={onShapeFillChange}
              />
            )}
            {shapeLine !== null && (
              <ColorSwatch
                label="Shape outline"
                glyph={
                  <span className="size-3 rounded-[2px] border-2" style={{ borderColor: shapeLine }} />
                }
                value={shapeLine}
                disabled={false}
                onChange={onShapeLineChange}
              />
            )}
          </Group>
        </>
      )}

      <Divider />

      <Group>
        <ToolButton
          label={fmtHint ?? 'Align left'}
          onClick={() => onAlign('l')}
          disabled={fmtOff}
          active={align === 'l'}
        >
          <AlignLeftIcon className="size-4" />
        </ToolButton>
        <ToolButton
          label={fmtHint ?? 'Align center'}
          onClick={() => onAlign('ctr')}
          disabled={fmtOff}
          active={align === 'ctr'}
        >
          <AlignCenterIcon className="size-4" />
        </ToolButton>
        <ToolButton
          label={fmtHint ?? 'Align right'}
          onClick={() => onAlign('r')}
          disabled={fmtOff}
          active={align === 'r'}
        >
          <AlignRightIcon className="size-4" />
        </ToolButton>
      </Group>

      <span className="ml-auto shrink-0 pl-3 text-xs tabular-nums text-muted-foreground">
        Slide {slideNumber} of {slideCount}
      </span>
    </div>
  )
}
