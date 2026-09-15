import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from '@/components/ui/dialog'

const starters = [
  {
    name: 'Daily briefing',
    idea: 'Show my upcoming meetings and important unread emails, with a short summary of what needs my attention.'
  },
  {
    name: 'Pull request dashboard',
    idea: 'Show open pull requests across my GitHub repositories, grouped by those waiting for my review and those I authored.'
  },
  {
    name: 'Personal tracker',
    idea: 'Build a simple habit tracker where I can add habits, check them off each day, and see my progress for the week.'
  }
]

export function NewAppDialog({
  onClose,
  onBuild
}: {
  onClose: () => void
  onBuild: (prompt: string, folder: string) => void
}) {
  const [name, setName] = useState('')
  const [idea, setIdea] = useState('')
  const [refresh, setRefresh] = useState('manual')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const build = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const base = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48)
        .replace(/-$/, '')
      if (base.length < 3)
        throw new Error('Choose a name with at least three letters or numbers.')
      // A short suffix avoids colliding with an app with the same display name.
      const folder = `${base}-${crypto.randomUUID().slice(0, 8)}`
      await window.ipc.invoke('apps:create', {
        folder,
        name: base,
        description: idea.trim().slice(0, 500)
      })
      onBuild(
        `Build my app “${name.trim()}” using the attached app as the starting point.\n\n${idea.trim()}\n\n${refresh === 'daily' ? 'Keep the data up to date every day.' : 'Update data only when I use the app; no scheduled updates.'}\n\nShow me the working app when it is ready.`,
        folder
      )
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent
        showCloseButton={!busy}
        className="max-h-[85vh] overflow-y-auto"
      >
        <DialogTitle>What would you like to build?</DialogTitle>
        <DialogDescription>
          Describe a tool you want to come back to. The copilot will connect the
          data it needs and build a working preview alongside your conversation.
        </DialogDescription>
        <div className="flex flex-wrap gap-2">
          {starters.map((s) => (
            <button
              key={s.name}
              type="button"
              disabled={busy}
              className="rounded-full border px-3 py-1.5 text-xs hover:bg-accent"
              onClick={() => {
                setName(s.name)
                setIdea(s.idea)
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void build()
          }}
        >
          <label className="block space-y-1 text-sm">
            App name
            <input
              autoFocus
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              placeholder="My daily briefing"
              className="w-full rounded-lg border bg-background p-2"
              maxLength={64}
            />
          </label>
          <label className="block space-y-1 text-sm">
            What should it help you do?
            <textarea
              value={idea}
              disabled={busy}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="What should I see or do? Which data should it use?"
              className="min-h-28 w-full rounded-lg border bg-background p-2"
              maxLength={4000}
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            Data refresh
            <select
              value={refresh}
              disabled={busy}
              onChange={(e) => setRefresh(e.target.value)}
              className="rounded-lg border bg-background p-2"
            >
              <option value="manual">When I use it</option>
              <option value="daily">Every day</option>
            </select>
          </label>
          <p className="text-xs text-muted-foreground">
            You can refine it in chat as it builds. Any required account
            connections will be explained there.
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || !name.trim() || !idea.trim()}
            className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? 'Creating your app…' : 'Build app'}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
