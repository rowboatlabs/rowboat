import { useState } from 'react'
import { Loader2, Pencil } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog'

export function EditChatMessage({ text, onSave }: { text: string; onSave: (text: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(text)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    if (saving || !draft.trim()) return
    setSaving(true); setError('')
    try { await onSave(draft); setOpen(false) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not submit your edit. Please try again.') }
    finally { setSaving(false) }
  }
  return <Dialog open={open} onOpenChange={value => {
    if (saving) return
    if (value) { setDraft(text); setError('') }
    setOpen(value)
  }}>
    <DialogTrigger asChild>
      <button type="button" aria-label="Edit message" title="Edit message" className="shrink-0 rounded-md p-1.5 text-muted-foreground/60 opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100">
        <Pencil className="size-3.5" />
      </button>
    </DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Edit message</DialogTitle>
        <DialogDescription>This starts a revised chat from this message. Earlier context and this message’s attachments are kept. Your original chat stays in history.</DialogDescription>
      </DialogHeader>
      <textarea aria-label="Revised message" value={draft} disabled={saving} onChange={e => setDraft(e.target.value)}
        className="min-h-40 max-h-80 w-full resize-y rounded-md border border-input bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void save() } }} />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
        <Button disabled={saving || !draft.trim() || draft === text} onClick={() => void save()}>
          {saving && <Loader2 className="size-4 animate-spin" />} {saving ? 'Submitting…' : 'Save & submit'}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
