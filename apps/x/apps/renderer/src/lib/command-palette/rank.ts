// Ranking for the ⌘K palette's navigation rows (sections, spaces, people,
// discussions, chats, code sessions). One scorer over a row's title and its
// keywords, tiered so the obvious thing wins: exact > prefix > word-start >
// every-word > substring > subsequence. Within a tier a shorter title edges
// out a longer one, and the caller's kind priority and recency settle what
// is left, so a space and a chat with the same name land in a stable order.

const WORD_BREAK = /[\s\-_/#.@:,()[\]]+/

export function normalize(text: string): string {
    return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** 0 = no match; higher is better (max 100). */
export function scoreMatch(query: string, text: string): number {
    const q = normalize(query)
    const t = normalize(text)
    if (!q || !t) return 0
    // A shorter title wins a tie within a tier.
    const penalty = Math.min(t.length, 60) / 100
    if (t === q) return 100
    if (t.startsWith(q)) return 90 - penalty
    const words = t.split(WORD_BREAK).filter(Boolean)
    if (words.some((w) => w.startsWith(q))) return 80 - penalty
    const tokens = q.split(' ')
    if (tokens.length > 1) {
        if (tokens.every((tok) => words.some((w) => w.startsWith(tok)))) return 75 - penalty
        if (tokens.every((tok) => t.includes(tok))) return 65 - penalty
    }
    if (t.includes(q)) return 60 - penalty
    // Subsequence ("dsg" → "design"): only once the query is long enough to
    // mean something, and tighter spans score higher (20..30).
    if (q.length >= 3) {
        const span = subsequenceSpan(q, t)
        if (span > 0) return 20 + 10 * (q.length / span) - penalty
    }
    return 0
}

/**
 * Length of the window of `t` holding `q` as a subsequence, anchored at a
 * word start and no looser than about two characters per query letter; 0
 * when there is none. Without the anchor and the bound, "des" reaches
 * "backgrounD agEntS" and "pat" reaches "uPdATe" — noise, not matches.
 */
function subsequenceSpan(q: string, t: string): number {
    const maxSpan = 2 * q.length + 1
    for (let start = 0; start < t.length; start++) {
        if (t[start] !== q[0]) continue
        if (start > 0 && !WORD_BREAK.test(t[start - 1]!)) continue
        let at = 1
        let i = start + 1
        for (; i < t.length && at < q.length && i - start < maxSpan; i++) {
            if (t[i] === q[at]) at++
        }
        if (at === q.length) return i - start
    }
    return 0
}

/** The first text is the title (full weight); the rest are keywords, matched at a discount so a title hit always outranks an alias hit. */
export function scoreTexts(query: string, texts: readonly string[]): number {
    let best = 0
    texts.forEach((text, i) => {
        const s = scoreMatch(query, text) * (i === 0 ? 1 : 0.9)
        if (s > best) best = s
    })
    return best
}

export interface Ranked<T> {
    item: T
    score: number
}

export function rankItems<T>(
    query: string,
    items: readonly T[],
    opts: {
        texts: (item: T) => readonly string[]
        /** Lower wins a tie (a section before a chat with the same name). */
        priority?: (item: T) => number
        /** ISO time; newer wins a tie. */
        recency?: (item: T) => string | undefined
        limit?: number
    },
): Ranked<T>[] {
    const ranked: Ranked<T>[] = []
    for (const item of items) {
        const score = scoreTexts(query, opts.texts(item))
        if (score > 0) ranked.push({ item, score })
    }
    ranked.sort(
        (a, b) =>
            b.score - a.score
            || (opts.priority?.(a.item) ?? 0) - (opts.priority?.(b.item) ?? 0)
            || (opts.recency?.(b.item) ?? '').localeCompare(opts.recency?.(a.item) ?? ''),
    )
    return opts.limit !== undefined ? ranked.slice(0, opts.limit) : ranked
}
