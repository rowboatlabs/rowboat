import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { ExternalLinkIcon, FileTextIcon, Loader2Icon } from 'lucide-react'
import type { DocxEditorRef } from '@eigenpal/docx-editor-react'

// The editor (and its CSS) is heavy and only needed when a .docx is open, so it
// loads in its own chunk the first time a Word document is viewed.
const LazyDocxEditor = lazy(async () => {
  const [mod] = await Promise.all([
    import('@eigenpal/docx-editor-react'),
    import('@eigenpal/docx-editor-react/styles.css'),
  ])
  return { default: mod.DocxEditor }
})

interface DocxFileViewerProps {
  path: string
}

type LoadState = 'loading' | 'ready' | 'error'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const SAVE_DEBOUNCE_MS = 800
// onChange fires for the editor's own load-time normalization. Ignore changes
// until shortly after the document settles so opening a file never rewrites it.
const ARM_DELAY_MS = 500

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
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

export function DocxFileViewer({ path }: DocxFileViewerProps) {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')

  const editorRef = useRef<DocxEditorRef>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const armedRef = useRef(false)
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)

  // Load the .docx bytes whenever the path changes.
  useEffect(() => {
    let cancelled = false
    setLoadState('loading')
    setBuffer(null)
    setSaveState('idle')
    armedRef.current = false
    dirtyRef.current = false
    savingRef.current = false

    ;(async () => {
      try {
        const result = await window.ipc.invoke('workspace:readFile', { path, encoding: 'base64' })
        if (cancelled) return
        setBuffer(base64ToArrayBuffer(result.data))
        setLoadState('ready')
        if (armTimerRef.current) clearTimeout(armTimerRef.current)
        armTimerRef.current = setTimeout(() => { armedRef.current = true }, ARM_DELAY_MS)
      } catch (err) {
        console.error('Failed to load docx:', err)
        if (!cancelled) setLoadState('error')
      }
    })()

    return () => {
      cancelled = true
      if (armTimerRef.current) clearTimeout(armTimerRef.current)
    }
  }, [path])

  // Serialize the current document and write it back to disk.
  const persist = async () => {
    const editor = editorRef.current
    if (!editor || savingRef.current) return
    savingRef.current = true
    dirtyRef.current = false
    setSaveState('saving')
    try {
      const out = await editor.save()
      if (out) {
        await window.ipc.invoke('workspace:writeFile', {
          path,
          data: arrayBufferToBase64(out),
          opts: { encoding: 'base64' },
        })
      }
      setSaveState('saved')
    } catch (err) {
      console.error('Failed to save docx:', err)
      dirtyRef.current = true
      setSaveState('error')
    } finally {
      savingRef.current = false
      // A change landed while we were saving — flush it.
      if (dirtyRef.current) scheduleSave()
    }
  }

  const scheduleSave = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => { void persist() }, SAVE_DEBOUNCE_MS)
  }

  const handleChange = () => {
    if (!armedRef.current) return
    dirtyRef.current = true
    scheduleSave()
  }

  // Flush a pending save when navigating away or unmounting.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      if (dirtyRef.current) void persist()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  if (loadState === 'error') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
        <FileTextIcon className="size-6" />
        <p className="text-sm font-medium text-foreground">Cannot open this document</p>
        <p className="max-w-md text-xs">The file may be corrupted or not a valid Word document.</p>
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

  if (loadState === 'loading' || !buffer) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2Icon className="size-6 animate-spin" />
        <p className="text-sm">Loading document…</p>
      </div>
    )
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
      <Suspense
        fallback={
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader2Icon className="size-6 animate-spin" />
            <p className="text-sm">Loading editor…</p>
          </div>
        }
      >
        <LazyDocxEditor
          key={path}
          ref={editorRef}
          documentBuffer={buffer}
          mode="editing"
          documentName={baseName(path)}
          documentNameEditable={false}
          onChange={handleChange}
          onError={(err) => { console.error('docx editor error:', err) }}
          className="flex-1 min-h-0"
        />
      </Suspense>
      {saveState !== 'idle' && (
        <div className="pointer-events-none absolute bottom-3 right-4 z-10 rounded-md bg-background/80 px-2 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
          {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : 'Save failed'}
        </div>
      )}
    </div>
  )
}
