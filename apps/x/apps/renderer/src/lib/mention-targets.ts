import { wikiLabel, stripKnowledgePrefix } from '@/lib/wiki-links'

// The assistant composer's @ menu (2026-09-12): what "@" can name, and how
// the list is ordered. Four kinds of target ride one popover — the agent
// itself, knowledge files, the shared spaces the user is in, and the people
// they can DM — grouped so a glance tells them apart, filtered as they type.
// Pure: the composer feeds it the sources, the popover renders the result,
// and the ranking is pinned by tests rather than left to the component.

export interface SpaceMentionTarget {
  kind: 'space'
  orgId: string
  orgName: string
  spaceId: string
  name: string
}

export interface MemberMentionTarget {
  kind: 'member'
  orgId: string
  orgName: string
  memberId: string
  displayName: string
}

export type MentionTarget =
  | { kind: 'rowboat' }
  | { kind: 'file'; path: string }
  | SpaceMentionTarget
  | MemberMentionTarget

export type MentionGroup = 'agent' | 'files' | 'spaces' | 'people'

export interface MentionEntry {
  target: MentionTarget
  group: MentionGroup
  /** Stable identity for React keys and the Command value. */
  key: string
  /** What follows the "@" in the text once picked. */
  label: string
}

/** The Spaces half of the menu's sources — what useSpacesMentionTargets resolves. */
export interface SpacesMentionTargets {
  spaces: SpaceMentionTarget[]
  members: MemberMentionTarget[]
}

export const EMPTY_SPACES_MENTION_TARGETS: SpacesMentionTargets = { spaces: [], members: [] }

export interface MentionSources extends SpacesMentionTargets {
  files: string[]
  recentFiles?: string[]
  visibleFiles?: string[]
}

export function mentionTargetKey(target: MentionTarget): string {
  switch (target.kind) {
    case 'rowboat':
      return 'rowboat'
    case 'file':
      return `file:${target.path}`
    case 'space':
      return `space:${target.orgId}/${target.spaceId}`
    case 'member':
      return `member:${target.orgId}/${target.memberId}`
  }
}

export function mentionTargetLabel(target: MentionTarget): string {
  switch (target.kind) {
    case 'rowboat':
      return 'rowboat'
    case 'file':
      return wikiLabel(target.path)
    case 'space':
      return target.name
    case 'member':
      return target.displayName
  }
}

// Caps per group. With no query the menu is a browse — a taste of each
// group, files first (the older habit), then spaces, then people. A query
// is a search: each group widens, because a typed prefix already thins it.
// Files alone (no org signed in) keep their original eight.
const FILES_ALONE = 8
const BROWSE_CAP = 3
const SEARCH_CAP = 5

/** Prefix matches first, then substring matches, each in source order. */
function rankByQuery<T>(items: T[], labelOf: (item: T) => string, query: string): T[] {
  if (!query) return items
  const prefix: T[] = []
  const rest: T[] = []
  for (const item of items) {
    const label = labelOf(item).toLowerCase()
    if (label.startsWith(query)) prefix.push(item)
    else if (label.includes(query)) rest.push(item)
  }
  return [...prefix, ...rest]
}

/** Files: visible > recent > rest (the tree the user has open first), then the query filter. */
function orderFiles(files: string[], recentFiles: string[], visibleFiles: string[], query: string): string[] {
  const visibleSet = new Set(visibleFiles)
  const recentSet = new Set(recentFiles)
  const allFiles = new Set(files)
  const visible: string[] = []
  const rest: string[] = []
  for (const file of files) {
    if (visibleSet.has(file)) visible.push(file)
    else if (!recentSet.has(file)) rest.push(file)
  }
  const orderedRecent = recentFiles.filter((f) => allFiles.has(f) && !visibleSet.has(f))
  const ordered = [...visible, ...orderedRecent, ...rest]
  if (!query) return ordered
  return ordered.filter((path) => {
    const label = wikiLabel(path).toLowerCase()
    const normalized = stripKnowledgePrefix(path).toLowerCase()
    return label.includes(query) || normalized.includes(query)
  })
}

export function buildMentionEntries(rawQuery: string, sources: MentionSources): MentionEntry[] {
  const query = rawQuery.toLowerCase()
  const hasSpacesSources = sources.spaces.length > 0 || sources.members.length > 0
  const groupCap = query ? SEARCH_CAP : BROWSE_CAP
  const fileCap = hasSpacesSources ? groupCap : FILES_ALONE

  const entries: MentionEntry[] = []

  // @rowboat leads whenever it still matches what's typed.
  if ('rowboat'.startsWith(query)) {
    entries.push({ target: { kind: 'rowboat' }, group: 'agent', key: 'rowboat', label: 'rowboat' })
  }

  for (const path of orderFiles(sources.files, sources.recentFiles ?? [], sources.visibleFiles ?? [], query).slice(0, fileCap)) {
    const target: MentionTarget = { kind: 'file', path }
    entries.push({ target, group: 'files', key: mentionTargetKey(target), label: mentionTargetLabel(target) })
  }

  for (const target of rankByQuery(sources.spaces, (s) => s.name, query).slice(0, groupCap)) {
    entries.push({ target, group: 'spaces', key: mentionTargetKey(target), label: target.name })
  }

  for (const target of rankByQuery(sources.members, (m) => m.displayName, query).slice(0, groupCap)) {
    entries.push({ target, group: 'people', key: mentionTargetKey(target), label: target.displayName })
  }

  return entries
}

/** Every label the menu can insert — what the composer highlights and deletes as one token. */
export function mentionLabelsFor(sources: MentionSources): string[] {
  const labels = new Set<string>()
  for (const path of sources.files) {
    const label = wikiLabel(path).trim()
    if (label) labels.add(label)
  }
  for (const space of sources.spaces) {
    const label = space.name.trim()
    if (label) labels.add(label)
  }
  for (const member of sources.members) {
    const label = member.displayName.trim()
    if (label) labels.add(label)
  }
  return Array.from(labels)
}
