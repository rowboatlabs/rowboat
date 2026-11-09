import { parseSpacesUrl } from '@x/shared/dist/spaces.js'
import { isDirectImageUrl } from '@/components/spaces/space-markdown'

// Which links in a message body get an unfurl card (link-preview-card.tsx
// renders them). Every https link qualifies by default — the fetch runs
// host-side with a cache and size cap; the click-through trust gate in
// space-markdown is a separate concern and untouched by this.

export const MAX_UNFURLS = 3

/**
 * The message's links worth a card, in order: skips code (fences and inline),
 * image embeds, direct image links (those already render as images), and
 * Spaces links (a space, file, message, or person renders as a chip — and the
 * server's hand-off page would only ever unfurl as "Open in Rowboat").
 */
export function previewUrls(body: string, serverAddresses: readonly string[] = []): string[] {
    const stripped = body
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`[^`\n]*`/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    const found: string[] = []
    for (const m of stripped.matchAll(/https:\/\/[^\s<>)"'\]]+/g)) {
        const url = m[0]!.replace(/[.,;:!?]+$/, '')
        if (isDirectImageUrl(url)) continue
        const link = parseSpacesUrl(url)
        // Every HTTPS homepage matches the server-root grammar. Only the known
        // server address identifies its hand-off page; other homepages unfurl.
        if (link && (link.kind !== 'server' || serverAddresses.includes(link.address))) continue
        if (!found.includes(url)) found.push(url)
        if (found.length >= MAX_UNFURLS) break
    }
    return found
}
