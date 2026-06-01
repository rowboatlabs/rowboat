import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileText, Loader2, RefreshCw, Search } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { GoogleClientIdModal } from '@/components/google-client-id-modal'
import { setGoogleCredentials } from '@/lib/google-credentials-store'
import { formatRelativeTime } from '@/lib/relative-time'
import { toast } from '@/lib/toast'

type GoogleDocListItem = {
  id: string
  name: string
  url: string
  modifiedTime: string | null
  owner: string | null
}

type GoogleDocsStatus = {
  connected: boolean
  hasRequiredScopes: boolean
  missingScopes: string[]
}

type GoogleDocPickerDialogProps = {
  open: boolean
  targetFolder: string
  onOpenChange: (open: boolean) => void
  onImported: (path: string) => void
}

function formatModified(modifiedTime: string | null): string {
  if (!modifiedTime) return ''
  return formatRelativeTime(modifiedTime)
}

export function GoogleDocPickerDialog({
  open,
  targetFolder,
  onOpenChange,
  onImported,
}: GoogleDocPickerDialogProps) {
  const [status, setStatus] = useState<GoogleDocsStatus | null>(null)
  const [query, setQuery] = useState('')
  const [docs, setDocs] = useState<GoogleDocListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [importingId, setImportingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [byokOpen, setByokOpen] = useState(false)

  const canList = Boolean(status?.connected && status.hasRequiredScopes)
  const targetLabel = useMemo(() => targetFolder.replace(/^knowledge\/?/, '') || 'knowledge', [targetFolder])

  const loadStatus = useCallback(async () => {
    setError(null)
    try {
      const result = await window.ipc.invoke('google-docs:getStatus', null)
      setStatus(result)
    } catch (err) {
      setStatus(null)
      setError(err instanceof Error ? err.message : 'Failed to check Google connection')
    }
  }, [])

  const loadDocs = useCallback(async (searchQuery: string) => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.ipc.invoke('google-docs:list', { query: searchQuery.trim() || undefined })
      setDocs(result.files)
    } catch (err) {
      setDocs([])
      setError(err instanceof Error ? err.message : 'Failed to load Google Docs')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setDocs([])
    setError(null)
    void loadStatus()
  }, [loadStatus, open])

  useEffect(() => {
    if (!open || !canList) return
    const timeout = window.setTimeout(() => {
      void loadDocs(query)
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [canList, loadDocs, open, query])

  const handleConnect = useCallback(async () => {
    setConnecting(true)
    setError(null)
    try {
      const result = await window.ipc.invoke('oauth:connect', { provider: 'google' })
      if (!result.success) {
        setError(result.error ?? 'Failed to start Google connection')
      } else {
        toast('Finish Google connection in the browser, then reopen the picker.', 'info')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start Google connection')
    } finally {
      setConnecting(false)
    }
  }, [])

  // BYOK: connect Google with the user's own OAuth client. Unlike the managed
  // (rowboat) sign-in, this local flow requests the Drive + Docs scopes, so a
  // signed-in user can actually grant Docs access without a backend change.
  const handleByokSubmit = useCallback((clientId: string, clientSecret: string) => {
    setGoogleCredentials(clientId, clientSecret)
    setByokOpen(false)
    setConnecting(true)
    setError(null)
    void window.ipc.invoke('oauth:connect', { provider: 'google', clientId, clientSecret })
      .then((result) => {
        if (!result.success) setError(result.error ?? 'Failed to start Google connection')
        else toast('Finish Google consent in the browser…', 'info')
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to start Google connection'))
      .finally(() => setConnecting(false))
  }, [])

  // Re-check scopes as soon as a Google connection completes in the browser.
  useEffect(() => {
    if (!open) return
    const cleanup = window.ipc.on('oauth:didConnect', (event) => {
      if (event.provider !== 'google') return
      void loadStatus()
    })
    return cleanup
  }, [open, loadStatus])

  const handleImport = useCallback(async (doc: GoogleDocListItem) => {
    setImportingId(doc.id)
    setError(null)
    try {
      const result = await window.ipc.invoke('google-docs:import', {
        fileId: doc.id,
        targetFolder,
      })
      toast('Google Doc added', 'success')
      onImported(result.path)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import Google Doc')
    } finally {
      setImportingId(null)
    }
  }, [onImported, onOpenChange, targetFolder])

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(720px,calc(100vh-4rem))] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4">
          <DialogTitle>Add Google Doc</DialogTitle>
          <DialogDescription>
            Select a Google Doc to link into {targetLabel}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          {!status && error ? (
            <div className="flex min-h-[320px] flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
              <div className="max-w-sm text-sm text-destructive">{error}</div>
              <Button variant="outline" onClick={() => void loadStatus()}>
                <RefreshCw className="size-4" />
                Retry
              </Button>
            </div>
          ) : !status ? (
            <div className="flex min-h-[320px] flex-1 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              Checking Google connection...
            </div>
          ) : !status.connected || !status.hasRequiredScopes ? (
            <div className="flex min-h-[360px] flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-8 py-8 text-center">
              <div className="max-w-sm text-sm text-muted-foreground">
                To choose Google Docs, Rowboat needs Drive&nbsp;+&nbsp;Docs access.
              </div>
              {status.missingScopes.length > 0 && (
                <div className="max-w-md rounded-md border border-border bg-muted/30 px-3 py-2 text-left text-xs text-muted-foreground">
                  Missing scopes: {status.missingScopes.join(', ')}
                </div>
              )}
              <div className="flex w-full max-w-xs flex-col gap-2">
                <Button onClick={() => setByokOpen(true)} disabled={connecting}>
                  {connecting ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  Connect with your Google credentials
                </Button>
                <Button variant="outline" onClick={handleConnect} disabled={connecting}>
                  Use managed Google sign-in
                </Button>
              </div>
              <p className="max-w-sm text-xs text-muted-foreground">
                Managed sign-in may not grant Docs access yet. If it keeps asking for scopes,
                connect a Google OAuth client (Desktop app) with the Drive&nbsp;API and Docs&nbsp;API enabled.
              </p>
            </div>
          ) : (
            <>
              <div className="shrink-0 border-b border-border p-4">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search Google Docs"
                    className="pl-9"
                    autoFocus
                  />
                </div>
              </div>

              {error && (
                <div className="mx-4 mt-4 shrink-0 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div className="min-h-[280px] flex-1 overflow-y-auto p-2">
                {loading ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Loading Docs...
                  </div>
                ) : docs.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    No Google Docs found.
                  </div>
                ) : (
                  <div className="space-y-1">
                    {docs.map((doc) => (
                      <button
                        key={doc.id}
                        type="button"
                        onClick={() => void handleImport(doc)}
                        disabled={importingId !== null}
                        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent disabled:opacity-60"
                      >
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{doc.name}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {[doc.owner, formatModified(doc.modifiedTime)].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                        {importingId === doc.id && <Loader2 className="size-4 shrink-0 animate-spin" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
    <GoogleClientIdModal
      open={byokOpen}
      onOpenChange={setByokOpen}
      onSubmit={handleByokSubmit}
      description="Enter a Google OAuth client (Desktop app) with the Drive API and Docs API enabled to grant Docs access."
    />
    </>
  )
}
