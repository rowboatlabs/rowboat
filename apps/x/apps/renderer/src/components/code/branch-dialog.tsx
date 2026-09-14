import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'

export function BranchDialog({ projectId, mode, initialBranch, excludeBranch, onClose, onConfirm }: {
  projectId: string
  mode: 'switch' | 'base'
  initialBranch?: string | null
  excludeBranch?: string
  onClose: () => void
  onConfirm: (branch: string) => Promise<void>
}) {
  const [branches, setBranches] = useState<string[]>([])
  const [selected, setSelected] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    window.ipc.invoke('codeProject:branches', { projectId }).then((result) => {
      if (cancelled) return
      setBranches(result.branches.filter((branch) => branch !== excludeBranch))
      const branch = initialBranch ?? result.currentBranch
      setSelected(branch && branch !== excludeBranch && result.branches.includes(branch) ? branch : '')
    }).catch((err) => { if (!cancelled) setError(String(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId, initialBranch, excludeBranch])
  const submit = async () => {
    if (!selected || busy) return
    setBusy(true)
    setError(null)
    try { await onConfirm(selected); onClose() }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }
  // Keep Git's recency order while searching; cmdk's default ranking
  // otherwise puts closer text matches ahead of newer branches.
  const visibleBranches = branches.filter((branch) => branch.toLowerCase().includes(search.trim().toLowerCase()))
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'base' ? 'Change base branch' : 'Change project branch'}</DialogTitle>
          <DialogDescription>{mode === 'base'
            ? 'Choose a new base before any session starts. Your empty sessions will be kept.'
            : 'Switch the main folder’s branch. New worktrees will start from this branch by default.'}</DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0 text-sm font-medium">
            {mode === 'base' ? 'Base branch' : 'Branch'}
            <span className="mt-1 block truncate font-mono font-normal text-muted-foreground" title={selected}>
              {loading ? 'Loading…' : selected || 'Select a branch'}
            </span>
          </div>
        </div>
        <Command className="rounded-md border" aria-label="Branches" shouldFilter={false}>
          <CommandInput value={search} onValueChange={setSearch} placeholder="Search local branches…" disabled={busy || loading} />
          <CommandList className="max-h-56">
            <CommandEmpty>{loading ? 'Loading branches…' : 'No matching branches'}</CommandEmpty>
            {visibleBranches.map((branch) => <CommandItem key={branch} value={branch} disabled={busy} onSelect={() => {
              setSelected(branch)
            }}>
              <Check className={selected === branch ? 'size-4' : 'size-4 invisible'} />
              <span className="truncate font-mono">{branch}</span>
            </CommandItem>)}
          </CommandList>
        </Command>
        {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={loading || busy || !selected} onClick={() => void submit()}>{busy ? 'Working…' : mode === 'base' ? 'Change base branch' : 'Switch branch'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
