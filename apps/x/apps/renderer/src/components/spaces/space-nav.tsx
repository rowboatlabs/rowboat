import { createContext, useContext, type ReactNode } from 'react'
import type { SpaceRefs } from '@/lib/spaces-presentation'

// The pane's identity and navigation, as React context — carved out of
// space-markdown so the profile popover (which the markdown chips render)
// can reach them without an import cycle. Every org link in rendered
// markdown opens what it names through SpaceNav: a file, a space, a
// message, a person's DM.

export const SpaceRefsContext = createContext<SpaceRefs | null>(null)

/** Mounted once per space pane, beside SpaceMembersProvider. */
export function SpaceRefsProvider({ refs, children }: { refs: SpaceRefs; children: ReactNode }) {
    return <SpaceRefsContext.Provider value={refs}>{children}</SpaceRefsContext.Provider>
}

export function useSpaceRefs(): SpaceRefs | null {
    return useContext(SpaceRefsContext)
}

export interface SpaceNav {
    /** Open a file of THIS space by id. */
    onOpenFile: (assetId: string) => void
    /** Open a file of another space the reader is in (App's openSpace with a file rail). */
    onOpenSpaceFile?: (orgId: string, spaceId: string, assetId: string) => void
    /** Open a space the reader is in (a space chip) — App's openSpace. */
    onOpenSpace?: (orgId: string, spaceId: string) => void
    /** Land on one message, in this space or another the reader is in; the pane resolves its thread. */
    onOpenMessage?: (orgId: string, spaceId: string, messageId: string) => void
    /** Open (creating on first use) the DM with a member of an org the reader is signed into. */
    onOpenDirect?: (orgId: string, memberId: string) => void
    /** The org id behind an address the reader is signed into — null otherwise. */
    resolveOrg?: (orgAddress: string) => string | null
    /** The org id behind an address + space the reader is in — null when the space is not in their listing. */
    resolveSpace?: (orgAddress: string, spaceId: string) => string | null
}

export const SpaceNavContext = createContext<SpaceNav | null>(null)

/** The pane's navigation, for surfaces outside the markdown tree (the profile popover's Message action). */
export function useSpaceNav(): SpaceNav | null {
    return useContext(SpaceNavContext)
}

