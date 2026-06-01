import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileText, Loader2, RefreshCw } from 'lucide-react'

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
import { openGooglePicker, getStoredPickerApiKey, setStoredPickerApiKey } from '@/lib/google-picker'
import { toast } from '@/lib/toast'

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

export function GoogleDocPickerDialog({
  open,
  targetFolder,
  onOpenChange,
  onImported,
}: GoogleDocPickerDialogProps) {
  const [status, setStatus] = useState<GoogleDocsStatus | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [byokOpen, setByokOpen] = useState(false)
  const [apiKey, setApiKey] = useState('')

  const canPick = Boolean(status?.connected && status.hasRequiredScopes)
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

  useEffect(() => {
    if (!open) return
    setError(null)
    setApiKey(getStoredPickerApiKey())
    void loadStatus()
  }, [loadStatus, open])

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

  // BYOK: connect Google with the user's own OAuth client, which requests the
  // drive.file scope locally (managed sign-in can't grant it without a backend
  // change).
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

  const handleChoose = useCallback(async () => {
    setError(null)
    const key = apiKey.trim()
    if (!key) {
      setError('Enter your Google Picker API key first.')
      return
    }
    setStoredPickerApiKey(key)
    setOpening(true)

    let accessToken: string | null = null
    try {
      const res = await window.ipc.invoke('google-docs:getAccessToken', null)
      accessToken = res.accessToken
    } catch (err) {
      setOpening(false)
      setError(err instanceof Error ? err.message : 'Failed to get a Google access token')
      return
    }
    if (!accessToken) {
      setOpening(false)
      setError('Google access token unavailable — reconnect Google.')
      return
    }

    // Hand off to Google's Picker; close our modal so it isn't trapped behind it.
    onOpenChange(false)
    try {
      await openGooglePicker({
        accessToken,
        apiKey: key,
        onPicked: async (file) => {
          try {
            const result = await window.ipc.invoke('google-docs:import', { fileId: file.id, targetFolder })
            toast(`Added “${file.name}”`, 'success')
            onImported(result.path)
          } catch (err) {
            toast(err instanceof Error ? err.message : 'Failed to import the document', 'error')
          }
        },
      })
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to open the Google Picker', 'error')
    } finally {
      setOpening(false)
    }
  }, [apiKey, targetFolder, onImported, onOpenChange])

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(720px,calc(100vh-4rem))] max-w-lg flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4">
          <DialogTitle>Add Google Doc</DialogTitle>
          <DialogDescription>
            Link a Google Doc or Word file from Drive into {targetLabel}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          {!status && error ? (
            <div className="flex min-h-[280px] flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
              <div className="max-w-sm text-sm text-destructive">{error}</div>
              <Button variant="outline" onClick={() => void loadStatus()}>
                <RefreshCw className="size-4" />
                Retry
              </Button>
            </div>
          ) : !status ? (
            <div className="flex min-h-[280px] flex-1 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              Checking Google connection...
            </div>
          ) : !canPick ? (
            <div className="flex min-h-[300px] flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-8 py-8 text-center">
              <div className="max-w-sm text-sm text-muted-foreground">
                To choose a document, Rowboat needs per-file Drive access (the <code>drive.file</code> scope).
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
                Managed sign-in may not grant Drive access yet. If it keeps asking for scopes,
                connect a Google OAuth client (Desktop app) with the Drive&nbsp;API and Picker&nbsp;API enabled.
              </p>
            </div>
          ) : (
            <div className="flex min-h-[300px] flex-1 flex-col items-center justify-center gap-4 px-8 py-8 text-center">
              <div className="max-w-sm text-sm text-muted-foreground">
                Pick a Google Doc or Word file from your Drive. It imports as an editable
                <code> .docx</code> and stays linked for two-way sync.
              </div>
              <div className="flex w-full max-w-sm flex-col gap-1.5 text-left">
                <label htmlFor="picker-api-key" className="text-xs font-medium text-muted-foreground">
                  Google Picker API key
                </label>
                <Input
                  id="picker-api-key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="AIza…"
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  From your Google Cloud project (APIs &amp; Services → Credentials → API key),
                  with the Picker&nbsp;API enabled. Stored locally.
                </p>
              </div>
              {error && (
                <div className="max-w-sm rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}
              <Button onClick={() => void handleChoose()} disabled={opening}>
                {opening ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
                Choose from Google Drive
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
    <GoogleClientIdModal
      open={byokOpen}
      onOpenChange={setByokOpen}
      onSubmit={handleByokSubmit}
      description="Enter a Google OAuth client (Desktop app) with the Drive API and Picker API enabled."
    />
    </>
  )
}
