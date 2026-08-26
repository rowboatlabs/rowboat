// What's selected inside a space: General (the chat), a thread (wire
// "topic"), a label (UI "Topic"), or a file. Part of the app's navigation
// history, so the top ‹ › retrace it.

export type RailSelection =
    | { kind: 'general' }
    | { kind: 'topic'; topicId: string }
    /** A reply pane with no topic behind it yet — the topic is created on first send. */
    | { kind: 'draft'; parentMessageId: string }
    /** An explicit label ("Topic" in the UI) — its tagged messages across the stream. */
    | { kind: 'label'; labelId: string }
    /** `fromTopicId` = opened from a topic (an artifact link) — the file view shows a crumb back to it. */
    | { kind: 'file'; path: string; fromTopicId?: string }

/** Stable key for history comparisons. */
export function railKey(sel: RailSelection | undefined): string {
    if (!sel || sel.kind === 'general') return 'general'
    if (sel.kind === 'topic') return `topic:${sel.topicId}`
    if (sel.kind === 'draft') return `draft:${sel.parentMessageId}`
    if (sel.kind === 'label') return `label:${sel.labelId}`
    return `file:${sel.path}`
}
