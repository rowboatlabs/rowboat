import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

type Choice = 'keep' | 'replace' | 'cancel'
/** A live file already at the wanted path: its id + version are what "Replace" proposes against. */
type Conflict = { path: string; assetId: string; version: number; changed: boolean }

/** The saved file: the id every later operation takes, the path it landed at (display). */
export interface SavedSpaceFile {
    assetId: string
    path: string
}

export function availableCopyPath(path: string, occupied: ReadonlySet<string>): string {
    const slash = path.lastIndexOf('/')
    const dot = path.lastIndexOf('.')
    const split = dot > slash + 1 ? dot : path.length
    const stem = path.slice(0, split)
    const extension = path.slice(split)
    for (let n = 1; ; n++) {
        const candidate = `${stem} (${n})${extension}`
        if (!occupied.has(candidate)) return candidate
    }
}

/**
 * Both upload entry points use the same explicit, version-checked decisions.
 * A new file is born through createAsset (paths are unique among the living,
 * so a collision is path-shaped); replacing an existing one is a propose
 * against that file's id at the version the user approved.
 */
export function useSpaceFileSave(orgId: string, spaceId: string) {
    const [conflict, setConflict] = useState<Conflict | null>(null)
    const pending = useRef<((choice: Choice) => void) | null>(null)
    useEffect(() => () => { pending.current?.('cancel') }, [])
    const choose = (choice: Choice) => {
        const resolve = pending.current
        pending.current = null
        setConflict(null)
        resolve?.(choice)
    }
    const ask = (value: Conflict) => new Promise<Choice>((resolve) => {
        pending.current = resolve
        setConflict(value)
    })
    const list = async () => (await window.ipc.invoke('spaces:listAssets', { orgId, spaceId })).entries.filter((entry) => entry.state !== 'deleted')
    const save = async ({ path, getBlob, reason }: { path: string; getBlob: () => Promise<string>; reason: string }): Promise<SavedSpaceFile | null> => {
        const entries = await list()
        const occupied = new Set(entries.map((entry) => entry.path))
        const existing = entries.find((entry) => entry.path === path)
        let collision: Conflict | null = existing ? { path, assetId: existing.id, version: existing.version, changed: false } : null
        let destination = path
        /** Set = replace this file at this version; unset = create a new one at `destination`. */
        let replace: { assetId: string; baseVersion: number } | null = null
        let hash: string | undefined
        for (;;) {
            if (collision) {
                const choice = await ask(collision)
                if (choice === 'cancel') return null
                if (choice === 'replace') {
                    // Pin to the version the user approved, never a refreshed head.
                    replace = { assetId: collision.assetId, baseVersion: collision.version }
                } else {
                    occupied.add(collision.path)
                    for (const entry of await list()) occupied.add(entry.path)
                    destination = availableCopyPath(path, occupied)
                    replace = null
                }
            }
            hash ??= await getBlob()
            if (replace) {
                const result = await window.ipc.invoke('spaces:proposeChange', {
                    orgId, spaceId,
                    input: { assetId: replace.assetId, baseVersion: replace.baseVersion, blob: hash, reason },
                })
                if (result.outcome !== 'conflict') return { assetId: replace.assetId, path: destination }
                collision = { path: destination, assetId: replace.assetId, version: result.currentVersion, changed: true }
                // A concurrent write requires a new decision, including for numbered copies.
                continue
            }
            try {
                const created = await window.ipc.invoke('spaces:createAsset', {
                    orgId, spaceId,
                    input: { path: destination, blob: hash, reason },
                })
                return { assetId: created.asset.id, path: created.asset.path }
            } catch (err) {
                // The org refuses an occupied path. The listing says whether that
                // is what happened (someone landed a file here since the check)
                // — then it is a collision to decide on, not a failure.
                const occupant = (await list().catch(() => [] as Awaited<ReturnType<typeof list>>)).find((entry) => entry.path === destination)
                if (!occupant) throw err
                collision = { path: destination, assetId: occupant.id, version: occupant.version, changed: true }
            }
        }
    }
    return { save, conflict, choose }
}

export function FileConflictNotice({ conflict, onChoose }: { conflict: Conflict; onChoose: (choice: Choice) => void }) {
    return (
        <div role="alert" className="space-y-3 rounded-md border border-border bg-muted/40 p-3 text-xs">
            <p className="break-words font-medium">“{conflict.path}” {conflict.changed ? 'changed while saving. Choose how to continue.' : 'already exists in this folder.'}</p>
            <p className="text-muted-foreground">Keep both saves a numbered copy. Replace saves a new version and preserves the existing file’s history.</p>
            <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => onChoose('keep')}>Keep both</Button>
                <Button size="sm" variant="outline" onClick={() => onChoose('replace')}>Replace</Button>
                <Button size="sm" variant="ghost" onClick={() => onChoose('cancel')}>Cancel</Button>
            </div>
        </div>
    )
}
