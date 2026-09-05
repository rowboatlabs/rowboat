import { isDirectImageUrl } from '@/components/spaces/space-markdown'

// Which links in a message body get an unfurl card (link-preview-card.tsx
// renders them). Every https link qualifies by default — the fetch runs
// host-side with a cache and size cap; the click-through trust gate in
// space-markdown is a separate concern and untouched by this.

export const MAX_UNFURLS = 3

/**
 * The message's links worth a card, in order: skips code (fences and inline),
 * image embeds, and direct image links (those already render as images).
 */
export function previewUrls(body: string): string[] {
    const stripped = body
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`[^`\n]*`/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    const found: string[] = []
    for (const m of stripped.matchAll(/https:\/\/[^\s<>)"'\]]+/g)) {
        const url = m[0]!.replace(/[.,;:!?]+$/, '')
        if (isDirectImageUrl(url)) continue
        if (!found.includes(url)) found.push(url)
        if (found.length >= MAX_UNFURLS) break
    }
    return found
}
