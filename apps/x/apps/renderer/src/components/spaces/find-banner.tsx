import { toast as notify } from 'sonner'
import { AutoBanner } from '@/components/spaces/auto-banner'
import { AUTO_TOAST } from '@/lib/spaces-auto-route'
import { clearFindSession, findNext, landingOf, searchInstead, useFindSession, type FindLanding, type FindNav } from '@/lib/spaces-find'
import * as analytics from '@/lib/analytics'

// The /find banner (2026-09-24): 'Match 1 of 4 for "…"' with "Next match",
// "Open search", and a close. Rendered by both panes; it shows only in the
// pane the current pick landed in, and moves with the next pick. Plain words
// on purpose (2026-09-24 review): the first cut read "Found for … 1 of 4 ·
// Not this, next" and was hard to parse at a glance.
export function FindBanner({ orgId, spaceId, pane, nav }: {
    orgId: string
    spaceId: string
    pane: FindLanding
    nav: FindNav
}) {
    const session = useFindSession()
    if (!session || session.orgId !== orgId || session.spaceId !== spaceId) return null
    const current = session.ranked[session.index]
    if (!current) return null
    const landing = landingOf(current)
    const here = pane.pane === 'stream' ? landing.pane === 'stream' : landing.pane === 'thread' && landing.rootMessageId === pane.rootMessageId
    if (!here) return null

    const hasNext = session.index + 1 < session.ranked.length
    const query = session.query
    const next = () => {
        analytics.spacesFind({ outcome: 'next' })
        if (!findNext(nav)) {
            notify.info('No more matches', { ...AUTO_TOAST, action: { label: 'Open search', onClick: () => searchInstead(query) } })
        }
    }
    const search = () => {
        analytics.spacesFind({ outcome: 'search-instead' })
        clearFindSession()
        searchInstead(query)
    }
    return (
        <AutoBanner
            message={`Match ${session.index + 1} of ${session.ranked.length} for "${query}"`}
            actions={[...(hasNext ? [{ label: 'Next match', onClick: next }] : []), { label: 'Open search', onClick: search }]}
            onDismiss={clearFindSession}
            dismissTitle="Close"
        />
    )
}
