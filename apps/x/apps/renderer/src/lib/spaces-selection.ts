// What's selected inside a space: General (the chat), a topic, or a file.
// Part of the app's navigation history, so the top ‹ › retrace it.

export type RailSelection =
    | { kind: 'general' }
    | { kind: 'topic'; topicId: string }
    /** `fromTopicId` = opened from a topic (an artifact link) — the file view shows a crumb back to it. */
    | { kind: 'file'; path: string; fromTopicId?: string }

/** Stable key for history comparisons. */
export function railKey(sel: RailSelection | undefined): string {
    if (!sel || sel.kind === 'general') return 'general'
    if (sel.kind === 'topic') return `topic:${sel.topicId}`
    return `file:${sel.path}`
}
