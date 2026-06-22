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
import { toast } from '@/lib/toast'

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
  // The managed picker runs its own drive.file OAuth in the browser, gated on
  // the Rowboat web session. So the only desktop prerequisite is being signed
  // in to Rowboat — it needs NO prior Google connection and NO drive.file scope
  // on the main grant (the picker grants drive.file per-file as you choose).
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const targetLabel = useMemo(() => targetFolder.replace(/^knowledge\/?/, '') || 'knowledge', [targetFolder])

  const loadStatus = useCallback(async () => {
    try {
      const account = await window.ipc.invoke('account:getRowboat', null)
      setSignedIn(account.signedIn)
      setError(null)
    } catch (err) {
      setSignedIn(null)
      setError(err instanceof Error ? err.message : 'Failed to check your Rowboat sign-in')
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void loadStatus()
  }, [loadStatus, open])

  const handleChoose = useCallback(async () => {
    setError(null)
    setOpening(true)

    // Managed pick: the Rowboat backend runs the whole grant + pick in the
    // browser with the company Google client, then deep-links the selection
    // back. No API key, BYOK creds, or redirect URL to configure. Close our
    // modal during the hand-off.
    onOpenChange(false)
    toast('Continue in your browser: grant access and pick a document…', 'info')
    let result: { path: string; doc: { name: string } } | null = null
    try {
      result = await window.ipc.invoke('google-docs:pickViaManaged', { targetFolder })
    } catch (err) {
      setOpening(false)
      toast(err instanceof Error ? err.message : 'Failed to open the Google Picker', 'error')
      return
    }

    if (!result) {
      setOpening(false)
      return
    }

    toast(`Added “${result.doc.name}”`, 'success')
    onImported(result.path)
    setOpening(false)
  }, [targetFolder, onImported, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(720px,calc(100vh-4rem))] max-w-lg flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4">
          <DialogTitle>Add Google Doc</DialogTitle>
          <DialogDescription>
            Link a Google Doc or Word file from Drive into {targetLabel}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          {signedIn === null && error ? (
            <div className="flex min-h-[280px] flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
              <div className="max-w-sm text-sm text-destructive">{error}</div>
              <Button variant="outline" onClick={() => void loadStatus()}>
                <RefreshCw className="size-4" />
                Retry
              </Button>
            </div>
          ) : signedIn === null ? (
            <div className="flex min-h-[280px] flex-1 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              Checking your Rowboat sign-in…
            </div>
          ) : !signedIn ? (
            <div className="flex min-h-[300px] flex-1 flex-col items-center justify-center gap-4 px-8 py-8 text-center">
              <div className="max-w-sm text-sm text-muted-foreground">
                Sign in to Rowboat to add Google Docs from Drive. The picker uses your
                Rowboat account — no Google credentials or API key needed.
              </div>
              <Button variant="outline" onClick={() => void loadStatus()}>
                <RefreshCw className="size-4" />
                I&apos;ve signed in — retry
              </Button>
            </div>
          ) : (
            <div className="flex min-h-[300px] flex-1 flex-col items-center justify-center gap-4 px-8 py-8 text-center">
              <div className="max-w-sm text-sm text-muted-foreground">
                Pick a Google Doc or Word file from your Drive. It imports as an editable
                <code> .docx</code> and stays linked for two-way sync.
              </div>
              <p className="max-w-sm text-xs text-muted-foreground">
                You&apos;ll continue in your browser to grant access and choose a document — no
                API key or setup needed.
              </p>
              {error && (
                <div className="w-full max-w-sm rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
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
  )
}
