import { useCallback, useMemo, useState } from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { DECK_PALETTES, newDeckPptx, type DeckPalette } from '@x/shared/dist/pptx/new-deck.js'

type NewPresentationDialogProps = {
  open: boolean
  targetFolder: string
  onOpenChange: (open: boolean) => void
  onCreated: (path: string) => void
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** The palette's face: background, heading color, and its accent row. */
function PaletteSwatch({
  palette,
  selected,
  onSelect,
}: {
  palette: DeckPalette
  selected: boolean
  onSelect: () => void
}) {
  const s = palette.scheme
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex-1 rounded-lg border p-2 text-left transition-colors',
        selected ? 'border-primary ring-2 ring-primary/40' : 'border-border hover:border-primary/50',
      )}
    >
      <div
        className="flex h-14 flex-col justify-between rounded-md border border-black/5 p-2"
        style={{ backgroundColor: `#${s.lt1}` }}
      >
        <div className="h-2 w-2/3 rounded-sm" style={{ backgroundColor: `#${s.dk1}` }} />
        <div className="flex gap-1">
          {[s.accent1, s.accent2, s.accent3, s.accent4].map((hex, i) => (
            <div key={i} className="h-2 w-2 rounded-full" style={{ backgroundColor: `#${hex}` }} />
          ))}
        </div>
      </div>
      <div className="mt-1.5 text-xs font-medium">{palette.name}</div>
    </button>
  )
}

function PaletteRow({
  paletteId,
  onSelect,
}: {
  paletteId: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">Theme</span>
      {/* Nine palettes: a grid, not a row. */}
      <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto pr-1">
        {DECK_PALETTES.map((palette) => (
          <PaletteSwatch
            key={palette.id}
            palette={palette}
            selected={palette.id === paletteId}
            onSelect={() => onSelect(palette.id)}
          />
        ))}
      </div>
    </div>
  )
}

export function NewPresentationDialog({
  open,
  targetFolder,
  onOpenChange,
  onCreated,
}: NewPresentationDialogProps) {
  const [paletteId, setPaletteId] = useState(DECK_PALETTES[0].id)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('Untitled presentation')
  const [creating, setCreating] = useState(false)

  const palette = useMemo(
    () => DECK_PALETTES.find((p) => p.id === paletteId) ?? DECK_PALETTES[0],
    [paletteId],
  )

  const reset = useCallback(() => {
    setPaletteId(DECK_PALETTES[0].id)
    setError(null)
    setName('Untitled presentation')
    setCreating(false)
  }, [])

  const close = useCallback(() => {
    onOpenChange(false)
    reset()
  }, [onOpenChange, reset])

  const handleCreate = useCallback(async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Enter a name')
      return
    }
    if (trimmed.includes('/')) {
      setError('Name cannot contain "/"')
      return
    }
    setCreating(true)
    setError(null)
    try {
      const bytes = await newDeckPptx({ title: trimmed, palette })
      // Dedupe the target name, then write + open.
      let fullPath = `${targetFolder}/${trimmed}.pptx`
      let i = 1
      while ((await window.ipc.invoke('workspace:exists', { path: fullPath })).exists) {
        fullPath = `${targetFolder}/${trimmed} (${i}).pptx`
        i += 1
      }
      await window.ipc.invoke('workspace:writeFile', {
        path: fullPath,
        data: uint8ArrayToBase64(bytes),
        opts: { encoding: 'base64' },
      })
      onOpenChange(false)
      reset()
      onCreated(fullPath)
    } catch (err) {
      setCreating(false)
      setError(err instanceof Error ? err.message : 'Failed to create the presentation')
    }
  }, [name, palette, targetFolder, onOpenChange, reset, onCreated])

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New presentation</DialogTitle>
          <DialogDescription>
            Creates a blank 16:9 deck and opens it in the editor.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-4">
            <div className="grid gap-2">
              <label htmlFor="presentation-name" className="text-sm font-medium">Name</label>
              <Input
                id="presentation-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Quarterly review"
                autoFocus
                onFocus={(e) => e.target.select()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !creating) {
                    e.preventDefault()
                    void handleCreate()
                  }
                }}
              />
            </div>
            <PaletteRow paletteId={paletteId} onSelect={setPaletteId} />
          </div>
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={creating}>Cancel</Button>
          <Button onClick={() => void handleCreate()} disabled={creating || !name.trim()}>
            {creating ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
