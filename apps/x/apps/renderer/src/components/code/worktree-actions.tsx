import { useState } from 'react'
import { GitMerge, Trash2 } from 'lucide-react'
import type { CodeSession } from '@x/shared/src/code-sessions.js'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { refreshCodeSessions } from './use-code-sessions'

// Workspace lifecycle remains available even when this session has coding off.
export function WorktreeActions({ session }: { session: CodeSession }) {
  const [cleanup, setCleanup] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  if (!session.worktree || session.worktree.removedAt) return null
  const merge = async () => {
    setBusy(true)
    try {
      const result = await window.ipc.invoke('codeSession:mergeBack', { sessionId: session.id })
      if (!result.ok) throw new Error(result.message)
      toast.success(result.message)
      await refreshCodeSessions()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Failed to merge worktree') }
    finally { setBusy(false) }
  }
  const remove = async (deleteBranch: boolean) => {
    setBusy(true)
    try {
      const result = await window.ipc.invoke('codeSession:cleanupWorktree', { sessionId: session.id, deleteBranch })
      if (!result.success) throw new Error(result.error ?? 'Failed to remove worktree')
      toast.success('Worktree removed. Its sessions now use the project folder.')
      await refreshCodeSessions()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Failed to remove worktree') }
    finally { setBusy(false) }
  }
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground" disabled={busy}><GitMerge className="size-3.5" />Worktree</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void merge()}><GitMerge className="size-4" />Merge back into repo</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setCleanup(false)}><Trash2 className="size-4" />Remove worktree (keep branch)</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => setCleanup(true)}><Trash2 className="size-4" />Remove worktree and branch</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <AlertDialog open={cleanup !== null} onOpenChange={(open) => { if (!open) setCleanup(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove this shared worktree?</AlertDialogTitle>
          <AlertDialogDescription>This stops every session and terminal in this worktree and removes its files, including uncommitted changes. Conversations are kept and will use the project folder. {cleanup ? 'The branch will also be deleted.' : 'The branch will be kept.'}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => { if (cleanup !== null) void remove(cleanup); setCleanup(null) }}>Remove worktree</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
}
