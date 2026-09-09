// Insert-into-the-visible-composer bus: profile popovers (the "Mention"
// action) fire here; the active conversation appends the text through its
// seed mechanism. When a thread is beside Messages, only the thread subscribes.

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
