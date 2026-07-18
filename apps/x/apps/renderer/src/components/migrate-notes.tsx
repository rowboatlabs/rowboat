import { useCallback, useEffect, useState } from 'react'
import { FileArchive, FolderOpen, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { notesMigrated } from '@/lib/analytics'

export type MigrateSource = 'obsidian' | 'notion'

export type MigrateSkippedFile = {
  file: string
  reason: 'too-large' | 'copy-failed' | 'unreadable-note'
}

export type MigrateResult = {
  source: MigrateSource
  notes: number
  attachments: number
  skipped: number
  skippedFiles: MigrateSkippedFile[]
  root: string
  assetsRoot: string
}

export type MigrateProgress = {
  done: number
  total: number
  stage: 'attachments' | 'notes'
}

// Rejected invoke() calls arrive as "Error invoking remote method
// 'knowledge:importNotes': Error: <message>" — strip the Electron wrapper so
// the UI and analytics see the message importTree actually threw.
function migrationErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') || 'Migration failed'
}

/**
 * Shared pieces for migrating a notes corpus from another app (an Obsidian
 * vault folder or a Notion export zip), used by both Settings → Migrate Data
 * and the onboarding migrate step. The flow is: native picker → single
 * knowledge:importNotes IPC call (progress pushed on knowledge:importProgress)
 * → summary with per-file skip reasons, undo, and view-in-notes.
 */
export function useNotesMigration() {
  const [migrating, setMigrating] = useState<MigrateSource | null>(null)
  const [progress, setProgress] = useState<MigrateProgress | null>(null)
  const [result, setResult] = useState<MigrateResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [undoing, setUndoing] = useState(false)
  const [undone, setUndone] = useState(false)

  useEffect(() => {
    if (!migrating) return
    return window.ipc.on('knowledge:importProgress', setProgress)
  }, [migrating])

  const runMigration = useCallback(async (source: MigrateSource) => {
    setError(null)
    setUndone(false)

    let sourcePath: string | null = null
    if (source === 'obsidian') {
      const picked = await window.ipc.invoke('dialog:openDirectory', {
        title: 'Choose your Obsidian vault folder',
      })
      sourcePath = picked.path
    } else {
      const picked = await window.ipc.invoke('dialog:openFiles', {
        title: 'Choose your Notion export (.zip)',
        filters: [{ name: 'Zip archives', extensions: ['zip'] }],
      })
      sourcePath = picked.paths[0] ?? null
      if (sourcePath && !sourcePath.toLowerCase().endsWith('.zip')) {
        const message = 'That doesn’t look like a Notion export. In Notion, use Settings → Export → "Markdown & CSV", then choose the downloaded .zip.'
        setError(message)
        notesMigrated({ source, success: false, error: message })
        return
      }
    }
    if (!sourcePath) return

    setMigrating(source)
    setResult(null)
    setProgress(null)
    try {
      const summary = await window.ipc.invoke('knowledge:importNotes', {
        source,
        sourcePath,
        targetFolder: 'knowledge',
      })
      setResult({ source, ...summary })
      notesMigrated({
        source,
        success: true,
        notes: summary.notes,
        attachments: summary.attachments,
        skipped: summary.skipped,
      })
    } catch (err) {
      const message = migrationErrorMessage(err)
      setError(message)
      notesMigrated({ source, success: false, error: message })
    } finally {
      setMigrating(null)
      setProgress(null)
    }
  }, [])

  const undoMigration = useCallback(async () => {
    if (!result || undoing) return
    setUndoing(true)
    setError(null)
    try {
      await window.ipc.invoke('knowledge:undoImport', {
        root: result.root,
        assetsRoot: result.assetsRoot,
      })
      setResult(null)
      setUndone(true)
    } catch (err) {
      setError(migrationErrorMessage(err))
    } finally {
      setUndoing(false)
    }
  }, [result, undoing])

  // Handled by App.tsx, which navigates to the folder in the Notes view.
  const viewInNotes = useCallback(() => {
    if (!result) return
    window.dispatchEvent(new CustomEvent('rowboat:open-knowledge-folder', {
      detail: { folderPath: result.root },
    }))
  }, [result])

  return { migrating, progress, result, error, undoing, undone, runMigration, undoMigration, viewInNotes }
}

export type NotesMigration = ReturnType<typeof useNotesMigration>

const CARDS: Record<MigrateSource, {
  icon: typeof FolderOpen
  title: string
  description: string
  actionLabel: string
}> = {
  obsidian: {
    icon: FolderOpen,
    title: 'Migrate from Obsidian',
    description: 'Choose your vault folder. All notes, folders, attachments, and [[wiki links]] come across intact.',
    actionLabel: 'Choose vault folder…',
  },
  notion: {
    icon: FileArchive,
    title: 'Migrate from Notion',
    description: 'In Notion: Settings → Export → "Markdown & CSV" (include subpages). Then choose the downloaded .zip — page links and images are converted automatically.',
    actionLabel: 'Choose export .zip…',
  },
}

export function MigrateSourceCard({
  source,
  busy,
  disabled,
  onClick,
}: {
  source: MigrateSource
  busy: boolean
  disabled: boolean
  onClick: () => void
}) {
  const { icon: Icon, title, description, actionLabel } = CARDS[source]
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <div className="mt-0.5 shrink-0 text-muted-foreground">
        {busy ? <Loader2 className="size-5 animate-spin" /> : <Icon className="size-5" />}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-1 text-xs text-muted-foreground">{description}</div>
        <div className="mt-2 text-xs font-medium text-primary">{actionLabel}</div>
      </div>
    </button>
  )
}

const SKIP_REASON_LABEL: Record<MigrateSkippedFile['reason'], string> = {
  'too-large': 'too large',
  'copy-failed': 'couldn’t be copied',
  'unreadable-note': 'couldn’t be read',
}

function SkippedBreakdown({ files }: { files: MigrateSkippedFile[] }) {
  const groups = new Map<string, string[]>()
  for (const f of files) {
    const label = SKIP_REASON_LABEL[f.reason]
    groups.set(label, [...(groups.get(label) ?? []), f.file])
  }
  return (
    <div className="mt-2 space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
      {[...groups.entries()].map(([label, names]) => (
        <div key={label}>
          <span className="font-medium">{names.length} {label}:</span>{' '}
          {names.slice(0, 3).join(', ')}
          {names.length > 3 && ` and ${names.length - 3} more`}
        </div>
      ))}
    </div>
  )
}

export function MigrateStatus({
  migration,
  onViewInNotes,
}: {
  migration: NotesMigration
  // When set, a "View in Notes" button is shown; the caller is responsible
  // for getting the Notes view on screen (e.g. closing its own dialog).
  onViewInNotes?: () => void
}) {
  const { migrating, progress, error, result, undoing, undone, undoMigration } = migration
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  return (
    <>
      {migrating && (
        <div className="space-y-1.5">
          <Progress value={pct} />
          <p className="text-xs text-muted-foreground">
            {progress
              ? `Copying ${progress.stage}… ${progress.done} of ${progress.total} files`
              : 'Preparing import…'}
          </p>
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {undone && !result && !migrating && (
        <p className="text-xs text-muted-foreground">
          Import undone — everything it added was removed.
        </p>
      )}
      {result && (
        <div className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm">
          <div>
            Migrated <span className="font-medium">{result.notes}</span> {result.notes === 1 ? 'note' : 'notes'}
            {result.attachments > 0 && <> and <span className="font-medium">{result.attachments}</span> attachments</>}
            {' '}from {result.source === 'obsidian' ? 'Obsidian' : 'Notion'} into{' '}
            <span className="font-medium">{result.root.replace(/^knowledge\//, 'Notes/')}</span>.
          </div>
          {result.skippedFiles.length > 0 && <SkippedBreakdown files={result.skippedFiles} />}
          <div className="mt-2 flex items-center gap-2">
            {onViewInNotes && (
              <Button size="sm" variant="outline" onClick={onViewInNotes}>
                View in Notes
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={undoing} onClick={() => void undoMigration()}>
              {undoing ? 'Undoing…' : 'Undo import'}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
