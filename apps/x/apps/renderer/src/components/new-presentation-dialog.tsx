import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Columns2,
  Flag,
  Hash,
  ImageOff,
  List,
  Loader2,
  Minus,
  Plus,
  Quote,
  Sparkles,
  Trash2,
  Type,
  type LucideIcon,
} from 'lucide-react'
import type { deck as deckShared } from '@x/shared'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { DECK_PALETTES, newDeckPptx, type DeckPalette } from '@/lib/pptx/new-deck'
import { synthesizeDeckFromOutline } from '@/lib/pptx/generate'
import { disposeOutlinePreview, synthesizeOutlineDeck, type OutlinePreview } from '@/lib/pptx/preview'
import { SlideThumbnail } from '@/components/pptx/canvas'
import {
  bulletsToText,
  clarifyComplete,
  clarifyRequest,
  deleteSlide as deleteOutlineSlide,
  insertSlideAt,
  reorderSlides,
  updateBullets,
  updateHeading,
  updatePattern,
  type DeckOutlineSlide,
  type GenerateDeckOutlineRequest,
} from '@/components/pptx/outline-editing'

type DeckOutline = deckShared.DeckOutline
type DeckSlidePattern = deckShared.DeckSlidePattern

type NewPresentationDialogProps = {
  open: boolean
  targetFolder: string
  onOpenChange: (open: boolean) => void
  onCreated: (path: string) => void
}

type Mode = 'blank' | 'generate'
/** Where the generate flow is: form → (clarify) → outline review. */
type GenStep = 'form' | 'clarify' | 'review'

const TONES = ['Professional', 'Casual', 'Persuasive'] as const
const SLIDE_COUNTS = ['auto', '5', '8', '12'] as const

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** The palette's face: background, heading color, and its accent row. */
function PaletteSwatch({
  palette,
  selected,
  onSelect,
}: {
  palette: DeckPalette
  selected: boolean
  onSelect: () => void
}) {
  const s = palette.scheme
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex-1 rounded-lg border p-2 text-left transition-colors',
        selected ? 'border-primary ring-2 ring-primary/40' : 'border-border hover:border-primary/50',
      )}
    >
      <div
        className="flex h-14 flex-col justify-between rounded-md border border-black/5 p-2"
        style={{ backgroundColor: `#${s.lt1}` }}
      >
        <div className="h-2 w-2/3 rounded-sm" style={{ backgroundColor: `#${s.dk1}` }} />
        <div className="flex gap-1">
          {[s.accent1, s.accent2, s.accent3, s.accent4].map((hex, i) => (
            <div key={i} className="h-2 w-2 rounded-full" style={{ backgroundColor: `#${hex}` }} />
          ))}
        </div>
      </div>
      <div className="mt-1.5 text-xs font-medium">{palette.name}</div>
    </button>
  )
}

function PaletteRow({
  paletteId,
  onSelect,
}: {
  paletteId: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">Theme</span>
      <div className="flex gap-2">
        {DECK_PALETTES.map((palette) => (
          <PaletteSwatch
            key={palette.id}
            palette={palette}
            selected={palette.id === paletteId}
            onSelect={() => onSelect(palette.id)}
          />
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------- outline review (cards)

/** Icon per slide pattern; 'title' shows on card 0's fixed badge only. */
const PATTERN_ICONS: Record<DeckSlidePattern, LucideIcon> = {
  title: Type,
  bullets: List,
  'two-column': Columns2,
  'big-number': Hash,
  quote: Quote,
  section: Minus,
  closing: Flag,
}

const PATTERN_LABELS: Record<DeckSlidePattern, string> = {
  title: 'Title',
  bullets: 'Bullets',
  'two-column': 'Two columns',
  'big-number': 'Big number',
  quote: 'Quote',
  section: 'Section',
  closing: 'Closing',
}

/** The patterns the switcher offers (title is reserved for the first card). */
const SWITCHABLE_PATTERNS: DeckSlidePattern[] = [
  'bullets',
  'two-column',
  'big-number',
  'quote',
  'section',
  'closing',
]

/**
 * The pattern badge on a card's top-right corner. Fixed (plain badge) on the
 * title card; a popover switcher everywhere else.
 */
function PatternBadge({
  pattern,
  fixed,
  onChange,
}: {
  pattern: DeckSlidePattern
  fixed: boolean
  onChange: (pattern: DeckSlidePattern) => void
}) {
  const [open, setOpen] = useState(false)
  const Icon = PATTERN_ICONS[pattern]
  const badge = (
    <span
      className={cn(
        'inline-flex size-6 items-center justify-center rounded-md bg-muted text-muted-foreground',
        !fixed && 'transition-colors hover:bg-accent hover:text-accent-foreground',
      )}
    >
      <Icon className="size-3.5" />
    </span>
  )
  if (fixed) {
    return (
      <span title={PATTERN_LABELS[pattern]} aria-label={`Pattern: ${PATTERN_LABELS[pattern]}`}>
        {badge}
      </span>
    )
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`Pattern: ${PATTERN_LABELS[pattern]}`}
          aria-label={`Change pattern (${PATTERN_LABELS[pattern]})`}
        >
          {badge}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1">
        <div className="grid">
          {SWITCHABLE_PATTERNS.map((p) => {
            const OptionIcon = PATTERN_ICONS[p]
            return (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setOpen(false)
                  if (p !== pattern) onChange(p)
                }}
                aria-pressed={p === pattern}
                className={cn(
                  'flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground',
                  p === pattern && 'bg-muted font-medium',
                )}
              >
                <OptionIcon className="size-3.5 shrink-0 text-muted-foreground" />
                {PATTERN_LABELS[p]}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Compact palette chips for the outline screen: name + accent dots. */
function PaletteStrip({
  paletteId,
  onSelect,
}: {
  paletteId: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">Theme</span>
      {DECK_PALETTES.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onSelect(p.id)}
          aria-pressed={p.id === paletteId}
          className={cn(
            'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
            p.id === paletteId
              ? 'border-primary ring-2 ring-primary/40'
              : 'border-border hover:border-primary/50',
          )}
        >
          {p.name}
          <span className="flex gap-0.5">
            {[p.scheme.accent1, p.scheme.accent2, p.scheme.accent3].map((hex, i) => (
              <span key={i} className="size-2 rounded-full" style={{ backgroundColor: `#${hex}` }} />
            ))}
          </span>
        </button>
      ))}
    </div>
  )
}

/**
 * The hover-revealed insert affordance in the gap between two cards. Also the
 * drop target line's home: the indicator renders on the cards themselves.
 */
function GapInsert({ onInsert, label }: { onInsert: () => void; label: string }) {
  return (
    <div className="group/gap relative flex h-4 items-center justify-center">
      <button
        type="button"
        aria-label={label}
        onClick={onInsert}
        className="z-10 inline-flex size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/gap:opacity-100"
      >
        <Plus className="size-3" />
      </button>
    </div>
  )
}

export function NewPresentationDialog({
  open,
  targetFolder,
  onOpenChange,
  onCreated,
}: NewPresentationDialogProps) {
  const [mode, setMode] = useState<Mode>('blank')
  const [paletteId, setPaletteId] = useState(DECK_PALETTES[0].id)
  const [error, setError] = useState<string | null>(null)

  // Blank mode.
  const [name, setName] = useState('Untitled presentation')
  const [creating, setCreating] = useState(false)

  // Generate mode.
  const [prompt, setPrompt] = useState('')
  const [tone, setTone] = useState<(typeof TONES)[number]>('Professional')
  const [slideCount, setSlideCount] = useState<(typeof SLIDE_COUNTS)[number]>('auto')
  const [genStep, setGenStep] = useState<GenStep>('form')
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState('')
  const [questions, setQuestions] = useState<string[]>([])
  const [answers, setAnswers] = useState<string[]>([])
  const [outlineSlides, setOutlineSlides] = useState<DeckOutlineSlide[]>([])
  const [outlineTitle, setOutlineTitle] = useState('')
  // Card drag state, mirroring the slide rail: the dragged card index and the
  // GAP the drop indicator sits in (gap g is above card g).
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  // True only while the entrance stagger plays; edits never re-trigger it.
  const [entering, setEntering] = useState(false)
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Live preview: the in-memory deck this outline+palette will produce.
  const [preview, setPreview] = useState<OutlinePreview | null>(null)
  const [previewPending, setPreviewPending] = useState(false)
  const [selectedCard, setSelectedCard] = useState(0)
  const previewRef = useRef<OutlinePreview | null>(null)
  const previewKeyRef = useRef('')
  const previewSeqRef = useRef(0)
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const palette = useMemo(
    () => DECK_PALETTES.find((p) => p.id === paletteId) ?? DECK_PALETTES[0],
    [paletteId],
  )

  /** The outline Create writes AND the preview renders — one composition. */
  const composeOutline = useCallback(
    (): DeckOutline => ({
      title: outlineTitle.trim() || 'Untitled presentation',
      suggestedPalette: palette.id as DeckOutline['suggestedPalette'],
      slides: outlineSlides,
    }),
    [outlineTitle, palette, outlineSlides],
  )

  // Debounced preview rebuild, memoized per (outline, palette). Stale decks
  // are disposed (blob URLs revoked) whenever a newer preview replaces them.
  useEffect(() => {
    if (!open || mode !== 'generate' || genStep !== 'review' || outlineSlides.length === 0) return
    const outline = composeOutline()
    const key = `${palette.id}|${JSON.stringify(outline)}`
    if (key === previewKeyRef.current) return
    setPreviewPending(true)
    const seq = ++previewSeqRef.current
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current)
    previewTimerRef.current = setTimeout(() => {
      void (async () => {
        const built = await synthesizeOutlineDeck(outline, palette)
        if (seq !== previewSeqRef.current) {
          disposeOutlinePreview(built)
          return
        }
        previewKeyRef.current = key
        disposeOutlinePreview(previewRef.current)
        previewRef.current = built
        setPreview(built)
        setPreviewPending(false)
      })()
    }, 400)
    return () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current)
    }
  }, [open, mode, genStep, outlineSlides, outlineTitle, paletteId, palette, composeOutline])

  // Dispose the last preview when the dialog unmounts entirely.
  useEffect(
    () => () => {
      disposeOutlinePreview(previewRef.current)
      previewRef.current = null
    },
    [],
  )

  const reset = useCallback(() => {
    setMode('blank')
    setPaletteId(DECK_PALETTES[0].id)
    setError(null)
    setName('Untitled presentation')
    setCreating(false)
    setPrompt('')
    setTone('Professional')
    setSlideCount('auto')
    setGenStep('form')
    setBusy(false)
    setStage('')
    setQuestions([])
    setAnswers([])
    setOutlineSlides([])
    setOutlineTitle('')
    setDragFrom(null)
    setDragOver(null)
    setEntering(false)
    if (enterTimerRef.current) {
      clearTimeout(enterTimerRef.current)
      enterTimerRef.current = null
    }
    setPreview(null)
    setPreviewPending(false)
    setSelectedCard(0)
    previewKeyRef.current = ''
    previewSeqRef.current++
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current)
      previewTimerRef.current = null
    }
    disposeOutlinePreview(previewRef.current)
    previewRef.current = null
  }, [])

  const close = useCallback(() => {
    onOpenChange(false)
    reset()
  }, [onOpenChange, reset])

  /** Dedupe the target name the way the blank path does, then write + open. */
  const writeAndOpen = useCallback(
    async (baseName: string, bytes: Uint8Array) => {
      let fullPath = `${targetFolder}/${baseName}.pptx`
      let i = 1
      while ((await window.ipc.invoke('workspace:exists', { path: fullPath })).exists) {
        fullPath = `${targetFolder}/${baseName} (${i}).pptx`
        i += 1
      }
      await window.ipc.invoke('workspace:writeFile', {
        path: fullPath,
        data: uint8ArrayToBase64(bytes),
        opts: { encoding: 'base64' },
      })
      onOpenChange(false)
      reset()
      onCreated(fullPath)
    },
    [targetFolder, onOpenChange, reset, onCreated],
  )

  // ---------------------------------------------------------------- blank mode

  const handleCreateBlank = useCallback(async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Enter a name')
      return
    }
    if (trimmed.includes('/')) {
      setError('Name cannot contain "/"')
      return
    }
    setCreating(true)
    setError(null)
    try {
      const bytes = await newDeckPptx({ title: trimmed, palette })
      await writeAndOpen(trimmed, bytes)
    } catch (err) {
      setCreating(false)
      setError(err instanceof Error ? err.message : 'Failed to create the presentation')
    }
  }, [name, palette, writeAndOpen])

  // ------------------------------------------------------------- generate mode

  const baseRequest = useCallback((): GenerateDeckOutlineRequest => {
    const req: GenerateDeckOutlineRequest = { prompt: prompt.trim() }
    if (slideCount !== 'auto') req.slideCount = Number(slideCount)
    req.tone = tone
    return req
  }, [prompt, slideCount, tone])

  /** Runs the model call, then routes to clarify or review by what came back. */
  const runGeneration = useCallback(
    async (request: GenerateDeckOutlineRequest) => {
      setBusy(true)
      setError(null)
      setStage('Outlining your deck…')
      try {
        const res = await window.ipc.invoke('deck:generateOutline', request)
        if (res.error || !res.outline) {
          setError(res.error ?? 'The model did not return an outline')
          setBusy(false)
          return
        }
        const outline: DeckOutline = res.outline
        const qs = outline.clarifyingQuestions ?? []
        // Always adopt the model's palette suggestion unless the user has
        // already overridden it away from the default.
        if (paletteId === DECK_PALETTES[0].id) setPaletteId(outline.suggestedPalette)
        if (qs.length > 0 && genStep === 'form') {
          // First round only: surface questions before showing the outline.
          setQuestions(qs)
          setAnswers(qs.map(() => ''))
          setGenStep('clarify')
        } else {
          setOutlineTitle(outline.title)
          setOutlineSlides(outline.slides)
          setGenStep('review')
          setSelectedCard(0)
          // Stagger the cards in once per arrival; edits never re-animate.
          setEntering(true)
          if (enterTimerRef.current) clearTimeout(enterTimerRef.current)
          enterTimerRef.current = setTimeout(
            () => setEntering(false),
            outline.slides.length * 60 + 500,
          )
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to generate the outline')
      } finally {
        setBusy(false)
      }
    },
    [genStep, paletteId],
  )

  const handleContinue = useCallback(() => {
    if (!prompt.trim()) {
      setError('Describe the deck you want')
      return
    }
    void runGeneration(baseRequest())
  }, [prompt, baseRequest, runGeneration])

  const handleClarifyContinue = useCallback(() => {
    void runGeneration(clarifyRequest(baseRequest(), answers))
  }, [baseRequest, answers, runGeneration])

  const handleRegenerate = useCallback(() => {
    // Re-run with whatever answers were gathered; skips straight to review.
    void runGeneration(clarifyRequest(baseRequest(), answers))
  }, [baseRequest, answers, runGeneration])

  const handleCreateGenerated = useCallback(async () => {
    setBusy(true)
    setError(null)
    setStage('Building your deck…')
    try {
      const outline = composeOutline()
      // Synthesis throws before producing bytes on any failure, so a failed
      // build never reaches writeAndOpen — nothing is written.
      const { bytes } = await synthesizeDeckFromOutline(outline, palette)
      await writeAndOpen(outline.title, bytes)
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : 'Failed to build the presentation')
    }
  }, [composeOutline, palette, writeAndOpen])

  // --------------------------------------------------------------------- views

  const modeTabs = (
    <div className="flex gap-1 rounded-lg bg-muted p-1">
      {(['blank', 'generate'] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => {
            setMode(m)
            setError(null)
          }}
          className={cn(
            'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            mode === m ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {m === 'blank' ? 'Blank' : (
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="size-3.5" />
              Generate with AI
            </span>
          )}
        </button>
      ))}
    </div>
  )

  const blankBody = (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <label htmlFor="presentation-name" className="text-sm font-medium">Name</label>
        <Input
          id="presentation-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Quarterly review"
          autoFocus
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !creating) {
              e.preventDefault()
              void handleCreateBlank()
            }
          }}
        />
      </div>
      <PaletteRow paletteId={paletteId} onSelect={setPaletteId} />
    </div>
  )

  const generateForm = (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <label htmlFor="deck-prompt" className="text-sm font-medium">What should the deck cover?</label>
        <Textarea
          id="deck-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. A 10-minute investor pitch for our developer-tools startup: problem, product, traction, ask."
          rows={4}
          autoFocus
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-2">
          <label className="text-sm font-medium">Slides</label>
          <Select value={slideCount} onValueChange={(v) => setSlideCount(v as typeof slideCount)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              <SelectItem value="5">5</SelectItem>
              <SelectItem value="8">8</SelectItem>
              <SelectItem value="12">12</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <label className="text-sm font-medium">Tone</label>
          <Select value={tone} onValueChange={(v) => setTone(v as typeof tone)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {TONES.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {/* Theme moved to the outline screen, where the cards preview it. */}
    </div>
  )

  const clarifyBody = (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        Before drafting, a few quick questions — including any facts the deck should quote
        instead of inventing:
      </p>
      <div className="grid max-h-[50vh] gap-4 overflow-y-auto pr-1">
        {questions.map((q, i) => (
          <div key={i} className="grid gap-1.5">
            <label htmlFor={`clarify-${i}`} className="text-sm font-medium">{q}</label>
            <Input
              id={`clarify-${i}`}
              value={answers[i] ?? ''}
              placeholder="Your answer…"
              onChange={(e) => setAnswers((prev) => prev.map((a, j) => (j === i ? e.target.value : a)))}
              autoFocus={i === 0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !busy && clarifyComplete(questions, answers)) {
                  e.preventDefault()
                  handleClarifyContinue()
                }
              }}
            />
          </div>
        ))}
      </div>
    </div>
  )

  const selectedIndex = Math.max(0, Math.min(selectedCard, outlineSlides.length - 1))
  const selectedPreviewSlide = preview?.slides[selectedIndex] ?? null

  const reviewBody = (
    <div className="flex min-h-0 flex-1 gap-4">
      {/* LEFT: title + outline cards; selection drives the right pane. */}
      <div className="flex w-[380px] min-w-0 shrink-0 flex-col gap-3">
        <div className="grid gap-1.5">
          <label htmlFor="outline-title" className="text-sm font-medium">Title</label>
          <Input
            id="outline-title"
            value={outlineTitle}
            onChange={(e) => setOutlineTitle(e.target.value)}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {outlineSlides.map((s, i) => {
          const pattern: DeckSlidePattern = i === 0 ? 'title' : (s.pattern ?? 'bullets')
          const previewSlide = preview?.slides[i] ?? null
          return (
            <div key={i}>
              {/* Card. Drag mirrors the slide rail: gap g sits above card g. */}
              <div
                draggable={i !== 0}
                onClick={() => setSelectedCard(i)}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', String(i))
                  e.dataTransfer.effectAllowed = 'move'
                  setDragFrom(i)
                }}
                onDragEnd={() => {
                  setDragFrom(null)
                  setDragOver(null)
                }}
                onDragOver={(e) => {
                  if (dragFrom === null) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  const box = e.currentTarget.getBoundingClientRect()
                  const before = e.clientY < box.top + box.height / 2
                  // Nothing drops above the title card.
                  setDragOver(Math.max(1, before ? i : i + 1))
                }}
                onDrop={(e) => {
                  if (dragFrom === null || dragOver === null) return
                  e.preventDefault()
                  setOutlineSlides((prev) =>
                    reorderSlides(prev, dragFrom, dragOver > dragFrom ? dragOver - 1 : dragOver),
                  )
                  setDragFrom(null)
                  setDragOver(null)
                }}
                className={cn(
                  'group/card relative rounded-lg p-2.5 ring-1 ring-border/60 transition-all',
                  'hover:-translate-y-0.5 hover:bg-accent/40 hover:shadow-md hover:ring-border',
                  'focus-within:bg-accent/30 focus-within:shadow-sm',
                  selectedIndex === i && 'bg-accent/30 ring-2 ring-ring',
                  dragFrom === i && 'opacity-40',
                  i !== 0 && 'cursor-grab active:cursor-grabbing',
                  entering &&
                    'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:fill-mode-backwards motion-safe:duration-300',
                )}
                style={entering ? { animationDelay: `${i * 60}ms` } : undefined}
              >
                {(dragOver === i || (dragOver === i + 1 && i === outlineSlides.length - 1)) &&
                  dragFrom !== null && (
                    <span
                      aria-hidden="true"
                      className={cn(
                        'pointer-events-none absolute inset-x-1 z-20 h-0.5 rounded-full bg-[var(--ring)]',
                        dragOver === i ? '-top-2.5' : '-bottom-2.5',
                      )}
                    />
                  )}
                <div className="flex items-start gap-2">
                  <div className="flex shrink-0 flex-col items-center gap-1">
                    <span className="w-5 rounded bg-muted py-px text-center text-[10px] font-medium leading-none tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    {/* The live thumbnail: a real render of this slide. */}
                    <div className="pointer-events-none relative w-[88px] shrink-0 overflow-hidden rounded border border-border/60 bg-white">
                      {previewSlide && preview?.deck ? (
                        <SlideThumbnail
                          slide={previewSlide}
                          sizeEmu={preview.deck.slideSizeEmu}
                          widthPx={88}
                        />
                      ) : preview && !previewPending ? (
                        <div
                          className="flex aspect-video w-full items-center justify-center bg-muted text-muted-foreground"
                          title="Preview unavailable"
                        >
                          <ImageOff className="size-4" />
                        </div>
                      ) : (
                        <div className="aspect-video w-full animate-pulse bg-muted" />
                      )}
                      {previewPending && previewSlide && (
                        <div className="absolute inset-0 animate-pulse bg-muted/50" />
                      )}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <Input
                      value={s.heading}
                      placeholder="Slide heading"
                      onChange={(e) => setOutlineSlides((prev) => updateHeading(prev, i, e.target.value))}
                      className="h-7 border-0 bg-transparent px-1 text-sm font-semibold shadow-none focus-visible:ring-0"
                    />
                    {i > 0 && (
                      <Textarea
                        value={bulletsToText(s)}
                        placeholder="One bullet per line"
                        onChange={(e) => setOutlineSlides((prev) => updateBullets(prev, i, e.target.value))}
                        rows={Math.min(5, Math.max(2, bulletsToText(s).split('\n').length))}
                        className="mt-1 min-h-0 resize-none border-0 bg-transparent px-1 py-0.5 text-sm text-muted-foreground shadow-none focus-visible:ring-0"
                      />
                    )}
                    {s.needsInput && s.needsInput.length > 0 && (
                      // The facts the model refused to invent: the deck carries
                      // [bracketed] placeholders until the user fills them in.
                      <div className="mt-1.5 flex flex-wrap items-center gap-1 px-1">
                        {s.needsInput.map((need, ni) => (
                          <span
                            key={ni}
                            className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-500"
                          >
                            fill in: {need}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      aria-label="Delete slide"
                      disabled={outlineSlides.length <= 1}
                      onClick={() => setOutlineSlides((prev) => deleteOutlineSlide(prev, i))}
                      className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover/card:opacity-100 disabled:opacity-0"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                    <PatternBadge
                      pattern={pattern}
                      fixed={i === 0}
                      onChange={(p) => setOutlineSlides((prev) => updatePattern(prev, i, p))}
                    />
                  </div>
                </div>
              </div>
              {/* Insert-between gap (also the append gap after the last card). */}
              <GapInsert
                onInsert={() => setOutlineSlides((prev) => insertSlideAt(prev, i + 1))}
                label={i === outlineSlides.length - 1 ? 'Add slide at end' : `Insert slide after slide ${i + 1}`}
              />
            </div>
          )
        })}
        </div>
      </div>

      {/* RIGHT: theme strip + a large live render of the selected slide. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <PaletteStrip paletteId={paletteId} onSelect={setPaletteId} />
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/30 p-4">
          {selectedPreviewSlide && preview?.deck ? (
            <div
              className={cn(
                'max-w-full overflow-hidden rounded-md border border-border bg-white shadow-md transition-opacity',
                previewPending && 'opacity-60',
              )}
            >
              <SlideThumbnail
                slide={selectedPreviewSlide}
                sizeEmu={preview.deck.slideSizeEmu}
                widthPx={620}
              />
            </div>
          ) : preview && !previewPending ? (
            <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <ImageOff className="size-6" />
              Preview unavailable
            </div>
          ) : (
            <div className="aspect-video w-[520px] max-w-full animate-pulse rounded-md bg-muted" />
          )}
          {previewPending && (
            <span className="absolute right-3 top-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Updating…
            </span>
          )}
        </div>
      </div>
    </div>
  )

  const busyOverlay = busy && (
    <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {stage || 'Working…'}
    </div>
  )

  // Footer differs by mode/step.
  let footer: React.ReactNode
  if (mode === 'blank') {
    footer = (
      <>
        <Button variant="outline" onClick={close} disabled={creating}>Cancel</Button>
        <Button onClick={() => void handleCreateBlank()} disabled={creating || !name.trim()}>
          {creating ? 'Creating…' : 'Create'}
        </Button>
      </>
    )
  } else if (genStep === 'form') {
    footer = (
      <>
        <Button variant="outline" onClick={close} disabled={busy}>Cancel</Button>
        <Button onClick={handleContinue} disabled={busy || !prompt.trim()}>
          {busy ? 'Working…' : 'Continue'}
        </Button>
      </>
    )
  } else if (genStep === 'clarify') {
    footer = (
      <>
        <Button variant="outline" onClick={() => setGenStep('form')} disabled={busy}>Back</Button>
        <Button
          onClick={handleClarifyContinue}
          disabled={busy || !clarifyComplete(questions, answers)}
        >
          {busy ? 'Working…' : 'Continue'}
        </Button>
      </>
    )
  } else {
    footer = (
      <>
        <Button variant="outline" onClick={handleRegenerate} disabled={busy}>Regenerate</Button>
        <Button
          onClick={() => void handleCreateGenerated()}
          disabled={busy || outlineSlides.length === 0 || outlineSlides.every((s) => !s.heading.trim())}
        >
          {busy ? 'Building…' : 'Create'}
        </Button>
      </>
    )
  }

  const showRetry = mode === 'generate' && error && !busy && genStep === 'form'

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent
        className={cn(
          // The review step is a near-fullscreen two-pane sheet (cards +
          // live preview); every other step keeps the compact width. The
          // explicit grid rows pin the footer while the middle row scrolls.
          mode === 'generate' && genStep === 'review'
            ? 'h-[86vh] sm:max-w-[min(1200px,94vw)] grid-rows-[auto_minmax(0,1fr)_auto]'
            : 'max-w-xl',
        )}
      >
        <DialogHeader>
          <DialogTitle>New presentation</DialogTitle>
          <DialogDescription>
            {mode === 'blank'
              ? 'Creates a blank 16:9 deck and opens it in the editor.'
              : genStep === 'review'
                ? 'Review and edit the outline. Nothing is saved until you press Create.'
                : genStep === 'clarify'
                  ? 'Answer a couple of quick questions so the outline fits your audience and depth.'
                  : 'Describe your deck and let AI draft an outline you can edit.'}
          </DialogDescription>
        </DialogHeader>

        <div
          className={cn(
            // On the review sheet this row must flex so the panes get the
            // height and scroll internally; elsewhere it stacks as before.
            mode === 'generate' && genStep === 'review'
              ? 'flex min-h-0 flex-col gap-4'
              : 'grid gap-4',
          )}
        >
          {genStep === 'form' && modeTabs}
          {mode === 'blank' && blankBody}
          {mode === 'generate' && genStep === 'form' && generateForm}
          {mode === 'generate' && genStep === 'clarify' && clarifyBody}
          {mode === 'generate' && genStep === 'review' && reviewBody}
          {busyOverlay}
          {error && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <span>{error}</span>
              {showRetry && (
                <Button size="sm" variant="outline" onClick={handleContinue}>Retry</Button>
              )}
            </div>
          )}
        </div>

        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
