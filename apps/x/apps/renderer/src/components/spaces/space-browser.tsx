import { useState } from 'react'
import { Hash } from 'lucide-react'
import { useSpaceDirectory, loadSpaceDirectory } from '@/hooks/use-space-directory'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function SpaceBrowser({ orgId, onOpenSpace, active }: { orgId: string; onOpenSpace: (orgId: string, spaceId: string) => void; active: boolean }) {
    const directory = useSpaceDirectory(orgId, active)
    const [query, setQuery] = useState('')
    const rows = directory.entries.filter(e => e.space.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
        .sort((a, b) => a.space.name.localeCompare(b.space.name) || a.space.id.localeCompare(b.space.id))
    return <section className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto p-6" aria-label="Browse spaces">
        <div><h1 className="text-xl font-semibold">Browse spaces</h1><p className="mt-1 text-sm text-muted-foreground">Explore open spaces in your team. Join when you’re ready to participate.</p></div>
        <Input aria-label="Search spaces" placeholder="Search spaces" value={query} onChange={e => setQuery(e.target.value)} />
        {directory.error ? <div role="alert">{directory.error} <Button variant="outline" onClick={() => void loadSpaceDirectory(orgId)}>Retry</Button></div>
        : !directory.supported ? <p>This server needs an update to support open spaces.</p>
        : !directory.loaded ? <p role="status">Loading spaces…</p>
        : rows.length === 0 ? <p className="text-sm text-muted-foreground">{query ? 'No spaces match your search.' : 'No open spaces yet.'}</p>
        : <ul className="divide-y divide-border">{rows.map(({ space, joined }) => <li key={space.id}>
            <button type="button" aria-label={`${space.name} ${joined ? 'Joined' : 'Preview'}`} className="flex w-full items-center gap-3 rounded-md p-3 text-left hover:bg-muted focus-visible:outline focus-visible:outline-2" onClick={() => onOpenSpace(orgId, space.id)}>
                <Hash className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{space.name}</span><span className="text-xs text-muted-foreground">{joined ? 'Joined' : 'Preview'}</span>
            </button>
        </li>)}</ul>}
    </section>
}
