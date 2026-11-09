// Shared by the Spaces account menu's hosts, the web app and the desktop (2026-11-09).

/** One of the menu's rows; hosts use it for theirs. */
export const ACCOUNT_ROW = 'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent'

/** The email claim of a sign-in's access token, or null. */
export function tokenEmail(token: string | null | undefined): string | null {
    const payload = token?.split('.')[1]
    if (!payload) return null
    try {
        const bytes = Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
        const claims = JSON.parse(new TextDecoder().decode(bytes)) as { email?: unknown }
        return typeof claims.email === 'string' ? claims.email : null
    } catch {
        return null
    }
}
