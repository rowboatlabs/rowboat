// A pending invite to join: the /join landing hands one in as a deep link,
// and an invite link clicked inside a message produces one directly. The
// join dialog (components/spaces/invite-join-dialog.tsx, mounted once in
// App) consumes it — module state, like spaces-jump, because the request
// can fire before the consumer has mounted (the app was just launched by
// the link).

let pending: string | null = null
const listeners = new Set<() => void>()

/** https://<org>/join/<token> — the one auth-adjacent link with a wire shape (protocol invite.ts). */
export function isInviteUrl(url: string): boolean {
    try {
        const u = new URL(url)
        return (u.protocol === 'https:' || u.protocol === 'http:') && /^\/join\/[^/]+$/.test(u.pathname)
    } catch {
        return false
    }
}

export function requestJoinInvite(url: string): void {
    pending = url
    for (const l of listeners) l()
}

export function consumeJoinInvite(): string | null {
    const url = pending
    pending = null
    return url
}

export function subscribeJoinInvite(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}
