import type { ReactNode } from 'react'
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BoldIcon,
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { RunFormatOverrides } from '@/lib/pptx/serialize'
import type { TextAlign } from '@/lib/pptx/types'

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
        <Tooltip>
          <TooltipTrigger asChild>
            <label
              className={`relative inline-flex size-7 items-center justify-center rounded-md ${
                fmtOff ? 'pointer-events-none opacity-40' : 'hover:bg-accent'
              }`}
            >
              <span className="text-[13px] font-semibold leading-none text-foreground">A</span>
              <span
                className="mt-3.5 absolute bottom-1 h-1 w-4 rounded-sm ring-1 ring-black/20"
                style={{ backgroundColor: colorValue }}
              />
              <input
                type="color"
                aria-label="Text color"
                value={colorValue}
                disabled={fmtOff}
                onMouseDown={(e) => e.stopPropagation()}
                onChange={(e) => onColorChange(e.target.value.slice(1).toUpperCase())}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </label>
          </TooltipTrigger>
          <TooltipContent side="bottom">{fmtHint ?? 'Text color'}</TooltipContent>
        </Tooltip>
      </Group>

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
