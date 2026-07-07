import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import {
  CloudDownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  Loader2Icon,
  UploadCloudIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import type { DocxEditorRef } from '@eigenpal/docx-editor-react'
import { formatRelativeTime } from '@/lib/relative-time'

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

type GoogleDocLink = {
  id: string
  url: string
  title: string
  syncedAt: string
  remoteModifiedTime?: string
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
  const [reloadNonce, setReloadNonce] = useState(0)
  const [link, setLink] = useState<GoogleDocLink | null>(null)
  const [syncing, setSyncing] = useState<'up' | 'down' | null>(null)

  const editorRef = useRef<DocxEditorRef>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const armedRef = useRef(false)
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)

  // Load the .docx bytes whenever the path changes or a sync-down reloads it.
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
  }, [path, reloadNonce])

  // Is this file linked to a Google Doc? Drives the sync bar.
  useEffect(() => {
    let cancelled = false
    setLink(null)
    void window.ipc.invoke('google-docs:getLink', { path })
      .then((res) => { if (!cancelled) setLink(res.link) })
      .catch((err) => { console.error('Failed to read Google Doc link:', err) })
    return () => { cancelled = true }
  }, [path])

  // Serialize the current document and write it back to disk.
  const persist = useCallback(async () => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

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

  // Write any pending edits to disk before a sync-up so we push the latest.
  const flushPendingSave = useCallback(async () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    if (dirtyRef.current || savingRef.current) {
      await persist()
    }
  }, [persist])

  const handleSyncDown = useCallback(async () => {
    if (syncing) return
    setSyncing('down')
    try {
      await window.ipc.invoke('google-docs:refreshSnapshot', { path })
      // Reload the freshly-written bytes into the editor.
      armedRef.current = false
      dirtyRef.current = false
      setReloadNonce((n) => n + 1)
      const res = await window.ipc.invoke('google-docs:getLink', { path })
      setLink(res.link)
      toast.success('Pulled latest from Google Docs')
    } catch (err) {
      console.error('Sync down failed:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to pull from Google Docs')
    } finally {
      setSyncing(null)
    }
  }, [path, syncing])

  const handleSyncUp = useCallback(async () => {
    if (syncing) return
    setSyncing('up')
    try {
      await flushPendingSave()
      let result = await window.ipc.invoke('google-docs:sync', { path })
      if (result.conflict) {
        const overwrite = window.confirm(
          'This Google Doc changed since your last sync.\n\n' +
          'Overwrite it with your local version? Cancel to keep the remote copy ' +
          '(use “Sync down” to pull it first).',
        )
        if (!overwrite) {
          toast.info('Sync up cancelled — remote Google Doc is unchanged')
          return
        }
        result = await window.ipc.invoke('google-docs:sync', { path, force: true })
      }
      if (!result.synced) {
        throw new Error(result.error || 'This file is not linked to a Google Doc.')
      }
      const res = await window.ipc.invoke('google-docs:getLink', { path })
      setLink(res.link)
      toast.success('Pushed changes to Google Docs')
    } catch (err) {
      console.error('Sync up failed:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to push to Google Docs')
    } finally {
      setSyncing(null)
    }
  }, [path, syncing, flushPendingSave])

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

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
      {link && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5 text-xs">
          <GoogleDocsIcon className="size-4 shrink-0" />
          <span className="truncate font-medium text-foreground">{link.title}</span>
          <span className="truncate text-muted-foreground">
            {syncing
              ? syncing === 'up' ? 'Syncing up…' : 'Syncing down…'
              : `Synced ${formatRelativeTime(link.syncedAt)}`}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => { void handleSyncDown() }}
              disabled={Boolean(syncing)}
              title="Pull latest from Google Docs"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-foreground hover:bg-accent disabled:opacity-50"
            >
              <CloudDownloadIcon className="size-3.5" /> Sync down
            </button>
            <button
              type="button"
              onClick={() => { void handleSyncUp() }}
              disabled={Boolean(syncing)}
              title="Push your changes to Google Docs"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-foreground hover:bg-accent disabled:opacity-50"
            >
              <UploadCloudIcon className="size-3.5" /> Sync up
            </button>
            <button
              type="button"
              onClick={() => { window.open(link.url, '_blank') }}
              title="Open in Google Docs"
              className="inline-flex items-center rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ExternalLinkIcon className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      {loadState === 'loading' || !buffer ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2Icon className="size-6 animate-spin" />
          <p className="text-sm">Loading document…</p>
        </div>
      ) : (
        <Suspense
          fallback={
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2Icon className="size-6 animate-spin" />
              <p className="text-sm">Loading editor…</p>
            </div>
          }
        >
          <LazyDocxEditor
            key={`${path}:${reloadNonce}`}
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
      )}
      {saveState !== 'idle' && (
        <div className="pointer-events-none absolute bottom-3 right-4 z-10 rounded-md bg-background/80 px-2 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
          {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : 'Save failed'}
        </div>
      )}
    </div>
  )
}

function GoogleDocsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M6 2h8l5 5v15H6V2Z" />
      <path fill="#AECBFA" d="M14 2v5h5l-5-5Z" />
      <path fill="#FFFFFF" d="M8.5 11h7v1.2h-7V11Zm0 2.6h7v1.2h-7v-1.2Zm0 2.6h5.2v1.2H8.5v-1.2Z" />
    </svg>
  )
}
