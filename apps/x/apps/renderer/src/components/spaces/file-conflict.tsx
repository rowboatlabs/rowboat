import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

type Choice = 'keep' | 'replace' | 'cancel'
type Conflict = { path: string; version: number; changed: boolean }

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

/** Both upload entry points use the same explicit, version-checked decisions. */
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
    const save = async ({ path, getBlob, reason }: { path: string; getBlob: () => Promise<string>; reason: string }): Promise<string | null> => {
        const entries = await list()
        const occupied = new Set(entries.map((entry) => entry.path))
        const existing = entries.find((entry) => entry.path === path)
        let collision: Conflict | null = existing ? { path, version: existing.version, changed: false } : null
        let destination = path
        let baseVersion = 0
        let hash: string | undefined
        for (;;) {
            if (collision) {
                const choice = await ask(collision)
                if (choice === 'cancel') return null
                if (choice === 'replace') {
                    // Pin to the version the user approved, never a refreshed head.
                    baseVersion = collision.version
                } else {
                    occupied.add(collision.path)
                    for (const entry of await list()) occupied.add(entry.path)
                    destination = availableCopyPath(path, occupied)
                    baseVersion = 0
                }
            }
            hash ??= await getBlob()
            const result = await window.ipc.invoke('spaces:proposeChange', {
                orgId, spaceId,
                input: { assetPath: destination, baseVersion, blob: hash, reason },
            })
            if (result.outcome !== 'conflict') return destination
            collision = { path: destination, version: result.currentVersion, changed: true }
            // A concurrent write requires a new decision, including for numbered copies.
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
