import type { spaces } from '@x/shared'

// The one-file link on a discussion (Topic.documentAssetId, 2026-09-11): the
// picker's candidate list. Live entries only — the org projects the link as
// an id even while the file is trashed, and offering the trash would be a
// lie — boards included, since the doc column renders them too. Picking is
// by id; the path is what the row shows.

/** Live entries matching every whitespace-separated term of `query` (path, case-insensitive), A–Z, the current link (by id) first. */
export function filterAttachable(entries: spaces.SpacesAssetEntry[], query: string, currentAssetId?: string): spaces.SpacesAssetEntry[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    return entries
        .filter((e) => e.state !== 'deleted')
        .filter((e) => terms.every((t) => e.path.toLowerCase().includes(t)))
        .sort((a, b) => Number(b.id === currentAssetId) - Number(a.id === currentAssetId) || a.path.localeCompare(b.path))
}
