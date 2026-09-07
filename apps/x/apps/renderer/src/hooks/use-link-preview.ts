import { useEffect, useState } from 'react'

export interface LinkPreviewData {
    url: string
    title?: string
    description?: string
    imageUrl?: string
    siteName?: string
    favicon?: string
}

// Session-lived cache: one fetch per URL no matter how many rows show it
// (the stream re-renders constantly; the IPC + page fetch must not).
const cache = new Map<string, Promise<LinkPreviewData | null>>()

function fetchPreview(url: string): Promise<LinkPreviewData | null> {
    let hit = cache.get(url)
    if (!hit) {
        hit = window.ipc
            .invoke('spaces:linkPreview', { url })
            .then((res) => res.preview)
            .catch(() => null)
        cache.set(url, hit)
    }
    return hit
}

/** OpenGraph card data for a URL — null while loading or when there is none. */
export function useLinkPreview(url: string | null): LinkPreviewData | null {
    // The url rides along with its result; a mismatch (url changed, fetch
    // still in flight) reads as "no preview yet" without an in-effect reset.
    const [state, setState] = useState<{ url: string; preview: LinkPreviewData | null } | null>(null)
    useEffect(() => {
        if (!url) return
        let cancelled = false
        void fetchPreview(url).then((preview) => {
            if (!cancelled) setState({ url, preview })
        })
        return () => {
            cancelled = true
        }
    }, [url])
    return url && state?.url === url ? state.preview : null
}
