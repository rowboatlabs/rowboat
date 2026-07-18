import { MigrateSourceCard, MigrateStatus, useNotesMigration } from '@/components/migrate-notes'

/**
 * Settings pane for migrating a whole notes corpus from another app: an entire
 * Obsidian vault, or a full Notion workspace export. Everything lands in a new
 * subfolder of knowledge/, so a migration never mixes into existing notes.
 */
export function MigrateSettings({ onNavigateToNotes }: { onNavigateToNotes?: () => void }) {
  const migration = useNotesMigration()
  const { migrating, runMigration, viewInNotes } = migration

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Bring all your notes across in one go. Your folders, images, and the links
        between notes are preserved, and everything lands in its own folder in Notes —
        nothing gets mixed into your existing notes.
      </p>

      <div className="space-y-3">
        <MigrateSourceCard
          source="obsidian"
          busy={migrating === 'obsidian'}
          disabled={migrating !== null}
          onClick={() => void runMigration('obsidian')}
        />
        <MigrateSourceCard
          source="notion"
          busy={migrating === 'notion'}
          disabled={migrating !== null}
          onClick={() => void runMigration('notion')}
        />
      </div>

      <MigrateStatus
        migration={migration}
        onViewInNotes={() => {
          viewInNotes()
          onNavigateToNotes?.()
        }}
      />
    </div>
  )
}
