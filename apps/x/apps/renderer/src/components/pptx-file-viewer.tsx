import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react'
import { ExternalLinkIcon, Loader2Icon, PresentationIcon } from 'lucide-react'
import type { PowerPointViewerHandle, PowerPointViewerProps, ViewerTheme } from 'pptx-react-viewer'

// Maps the viewer's --pptx-* tokens onto the app's shadcn palette so it tracks
// the active (dark) theme. Its own stylesheet is deliberately never imported:
// that file is a standalone Tailwind build whose :root tokens and unscoped
// utility classes win over ours app-wide once loaded. App.css generates the
// viewer's classes from our tokens instead — see the @source directive there.
// destructiveForeground is left to the viewer's default (white): the app has no
// equivalent token, and its foreground colors are unreadable on red.
const VIEWER_THEME: ViewerTheme = {
  colors: {
    background: 'var(--background)',
    foreground: 'var(--foreground)',
    card: 'var(--card)',
    cardForeground: 'var(--card-foreground)',
    popover: 'var(--popover)',
    popoverForeground: 'var(--popover-foreground)',
    primary: 'var(--primary)',
    primaryForeground: 'var(--primary-foreground)',
    secondary: 'var(--secondary)',
    secondaryForeground: 'var(--secondary-foreground)',
    muted: 'var(--muted)',
    mutedForeground: 'var(--muted-foreground)',
    accent: 'var(--accent)',
    accentForeground: 'var(--accent-foreground)',
    destructive: 'var(--destructive)',
    border: 'var(--border)',
    input: 'var(--input)',
    ring: 'var(--ring)',
  },
  radius: 'var(--radius)',
}

type LazyPptxViewerProps = PowerPointViewerProps & {
  viewerRef: Ref<PowerPointViewerHandle>
}

// The viewer (and the i18next stack it renders through) is heavy and only
// needed when a .pptx is open, so it loads in its own chunk the first time a
// presentation is viewed. Its stylesheet is not among these imports by design —
// see VIEWER_THEME above.
const LazyPptxViewer = lazy(async () => {
  const [viewerMod, i18nMod, reactI18nMod, i18nAssets] = await Promise.all([
    import('pptx-react-viewer'),
    import('i18next'),
    import('react-i18next'),
    import('pptx-react-viewer/i18n'),
  ])

  // The viewer resolves every UI string through react-i18next. The app has no
  // i18next setup of its own, so stand up an instance scoped to this chunk,
  // seeded with the dictionary the package ships.
  const i18n = i18nMod.createInstance()
  await i18n.use(reactI18nMod.initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: i18nAssets.translationsEn } },
    interpolation: { escapeValue: false },
    // Anything the dictionary misses degrades to a title-cased label
    // ("pptx.slideSorter.zoomIn" -> "Zoom In") rather than a raw dotted key.
    parseMissingKeyHandler: (key: string) => i18nAssets.keyToLabel(key),
  })

  const { PowerPointViewer } = viewerMod
  const { I18nextProvider } = reactI18nMod

  return {
    default: function PptxViewerWithI18n({ viewerRef, ...props }: LazyPptxViewerProps) {
      return (
        <I18nextProvider i18n={i18n}>
          <PowerPointViewer ref={viewerRef} {...props} />
        </I18nextProvider>
      )
    },
  }
})

interface PptxFileViewerProps {
  path: string
}

type LoadState = 'loading' | 'ready' | 'error'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const SAVE_DEBOUNCE_MS = 800
// The viewer normalizes the presentation as it loads, which serializes through
// onContentChange. Ignore content until shortly after the document settles so
// opening a file never rewrites it.
const ARM_DELAY_MS = 500
// onContentChange is a result channel, not an edit notification — the viewer
// only emits it on a theme change and from inside getContent(). Interactions
// inside the viewer are the available per-edit signal; each one re-serializes,
// and only bytes that differ from the last write reach the disk.
const EDIT_SIGNAL_EVENTS = ['keyup', 'pointerup', 'input', 'paste', 'cut', 'drop'] as const

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

export function PptxFileViewer({ path }: PptxFileViewerProps) {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [content, setContent] = useState<Uint8Array | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  // The viewer has no onError prop, so a presentation it cannot parse surfaces
  // as a render-time throw caught by the boundary below.
  const [renderFailed, setRenderFailed] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<PowerPointViewerHandle | null>(null)
  // Which path the currently-attached viewer belongs to, stamped on ref
  // attachment so a debounced save landing after a file switch can never
  // serialize one document into another's file.
  const viewerOwnerRef = useRef<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const armedRef = useRef(false)
  const savingRef = useRef(false)
  const pendingRef = useRef(false)
  const lastWrittenRef = useRef<string | null>(null)
  // Bytes from the viewer's most recent serialization, stamped with the path
  // they belong to so a flush can never write one document into another's file.
  const latestBytesRef = useRef<{ path: string; data: Uint8Array } | null>(null)
  // True while persist() is driving getContent(), whose re-emit through
  // onContentChange would otherwise schedule the next save in a loop.
  const serializingRef = useRef(false)

  // Record what the settled document serializes to, without writing it. The
  // viewer's serialization never matches the bytes on disk, so without this
  // baseline the first interaction would look like an edit and rewrite the file.
  const baselineAndArm = useCallback(async (viewer: PowerPointViewerHandle, owner: string) => {
    serializingRef.current = true
    try {
      await viewer.getContent()
      const baseline = latestBytesRef.current
      if (baseline && baseline.path === owner) {
        lastWrittenRef.current = uint8ArrayToBase64(baseline.data)
      }
    } catch (err) {
      console.error('Failed to baseline pptx:', err)
    } finally {
      serializingRef.current = false
      if (viewerOwnerRef.current === owner) armedRef.current = true
    }
  }, [])

  // Arming hangs off ref attachment rather than the load, because the viewer
  // chunk can take longer to arrive than ARM_DELAY_MS on a cold open.
  const setViewer = useCallback((instance: PowerPointViewerHandle | null) => {
    viewerRef.current = instance
    viewerOwnerRef.current = instance ? path : null
    if (armTimerRef.current) clearTimeout(armTimerRef.current)
    if (!instance) return
    const owner = path
    armTimerRef.current = setTimeout(() => { void baselineAndArm(instance, owner) }, ARM_DELAY_MS)
  }, [path, baselineAndArm])

  // Load the .pptx bytes whenever the path changes.
  useEffect(() => {
    let cancelled = false
    setLoadState('loading')
    setContent(null)
    setSaveState('idle')
    setRenderFailed(false)
    armedRef.current = false
    savingRef.current = false
    pendingRef.current = false
    serializingRef.current = false
    lastWrittenRef.current = null
    latestBytesRef.current = null

    ;(async () => {
      try {
        const result = await window.ipc.invoke('workspace:readFile', { path, encoding: 'base64' })
        if (cancelled) return
        setContent(base64ToUint8Array(result.data))
        setLoadState('ready')
      } catch (err) {
        console.error('Failed to load pptx:', err)
        if (!cancelled) setLoadState('error')
      }
    })()

    return () => {
      cancelled = true
      if (armTimerRef.current) clearTimeout(armTimerRef.current)
    }
  }, [path])

  // Write the viewer's latest serialization back to disk.
  const persist = useCallback(async () => {
    const viewer = viewerRef.current
    // A debounced save can land after the viewer has moved on to another file.
    if (!viewer || viewerOwnerRef.current !== path) return
    if (savingRef.current) {
      pendingRef.current = true
      return
    }
    savingRef.current = true
    try {
      // getContent() is what refreshes latestBytesRef — it re-emits the bytes
      // through onContentChange, which the viewer otherwise only fires on a
      // theme change.
      serializingRef.current = true
      await viewer.getContent()
      serializingRef.current = false

      const latest = latestBytesRef.current
      if (!latest || latest.path !== path) return
      const data = uint8ArrayToBase64(latest.data)
      // Every edit signal lands here, so most calls have nothing new to write.
      // Comparing against the last write keeps those off the disk entirely.
      if (!data || data === lastWrittenRef.current) return
      setSaveState('saving')
      await window.ipc.invoke('workspace:writeFile', {
        path,
        data,
        opts: { encoding: 'base64' },
      })
      lastWrittenRef.current = data
      setSaveState('saved')
    } catch (err) {
      console.error('Failed to save pptx:', err)
      setSaveState('error')
    } finally {
      serializingRef.current = false
      savingRef.current = false
      // A change landed while we were saving — flush it.
      if (pendingRef.current) {
        pendingRef.current = false
        scheduleSave()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  const scheduleSave = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => { void persist() }, SAVE_DEBOUNCE_MS)
  }

  const handleContentChange = (data: Uint8Array) => {
    latestBytesRef.current = { path, data }
    // Scheduling on our own getContent() re-emit would make each save trigger
    // the next one; a theme change emits here on its own and does need a save.
    if (!armedRef.current || serializingRef.current) return
    scheduleSave()
  }

  // Per-edit signals. Merely opening and clicking around still writes nothing:
  // persist() compares against the baseline captured when the document armed.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handleEditSignal = () => {
      if (!armedRef.current) return
      scheduleSave()
    }
    for (const event of EDIT_SIGNAL_EVENTS) {
      el.addEventListener(event, handleEditSignal, true)
    }
    return () => {
      for (const event of EDIT_SIGNAL_EVENTS) {
        el.removeEventListener(event, handleEditSignal, true)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  // Flush the last serialization when navigating away or unmounting. This runs
  // off the stored bytes rather than the viewer, whose ref has already been
  // detached by the time this cleanup fires — reaching for it here silently
  // skipped the flush and dropped the edit.
  useEffect(() => {
    const owner = path
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      const latest = latestBytesRef.current
      if (latest && latest.path === owner) {
        const data = uint8ArrayToBase64(latest.data)
        if (data && data !== lastWrittenRef.current) {
          lastWrittenRef.current = data
          void window.ipc.invoke('workspace:writeFile', {
            path: owner,
            data,
            opts: { encoding: 'base64' },
          })
        }
      }
      // Those bytes predate anything edited inside the debounce window. If the
      // viewer is somehow still attached and still ours, take the chance to
      // serialize once more; persist() re-checks ownership and dedupes.
      if (viewerRef.current && viewerOwnerRef.current === owner) void persist()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  if (loadState === 'error' || renderFailed) {
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
          onClick={() => { void window.ipc.invoke('shell:openPath', { path }) }}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
        >
          <ExternalLinkIcon className="size-3.5" />
          Open in system
        </button>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative flex h-full w-full flex-col overflow-hidden">
      {loadState === 'loading' || !content ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2Icon className="size-6 animate-spin" />
          <p className="text-sm">Loading presentation…</p>
        </div>
      ) : (
        <ViewerErrorBoundary onError={() => setRenderFailed(true)}>
          <Suspense
            fallback={
              <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-muted-foreground">
                <Loader2Icon className="size-6 animate-spin" />
                <p className="text-sm">Loading viewer…</p>
              </div>
            }
          >
            <LazyPptxViewer
              key={path}
              viewerRef={setViewer}
              content={content}
              filePath={path}
              fileName={baseName(path)}
              canEdit={true}
              onContentChange={handleContentChange}
              theme={VIEWER_THEME}
              className="flex-1 min-h-0"
            />
          </Suspense>
        </ViewerErrorBoundary>
      )}
      {saveState !== 'idle' && (
        <div className="pointer-events-none absolute bottom-3 right-4 z-10 rounded-md bg-background/80 px-2 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
          {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : 'Save failed'}
        </div>
      )}
    </div>
  )
}

interface ViewerErrorBoundaryProps {
  onError: () => void
  children: ReactNode
}

/**
 * Catches a parse/render failure inside the presentation viewer so the panel
 * can fall back to "open externally" instead of taking the whole pane down.
 */
class ViewerErrorBoundary extends Component<ViewerErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error('pptx viewer error:', error)
    this.props.onError()
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}
