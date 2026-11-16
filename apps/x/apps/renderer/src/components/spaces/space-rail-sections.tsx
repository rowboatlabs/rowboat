import type { ReactNode } from 'react'

/**
 * The rail's full-height column. Spaces redesign (2026-10-21): Activity moved
 * from a resizable bottom panel to a nav row in ServerSpaceNavigation, so this
 * only holds the navigation.
 */
export function SpaceRailSections({ children }: { children: ReactNode }) {
    return <div className="spaces-navigation flex h-full min-h-0 flex-col">{children}</div>
}
