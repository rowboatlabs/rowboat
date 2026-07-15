import { useCallback, useState } from 'react'
import { FileArchive, FolderOpen, Loader2 } from 'lucide-react'

type MigrateSource = 'obsidian' | 'notion'

type MigrateResult = {
  source: MigrateSource
  notes: number
  attachments: number
  skipped: number
  root: string
}

/**
 * Settings pane for migrating a whole notes corpus from another app: an entire
 * Obsidian vault, or a full Notion workspace export. Everything lands in a new
 * subfolder of knowledge/, so a migration never mixes into existing notes.
 */
export function MigrateSettings() {
  const [migrating, setMigrating] = useState<MigrateSource | null>(null)
  const [result, setResult] = useState<MigrateResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const runMigration = useCallback(async (source: MigrateSource) => {
    setError(null)

    let sourcePath: string | null = null
    if (source === 'obsidian') {
      const picked = await window.ipc.invoke('dialog:openDirectory', {
        title: 'Choose your Obsidian vault folder',
      })
      sourcePath = picked.path
    } else {
      const picked = await window.ipc.invoke('dialog:openFiles', {
        title: 'Choose your Notion export (.zip)',
      })
      sourcePath = picked.paths[0] ?? null
      if (sourcePath && !sourcePath.toLowerCase().endsWith('.zip')) {
        setError('That doesn’t look like a Notion export. In Notion, use Settings → Export → "Markdown & CSV", then choose the downloaded .zip.')
        return
      }
    }
    if (!sourcePath) return

    setMigrating(source)
    setResult(null)
    try {
      const summary = await window.ipc.invoke('knowledge:importNotes', {
        source,
        sourcePath,
        targetFolder: 'knowledge',
      })
      setResult({ source, ...summary })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Migration failed')
    } finally {
      setMigrating(null)
    }
  }, [])

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Bring all your notes across in one go. Your folders, images, and the links
        between notes are preserved, and everything lands in its own folder in Notes —
        nothing gets mixed into your existing notes.
      </p>

      <div className="space-y-3">
        <MigrateSourceCard
          icon={FolderOpen}
          title="Migrate from Obsidian"
          description="Choose your vault folder. All notes, folders, attachments, and [[wiki links]] come across intact."
          actionLabel="Choose vault folder…"
          busy={migrating === 'obsidian'}
          disabled={migrating !== null}
          onClick={() => void runMigration('obsidian')}
        />
        <MigrateSourceCard
          icon={FileArchive}
          title="Migrate from Notion"
          description={'In Notion: Settings → Export → "Markdown & CSV" (include subpages). Then choose the downloaded .zip — page links and images are converted automatically.'}
          actionLabel="Choose export .zip…"
          busy={migrating === 'notion'}
          disabled={migrating !== null}
          onClick={() => void runMigration('notion')}
        />
      </div>

      {migrating && (
        <p className="text-xs text-muted-foreground">
          Migrating… this can take a few moments for large collections.
        </p>
      )}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {result && (
        <div className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm">
          Migrated <span className="font-medium">{result.notes}</span> {result.notes === 1 ? 'note' : 'notes'}
          {result.attachments > 0 && <> and <span className="font-medium">{result.attachments}</span> attachments</>}
          {' '}from {result.source === 'obsidian' ? 'Obsidian' : 'Notion'} into{' '}
          <span className="font-medium">{result.root.replace(/^knowledge\//, 'Notes/')}</span>.
          {result.skipped > 0 && <> {result.skipped} {result.skipped === 1 ? 'file was' : 'files were'} skipped.</>}
        </div>
      )}
    </div>
  )
}

function MigrateSourceCard({
  icon: Icon,
  title,
  description,
  actionLabel,
  busy,
  disabled,
  onClick,
}: {
  icon: typeof FolderOpen
  title: string
  description: string
  actionLabel: string
  busy: boolean
  disabled: boolean
  onClick: () => void
}) {
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
