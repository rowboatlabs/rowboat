import type { spaces } from '@x/shared'

// The one-file link on a discussion (Topic.documentPath, 2026-09-11): the
// picker's candidate list. Live entries only — the org projects a trashed
// link as absent, so offering the trash would be a lie — boards included,
// since the doc column renders them too.

/** Live entries matching every whitespace-separated term of `query` (path, case-insensitive), A–Z, the current link first. */
export function filterAttachable(entries: spaces.SpacesAssetEntry[], query: string, current?: string): spaces.SpacesAssetEntry[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    return entries
        .filter((e) => e.state !== 'deleted')
        .filter((e) => terms.every((t) => e.path.toLowerCase().includes(t)))
        .sort((a, b) => Number(b.path === current) - Number(a.path === current) || a.path.localeCompare(b.path))
}
