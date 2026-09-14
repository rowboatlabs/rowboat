import { describe, expect, it } from 'vitest'
import { splitMentions } from './mention-payload'
import type { Mention } from '@/components/ai-elements/prompt-input'

// What the composer's @ picks become on the wire: files are attachments,
// everything from Spaces is context the model acts on by id.

const mentions: Mention[] = [
  { kind: 'file', id: 'm1', path: 'knowledge/notes.md', displayName: 'notes' },
  { kind: 'space', id: 'm2', orgId: 'org-1', orgName: 'rowboat', spaceId: '01SPACE', displayName: 'Design' },
  {
    kind: 'board',
    id: 'm3',
    orgId: 'org-1',
    orgName: 'rowboat',
    spaceId: '01SPACE',
    spaceName: 'Design',
    path: 'whiteboards/roadmap.excalidraw',
    displayName: 'roadmap',
  },
  { kind: 'member', id: 'm4', orgId: 'org-1', orgName: 'rowboat', memberId: '01HARSH', displayName: 'Harsh Kumar' },
]

describe('splitMentions', () => {
  it('keeps files as attachments and turns spaces, boards and people into context refs', () => {
    const { fileMentions, spaceMentions } = splitMentions(mentions)
    expect(fileMentions.map((f) => f.path)).toEqual(['knowledge/notes.md'])
    expect(spaceMentions).toEqual([
      { kind: 'space', orgId: 'org-1', orgName: 'rowboat', spaceId: '01SPACE', name: 'Design' },
      {
        kind: 'board',
        orgId: 'org-1',
        orgName: 'rowboat',
        spaceId: '01SPACE',
        spaceName: 'Design',
        path: 'whiteboards/roadmap.excalidraw',
        name: 'roadmap',
      },
      { kind: 'member', orgId: 'org-1', orgName: 'rowboat', memberId: '01HARSH', displayName: 'Harsh Kumar' },
    ])
  })

  it('is empty for no mentions', () => {
    expect(splitMentions(undefined)).toEqual({ fileMentions: [], spaceMentions: [] })
  })
})
