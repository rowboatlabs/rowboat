import { createContext, useContext, type ReactNode } from 'react'
import { resolveMentions } from '@/lib/spaces-presentation'

// One place where member ids become people. SpacePane provides the space's
// member map; every surface below renders ids through these instead of
// hand-rolling `names.get(id) ?? id` or leaking wire text ("@<memberId>").
// The resolution itself lives in lib/spaces-presentation.ts (mapMentions) —
// these are its React face.

const SpaceMembersContext = createContext<ReadonlyMap<string, string>>(new Map())

export function SpaceMembersProvider({ members, children }: {
    members: ReadonlyMap<string, string>
    children: ReactNode
}) {
    return <SpaceMembersContext.Provider value={members}>{children}</SpaceMembersContext.Provider>
}

/** The member-id → display-name map, for string contexts (search haystacks, tooltips, markdown pipelines). */
export function useMemberNames(): ReadonlyMap<string, string> {
    return useContext(SpaceMembersContext)
}

/** One member, by id. Unknown ids render as the id — the honest fallback. */
export function MemberName({ id }: { id: string }) {
    const names = useMemberNames()
    return <>{names.get(id) ?? id}</>
}

/** Wire text that may carry "@<memberId>" addresses, rendered as people. */
export function MemberText({ text }: { text: string }) {
    const names = useMemberNames()
    return <>{resolveMentions(text, names)}</>
}
