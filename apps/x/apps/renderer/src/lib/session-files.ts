import type { ConversationItem } from '@/lib/chat-conversation'
import { isChatMessage, isToolCall, normalizeToolInput } from '@/lib/chat-conversation'

// ---------------------------------------------------------------------------
// Files created in a chat
//
// Pure derivation over the session's conversation items (which span every
// turn of the session), from two sources:
//
//   1. Completed file-writing tool calls (file-writeText etc.). Renames
//      follow the file, removes drop it, so the list reflects where files
//      ended up — not every intermediate step.
//   2. ```filepath fences in assistant messages — the same fences that
//      render as inline FilePathCards. This is how files produced outside
//      the file-* tools (shell-generated PDFs, exports) surface.
//
// Powers the "Files" panel in the chat header.
// ---------------------------------------------------------------------------

export interface SessionFileEntry {
    /** Workspace-relative or absolute path, exactly as the tool received it. */
    path: string
    /** How the file entered the chat: written whole vs. edited in place. */
    action: 'created' | 'edited'
    /** Timestamp of the most recent completed tool call that touched it. */
    timestamp: number
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
    value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined

const asString = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined

// Scratch files (the presentations skill's tmp/convert.js etc.) are build
// intermediates, not deliverables — keep them out of the panel.
const isScratchPath = (p: string): boolean =>
    p.startsWith('tmp/') || p.startsWith('./tmp/')

// Matches the ```filepath fences that markdown-code-override renders as
// inline FilePathCards. A fence may carry several paths, one per line.
const FILEPATH_FENCE = /```filepath\s*\n([\s\S]*?)```/g

export function collectSessionFiles(items: ConversationItem[]): SessionFileEntry[] {
    const entries = new Map<string, SessionFileEntry>()

    const touch = (rawPath: unknown, action: SessionFileEntry['action'], timestamp: number) => {
        const path = asString(rawPath)
        if (!path || isScratchPath(path)) return
        const existing = entries.get(path)
        // First touch decides the action label; later touches only refresh
        // the timestamp (a created-then-edited file is still "created" here).
        if (existing) existing.timestamp = timestamp
        else entries.set(path, { path, action, timestamp })
    }

    for (const item of items) {
        if (isChatMessage(item)) {
            if (item.role !== 'assistant') continue
            for (const match of item.content.matchAll(FILEPATH_FENCE)) {
                for (const line of match[1].split('\n')) {
                    touch(line, 'created', item.timestamp)
                }
            }
            continue
        }
        if (!isToolCall(item) || item.status !== 'completed') continue
        const input = asRecord(normalizeToolInput(item.input))
        const result = asRecord(item.result)
        const ts = item.timestamp

        switch (item.name) {
            case 'file-writeText':
                touch(input?.path, 'created', ts)
                break
            case 'file-editText':
                touch(input?.path, 'edited', ts)
                break
            case 'file-copy':
                touch(input?.to, 'created', ts)
                break
            case 'file-rename': {
                // Only follow files this chat already produced — renaming a
                // pre-existing file doesn't make it a chat artifact.
                const from = asString(input?.from)
                const to = asString(input?.to)
                const tracked = from ? entries.get(from) : undefined
                if (tracked && from) {
                    entries.delete(from)
                    if (to && !isScratchPath(to)) {
                        entries.set(to, { ...tracked, path: to, timestamp: ts })
                    }
                }
                break
            }
            case 'file-remove': {
                const path = asString(input?.path)
                if (path) entries.delete(path)
                break
            }
            case 'code_agent_run': {
                // Coding runs report repo-relative paths; anchor them to the
                // run's cwd so the cards can open them. Without a cwd in the
                // args there's nothing reliable to anchor to — skip those.
                const changed = Array.isArray(result?.changedFiles) ? result.changedFiles : []
                const cwd = asString(input?.cwd)?.replace(/\/+$/, '')
                for (const file of changed) {
                    const rel = asString(file)
                    if (!rel) continue
                    if (rel.startsWith('/') || rel.startsWith('~')) touch(rel, 'edited', ts)
                    else if (cwd) touch(`${cwd}/${rel}`, 'edited', ts)
                }
                break
            }
        }
    }

    return [...entries.values()]
}
