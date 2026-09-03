// Trusted domains for external links in Spaces chat: first click on a domain
// asks (the full URL shown), "trust" remembers the hostname locally so later
// links there open straight away. Local only — this is a per-machine
// convenience list, never synced through the org.

const KEY = 'spaces:trustedDomains'

function load(): string[] {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
        return Array.isArray(parsed) ? parsed.filter((d): d is string => typeof d === 'string') : []
    } catch {
        return []
    }
}

/** Hostname a link would take the user to — null for anything but http(s). */
export function linkDomain(url: string): string | null {
    try {
        const u = new URL(url)
        return u.protocol === 'https:' || u.protocol === 'http:' ? u.hostname.toLowerCase() : null
    } catch {
        return null
    }
}

export function isTrustedDomain(domain: string): boolean {
    return load().includes(domain.toLowerCase())
}

export function trustDomain(domain: string): void {
    const d = domain.toLowerCase()
    const list = load()
    if (!list.includes(d)) localStorage.setItem(KEY, JSON.stringify([...list, d]))
}
