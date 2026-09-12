import { describe, expect, it } from 'vitest'
import {
  buildMentionEntries,
  mentionLabelsFor,
  mentionTargetKey,
  type MemberMentionTarget,
  type MentionSources,
  type SpaceMentionTarget,
} from './mention-targets'

// The assistant composer's @ menu: what "@" offers and in what order. The
// ranking is a product decision (files first as a browse, spaces and people
// behind them; a typed prefix outranks a substring), so it is pinned here.

const space = (name: string, org = 'rowboat'): SpaceMentionTarget => ({
  kind: 'space',
  orgId: `org-${org}`,
  orgName: org,
  spaceId: `space-${org}-${name}`,
  name,
})

const person = (displayName: string, org = 'rowboat'): MemberMentionTarget => ({
  kind: 'member',
  orgId: `org-${org}`,
  orgName: org,
  memberId: `member-${org}-${displayName}`,
  displayName,
})

const files = ['alpha.md', 'beta.md', 'gamma.md', 'delta.md', 'design.md', 'epsilon.md', 'zeta.md', 'eta.md', 'theta.md']

const sources: MentionSources = {
  files,
  recentFiles: ['gamma.md'],
  visibleFiles: ['beta.md'],
  spaces: [space('Design'), space('Roadboard'), space('Random'), space('Dev')],
  members: [person('Arjun'), person('Harsh Kumar'), person('Ramnique Singh'), person('Devi')],
}

const kinds = (entries: ReturnType<typeof buildMentionEntries>) => entries.map((e) => `${e.group}:${e.label}`)

describe('buildMentionEntries', () => {
  it('browses each group in turn on a bare "@": rowboat, files, spaces, people', () => {
    const entries = buildMentionEntries('', sources)
    expect(entries[0].target.kind).toBe('rowboat')
    const groups = entries.map((e) => e.group)
    // Grouped, in order, and never interleaved.
    expect(groups).toEqual([...groups].sort((a, b) => ORDER[a] - ORDER[b]))
    // A taste of each group, not the whole world.
    expect(entries.filter((e) => e.group === 'files')).toHaveLength(3)
    expect(entries.filter((e) => e.group === 'spaces')).toHaveLength(3)
    expect(entries.filter((e) => e.group === 'people')).toHaveLength(3)
  })

  it('ranks files the way the tree does: visible, then recent, then the rest', () => {
    const labels = buildMentionEntries('', sources)
      .filter((e) => e.group === 'files')
      .map((e) => e.label)
    expect(labels).toEqual(['beta', 'gamma', 'alpha'])
  })

  it('keeps the original eight files when no org is signed in', () => {
    const entries = buildMentionEntries('', { files, spaces: [], members: [] })
    expect(entries.filter((e) => e.group === 'files')).toHaveLength(8)
    expect(entries.some((e) => e.group === 'spaces' || e.group === 'people')).toBe(false)
  })

  it('filters every group by the query, case-insensitively, and drops rowboat once it stops matching', () => {
    const entries = buildMentionEntries('DE', sources)
    expect(entries.some((e) => e.target.kind === 'rowboat')).toBe(false)
    expect(kinds(entries)).toEqual([
      'files:delta',
      'files:design',
      'spaces:Design',
      'spaces:Dev',
      'people:Devi',
    ])
  })

  it('puts prefix matches ahead of substring matches within a group', () => {
    const entries = buildMentionEntries('ra', { ...sources, spaces: [space('Roadboard'), space('Ultra'), space('Random')] })
    expect(entries.filter((e) => e.group === 'spaces').map((e) => e.label)).toEqual(['Random', 'Ultra'])
  })

  it('keeps rowboat first while the query is a prefix of it', () => {
    const entries = buildMentionEntries('ro', sources)
    expect(entries[0].target.kind).toBe('rowboat')
    expect(entries.map((e) => e.label)).toContain('Roadboard')
  })

  it('widens each group once a query narrows it', () => {
    const many = { ...sources, members: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'].map((n) => person(n)) }
    expect(buildMentionEntries('a', many).filter((e) => e.group === 'people')).toHaveLength(5)
    expect(buildMentionEntries('', many).filter((e) => e.group === 'people')).toHaveLength(3)
  })

  it('gives a space and a file with the same name distinct keys', () => {
    const entries = buildMentionEntries('design', sources)
    const keys = entries.filter((e) => e.label.toLowerCase() === 'design').map((e) => e.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toContain(mentionTargetKey({ kind: 'file', path: 'design.md' }))
    expect(keys).toContain(mentionTargetKey(space('Design')))
  })

  it('scopes keys by org, so the same member on two orgs stays two entries', () => {
    const entries = buildMentionEntries('harsh', {
      ...sources,
      members: [person('Harsh Kumar', 'rowboat'), person('Harsh Kumar', 'acme')],
    })
    expect(entries.filter((e) => e.group === 'people')).toHaveLength(2)
  })
})

describe('mentionLabelsFor', () => {
  it('is every label the menu can insert, deduped across kinds', () => {
    const labels = mentionLabelsFor({
      files: ['design.md', 'notes.md'],
      spaces: [space('design'), space('Ops')],
      members: [person('Ops'), person('Harsh Kumar')],
    })
    expect(labels).toEqual(['design', 'notes', 'Ops', 'Harsh Kumar'])
  })
})

const ORDER = { agent: 0, files: 1, spaces: 2, people: 3 } as const
