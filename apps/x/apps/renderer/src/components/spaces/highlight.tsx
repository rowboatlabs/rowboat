import type { ReactNode } from 'react'

/** Bold every query-word occurrence (case-insensitive) in already-resolved text. Shared by the space's search bar and the ⌘K palette. */
export function highlight(text: string, words: readonly string[]): ReactNode {
    if (words.length === 0) return text
    const lower = text.toLowerCase()
    const parts: ReactNode[] = []
    let at = 0
    while (at < text.length) {
        let hit = -1
        let hitLen = 0
        for (const w of words) {
            if (!w) continue
            const idx = lower.indexOf(w, at)
            if (idx !== -1 && (hit === -1 || idx < hit)) {
                hit = idx
                hitLen = w.length
            }
        }
        if (hit === -1) {
            parts.push(text.slice(at))
            break
        }
        if (hit > at) parts.push(text.slice(at, hit))
        parts.push(
            <span key={`${hit}`} className="font-semibold text-foreground">
                {text.slice(hit, hit + hitLen)}
            </span>,
        )
        at = hit + hitLen
    }
    return <>{parts}</>
}
