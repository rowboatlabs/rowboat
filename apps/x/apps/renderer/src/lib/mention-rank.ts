// How the Spaces @ menu orders what a query matches (mention-autocomplete).

/**
 * How well `text` matches the query: 0 starts with it, 1 has a word that
 * starts with it, 2 merely contains it, -1 no match. Typing "ar" should put
 * Arjun (and Mark Arden) above Mark, the way Slack and Discord do (2026-10-07,
 * Arjun's request in Spaces); before this, a group kept its source order
 * whatever was typed.
 */
export function matchRank(text: string, q: string): number {
    const t = text.toLowerCase()
    if (t.startsWith(q)) return 0
    if (!t.includes(q)) return -1
    return t.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(q)) ? 1 : 2
}

/** Better matches first; a stable sort, so ties keep the group's own order (joined, then sidebar). */
export function byRank<T>(rows: { row: T; rank: number }[]): T[] {
    return rows.filter((r) => r.rank >= 0).sort((a, b) => a.rank - b.rank).map((r) => r.row)
}
