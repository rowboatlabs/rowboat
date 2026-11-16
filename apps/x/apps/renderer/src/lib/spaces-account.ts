// Shared by the Spaces account menu's hosts, the web app and the desktop (2026-11-09).

/** One of the menu's rows; hosts use it for theirs. */
export const ACCOUNT_ROW = 'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent'

function tokenClaims(token: string | null | undefined): Record<string, unknown> | null {
    const payload = token?.split('.')[1]
    if (!payload) return null
    try {
        const bytes = Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
        const claims = JSON.parse(new TextDecoder().decode(bytes)) as unknown
        return claims && typeof claims === 'object' ? (claims as Record<string, unknown>) : null
    } catch {
        return null
    }
}

/** The email claim of a sign-in's access token, or null. */
export function tokenEmail(token: string | null | undefined): string | null {
    const email = tokenClaims(token)?.email
    return typeof email === 'string' ? email : null
}

/** The subject (the account's id) of a sign-in's access token, or null. */
export function tokenSubject(token: string | null | undefined): string | null {
    const sub = tokenClaims(token)?.sub
    return typeof sub === 'string' && sub ? sub : null
}
