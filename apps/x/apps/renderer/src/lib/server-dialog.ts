// The server dialogs (components/spaces/server-dialogs.tsx) are mounted ONCE,
// in App. Everything that used to open its own copy — the sidebar's +, the
// dock flyout, the empty Spaces pane, the server switcher, an invite link
// arriving by deep link or clicked inside a message — asks for one here
// instead, naming the intent. Module state, like spaces-jump: a request can
// fire before the host has mounted (the app was just launched by an invite
// link), so it waits to be consumed.

export type ServerDialogRequest =
    | { kind: 'create' }
    /** With `inviteUrl` the dialog opens on the resolved invite, one click from Join. */
    | { kind: 'join'; inviteUrl?: string }
    /** A server by address — self-hosted, or one you are already a member of. */
    | { kind: 'address' }
    /** Dev sign-in against a stub Harbor. */
    | { kind: 'dev' }

let pending: ServerDialogRequest | null = null
const listeners = new Set<() => void>()

export function openServerDialog(request: ServerDialogRequest): void {
    pending = request
    for (const l of listeners) l()
}

export function consumeServerDialog(): ServerDialogRequest | null {
    const request = pending
    pending = null
    return request
}

export function subscribeServerDialog(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

/** https://<org>/join/<token> — the one auth-adjacent link with a wire shape (protocol invite.ts). */
export function isInviteUrl(url: string): boolean {
    try {
        const u = new URL(url)
        return (u.protocol === 'https:' || u.protocol === 'http:') && /^\/join\/[^/]+$/.test(u.pathname)
    } catch {
        return false
    }
}
