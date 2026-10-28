import { useState } from 'react'
import { Hash, Star } from 'lucide-react'
import { useSpaceDirectory, loadSpaceDirectory } from '@/hooks/use-space-directory'
import { useOrgRoster } from '@/hooks/use-space-members'
import { setDefaultSpace } from '@/lib/spaces-invites'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const NO_SPACE_IDS: string[] = []

export function SpaceBrowser({ orgId, memberId, onOpenSpace, active }: { orgId: string; memberId?: string; onOpenSpace: (orgId: string, spaceId: string) => void; active: boolean }) {
    const directory = useSpaceDirectory(orgId, active)
    // Default spaces are an admin's to choose (harbor, 2026-10-19), and an
    // admin need not be in the space, so the browser is where they choose.
    // No member id, no roster fetch: nothing here to decide.
    const isAdmin = useOrgRoster(memberId ? orgId : '', NO_SPACE_IDS).find((m) => m.id === memberId)?.role === 'admin'
    const [toggling, setToggling] = useState<string | null>(null)
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
        : <ul className="divide-y divide-border">{rows.map(({ space, joined }) => <li key={space.id} className="flex items-center gap-1">
            <button type="button" aria-label={`${space.name} ${joined ? 'Joined' : 'Preview'}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-md p-3 text-left hover:bg-muted focus-visible:outline focus-visible:outline-2" onClick={() => onOpenSpace(orgId, space.id)}>
                <Hash className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{space.name}</span>
                {space.isDefault && <span className="rounded-sm border border-border px-1.5 py-px text-[10.5px] text-muted-foreground" title="Everyone who joins the server joins this space">Default</span>}
                <span className="text-xs text-muted-foreground">{joined ? 'Joined' : 'Preview'}</span>
            </button>
            {isAdmin && (space.isDefault || !space.archived) && (
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 text-muted-foreground"
                    disabled={toggling === space.id}
                    aria-label={space.isDefault ? `Remove ${space.name} from default spaces` : `Make ${space.name} a default space`}
                    title={space.isDefault ? 'Remove from default spaces' : 'Make a default space — everyone who joins the server joins it'}
                    onClick={() => {
                        setToggling(space.id)
                        void setDefaultSpace(orgId, space, !space.isDefault).finally(() => setToggling(null))
                    }}
                >
                    <Star className={cn('size-4', space.isDefault && 'fill-current text-foreground')} />
                </Button>
            )}
        </li>)}</ul>}
    </section>
}
