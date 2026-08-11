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
import {
  CopyIcon,
  ExternalLinkIcon,
  Loader2Icon,
  PlusIcon,
  PresentationIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { disposeDeck, parseAddedSlide, parsePptx } from '@x/shared/dist/pptx/parse.js'
import { upgradeGeneratedDeck, DECK_PALETTES } from '@x/shared/dist/pptx/new-deck.js'
import { buildThemeXml, resolveThemePath } from '@x/shared/dist/pptx/restyle.js'
import { planDuplicateSlide, planNewSlide, readSlideRels } from '@x/shared/dist/pptx/add-slide.js'
import { isLinePreset } from '@x/shared/dist/pptx/geometry.js'
import type { NewShapeSpec } from '@x/shared/dist/pptx/shape-xml.js'
import { writeDeck, type EditedParagraph, type RunFormatOverrides } from '@x/shared/dist/pptx/serialize.js'
import type {
  Fill,
  NodePath,
  Paragraph,
  Shape,
  Slide,
  SlideDeck,
  TextAlign,
  TextShape,
} from '@x/shared/dist/pptx/types.js'
import {
  EMPTY_DECK_EDITS,
  EMU_PER_INCH,
  EMU_PER_PX,
  acceptsFormatting,
  applyEditSet,
  editHoldsFormatting,
  hasEdits,
  isInsertedShape,
  isNoopCommit,
  runKeyOf,
  shapeKeyOf,
  spTreeSlotOf,
  structureMatches,
  insertsToSlideEdits,
  mergeSlideEdits,
  toSlideEdits,
  withShapeEdit,
  withShapeInserted,
  withShapeUninserted,
  withSlideAdded,
  withSlideOrder,
  withSlideRemoved,
  type DeckEdits,
  type EditSet,
  type RectEmuBox,
  type ShapeKey,
} from '@/components/pptx/edit-model'
import { SlideCanvas, SlideThumbnail } from '@/components/pptx/canvas'
import { createSavePipeline, type SavePipeline } from '@/components/pptx/save-pipeline'
import { createDeckFileSync, ExternalChangeError, type DeckFileSync } from '@/components/pptx/file-sync'
import { PresentationOverlay } from '@/components/pptx/presentation'
import {
  EditorHeader,
  EditorToolbar,
  type InsertChoice,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEPS,
  type SaveStatus,
} from '@/components/pptx/toolbar'
import {
  DEFAULT_TEXT_PT,
  aggregateFontOfShape,
  aggregateFontOfSpans,
  aggregateFormat,
  aggregateFormatOfParagraphs,
  applyAlignToBlocks,
  applyFormatToSpans,
  fontScaleOf,
  selectedParagraphBlocks,
  selectedRunSpans,
  typefacesInShapes,
  type TextOverlayHandle,
} from '@/components/pptx/text-dom'

interface PptxEditorProps {
  path: string
  /**
   * Reports the slide the user is looking at (1-based) and the deck's length,
   * so the host can tell the assistant what "this slide" refers to. Fires on
   * mount once the deck is parsed and on every selection / slide-count change.
   */
  onSlideChange?: (slideNumber: number, slideCount: number) => void
}

type LoadState = 'loading' | 'ready' | 'error'

/** Default sizes for inserted shapes, centred on the slide. */
const INSERT_SIZES: Record<string, { w: number; h: number }> = {
  textbox: { w: 4 * EMU_PER_INCH, h: 0.6 * EMU_PER_INCH },
  rect: { w: 3 * EMU_PER_INCH, h: 2 * EMU_PER_INCH },
  roundRect: { w: 3 * EMU_PER_INCH, h: 2 * EMU_PER_INCH },
  ellipse: { w: 2.5 * EMU_PER_INCH, h: 2.5 * EMU_PER_INCH },
  line: { w: 3 * EMU_PER_INCH, h: 0 },
  image: { w: 4 * EMU_PER_INCH, h: 3 * EMU_PER_INCH },
}

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

/** The header carries a PPTX badge, so the extension would just be noise. */
function displayName(path: string): string {
  return baseName(path).replace(/\.pptx$/i, '')
}

/**
 * One undo/redo step. A plain step is an edit-set snapshot; a theme step also
 * carries the theme part bytes before/after the swap (edits are unchanged
 * across it), so undo restores `before` and redo re-applies `after`.
 */
interface HistoryEntry {
  edits: DeckEdits
  theme?: { before: string; after: string }
}

/** The built-in palette id a theme's bytes correspond to, or null if custom. */
function paletteIdOfTheme(themeXml: string | null): string | null {
  if (!themeXml) return null
  for (const p of DECK_PALETTES) {
    if (themeXml === buildThemeXml(p)) return p.id
  }
  return null
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

/** The displayed solid colour of a fill, if it has one. */
function hexOfFill(fill: Fill | undefined): string | undefined {
  return fill?.kind === 'solid' ? fill.hex : undefined
}

/** Structure + text only; formatting is compared separately. */
function textSignature(paras: readonly { runs: readonly { text: string }[] }[]): string {
  return JSON.stringify(paras.map((p) => p.runs.map((r) => r.text)))
}

export function PptxEditor({ path, onSlideChange }: PptxEditorProps) {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [baseDeck, setBaseDeck] = useState<SlideDeck | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [selectedKey, setSelectedKey] = useState<ShapeKey | null>(null)
  const [editingKey, setEditingKey] = useState<ShapeKey | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('clean')
  // The file changed underneath us (assistant tool / external write) while
  // local unsaved edits exist. Nothing is written until the user picks a side.
  const [externalConflict, setExternalConflict] = useState(false)
  const [zoomMode, setZoomMode] = useState<'fit' | number>('fit')
  const [zoomPercent, setZoomPercent] = useState(100)
  const [selectionTick, setSelectionTick] = useState(0)
  const [presenting, setPresenting] = useState(false)

  // A history entry is an edit-set snapshot; a theme-change entry additionally
  // carries the theme part bytes before/after the swap, since theme changes are
  // NOT part of the edit set — undo/redo restore those bytes directly.
  const [history, setHistory] = useState<HistoryEntry[]>([{ edits: EMPTY_DECK_EDITS }])
  const [histIndex, setHistIndex] = useState(0)
  const editSet = (history[histIndex] ?? { edits: EMPTY_DECK_EDITS }).edits
  // The theme part currently loaded into baseDeck; null until the deck loads.
  const [currentThemeXml, setCurrentThemeXml] = useState<string | null>(null)
  const [themeBusy, setThemeBusy] = useState(false)
  const activeThemeRef = useRef<string | null>(null)
  // Slide pending deletion, as an index into the RENDERED deck; null = closed.
  const [confirmDeleteIndex, setConfirmDeleteIndex] = useState<number | null>(null)
  // Rail drag: the card being dragged, and the GAP the drop indicator sits in
  // (gap g is above card g, so g === slides.length means "after the last").
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  const rootRef = useRef<HTMLDivElement>(null)
  const baseDeckRef = useRef<SlideDeck | null>(null)
  const editSetRef = useRef<DeckEdits>(EMPTY_DECK_EDITS)
  const histIndexRef = useRef(0)
  const overlayRef = useRef<TextOverlayHandle | null>(null)
  /** Last reported save failure, so the same one is not announced repeatedly. */
  const lastSaveErrorRef = useRef<string | null>(null)

  useEffect(() => {
    editSetRef.current = editSet
  }, [editSet])
  useEffect(() => {
    histIndexRef.current = histIndex
  }, [histIndex])

  // ------------------------------------------------------------- persistence

  // File-state tracker for this mount: every write is transactional against
  // the etag of what THIS editor last read or wrote (verified under the main
  // process file lock), so an assistant tool writing the same deck can never
  // be silently overwritten by our autosave. Lazy ref like the save pipeline.
  const fileSyncRef = useRef<DeckFileSync | null>(null)
  if (fileSyncRef.current === null) {
    fileSyncRef.current = createDeckFileSync({
      read: async () => {
        const res = await window.ipc.invoke('workspace:readFile', { path, encoding: 'base64' })
        return { data: res.data, etag: res.etag, stat: { mtimeMs: res.stat.mtimeMs, size: res.stat.size } }
      },
      write: async (data, expectedEtag) => {
        const res = await window.ipc.invoke('workspace:writeFile', {
          path,
          data,
          opts: { encoding: 'base64', ...(expectedEtag !== null ? { expectedEtag } : {}) },
        })
        return { etag: res.etag, stat: { mtimeMs: res.stat.mtimeMs, size: res.stat.size } }
      },
      stat: async () => {
        try {
          const s = await window.ipc.invoke('workspace:stat', { path })
          return { mtimeMs: s.mtimeMs, size: s.size }
        } catch {
          return null
        }
      },
      onConflict: () => setExternalConflict(true),
    })
  }
  const fileSync = fileSyncRef.current

  // One pipeline per mount (App.tsx keys this component by path). It owns the
  // debounce timer and the dirty generations; the callbacks read refs so it
  // never captures stale edit state. Lazy ref, not useMemo — React may drop
  // a memo, and with it the generation counters an unmount flush relies on.
  const savePipelineRef = useRef<SavePipeline | null>(null)
  if (savePipelineRef.current === null) {
    savePipelineRef.current = createSavePipeline({
      debounceMs: SAVE_DEBOUNCE_MS,
      hasEdits: () => hasEdits(editSetRef.current),
      serialize: async () => {
        const base = baseDeckRef.current
        if (!base) throw new Error('presentation is not loaded')
        const edits = editSetRef.current
        const bytes = await writeDeck(
          base,
          mergeSlideEdits(toSlideEdits(edits.shapes), insertsToSlideEdits(edits.insertedShapes)),
          {
            deleteSlides: edits.deletedSlides,
            addSlides: edits.addedSlides,
            slideOrder: edits.slideOrder,
          },
        )
        return uint8ArrayToBase64(bytes)
      },
      write: (data) => fileSync.guardedWrite(data),
      onStatus: (status) => {
        if (status === 'saved') lastSaveErrorRef.current = null
        setSaveStatus(status)
      },
      onError: (err) => {
        // A refused write after an external change is not a failure to
        // announce — the conflict banner owns that conversation.
        if (err instanceof ExternalChangeError) return
        console.error('Failed to save pptx:', err)
        // The edit set is cumulative, so ONE rejected edit makes every later
        // save fail too — silently, until now. Without the reason on screen
        // this reads as "editing randomly stopped working", which is exactly
        // how it was reported. Only announce a CHANGED reason, since the
        // debounce would otherwise re-toast the same failure on every keystroke.
        const message = err instanceof Error ? err.message : String(err)
        if (message === lastSaveErrorRef.current) return
        lastSaveErrorRef.current = message
        toast.error('This presentation could not be saved.', {
          description: message,
          duration: 10000,
        })
      },
    })
  }
  const savePipeline = savePipelineRef.current

  /** Commits a new edit set: pushes onto the undo stack and schedules a save. */
  const pushEdits = useCallback(
    (next: DeckEdits) => {
      setHistory((h) => {
        const trimmed = [...h.slice(0, histIndexRef.current + 1), { edits: next }]
        return trimmed.length > MAX_HISTORY ? trimmed.slice(trimmed.length - MAX_HISTORY) : trimmed
      })
      setHistIndex((i) => Math.min(i + 1, MAX_HISTORY - 1))
      editSetRef.current = next
      savePipeline.scheduleSave()
    },
    [savePipeline],
  )

  /** Commits a shape-level change, carrying the slide deletions forward. */
  const pushShapeEdits = useCallback(
    (shapes: EditSet) => {
      pushEdits({ ...editSetRef.current, shapes })
    },
    [pushEdits],
  )

  // Flush pending edits on unmount / path change, before blob URLs are revoked.
  // The pipeline awaits any in-flight save and persists anything it missed.
  useEffect(() => {
    return () => {
      void savePipeline.flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  // App.tsx keys this component by path, so a different file is a fresh mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await fileSync.load()
        let bytes = base64ToUint8Array(data)
        // Decks created by the first version of the deck generator carry
        // scaffolding desktop PowerPoint renders as blank slides, and saves
        // preserve it byte-for-byte — repair the package once, on open.
        try {
          const upgraded = await upgradeGeneratedDeck(bytes)
          if (upgraded && !cancelled) {
            // Guarded like every other write: if the assistant touched the
            // file between our read and this repair, keep opening as-is and
            // let the conflict banner sort it out.
            await fileSync.guardedWrite(uint8ArrayToBase64(upgraded))
            bytes = upgraded
          }
        } catch (err) {
          console.warn('pptx upgrade check failed; opening as-is:', err)
        }
        const parsed = await parsePptx(bytes)
        if (cancelled) {
          disposeDeck(parsed)
          return
        }
        baseDeckRef.current = parsed
        setBaseDeck(parsed)
        // Snapshot the theme part so the palette picker can highlight the
        // current one and undo has an original to restore to. Best-effort:
        // a deck whose theme can't be resolved just shows no highlight.
        try {
          const themePath = await resolveThemePath(parsed.source.zip)
          const themeXml = await parsed.source.zip.file(themePath)?.async('string')
          if (themeXml && !cancelled) {
            activeThemeRef.current = themeXml
            setCurrentThemeXml(themeXml)
          }
        } catch {
          activeThemeRef.current = null
          setCurrentThemeXml(null)
        }
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
  }, [path, fileSync])

  // -------------------------------------------------- external file changes

  /**
   * Re-reads the file and installs it as the new base: fresh parse, old blob
   * URLs disposed, local edit state reset — the disk is now the whole truth.
   * `activeIndex` is deliberately left alone: the currentIndex clamp keeps
   * the view on the same slide number when it still exists, and on the last
   * slide when the reloaded deck is shorter.
   */
  const reloadFromDisk = useCallback(async () => {
    try {
      const data = await fileSync.load()
      const parsed = await parsePptx(base64ToUint8Array(data))
      // An edit racing the re-read must not be clobbered silently: back out
      // and let the banner ask.
      if (!savePipeline.isIdle()) {
        disposeDeck(parsed)
        setExternalConflict(true)
        return
      }
      const old = baseDeckRef.current
      baseDeckRef.current = parsed
      setBaseDeck(parsed)
      if (old && old !== parsed) disposeDeck(old)
      setHistory([{ edits: EMPTY_DECK_EDITS }])
      setHistIndex(0)
      histIndexRef.current = 0
      editSetRef.current = EMPTY_DECK_EDITS
      setSelectedKey(null)
      setEditingKey(null)
      setExternalConflict(false)
      try {
        const themePath = await resolveThemePath(parsed.source.zip)
        const themeXml = (await parsed.source.zip.file(themePath)?.async('string')) ?? null
        activeThemeRef.current = themeXml
        setCurrentThemeXml(themeXml)
      } catch {
        activeThemeRef.current = null
        setCurrentThemeXml(null)
      }
      setSaveStatus('clean')
    } catch (err) {
      console.error('Failed to reload pptx after external change:', err)
      toast.error('Could not reload the presentation.', {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }, [fileSync, savePipeline])

  /**
   * A workspace:didChange / rowboat:deck-touched signal for this path. Our
   * own saves echo back through the watcher too; checkExternal (stat vs the
   * snapshot of our last read/write) filters them without reading the file.
   * Clean editor → reload in place. Unsaved edits → banner; nothing writes
   * and nothing reloads until the user picks a side (the etag guard enforces
   * the no-write half even when the autosave debounce fires regardless).
   */
  const externalSignalBusyRef = useRef(false)
  const handleExternalSignal = useCallback(async () => {
    // Signals during the initial load race the first parse; the load is
    // reading the newest bytes anyway.
    if (!baseDeckRef.current) return
    if (externalSignalBusyRef.current) return
    externalSignalBusyRef.current = true
    try {
      const verdict = await fileSync.checkExternal()
      if (verdict !== 'external') return
      if (savePipeline.isIdle()) {
        await reloadFromDisk()
      } else {
        setExternalConflict(true)
      }
    } finally {
      externalSignalBusyRef.current = false
    }
  }, [fileSync, savePipeline, reloadFromDisk])

  // The workspace watcher only covers allowlisted roots, so assistant deck
  // tools additionally announce their writes via this window event (App.tsx).
  useEffect(() => {
    const onTouched = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string }>).detail
      if (detail?.path === path) void handleExternalSignal()
    }
    window.addEventListener('rowboat:deck-touched', onTouched)
    return () => window.removeEventListener('rowboat:deck-touched', onTouched)
  }, [path, handleExternalSignal])

  useEffect(() => {
    const cleanup = window.ipc.on('workspace:didChange', (event) => {
      switch (event.type) {
        case 'created':
        case 'changed':
          if (event.path === path) void handleExternalSignal()
          break
        case 'moved':
          if (event.to === path) void handleExternalSignal()
          break
        case 'bulkChanged':
          if (!event.paths || event.paths.includes(path)) void handleExternalSignal()
          break
        // 'deleted': nothing to reload; the next save simply recreates the file.
      }
    })
    return cleanup
  }, [path, handleExternalSignal])

  /** Banner: throw away local edits and take what is on disk. */
  const resolveConflictReload = useCallback(async () => {
    savePipeline.discard()
    // A guarded write may still be mid-flight; let it settle (the etag guard
    // decides its fate), then re-discard whatever generation bookkeeping it
    // left behind before installing the disk state.
    await savePipeline.settled()
    savePipeline.discard()
    await reloadFromDisk()
  }, [savePipeline, reloadFromDisk])

  /** Banner: keep local edits; the next save knowingly overwrites the file. */
  const resolveConflictKeepMine = useCallback(() => {
    fileSync.keepMine()
    setExternalConflict(false)
    void savePipeline.persist()
  }, [fileSync, savePipeline])

  // ------------------------------------------------------------ derived deck

  const deck = useMemo(
    () => (baseDeck ? applyEditSet(baseDeck, editSet) : null),
    [baseDeck, editSet],
  )
  // The rendered deck, held in a ref so async handlers (slide generation) read
  // the current one without re-subscribing.
  const deckRef = useRef<SlideDeck | null>(null)
  useEffect(() => {
    deckRef.current = deck
  }, [deck])

  // Deleting slides shrinks the rendered deck, and undo/redo can grow it back;
  // clamp rather than track so a stale index can never render a blank pane.
  const slideCount = deck?.slides.length ?? 0
  const currentIndex = Math.max(0, Math.min(activeIndex, slideCount - 1))
  const slide = deck?.slides[currentIndex] ?? null
  const selectedShape = findShape(slide, selectedKey)
  const shapeEdit = selectedKey ? editSet.shapes[selectedKey] : undefined

  // Report the visible slide upward (1-based) once the deck is parsed and on
  // every change, so the host can tell the assistant what "this slide" means.
  // The callback lives in a ref so an inline arrow from the caller doesn't
  // re-fire this on every one of the host's renders.
  const onSlideChangeRef = useRef(onSlideChange)
  useEffect(() => {
    onSlideChangeRef.current = onSlideChange
  }, [onSlideChange])
  useEffect(() => {
    if (slideCount === 0) return
    onSlideChangeRef.current?.(currentIndex + 1, slideCount)
  }, [currentIndex, slideCount])

  // -------------------------------------------------------------- theme swap

  /**
   * Re-parses the base deck with a different theme part and installs it, so the
   * canvas re-renders in the new palette while the edit set is untouched. Only
   * the theme part changes (writeDeck replaceTheme); everything else is copied
   * byte-for-byte. Fails closed inside writeDeck on an ambiguous package.
   */
  const swapBaseTheme = useCallback(async (themeXml: string) => {
    const base = baseDeckRef.current
    if (!base) return
    const bytes = await writeDeck(base, new Map(), { replaceTheme: { xml: themeXml } })
    const nextBase = await parsePptx(bytes)
    baseDeckRef.current = nextBase
    setBaseDeck(nextBase)
    if (base !== nextBase) disposeDeck(base)
    activeThemeRef.current = themeXml
    setCurrentThemeXml(themeXml)
  }, [])

  /** Writes the full deck (current edits + current base theme) to disk now. */
  const persistFullDeck = useCallback(async () => {
    const base = baseDeckRef.current
    if (!base) return
    const edits = editSetRef.current
    const bytes = await writeDeck(
      base,
      mergeSlideEdits(toSlideEdits(edits.shapes), insertsToSlideEdits(edits.insertedShapes)),
      { deleteSlides: edits.deletedSlides, addSlides: edits.addedSlides, slideOrder: edits.slideOrder },
    )
    await fileSync.guardedWrite(uint8ArrayToBase64(bytes))
  }, [fileSync])

  const activePaletteId = useMemo(() => paletteIdOfTheme(currentThemeXml), [currentThemeXml])

  /**
   * Swap the whole deck to a built-in palette. Flushes pending edits first,
   * swaps the theme in memory, writes the restyled deck, and records a special
   * history entry so the change is undoable through the same mechanism.
   */
  const changeTheme = useCallback(
    async (paletteId: string) => {
      const pal = DECK_PALETTES.find((p) => p.id === paletteId)
      const base = baseDeckRef.current
      if (!pal || !base || themeBusy) return
      const before = activeThemeRef.current
      const after = buildThemeXml(pal)
      if (after === before) return
      setThemeBusy(true)
      try {
        // Persist any pending edits before we overwrite the file.
        await savePipeline.flush()
        // `before` may be null for a deck whose theme we couldn't resolve at
        // load; recover it now so undo has an exact original to restore.
        let originalTheme = before
        if (originalTheme === null) {
          const themePath = await resolveThemePath(base.source.zip)
          originalTheme = (await base.source.zip.file(themePath)?.async('string')) ?? null
        }
        if (originalTheme === null) throw new Error('could not resolve the deck theme to replace')
        await swapBaseTheme(after)
        await persistFullDeck()
        setHistory((h) => {
          const trimmed = [
            ...h.slice(0, histIndexRef.current + 1),
            { edits: editSetRef.current, theme: { before: originalTheme!, after } },
          ]
          return trimmed.length > MAX_HISTORY ? trimmed.slice(trimmed.length - MAX_HISTORY) : trimmed
        })
        setHistIndex((i) => Math.min(i + 1, MAX_HISTORY - 1))
        setSelectedKey(null)
        setEditingKey(null)
      } catch (err) {
        console.error('Failed to change theme:', err)
        // A refused guarded write already raised the conflict banner.
        if (!(err instanceof ExternalChangeError)) {
          toast.error('Could not change the theme.', {
            description: err instanceof Error ? err.message : String(err),
          })
        }
      } finally {
        setThemeBusy(false)
      }
    },
    [savePipeline, swapBaseTheme, persistFullDeck, themeBusy],
  )

  // ------------------------------------------------------------ undo / redo

  const canUndo = histIndex > 0
  const canRedo = histIndex < history.length - 1

  const undo = useCallback(() => {
    if (histIndexRef.current <= 0 || themeBusy) return
    const from = histIndexRef.current
    const next = from - 1
    const leaving = history[from]
    histIndexRef.current = next
    editSetRef.current = (history[next] ?? { edits: EMPTY_DECK_EDITS }).edits
    setHistIndex(next)
    setEditingKey(null)
    if (leaving?.theme) {
      // Undo a theme change: restore the previous theme part and persist.
      setThemeBusy(true)
      void (async () => {
        try {
          await swapBaseTheme(leaving.theme!.before)
          await persistFullDeck()
        } finally {
          setThemeBusy(false)
        }
      })()
    } else {
      savePipeline.scheduleSave()
    }
  }, [history, savePipeline, swapBaseTheme, persistFullDeck, themeBusy])

  const redo = useCallback(() => {
    if (histIndexRef.current >= history.length - 1 || themeBusy) return
    const next = histIndexRef.current + 1
    const entering = history[next]
    histIndexRef.current = next
    editSetRef.current = (entering ?? { edits: EMPTY_DECK_EDITS }).edits
    setHistIndex(next)
    setEditingKey(null)
    if (entering?.theme) {
      setThemeBusy(true)
      void (async () => {
        try {
          await swapBaseTheme(entering.theme!.after)
          await persistFullDeck()
        } finally {
          setThemeBusy(false)
        }
      })()
    } else {
      savePipeline.scheduleSave()
    }
  }, [history, savePipeline, swapBaseTheme, persistFullDeck, themeBusy])

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
      // The serializer writes geometry only for sp/pic/cxnSp. graphicFrame
      // placeholders would fail the whole save closed, so their drags snap
      // back instead of committing. Groups (and everything inside them) are
      // read-only — their nodePaths must never reach the serializer.
      if (shape.type === 'group') return
      if (shape.type === 'placeholder' && shape.kind !== 'video') return
      const key = shapeKeyOf(slide.xmlPath, shape.nodePath)
      pushShapeEdits(
        withShapeEdit(editSetRef.current.shapes, key, seedFor(slide.xmlPath, shape), (draft) => {
          draft.geometry = rect
        }),
      )
    },
    [slide, pushShapeEdits, seedFor],
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
            latinFont: src?.latinFont,
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
            if ((r.latinFont ?? null) !== (src.latinFont ?? null) && r.latinFont !== undefined) {
              delta.latinFont = r.latinFont
            }
            if (Object.keys(delta).length > 0) formats[runKeyOf(pi, ri)] = delta
          })
        })
      }

      const previous = editSetRef.current.shapes[key]
      const hadFormatting = editHoldsFormatting(previous)
      // Retyping the original text is a revert, not a no-op: it must fall
      // through so the accumulated text edit below is cleared.
      const noop = isNoopCommit(previous, {
        textChanged,
        formatCount: Object.keys(formats).length,
        alignCount: Object.keys(aligns).length,
      })
      if (noop) return

      if (structural && hadFormatting) {
        toast.info('Formatting was reset on this text box because its structure changed.')
      }

      pushShapeEdits(
        withShapeEdit(editSetRef.current.shapes, key, seedFor(slide.xmlPath, shape), (draft) => {
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
    [slide, pushShapeEdits, seedFor],
  )

  // ------------------------------------------------------------ formatting

  // While a box is OPEN for editing, formatting goes onto DOM spans and is
  // committed as run properties, which the serializer now emits even for runs
  // with no provenance — so structure is irrelevant on that path. Only the
  // closed-box path writes the `formats` map, whose keys are ORIGINAL run
  // indices and therefore meaningless once the structure has diverged.
  const editingThisShape = editingKey !== null && editingKey === selectedKey
  const canFormat =
    selectedShape?.type === 'text' &&
    (editingThisShape || acceptsFormatting(shapeEdit)) &&
    slide !== null

  const formatDisabledReason = !selectedShape
    ? 'Select a text box first'
    : selectedShape.type !== 'text'
      ? 'This shape has no text'
      : !editingThisShape && !acceptsFormatting(shapeEdit)
        ? 'Double-click the text to format it — this box’s structure has changed'
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

  // The RESOLVED typeface of the selection (inheritance included), so the
  // picker shows what is on screen rather than only explicit run overrides.
  const activeFont: string | undefined = !canFormat
    ? undefined
    : overlayRef.current
      ? aggregateFontOfSpans(selectedRunSpans(overlayRef.current.root))
      : aggregateFontOfShape(selectedShape as TextShape)

  // Fill / outline are offered only for the shape kinds the serializer can
  // restyle — never images, groups or unrendered placeholders — and never
  // while text is being edited, where the toolbar is about the text.
  const styleTarget =
    selectedShape &&
    !editingKey &&
    selectedShape.style &&
    (selectedShape.type === 'text' || selectedShape.type === 'drawing')
      ? selectedShape
      : null
  const styleEdit = styleTarget ? editSet.shapes[selectedKey as ShapeKey] : undefined
  const shapeFill: string | null = !styleTarget
    ? null
    : // Anything drawn as a stroke has no fillable region: connectors, and
      // inserted `line` shapes alike.
      isLinePreset(styleTarget.visual?.geom?.preset ?? '')
      ? null
      : `#${styleEdit?.fillHex ?? hexOfFill(styleTarget.visual?.fill) ?? 'FFFFFF'}`
  const shapeLine: string | null = !styleTarget
    ? null
    : `#${styleEdit?.lineHex ?? styleTarget.visual?.line?.hex ?? '000000'}`

  /** Commits a fill/outline change through the normal edit-set pipeline. */
  const applyShapeStyle = useCallback(
    (set: { fillHex?: string; lineHex?: string }) => {
      if (!selectedKey || !selectedShape || !selectedShape.style) return
      pushShapeEdits(
        withShapeEdit(
          editSetRef.current.shapes,
          selectedKey,
          { slidePath: selectedShape.slideXmlPath, nodePath: selectedShape.nodePath },
          (draft) => {
            draft.shapeType = selectedShape.type
            draft.shapeId = selectedShape.id
            // The anchor is the file's style, not the current override, so a
            // second recolour still validates against the original bytes.
            draft.styleOriginal = selectedShape.style
            if (set.fillHex !== undefined) draft.fillHex = set.fillHex
            if (set.lineHex !== undefined) draft.lineHex = set.lineHex
          },
        ),
      )
    },
    [selectedKey, selectedShape, pushShapeEdits],
  )

  // Every typeface the deck renders with, for the picker's first group.
  const deckFonts = useMemo(
    () =>
      deck
        ? typefacesInShapes(
            deck.slides.flatMap((s) => s.shapes.filter((sh): sh is TextShape => sh.type === 'text')),
          )
        : [],
    [deck],
  )

  const applyFormat = useCallback(
    (set: RunFormatOverrides) => {
      if (!slide || !selectedKey) return
      const shape = findShape(slide, selectedKey)
      if (shape?.type !== 'text') return

      const overlay = overlayRef.current
      if (overlay) {
        // Editing: mutate the spans; the commit on blur turns this into edits.
        applyFormatToSpans(selectedRunSpans(overlay.root), set, overlay.scale, fontScaleOf(overlay.shape))
        setSelectionTick((t) => t + 1)
        savePipeline.markEdited()
        return
      }

      const original = baseParagraphsOf(baseDeckRef.current, slide.xmlPath, shape.nodePath)
      if (!original) return
      pushShapeEdits(
        withShapeEdit(editSetRef.current.shapes, selectedKey, seedFor(slide.xmlPath, shape), (draft) => {
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
    [slide, selectedKey, pushShapeEdits, seedFor, savePipeline],
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
        savePipeline.markEdited()
        return
      }

      const original = baseParagraphsOf(baseDeckRef.current, slide.xmlPath, shape.nodePath)
      if (!original) return
      pushShapeEdits(
        withShapeEdit(editSetRef.current.shapes, selectedKey, seedFor(slide.xmlPath, shape), (draft) => {
          draft.original = original
          const aligns = { ...(draft.aligns ?? {}) }
          original.forEach((_, pi) => {
            aligns[String(pi)] = align
          })
          draft.aligns = aligns
        }),
      )
    },
    [slide, selectedKey, pushShapeEdits, seedFor, savePipeline],
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

  // ------------------------------------------------------------ presentation

  // `activeIndex` is untouched while presenting, so leaving lands back on the
  // slide the editor was on; the overlay hands focus back as it unmounts.
  const startPresenting = useCallback(() => setPresenting(true), [])
  const stopPresenting = useCallback(() => setPresenting(false), [])

  // -------------------------------------------------------------- deletion

  const deleteSelectedShape = useCallback(() => {
    if (!slide || !selectedKey) return
    const shape = findShape(slide, selectedKey)
    if (!shape) return
    // A shape this session inserted is removed by dropping the insert; it has
    // no element in the file to splice out, and its id is an editor key rather
    // than a cNvPr id, so a deleteShape edit would fail the save closed.
    if (isInsertedShape(editSetRef.current, selectedKey)) {
      pushEdits(withShapeUninserted(editSetRef.current, selectedKey))
      setSelectedKey(null)
      setEditingKey(null)
      return
    }
    pushShapeEdits(
      withShapeEdit(editSetRef.current.shapes, selectedKey, seedFor(slide.xmlPath, shape), (draft) => {
        // Deletion supersedes the other fields — their splices would land
        // inside the removed range and fail the whole save closed.
        draft.text = undefined
        draft.formats = undefined
        draft.aligns = undefined
        draft.geometry = undefined
        draft.deleted = { shapeType: shape.type, shapeId: shape.id }
      }),
    )
    setSelectedKey(null)
  }, [slide, selectedKey, pushShapeEdits, pushEdits, seedFor])

  const requestDeleteSlide = useCallback(
    (index: number) => {
      if (!deck) return
      if (deck.slides.length <= 1) {
        toast.info('A presentation needs at least one slide.')
        return
      }
      setConfirmDeleteIndex(index)
    },
    [deck],
  )

  // Keynote-style Add Slide: a new slide on the SAME layout as the active one,
  // inserted right after it, seeded with the layout's placeholder boxes. Both
  // the part strings and the pre-parsed render live in the edit set, so the
  // add is undoable and only reaches the file through the normal save.
  const addingSlideRef = useRef(false)
  const addSlide = useCallback(async () => {
    const base = baseDeckRef.current
    if (!base || !slide || addingSlideRef.current) return
    addingSlideRef.current = true
    try {
      const cur = editSetRef.current
      const anchorAdded = cur.addedSlides.find((a) => a.path === slide.xmlPath)
      const plan = await planNewSlide(
        base,
        slide.xmlPath,
        anchorAdded?.relsXml,
        cur.addedSlides.map((a) => a.path),
      )
      const parsed = await parseAddedSlide(base, plan.path, plan.xml, plan.relsXml)
      pushEdits(withSlideAdded(cur, { ...plan, slide: parsed }))
      setSelectedKey(null)
      setEditingKey(null)
      setActiveIndex(currentIndex + 1)
    } catch (err) {
      console.error('Failed to add slide:', err)
      toast.error('Could not add a slide to this presentation.')
    } finally {
      addingSlideRef.current = false
    }
  }, [slide, currentIndex, pushEdits])

  /**
   * Duplicate: copies the slide AS CURRENTLY SHOWN. The anchor's pending edits
   * are baked into the copy's bytes here, once, so the two slides are fully
   * independent from that point on — later edits address different parts.
   */
  const duplicateSlide = useCallback(
    async (index: number) => {
      const base = baseDeckRef.current
      const target = deck?.slides[index]
      if (!base || !target || addingSlideRef.current) return
      addingSlideRef.current = true
      try {
        const cur = editSetRef.current
        const anchorAdded = cur.addedSlides.find((a) => a.path === target.xmlPath)
        const xml = anchorAdded?.xml ?? base.source.slideXml[target.xmlPath]
        if (xml === undefined) throw new Error(`no retained XML for ${target.xmlPath}`)
        const relsXml = anchorAdded?.relsXml ?? (await readSlideRels(base, target.xmlPath))
        const plan = planDuplicateSlide(
          base,
          target.xmlPath,
          { xml, relsXml, edits: toSlideEdits(cur.shapes).get(target.xmlPath) },
          cur.addedSlides.map((a) => a.path),
        )
        const parsed = await parseAddedSlide(base, plan.path, plan.xml, plan.relsXml)
        pushEdits(withSlideAdded(cur, { ...plan, slide: parsed }))
        setSelectedKey(null)
        setEditingKey(null)
        setActiveIndex(index + 1)
      } catch (err) {
        console.error('Failed to duplicate slide:', err)
        toast.error('Could not duplicate this slide.')
      } finally {
        addingSlideRef.current = false
      }
    },
    [deck, pushEdits],
  )

  /** Commits one explicit order after a rail drag. */
  const reorderSlides = useCallback(
    (from: number, to: number) => {
      if (!deck || from === to) return
      const paths = deck.slides.map((s) => s.xmlPath)
      const moved = paths.splice(from, 1)[0]
      if (moved === undefined) return
      // `to` is the index the card should occupy once it has been lifted out.
      paths.splice(Math.max(0, Math.min(to, paths.length)), 0, moved)
      pushEdits(withSlideOrder(editSetRef.current, paths))
      setSelectedKey(null)
      setEditingKey(null)
      setActiveIndex(paths.indexOf(moved))
    },
    [deck, pushEdits],
  )


  // ------------------------------------------------------------------ insert

  const insertShape = useCallback(
    async (choice: InsertChoice) => {
      if (!deck || !slide) return
      const size = INSERT_SIZES[choice] ?? INSERT_SIZES.rect
      const xfrmEmu = {
        x: Math.round((deck.slideSizeEmu.w - size.w) / 2),
        y: Math.round((deck.slideSizeEmu.h - size.h) / 2),
        w: size.w,
        h: Math.max(size.h, 1),
      }

      let spec: NewShapeSpec
      let previewUrl: string | undefined
      if (choice === 'image') {
        // Opens the OS file picker in the main process. A throw here means the
        // handler is missing — the main process does not hot-reload, so a
        // stale app shows that as nothing happening at all unless it is said
        // out loud.
        let picked: Awaited<ReturnType<typeof window.ipc.invoke<'workspace:pickImage'>>>
        try {
          picked = await window.ipc.invoke('workspace:pickImage', {})
        } catch (err) {
          console.error('Image picker failed:', err)
          toast.error('Could not open the image picker.', {
            description:
              (err instanceof Error ? err.message : String(err)) +
              ' — fully quit and relaunch the app, then try again.',
            duration: 10000,
          })
          return
        }
        if (picked.error) {
          toast.error('Could not read that image.', { description: picked.error })
          return
        }
        // Cancelled the dialog: nothing to say.
        if (!picked.picked || !picked.dataBase64 || !picked.ext) return
        const bytes = base64ToUint8Array(picked.dataBase64)
        previewUrl = URL.createObjectURL(new Blob([bytes as unknown as BlobPart]))
        spec = {
          kind: 'image',
          xfrmEmu,
          ext: picked.ext,
          dataBase64: picked.dataBase64,
          name: picked.name,
        }
      } else if (choice === 'textbox') {
        spec = { kind: 'textbox', xfrmEmu }
      } else {
        spec = { kind: 'shape', preset: choice, xfrmEmu }
      }

      // The key must be the one the RENDERED shape will carry, i.e. derived
      // from the node path it will occupy — otherwise selection cannot find
      // it and the whole toolbar stays disabled.
      const slot = spTreeSlotOf(slide)
      const pending = editSetRef.current.insertedShapes.filter(
        (i) => i.slidePath === slide.xmlPath,
      ).length
      const key = shapeKeyOf(slide.xmlPath, [...slot.path, slot.nextChild + pending])
      pushEdits(
        withShapeInserted(editSetRef.current, { key, slidePath: slide.xmlPath, spec, previewUrl }),
      )
      setSelectedKey(key)
      // A new text box opens for typing straight away; a shape is just selected.
      setEditingKey(choice === 'textbox' ? key : null)
    },
    [deck, slide, pushEdits],
  )

  const confirmDeleteSlide = useCallback(() => {
    const index = confirmDeleteIndex
    setConfirmDeleteIndex(null)
    if (index === null || !deck) return
    const target = deck.slides[index]
    if (!target || deck.slides.length <= 1) return
    // withSlideRemoved prunes the slide's shape edits (their splices are moot,
    // and the serializer refuses a slide both edited and deleted), drops an
    // ADDED slide outright, and re-anchors any additions that followed it. The
    // prior history entry still holds everything, so undo restores it all.
    const reanchorTo = deck.slides[index - 1]?.xmlPath ?? ''
    pushEdits(withSlideRemoved(editSetRef.current, target.xmlPath, reanchorTo))
    setSelectedKey(null)
    setEditingKey(null)
    setActiveIndex((i) => {
      // Stay on the same slide when one before it goes; the clamp handles
      // deleting the last card.
      const next = i > index ? i - 1 : i
      return Math.max(0, Math.min(next, deck.slides.length - 2))
    })
  }, [confirmDeleteIndex, deck, pushEdits])

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
      if (mod && e.key === 'Backspace') {
        if (editingKey) return
        e.preventDefault()
        requestDeleteSlide(currentIndex)
        return
      }
      if (mod && e.key.toLowerCase() === 'd') {
        if (editingKey) return
        e.preventDefault()
        void duplicateSlide(currentIndex)
        return
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && !mod) {
        if (editingKey || !selectedKey) return
        // A press inside a toolbar input must never nuke the selected shape.
        if (e.target instanceof HTMLElement && e.target.tagName === 'INPUT') return
        e.preventDefault()
        deleteSelectedShape()
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
    [
      editingKey,
      selectedKey,
      slide,
      currentIndex,
      undo,
      redo,
      handleGeometryCommit,
      deleteSelectedShape,
      requestDeleteSlide,
      duplicateSlide,
    ],
  )

  // ---------------------------------------------------------------- render

  const openExternally = useCallback(() => {
    void window.ipc.invoke('shell:openPath', { path })
  }, [path])

  /** Saves a copy elsewhere. Flushes first so the copy has the latest edits. */
  const exportCopy = useCallback(async () => {
    try {
      await savePipeline.flush()
      const result = await window.ipc.invoke('workspace:exportCopy', { path })
      if (result.error) {
        toast.error(`Could not export a copy: ${result.error}`)
        return
      }
      // Cancelling the dialog is not a failure — say nothing.
      if (result.saved && result.dest) toast.success(`Exported to ${baseName(result.dest)}`)
    } catch (err) {
      // Surface the reason: a generic message here hid a stale main process
      // ("no handler registered") behind an unactionable toast.
      console.error('Failed to export a copy:', err)
      const message = err instanceof Error ? err.message : String(err)
      toast.error('Could not export a copy.', { description: message })
    }
  }, [path, savePipeline])

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
        <EditorHeader
          fileName={displayName(path)}
          filePath={path}
          saveStatus={saveStatus}
          onPlay={startPresenting}
          onExport={() => void exportCopy()}
          paletteId={activePaletteId}
          onChangeTheme={(id) => void changeTheme(id)}
          themeBusy={themeBusy}
        />

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
          onInsert={(choice) => void insertShape(choice)}
          shapeFill={shapeFill}
          shapeLine={shapeLine}
          onShapeFillChange={(hex) => applyShapeStyle({ fillHex: hex })}
          onShapeLineChange={(hex) => applyShapeStyle({ lineHex: hex })}
          font={activeFont}
          deckFonts={deckFonts}
          onFontChange={(family) => applyFormat({ latinFont: family })}
          onToggleBold={() => applyFormat({ bold: !activeFormat?.bold })}
          onToggleItalic={() => applyFormat({ italic: !activeFormat?.italic })}
          onToggleUnderline={() => applyFormat({ underline: !activeFormat?.underline })}
          onFontSizeStep={stepFontSize}
          onColorChange={(hex) => applyFormat({ colorHex: hex })}
          align={activeAlign}
          onAlign={applyAlign}
          slideNumber={currentIndex + 1}
          slideCount={deck.slides.length}
        />

        {externalConflict && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs"
          >
            <TriangleAlertIcon className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="font-medium text-foreground">
              This file was changed by the assistant.
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => void resolveConflictReload()}
                className="rounded-md border border-border bg-background px-2.5 py-1 font-medium text-foreground transition-colors hover:bg-accent"
              >
                Reload (discard your unsaved changes)
              </button>
              <button
                type="button"
                onClick={resolveConflictKeepMine}
                className="rounded-md border border-border bg-background px-2.5 py-1 font-medium text-foreground transition-colors hover:bg-accent"
              >
                Keep mine (your next save overwrites)
              </button>
            </div>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          <nav
            aria-label="Slides"
            className="flex w-56 shrink-0 flex-col border-r border-border bg-card/40"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
              <span className="text-[11px] font-medium text-muted-foreground">
                Slides · {deck.slides.length}
              </span>
              <button
                type="button"
                aria-label="Add slide"
                title="Add slide"
                onClick={() => void addSlide()}
                className="inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <PlusIcon className="size-3.5" />
              </button>
            </div>
            <div
              className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2"
              onDragOver={(e) => {
                // The list itself accepts the drop, so a release in the gap
                // between cards still lands on the last computed position.
                if (dragFrom !== null) e.preventDefault()
              }}
              onDrop={(e) => {
                if (dragFrom === null || dragOver === null) return
                e.preventDefault()
                reorderSlides(dragFrom, dragOver > dragFrom ? dragOver - 1 : dragOver)
                setDragFrom(null)
                setDragOver(null)
              }}
            >
              {deck.slides.map((s, i) => (
                <SlideCard
                  key={s.xmlPath}
                  index={i}
                  slide={s}
                  sizeEmu={deck.slideSizeEmu}
                  title={slideTitle(s)}
                  active={i === currentIndex}
                  dragging={dragFrom === i}
                  dropBefore={dragFrom !== null && dragOver === i}
                  dropAfter={dragFrom !== null && dragOver === i + 1 && i === deck.slides.length - 1}
                  onSelect={() => {
                    setActiveIndex(i)
                    setSelectedKey(null)
                    setEditingKey(null)
                  }}
                  onDelete={() => requestDeleteSlide(i)}
                  onDuplicate={() => void duplicateSlide(i)}
                  onDragStart={() => setDragFrom(i)}
                  onDragEnd={() => {
                    setDragFrom(null)
                    setDragOver(null)
                  }}
                  onDragOverCard={(before) => setDragOver(before ? i : i + 1)}
                />
              ))}
            </div>
          </nav>

          <div className="flex min-w-0 flex-1 flex-col">
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

        {presenting && (
          <PresentationOverlay
            slides={deck.slides}
            sizeEmu={deck.slideSizeEmu}
            startIndex={currentIndex}
            onExit={stopPresenting}
          />
        )}

        <AlertDialog
          open={confirmDeleteIndex !== null}
          onOpenChange={(open) => {
            if (!open) setConfirmDeleteIndex(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Delete slide {confirmDeleteIndex !== null ? confirmDeleteIndex + 1 : ''}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                The slide is removed from the presentation. You can undo this with ⌘Z.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={confirmDeleteSlide}>Delete slide</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </EditorErrorBoundary>
  )
}

// --------------------------------------------------------------- slide rail

/**
 * Rail width (w-56 = 224) minus its border, the list padding, the card padding,
 * the number badge + gap, and the scrollbar gutter.
 */
const THUMB_WIDTH_PX = 160

interface SlideCardProps {
  index: number
  slide: Slide
  sizeEmu: { w: number; h: number }
  title: string | null
  active: boolean
  /** This card is the one being dragged. */
  dragging: boolean
  /** Show the drop indicator above / below this card. */
  dropBefore: boolean
  dropAfter: boolean
  onSelect: () => void
  onDelete: () => void
  onDuplicate: () => void
  onDragStart: () => void
  onDragEnd: () => void
  /** `true` when the pointer is in the card's top half. */
  onDragOverCard: (before: boolean) => void
}

function SlideCard({
  index,
  slide,
  sizeEmu,
  title,
  active,
  dragging,
  dropBefore,
  dropAfter,
  onSelect,
  onDelete,
  onDuplicate,
  onDragStart,
  onDragEnd,
  onDragOverCard,
}: SlideCardProps) {
  return (
    // The action affordances are SIBLINGS of the card button (buttons must not
    // nest), floated over its corner; only the active card shows them.
    <div
      draggable
      onDragStart={(e) => {
        // Firefox requires data for a drag to start at all.
        e.dataTransfer.setData('text/plain', String(index))
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        const box = e.currentTarget.getBoundingClientRect()
        onDragOverCard(e.clientY < box.top + box.height / 2)
      }}
      className={`relative shrink-0 transition-opacity ${dragging ? 'opacity-40' : ''}`}
    >
      {(dropBefore || dropAfter) && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-1 z-20 h-0.5 rounded-full bg-[var(--ring)] ${
            dropBefore ? '-top-1' : '-bottom-1'
          }`}
        />
      )}
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        aria-label={`Slide ${index + 1}${title ? `: ${title}` : ''}`}
        className={`flex w-full shrink-0 items-center gap-1.5 rounded-md p-1.5 transition-all ${
          active
            ? 'bg-accent/60 shadow-sm ring-2 ring-ring'
            : 'ring-1 ring-border/60 hover:bg-accent/40 hover:ring-border'
        }`}
      >
        {/* Outside the thumbnail on purpose — overlaid, it sat on the slide's own title. */}
        <span
          className={`w-5 shrink-0 rounded py-px text-center text-[10px] font-medium leading-none tabular-nums ${
            active ? 'bg-background text-foreground' : 'text-muted-foreground'
          }`}
        >
          {index + 1}
        </span>
        <span className="mx-auto block shrink-0 overflow-hidden rounded-sm">
          <SlideThumbnail slide={slide} sizeEmu={sizeEmu} widthPx={THUMB_WIDTH_PX} />
        </span>
      </button>
      {active && (
        <div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-1">
          <button
            type="button"
            aria-label={`Duplicate slide ${index + 1}`}
            title="Duplicate slide (⌘D)"
            onClick={(e) => {
              e.stopPropagation()
              onDuplicate()
            }}
            className="inline-flex size-5 items-center justify-center rounded bg-background/90 text-muted-foreground shadow-sm ring-1 ring-border transition-colors hover:text-foreground"
          >
            <CopyIcon className="size-3" />
          </button>
          <button
            type="button"
            aria-label={`Delete slide ${index + 1}`}
            title="Delete slide (⌘⌫)"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="inline-flex size-5 items-center justify-center rounded bg-background/90 text-muted-foreground shadow-sm ring-1 ring-border transition-colors hover:text-destructive"
          >
            <Trash2Icon className="size-3" />
          </button>
        </div>
      )}
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
