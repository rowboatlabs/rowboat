import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MigrateSourceCard, MigrateStatus, useNotesMigration } from "@/components/migrate-notes"
import type { OnboardingState } from "../use-onboarding-state"

interface MigrateStepProps {
  state: OnboardingState
}

export function MigrateStep({ state }: MigrateStepProps) {
  const { handleNext, handleBack } = state
  const { migrating, result, error, runMigration } = useNotesMigration()

  // Navigation is locked while an import runs: the import itself continues in
  // the main process, but leaving the step unmounts the summary/error UI.
  const busy = migrating !== null

  return (
    <div className="flex flex-col flex-1">
      {/* Title */}
      <h2 className="text-3xl font-bold tracking-tight text-center mb-2">
        Bring Your Notes
      </h2>
      <p className="text-base text-muted-foreground text-center leading-relaxed mb-6 max-w-md mx-auto">
        Already keep notes in Obsidian? Migrate your vault now — folders, images, and
        the links between notes come across intact, in their own folder in Notes.
        You can also do this anytime (or migrate from Notion) in Settings → Migrate Data.
      </p>

      <div className="space-y-3">
        <MigrateSourceCard
          source="obsidian"
          busy={migrating === 'obsidian'}
          disabled={busy}
          onClick={() => void runMigration('obsidian')}
        />
        <MigrateStatus migrating={migrating} error={error} result={result} />
      </div>

      {/* Footer */}
      <div className="flex flex-col gap-3 mt-8 pt-4 border-t">
        <Button onClick={handleNext} size="lg" className="h-12 text-base font-medium" disabled={busy}>
          Continue
        </Button>
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={handleBack} className="gap-1" disabled={busy}>
            <ArrowLeft className="size-4" />
            Back
          </Button>
          <Button variant="ghost" onClick={handleNext} className="text-muted-foreground" disabled={busy}>
            Skip for now
          </Button>
        </div>
      </div>
    </div>
  )
}
