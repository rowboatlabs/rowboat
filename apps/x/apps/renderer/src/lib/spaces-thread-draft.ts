import { useSyncExternalStore } from 'react'

// Staging a draft into a thread's composer (2026-09-23): the stream composer's
// Auto toggle in Preview mode hands the reply Jev routed to the thread it
// picked, for a look before sending; Post mode's Undo lands here too. Two
// paths cover the two mount states of the thread pane (spaces-view keys it by
// root, so a different thread is a fresh mount): the composer's own stored
// draft slot, which a fresh Composer reads on mount, and a bus for a pane
// already showing that thread, which seeds its editor. The staged text joins
// whatever was already drafted there, the composer's rule for seeds.
//
// A staged reply also leaves a RECORD, persisted beside the draft, so the
// thread pane can show the "Auto put this here" banner until the person acts:
// sends it, posts it to the stream instead, tries another thread, or keeps it
// as a plain draft. The record remembers the draft that was there before, so
// taking the reply back leaves that draft in place, and the threads already
// rejected, so "try another" never circles back.

export function threadDraftKey(orgId: string, spaceId: string, rootMessageId: string): string {
    return `${orgId}/${spaceId}/${rootMessageId}`
}

/** The composer's own storage slot for a draft key. */
export function draftStorageKey(draftKey: string): string {
    return `spaces:draft:${draftKey}`
}

const STAGED_PREFIX = 'spaces:auto-staged:'

export interface StagedThreadDraft {
    draftKey: string
    /** The routed reply as staged (the composer may have been edited since). */
    text: string
    /** The thread's unsent draft before staging; restored when the reply is taken back. */
    before: string
    /** Threads the person already said "not this" to, in order. */
    rejected: string[]
    stagedAt: string
}

/** The composer's stored draft for a key ('' when none). */
export function readThreadDraft(draftKey: string): string {
    try {
        return window.localStorage.getItem(draftStorageKey(draftKey)) ?? ''
    } catch {
        return ''
    }
}

function writeThreadDraft(draftKey: string, text: string): void {
    try {
        if (text) window.localStorage.setItem(draftStorageKey(draftKey), text)
        else window.localStorage.removeItem(draftStorageKey(draftKey))
    } catch {
        // Quota/private mode: a mounted pane still gets it through the bus.
    }
}

function join(current: string, text: string): string {
    return current ? `${current}${/\s$/.test(current) ? '' : ' '}${text}` : text
}

// Records: hydrated from storage per key on first read (a fresh pane after a
// restart still shows its banner), held in memory after that.
const records = new Map<string, StagedThreadDraft>()
const hydrated = new Set<string>()
const listeners = new Set<() => void>()
const stageListeners = new Set<(staged: StagedThreadDraft) => void>()

function record(draftKey: string): StagedThreadDraft | null {
    if (!hydrated.has(draftKey)) {
        hydrated.add(draftKey)
        try {
            const raw = window.localStorage.getItem(STAGED_PREFIX + draftKey)
            if (raw) {
                const parsed = JSON.parse(raw) as Partial<StagedThreadDraft>
                if (typeof parsed.text === 'string') {
                    records.set(draftKey, {
                        draftKey,
                        text: parsed.text,
                        before: typeof parsed.before === 'string' ? parsed.before : '',
                        rejected: Array.isArray(parsed.rejected) ? parsed.rejected.filter((r): r is string => typeof r === 'string') : [],
                        stagedAt: typeof parsed.stagedAt === 'string' ? parsed.stagedAt : new Date(0).toISOString(),
                    })
                }
            }
        } catch {
            // Unreadable storage: no banner, the draft itself still shows.
        }
    }
    return records.get(draftKey) ?? null
}

function setRecord(draftKey: string, next: StagedThreadDraft | null): void {
    hydrated.add(draftKey)
    if (next) records.set(draftKey, next)
    else records.delete(draftKey)
    try {
        if (next) window.localStorage.setItem(STAGED_PREFIX + draftKey, JSON.stringify(next))
        else window.localStorage.removeItem(STAGED_PREFIX + draftKey)
    } catch {
        // The in-memory record still drives this session's banner.
    }
    for (const listener of listeners) listener()
}

/** Put a routed reply into a thread's composer and note it there. */
export function stageThreadDraft(
    orgId: string,
    spaceId: string,
    rootMessageId: string,
    text: string,
    opts: { rejected?: string[] } = {},
): StagedThreadDraft {
    const draftKey = threadDraftKey(orgId, spaceId, rootMessageId)
    // A reply staged over a reply still staged: the earlier one is what the
    // person had, not "before" in any useful sense; keep the original before.
    const previous = record(draftKey)
    const before = previous ? previous.before : readThreadDraft(draftKey)
    writeThreadDraft(draftKey, join(readThreadDraft(draftKey), text))
    const staged: StagedThreadDraft = {
        draftKey,
        text: previous ? join(previous.text, text) : text,
        before,
        rejected: opts.rejected ?? previous?.rejected ?? [],
        stagedAt: new Date().toISOString(),
    }
    setRecord(draftKey, staged)
    for (const listener of stageListeners) listener({ ...staged, text })
    return staged
}

export function getStagedThreadDraft(draftKey: string): StagedThreadDraft | null {
    return record(draftKey)
}

export function useStagedThreadDraft(draftKey: string): StagedThreadDraft | null {
    return useSyncExternalStore(
        (listener) => {
            listeners.add(listener)
            return () => {
                listeners.delete(listener)
            }
        },
        () => record(draftKey),
    )
}

/** The reply as it stands now: the composer's draft with the earlier draft stripped off the front. */
export function peekStagedReply(draftKey: string): string {
    const staged = record(draftKey)
    if (!staged) return ''
    const current = readThreadDraft(draftKey)
    const text = staged.before && current.startsWith(staged.before) ? current.slice(staged.before.length) : current
    return text.trim()
}

/** The person keeps the text as their own draft (or sent it): the banner goes, the draft stays. */
export function clearStagedThreadDraft(draftKey: string): void {
    if (record(draftKey)) setRecord(draftKey, null)
}

/**
 * Take the staged reply back out of the thread: returns the reply as it
 * stands now (edits included, the earlier draft stripped) and puts the earlier
 * draft back in the slot. A mounted pane seeds its editor to match.
 */
export function releaseStagedThreadDraft(draftKey: string): { text: string; before: string; rejected: string[] } | null {
    const staged = record(draftKey)
    if (!staged) return null
    const text = peekStagedReply(draftKey)
    writeThreadDraft(draftKey, staged.before)
    setRecord(draftKey, null)
    return { text, before: staged.before, rejected: staged.rejected }
}

/** Fires when a reply is staged; the payload's text is the newly staged piece. */
export function subscribeStagedThreadDraft(listener: (staged: StagedThreadDraft) => void): () => void {
    stageListeners.add(listener)
    return () => {
        stageListeners.delete(listener)
    }
}
