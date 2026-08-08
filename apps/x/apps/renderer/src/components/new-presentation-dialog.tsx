import { useCallback, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react'
import type { deck as deckShared } from '@x/shared'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import {
  addSlide as addOutlineSlide,
  bulletsToText,
  clarifyComplete,
  clarifyRequest,
  deleteSlide as deleteOutlineSlide,
  moveSlide,
  updateBullets,
  updateHeading,
  type DeckOutlineSlide,
  type GenerateDeckOutlineRequest,
} from '@/components/pptx/outline-editing'

type DeckOutline = deckShared.DeckOutline

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

  const palette = useMemo(
    () => DECK_PALETTES.find((p) => p.id === paletteId) ?? DECK_PALETTES[0],
    [paletteId],
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
      const outline: DeckOutline = {
        title: outlineTitle.trim() || 'Untitled presentation',
        suggestedPalette: palette.id as DeckOutline['suggestedPalette'],
        slides: outlineSlides,
      }
      // Synthesis throws before producing bytes on any failure, so a failed
      // build never reaches writeAndOpen — nothing is written.
      const { bytes } = await synthesizeDeckFromOutline(outline, palette)
      await writeAndOpen(outline.title, bytes)
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : 'Failed to build the presentation')
    }
  }, [outlineTitle, outlineSlides, palette, writeAndOpen])

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
      <PaletteRow paletteId={paletteId} onSelect={setPaletteId} />
    </div>
  )

  const clarifyBody = (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        A couple of quick questions to sharpen the outline:
      </p>
      {questions.map((q, i) => (
        <div key={i} className="grid gap-2">
          <label className="text-sm font-medium">{q}</label>
          <Input
            value={answers[i] ?? ''}
            onChange={(e) => setAnswers((prev) => prev.map((a, j) => (j === i ? e.target.value : a)))}
            autoFocus={i === 0}
          />
        </div>
      ))}
    </div>
  )

  const reviewBody = (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <label htmlFor="outline-title" className="text-sm font-medium">Title</label>
        <Input
          id="outline-title"
          value={outlineTitle}
          onChange={(e) => setOutlineTitle(e.target.value)}
        />
      </div>
      <div className="grid max-h-[46vh] gap-2 overflow-y-auto pr-1">
        {outlineSlides.map((s, i) => (
          <div key={i} className="rounded-lg border border-border p-2">
            <div className="flex items-center gap-2">
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {i + 1}
              </span>
              <Input
                value={s.heading}
                placeholder="Slide heading"
                onChange={(e) => setOutlineSlides((prev) => updateHeading(prev, i, e.target.value))}
                className="h-8"
              />
              <div className="flex shrink-0 items-center gap-0.5">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  disabled={i === 0}
                  onClick={() => setOutlineSlides((prev) => moveSlide(prev, i, -1))}
                  aria-label="Move up"
                >
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  disabled={i === outlineSlides.length - 1}
                  onClick={() => setOutlineSlides((prev) => moveSlide(prev, i, 1))}
                  aria-label="Move down"
                >
                  <ArrowDown className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  disabled={outlineSlides.length <= 1}
                  onClick={() => setOutlineSlides((prev) => deleteOutlineSlide(prev, i))}
                  aria-label="Delete slide"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
            {i > 0 && (
              <Textarea
                value={bulletsToText(s)}
                placeholder="One bullet per line"
                onChange={(e) => setOutlineSlides((prev) => updateBullets(prev, i, e.target.value))}
                rows={Math.min(6, Math.max(2, bulletsToText(s).split('\n').length))}
                className="mt-2 text-sm"
              />
            )}
          </div>
        ))}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="justify-self-start"
        onClick={() => setOutlineSlides((prev) => addOutlineSlide(prev))}
      >
        <Plus className="size-4" />
        Add slide
      </Button>
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
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New presentation</DialogTitle>
          <DialogDescription>
            {mode === 'blank'
              ? 'Creates a blank 16:9 deck and opens it in the editor.'
              : genStep === 'review'
                ? 'Review and edit the outline. Nothing is saved until you press Create.'
                : 'Describe your deck and let AI draft an outline you can edit.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
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
