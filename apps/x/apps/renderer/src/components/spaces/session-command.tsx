import { Plus } from 'lucide-react'
import type { spaces } from '@x/shared'
import type { SlashChoice, SlashCommand } from '@/components/spaces/composer'
import { ThreadStatusDot } from '@/components/spaces/session-status'
import { threadStatusLabel } from '@/lib/spaces-my-threads'

/** How many open sessions the picker lists under New. */
const LISTED = 8

/**
 * `/session` (2026-11-05, "coding session: threads" in Main): what follows
 * the command is a title. The first row starts a session with it (or, in a
 * thread, makes that thread one), and is the default; below it are your open
 * sessions, this space's first, filtered by the same words, to jump back to.
 */
export function sessionCommand({ spaceId, sessions, newLabel, fallbackTitle, onNew, onOpen }: {
    spaceId: string
    sessions: readonly spaces.ThreadListing[]
    /** The first row's words for a title: "New session: …", "Make this thread a session: …". */
    newLabel: (title: string) => string
    /** A title to use when none is typed; absent = one must be typed. */
    fallbackTitle?: string
    onNew: (title: string) => void | Promise<void>
    onOpen: (session: spaces.ThreadListing) => void
}): SlashCommand {
    return {
        name: 'session',
        args: '<title>',
        hint: 'Start a session, or jump back to one of yours',
        run: (args) => void onNew(args.trim() || fallbackTitle || ''),
        choices: (args) => {
            const typed = args.trim()
            const title = typed || fallbackTitle || ''
            const query = typed.toLowerCase()
            const here = (s: spaces.ThreadListing) => (s.spaceId === spaceId ? 0 : 1)
            const listed = sessions
                .filter((s) => !query || (s.root.session?.title ?? '').toLowerCase().includes(query))
                .sort((a, b) => here(a) - here(b))
                .slice(0, LISTED)
            const first: SlashChoice = {
                key: 'new',
                label: title ? newLabel(title) : 'New session — type a title',
                icon: <Plus className="size-3.5" />,
                disabled: !title,
                run: () => onNew(title),
            }
            return [first, ...listed.map((s): SlashChoice => ({
                key: s.root.id,
                section: 'Your open sessions',
                label: s.root.session?.title ?? 'Session',
                detail: [s.spaceId === spaceId ? null : s.spaceName, threadStatusLabel(s.status), s.unreadReplies > 0 ? `${s.unreadReplies} new` : null]
                    .filter(Boolean)
                    .join(' · '),
                icon: <ThreadStatusDot status={s.status} />,
                run: () => onOpen(s),
            }))]
        },
    }
}
