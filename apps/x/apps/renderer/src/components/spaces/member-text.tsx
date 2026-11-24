import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { spaces } from '@x/shared'
import { resolveMentions } from '@/lib/spaces-presentation'

// One place where wire ids become names. SpacePane provides the member map
// (the org's roster, this space's on top) and the org's space names; every
// surface below renders ids through these instead of hand-rolling
// `names.get(id) ?? id` or leaking wire text ("@<memberId>"). The resolution
// itself lives in lib/spaces-presentation.ts (mapMentions) — these are its
// React face.

const EMPTY_NAMES: ReadonlyMap<string, string> = new Map()
const SpaceMembersContext = createContext<ReadonlyMap<string, string>>(EMPTY_NAMES)
const SpaceNamesContext = createContext<ReadonlyMap<string, string>>(EMPTY_NAMES)

export function SpaceMembersProvider({ members, spaceNames = EMPTY_NAMES, children }: {
    members: ReadonlyMap<string, string>
    /** Space id → current name on the org (useSpaceNames) — the `#Name` face of a space token. */
    spaceNames?: ReadonlyMap<string, string>
    children: ReactNode
}) {
    return (
        <SpaceMembersContext.Provider value={members}>
            <SpaceNamesContext.Provider value={spaceNames}>{children}</SpaceNamesContext.Provider>
        </SpaceMembersContext.Provider>
    )
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

/** Wire text that may carry mention tokens, rendered as names — people and spaces. */
export function MemberText({ text }: { text: string }) {
    const names = useMemberNames()
    const spaceNames = useContext(SpaceNamesContext)
    return <>{resolveMentions(text, names, spaceNames)}</>
}

// Full member records + presence, for profile surfaces (the click-a-face
// popover). Separate from the names map above: most consumers only need
// names, and the roster's shape (roles, presence, self) shouldn't ride
// along with every markdown render.

export interface SpaceProfiles {
    byId: ReadonlyMap<string, spaces.Member>
    /** Members present right now (already filtered to known members). */
    here: ReadonlySet<string>
    selfId: string | null
}

const SpaceProfilesContext = createContext<SpaceProfiles>({ byId: new Map(), here: new Set(), selfId: null })

export function SpaceProfilesProvider({ members, here, selfId, children }: {
    members: readonly spaces.Member[]
    here: ReadonlySet<string>
    selfId: string | null
    children: ReactNode
}) {
    const value = useMemo<SpaceProfiles>(
        () => ({ byId: new Map(members.map((m) => [m.id, m])), here, selfId }),
        [members, here, selfId],
    )
    return <SpaceProfilesContext.Provider value={value}>{children}</SpaceProfilesContext.Provider>
}

export function useSpaceProfiles(): SpaceProfiles {
    return useContext(SpaceProfilesContext)
}
