// Insert-into-the-visible-composer bus: profile popovers (the "Mention"
// action) fire here; whichever chat surface is visible appends the text to
// its composer via the seed mechanism. Exactly one chat surface is visible
// at a time (keep-alive hides the others), so a simple broadcast suffices.

export interface ComposeInsert {
    text: string
}

const listeners = new Set<(insert: ComposeInsert) => void>()

export function requestComposeInsert(text: string): void {
    for (const l of listeners) l({ text })
}

export function subscribeComposeInsert(listener: (insert: ComposeInsert) => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}
