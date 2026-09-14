import { useMemo } from 'react'
import { useSpacesOrgs } from '@/hooks/use-spaces'
import { useOrgRosters } from '@/hooks/use-space-members'
import { useOrgBoards } from '@/hooks/use-space-boards'
import {
  EMPTY_SPACES_MENTION_TARGETS,
  type BoardMentionTarget,
  type MemberMentionTarget,
  type SpaceMentionTarget,
  type SpacesMentionTargets,
} from '@/lib/mention-targets'

/**
 * What the assistant composer's @ menu can name in Spaces: every shared
 * space the user is in, the whiteboards in those spaces, and every person
 * they can DM, across every org this install is signed into. Reads the same
 * stores the Spaces sidebar renders (orgs + listing; org rosters, cached then
 * refreshed; board listings, cached then refreshed), so the menu's first
 * frame is already full and nothing is fetched twice. Yourself is left out —
 * "@me" reads oddly in an ask, and the assistant knows who its person is.
 * With Spaces dark there are no orgs, so the result is simply empty.
 */
export function useSpacesMentionTargets(): SpacesMentionTargets {
  const { orgs } = useSpacesOrgs()
  const rosterOrgs = useMemo(
    () => orgs.filter((o) => !o.error).map((o) => ({ id: o.id, spaceIds: o.spaces.map((s) => s.id) })),
    [orgs],
  )
  const rosters = useOrgRosters(rosterOrgs)
  const boardsByOrg = useOrgBoards(rosterOrgs)
  return useMemo(() => {
    if (orgs.length === 0) return EMPTY_SPACES_MENTION_TARGETS
    const spaces: SpaceMentionTarget[] = []
    const boards: BoardMentionTarget[] = []
    const members: MemberMentionTarget[] = []
    for (const org of orgs) {
      if (org.error) continue
      for (const space of org.spaces) {
        spaces.push({ kind: 'space', orgId: org.id, orgName: org.name, spaceId: space.id, name: space.name })
        for (const board of boardsByOrg.get(org.id)?.get(space.id) ?? []) {
          boards.push({ kind: 'board', orgId: org.id, orgName: org.name, spaceId: space.id, spaceName: space.name, path: board.path, name: board.name })
        }
      }
      for (const member of rosters.get(org.id) ?? []) {
        if (member.id === org.memberId) continue
        members.push({ kind: 'member', orgId: org.id, orgName: org.name, memberId: member.id, displayName: member.displayName })
      }
    }
    return { spaces, boards, members }
  }, [orgs, rosters, boardsByOrg])
}
