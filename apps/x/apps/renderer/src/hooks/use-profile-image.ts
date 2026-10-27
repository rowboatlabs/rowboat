import { useEffect, useState } from 'react'

// Fetch through the org's authenticated client on both hosts; never send a token
// to an arbitrary avatar URL (2026-10-22, Spaces profiles).
const images = new Map<string, Promise<string>>()
export function useProfileImage(orgId?: string, avatarUrl?: string): string | undefined {
    const hash = avatarUrl?.match(/\/v1\/images\/([a-f0-9]{64})$/)?.[1]
    const key = orgId && hash ? `${orgId}/${hash}` : undefined
    const [loaded, setLoaded] = useState<{ key: string; src: string }>()
    useEffect(() => {
        if (!key || !orgId || !hash) return
        let cancelled = false
        let request = images.get(key)
        if (!request) {
            request = window.ipc.invoke('spaces:getProfileImage', { orgId, hash }).then(r => r.src)
            images.set(key, request)
            // Bound retained image data while keeping shared avatars deduplicated (2026-10-22).
            if (images.size > 128) images.delete(images.keys().next().value!)
        }
        void request.then(src => { if (!cancelled) setLoaded({ key, src }) }, () => { images.delete(key) })
        return () => { cancelled = true }
    }, [key, orgId, hash])
    return loaded?.key === key ? loaded?.src : undefined
}
