import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import posthog from 'posthog-js'
import {
  Bell,
  Bot,
  Code2,
  CornerDownRight,
  FileText,
  Folder,
  Hash,
  History,
  LayoutGrid,
  ListTodo,
  Mail,
  MessageSquare,
  MessagesSquare,
  Mic,
  PenTool,
  Settings,
  StickyNote,
  User,
  Waypoints,
  type LucideIcon,
} from 'lucide-react'
import * as analytics from '@/lib/analytics'
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { projectLabel, useCodeSessions } from '@/components/code/use-code-sessions'
import { highlight } from '@/components/spaces/highlight'
import { useOrgRosters } from '@/hooks/use-space-members'
import { useSpaceFeeds, useSpacesOrgs } from '@/hooks/use-spaces'
import {
  PALETTE_SCOPES,
  PALETTE_SECTIONS,
  type PaletteDestination,
  type PaletteScope,
  type PaletteSectionKey,
} from '@/lib/command-palette/destinations'
import type { PaletteNote } from '@/lib/command-palette/notes'
import { rankItems } from '@/lib/command-palette/rank'
import {
  EMPTY_CROSS_SPACE,
  searchAllSpaces,
  type CrossSpaceResults,
  type SpaceRef,
} from '@/lib/command-palette/spaces-search'
import { SPACES_ENABLED } from '@/lib/feature-flags'
import { chord } from '@/lib/shortcut'
import { formatFeedTime, resolveMentions } from '@/lib/spaces-presentation'
import { spaceVisitedAt, useSpaceVisitsVersion } from '@/lib/spaces-visits'
import { cn } from '@/lib/utils'

// The app's one ⌘K: Spotlight for Rowboat. Navigation and search in a single
// box — type a few letters and the best thing to open is first, whatever it
// is: a section, a space, a person, a discussion, a chat, a code chat, a note
// (ranked locally, instantly), and under that what the text turned up across
// spaces (messages, discussions, files), your chats, and Brain (fetched after
// a debounce). Scope chips narrow it; Tab cycles them. A leading "#" names a
// space and "@" a person, as people write them. The space header's own bar
// (⌘⇧K) stays for a search confined to one space with its filter grammar.
//
// Spaces and people read the same stores the sidebar and the assistant's @
// menu do: the org listing, the org rosters (so "@" reaches anyone, not only
// those with a DM already), and the visit log (so what you keep opening
// comes first).

export interface PaletteChat {
  id: string
  title?: string
  modifiedAt: string
}

// Retained for the programmatic Copilot entry points in App (background-agent
// setup, prompt-block run) — the palette itself no longer invokes Copilot.
export type CommandPaletteMention = {
  path: string
  displayName: string
  lineNumber?: number
}

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * The person's own chats, newest first (App's chatRuns). Code-mode chats
   * ride in this list too (they are chat sessions); the palette moves them
   * to the Code scope by their membership in the code-session store.
   */
  chats: readonly PaletteChat[]
  /** Brain notes, newest first (App's tree through brainNotes). */
  notes: readonly PaletteNote[]
  /** Open narrowed — the Brain view's search button opens on Brain. */
  defaultScope?: PaletteScope
  onNavigate: (dest: PaletteDestination) => void
}

type RowKind =
  | 'section'
  | 'space'
  | 'dm'
  | 'activity'
  | 'discussion'
  | 'chat'
  | 'code'
  | 'note'
  | 'message'
  | 'file'
  | 'note-hit'
  | 'transcript'
  | 'code-transcript'

/** One pickable row, whatever its source — the list and the keyboard see only these. */
interface Row {
  key: string
  kind: RowKind
  icon: LucideIcon
  title: ReactNode
  /** Beside the title, muted: where it lives. */
  subtitle?: ReactNode
  /** Under the title: a snippet or preview. */
  detail?: ReactNode
  /** Right edge: a shortcut, a time. */
  aside?: ReactNode
  dest: PaletteDestination
}

/** A navigable thing and what it is called — ranked locally as you type. */
interface NavItem {
  texts: string[]
  /** Lower wins a tie: a section before a space before a chat of the same name. */
  priority: number
  /** ISO; newer wins a tie, and orders the browse lists. Spaces: when you last opened it. */
  recency?: string
  row: Row
}

interface Group {
  heading: string
  rows: Row[]
}

interface LocalHit {
  type: 'knowledge' | 'chat'
  title: string
  preview: string
  path: string
}

interface ContentHits {
  notes: LocalHit[]
  transcripts: LocalHit[]
}

const EMPTY_CONTENT: ContentHits = { notes: [], transcripts: [] }
const EMPTY_NAMES: ReadonlyMap<string, string> = new Map()
const EMPTY_IDS: ReadonlySet<string> = new Set()

const SECTION_ICONS: Record<PaletteSectionKey, LucideIcon> = {
  home: ListTodo,
  spaces: MessagesSquare,
  email: Mail,
  code: Code2,
  meetings: Mic,
  brain: FileText,
  apps: LayoutGrid,
  'bg-tasks': Bot,
  projects: Folder,
  'chat-history': History,
  'live-notes': StickyNote,
  graph: Waypoints,
  settings: Settings,
}

/** Which navigation rows each scope ranks. */
const NAV_KINDS: Record<PaletteScope, ReadonlySet<RowKind>> = {
  all: new Set(['section', 'space', 'dm', 'activity', 'discussion', 'chat', 'code', 'note']),
  spaces: new Set(['space', 'dm', 'activity', 'discussion']),
  chats: new Set(['chat']),
  brain: new Set(['note']),
  code: new Set(['code']),
}

const NAV_HEADING: Record<PaletteScope, string> = {
  all: 'Go to',
  spaces: 'Spaces',
  chats: 'Chats',
  brain: 'Notes',
  code: 'Code chats',
}

const PLACEHOLDER: Record<PaletteScope, string> = {
  all: 'Search or jump to anything…',
  spaces: 'Search spaces, people, and messages…',
  chats: 'Search chats…',
  brain: 'Search notes and files…',
  code: 'Search code chats…',
}

const SCOPE_LABEL: Record<PaletteScope, string> = {
  all: 'everything',
  spaces: 'spaces',
  chats: 'chats',
  brain: 'Brain',
  code: 'code chats',
}

/**
 * A leading sigil names the kind, the way people write them: "#main" is the
 * space, "@pat" the person. With or without it the same row is found; the
 * sigil only narrows the pool (regardless of scope) and is not searched for.
 */
const SIGILS: Record<string, { kinds: readonly RowKind[]; heading: string }> = {
  '#': { kinds: ['space'], heading: 'Spaces' },
  '@': { kinds: ['dm'], heading: 'People' },
}

function splitSigil(text: string): { sigil: string | null; needle: string } {
  const first = text[0]
  if (first !== undefined && SIGILS[first]) return { sigil: first, needle: text.slice(1).trim() }
  return { sigil: null, needle: text }
}

/** Most recently opened first; never opened keeps its listing order (stable sort). */
function byRecency(a: NavItem, b: NavItem): number {
  return (b.recency ?? '').localeCompare(a.recency ?? '')
}

/** The Code section exists only with code mode on (the dock reads the same flag). */
function useCodeModeEnabled(): boolean {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    const load = () => {
      window.ipc.invoke('codeMode:getConfig', null)
        .then((r) => setEnabled(r.enabled))
        .catch(() => setEnabled(false))
    }
    load()
    window.addEventListener('code-mode-config-changed', load)
    return () => window.removeEventListener('code-mode-config-changed', load)
  }, [])
  return enabled
}

export function CommandPalette({ open, onOpenChange, chats, notes, defaultScope, onNavigate }: CommandPaletteProps) {
  const { orgs } = useSpacesOrgs()
  const feedOf = useSpaceFeeds()
  const codeMode = useCodeModeEnabled()
  const { sessions: codeSessions, projects } = useCodeSessions()
  const inputRef = useRef<HTMLInputElement>(null)

  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<PaletteScope>(defaultScope ?? 'all')
  const [content, setContent] = useState<ContentHits>(EMPTY_CONTENT)
  const [spaceHits, setSpaceHits] = useState<CrossSpaceResults>(EMPTY_CROSS_SPACE)
  const [searching, setSearching] = useState(false)

  // Open: a fresh query in the caller's scope. Close: nothing lingers. The
  // reset is a render-time adjustment (the previous-render idiom, as the
  // space search's candidate list does), so no effect sets state; opening's
  // side effects follow in the effect below.
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    setQuery('')
    setContent(EMPTY_CONTENT)
    setSpaceHits(EMPTY_CROSS_SPACE)
    setSearching(false)
    if (open) setScope(defaultScope ?? 'all')
  }
  useEffect(() => {
    if (!open) return
    analytics.searchOpened()
    inputRef.current?.focus()
  }, [open])

  const scopes = useMemo(
    () => PALETTE_SCOPES.filter((s) => (s.key === 'spaces' ? SPACES_ENABLED : s.key === 'code' ? codeMode : true)),
    [codeMode],
  )
  const cycleScope = useCallback((step: 1 | -1) => {
    setScope((current) => {
      const i = scopes.findIndex((s) => s.key === current)
      return scopes[(i + step + scopes.length) % scopes.length]!.key
    })
  }, [scopes])

  // Code-mode chats are chat sessions, so they arrive in `chats` too. With
  // code mode on they belong to the Code scope alone; with it off there is
  // no Code section to open them in, and they stay ordinary chats.
  const codeIds = useMemo<ReadonlySet<string>>(
    () => (codeMode ? new Set(codeSessions.map((s) => s.id)) : EMPTY_IDS),
    [codeMode, codeSessions],
  )

  // The org rosters (cached, then refreshed): who "@" can reach, and the
  // names on message rows — the palette has no space pane around it.
  const rosterOrgs = useMemo(
    () => orgs.filter((o) => !o.error).map((o) => ({ id: o.id, spaceIds: o.spaces.map((s) => s.id) })),
    [orgs],
  )
  const rosters = useOrgRosters(rosterOrgs)
  const rosterNames = useMemo(() => {
    const out = new Map<string, ReadonlyMap<string, string>>()
    for (const [orgId, members] of rosters) out.set(orgId, new Map(members.map((m) => [m.id, m.displayName])))
    return out
  }, [rosters])

  // When each space was last opened here. The log exposes a version, not a
  // value: bind the lookup to it so a visit yields a new lookup and the rows
  // memo below follows.
  const visitsVersion = useSpaceVisitsVersion()
  const visitedAt = useMemo(() => {
    void visitsVersion
    return (orgId: string, spaceId: string): string | undefined => {
      const at = spaceVisitedAt(orgId, spaceId)
      return at === null ? undefined : new Date(at).toISOString()
    }
  }, [visitsVersion])

  // Every space and DM, flat — the fan-out targets and the rows' captions.
  const spaceRefs = useMemo<SpaceRef[]>(
    () => orgs.flatMap((org) => [
      ...org.spaces.map((s): SpaceRef => ({ orgId: org.id, orgName: org.name, spaceId: s.id, name: s.name, direct: false })),
      ...org.directs.map((d): SpaceRef => ({ orgId: org.id, orgName: org.name, spaceId: d.id, name: org.directLabels[d.id] ?? d.name, direct: true })),
    ]),
    [orgs],
  )
  // The listing refreshes on focus and on live frames; a search in flight
  // keys on the text, not on the listing's identity.
  const spaceRefsRef = useRef(spaceRefs)
  useEffect(() => {
    spaceRefsRef.current = spaceRefs
  }, [spaceRefs])

  const navItems = useMemo<NavItem[]>(() => {
    const items: NavItem[] = []
    for (const s of PALETTE_SECTIONS) {
      if (s.key === 'spaces' && !SPACES_ENABLED) continue
      if (s.key === 'code' && !codeMode) continue
      items.push({
        texts: [s.label, ...s.keywords],
        priority: 0,
        row: {
          key: `section:${s.key}`,
          kind: 'section',
          icon: SECTION_ICONS[s.key],
          title: s.label,
          aside: s.digit ? chord(String(s.digit)) : undefined,
          dest: { kind: 'section', section: s.key },
        },
      })
    }
    const manyOrgs = orgs.length > 1
    for (const org of orgs) {
      for (const s of org.spaces) {
        items.push({
          texts: [s.name],
          priority: 1,
          recency: visitedAt(org.id, s.id),
          row: {
            key: `space:${org.id}/${s.id}`,
            kind: 'space',
            icon: Hash,
            title: s.name,
            subtitle: manyOrgs ? org.name : 'Space',
            dest: { kind: 'space', orgId: org.id, spaceId: s.id },
          },
        })
      }
      // People: those you already have a DM with, then everyone else on the
      // roster (picking one starts the DM). Yourself is the self-DM row.
      const withDm = new Set(org.directs.flatMap((d) => d.participants ?? []))
      for (const d of org.directs) {
        const name = org.directLabels[d.id] ?? d.name
        items.push({
          texts: [name],
          priority: 2,
          recency: visitedAt(org.id, d.id),
          row: {
            key: `dm:${org.id}/${d.id}`,
            kind: 'dm',
            icon: User,
            title: name,
            subtitle: manyOrgs ? `Direct message · ${org.name}` : 'Direct message',
            dest: { kind: 'space', orgId: org.id, spaceId: d.id },
          },
        })
      }
      for (const m of rosters.get(org.id) ?? []) {
        if (m.id === org.memberId || withDm.has(m.id)) continue
        items.push({
          texts: [m.displayName],
          priority: 2,
          row: {
            key: `person:${org.id}/${m.id}`,
            kind: 'dm',
            icon: User,
            title: m.displayName,
            subtitle: manyOrgs ? `Person · ${org.name}` : 'Person',
            dest: { kind: 'person', orgId: org.id, memberId: m.id },
          },
        })
      }
      items.push({
        texts: ['Activity', `${org.name} activity`],
        priority: 3,
        row: {
          key: `activity:${org.id}`,
          kind: 'activity',
          icon: Bell,
          title: 'Activity',
          subtitle: org.name,
          dest: { kind: 'activity', orgId: org.id },
        },
      })
    }
    for (const ref of spaceRefs) {
      for (const t of feedOf(ref.orgId, ref.spaceId).topics) {
        if (t.archived) continue
        items.push({
          texts: [t.title],
          priority: 4,
          recency: t.lastActivityAt,
          row: {
            key: `topic:${ref.orgId}/${ref.spaceId}/${t.id}`,
            kind: 'discussion',
            icon: CornerDownRight,
            title: t.title,
            subtitle: ref.direct ? ref.name : `#${ref.name}`,
            aside: formatFeedTime(t.lastActivityAt),
            dest: { kind: 'space', orgId: ref.orgId, spaceId: ref.spaceId, rail: { kind: 'thread', rootMessageId: t.rootMessageId } },
          },
        })
      }
    }
    for (const c of chats) {
      if (codeIds.has(c.id)) continue
      const title = c.title ?? 'New chat'
      items.push({
        texts: [title],
        priority: 5,
        recency: c.modifiedAt,
        row: {
          key: `chat:${c.id}`,
          kind: 'chat',
          icon: MessageSquare,
          title,
          subtitle: 'Chat',
          aside: formatFeedTime(c.modifiedAt),
          dest: { kind: 'chat', sessionId: c.id },
        },
      })
    }
    if (codeMode) {
      const labels = new Map(projects.map((p) => [p.project.id, projectLabel(p)]))
      for (const s of codeSessions) {
        const at = s.lastActivityAt ?? s.createdAt
        const project = labels.get(s.projectId)
        items.push({
          texts: project ? [s.title, project] : [s.title],
          priority: 6,
          recency: at,
          row: {
            key: `code:${s.id}`,
            kind: 'code',
            icon: Code2,
            title: s.title,
            subtitle: project ?? 'Code chat',
            aside: formatFeedTime(at),
            dest: { kind: 'code-session', sessionId: s.id },
          },
        })
      }
    }
    for (const n of notes) {
      items.push({
        texts: [n.title],
        priority: 7,
        recency: n.modifiedAt,
        row: {
          key: `note:${n.path}`,
          kind: 'note',
          icon: FileText,
          title: n.title,
          subtitle: 'Note',
          aside: formatFeedTime(n.modifiedAt),
          dest: { kind: 'note', path: n.path },
        },
      })
    }
    return items
  }, [orgs, rosters, visitedAt, spaceRefs, feedOf, chats, codeIds, codeMode, codeSessions, projects, notes])

  const q = query.trim()
  const { sigil, needle } = splitSigil(q)
  const terms = useMemo(() => needle.toLowerCase().split(/\s+/).filter(Boolean), [needle])

  // Navigation groups: a browsable list when nothing is typed, one ranked
  // list once something is.
  const navGroups = useMemo<Group[]>(() => {
    const rank = (pool: NavItem[], text: string, limit: number) =>
      rankItems(text, pool, {
        texts: (i) => i.texts,
        priority: (i) => i.priority,
        recency: (i) => i.recency,
        limit,
      }).map((r) => r.item.row)
    if (sigil) {
      const { kinds, heading } = SIGILS[sigil]!
      const pool = navItems.filter((i) => kinds.includes(i.row.kind))
      return [{ heading, rows: needle ? rank(pool, needle, 20) : [...pool].sort(byRecency).map((i) => i.row) }]
    }
    const allowed = NAV_KINDS[scope]
    const pool = navItems.filter((i) => allowed.has(i.row.kind))
    const rows = (kinds: RowKind[], limit = Infinity) =>
      pool.filter((i) => kinds.includes(i.row.kind)).slice(0, limit).map((i) => i.row)
    if (!q) {
      switch (scope) {
        case 'all':
          return [
            { heading: 'Go to', rows: rows(['section']) },
            {
              heading: 'Recent spaces',
              rows: pool.filter((i) => (i.row.kind === 'space' || i.row.kind === 'dm') && i.recency).sort(byRecency).slice(0, 3).map((i) => i.row),
            },
            { heading: 'Recent chats', rows: rows(['chat'], 5) },
          ]
        case 'spaces':
          return [
            { heading: 'Spaces', rows: pool.filter((i) => i.row.kind === 'space' || i.row.kind === 'activity').sort(byRecency).map((i) => i.row) },
            { heading: 'People', rows: pool.filter((i) => i.row.kind === 'dm').sort(byRecency).map((i) => i.row) },
          ]
        case 'chats':
          return [{ heading: 'Recent chats', rows: rows(['chat'], 15) }]
        case 'brain':
          return [{ heading: 'Recent notes', rows: rows(['note'], 15) }]
        case 'code':
          return [{ heading: 'Recent code chats', rows: rows(['code'], 15) }]
      }
    }
    return [{ heading: NAV_HEADING[scope], rows: rank(pool, q, scope === 'all' ? 10 : 20) }]
  }, [navItems, q, sigil, needle, scope])

  // Content search, a debounce after the last keystroke: Brain and chat
  // transcripts through search:query, every space through the org's
  // per-space search. Typing orphans whatever is in flight (the sequence
  // moves on), so a stale response never overwrites a newer one.
  const seq = useRef(0)
  useEffect(() => {
    const text = splitSigil(query.trim()).needle
    const mine = ++seq.current
    const timer = setTimeout(() => {
      if (!open || text.length < 2) {
        setContent(EMPTY_CONTENT)
        setSpaceHits(EMPTY_CROSS_SPACE)
        setSearching(false)
        return
      }
      const wantNotes = scope === 'all' || scope === 'brain'
      const wantTranscripts = scope === 'all' || scope === 'chats' || scope === 'code'
      const wantSpaces = SPACES_ENABLED && (scope === 'all' || scope === 'spaces')
      const types: Array<'knowledge' | 'chat'> = [
        ...(wantNotes ? ['knowledge' as const] : []),
        ...(wantTranscripts ? ['chat' as const] : []),
      ]
      const perGroup = scope === 'all' ? 6 : 20
      setSearching(true)
      // One call per type: the core's limit is a single total with Brain
      // first, so a shared call would starve chats of their rows.
      const local = types.length > 0
        ? Promise.all(types.map((type) => window.ipc.invoke('search:query', { query: text, limit: perGroup, types: [type] })))
          .then((pages) => {
            if (seq.current !== mine) return
            const hits = pages.flatMap((p) => p.results)
            setContent({
              notes: hits.filter((r) => r.type === 'knowledge'),
              transcripts: hits.filter((r) => r.type === 'chat'),
            })
          })
          .catch((err) => {
            console.error('Search failed:', err)
            if (seq.current === mine) setContent(EMPTY_CONTENT)
          })
        : Promise.resolve(setContent(EMPTY_CONTENT))
      const targets = spaceRefsRef.current
      const remote = wantSpaces && targets.length > 0
        ? searchAllSpaces(targets, text, { perSpace: scope === 'all' ? 3 : 5, limit: scope === 'all' ? 6 : 15 })
          .then((r) => { if (seq.current === mine) setSpaceHits(r) })
        : Promise.resolve(setSpaceHits(EMPTY_CROSS_SPACE))
      analytics.searchExecuted([...types, ...(wantSpaces ? ['spaces'] : [])])
      posthog.people.set_once({ has_used_search: true })
      void Promise.allSettled([local, remote]).then(() => {
        if (seq.current === mine) setSearching(false)
      })
    }, 250)
    return () => clearTimeout(timer)
  }, [query, scope, open])

  const contentGroups = useMemo<Group[]>(() => {
    const navKeys = new Set(navGroups.flatMap((g) => g.rows.map((r) => r.key)))
    const messages: Row[] = spaceHits.messages.map(({ space, hit }) => {
      const roster = rosterNames.get(space.orgId) ?? EMPTY_NAMES
      const author = roster.get(hit.author.memberId) ?? hit.author.memberId
      const isRoot = hit.threadRootId === hit.messageId
      return {
        key: `msg:${space.orgId}/${space.spaceId}/${hit.messageId}`,
        kind: 'message',
        icon: MessageSquare,
        title: hit.author.agentName ? `${author} · ${hit.author.agentName}` : author,
        subtitle: `${space.direct ? space.name : `#${space.name}`}${hit.topicTitle ? ` › ${hit.topicTitle}` : ''}`,
        detail: highlight(resolveMentions(hit.snippet, roster), terms),
        aside: formatFeedTime(hit.postedAt),
        dest: {
          kind: 'space',
          orgId: space.orgId,
          spaceId: space.spaceId,
          rail: isRoot ? { kind: 'general' } : { kind: 'thread', rootMessageId: hit.threadRootId },
          messageId: hit.messageId,
        },
      }
    })
    // Discussions the org found that the local feed did not already rank.
    const topics: Row[] = spaceHits.topics
      .filter(({ space, hit }) => !navKeys.has(`topic:${space.orgId}/${space.spaceId}/${hit.topic.id}`))
      .map(({ space, hit }) => ({
        key: `topic-hit:${space.orgId}/${space.spaceId}/${hit.topic.id}`,
        kind: 'discussion',
        icon: CornerDownRight,
        title: highlight(hit.topic.title, terms),
        subtitle: `${space.direct ? space.name : `#${space.name}`}${hit.topic.archived ? ' · archived' : ''}`,
        aside: formatFeedTime(hit.topic.createdAt),
        dest: { kind: 'space', orgId: space.orgId, spaceId: space.spaceId, rail: { kind: 'thread', rootMessageId: hit.topic.rootMessageId } },
      }))
    const files: Row[] = spaceHits.assets.map(({ space, hit }) => {
      const board = /\.excalidraw$/i.test(hit.path)
      return {
        key: `asset:${space.orgId}/${space.spaceId}/${hit.path}`,
        kind: 'file',
        icon: board ? PenTool : FileText,
        title: <span className="font-mono text-[13px]">{highlight(hit.path, terms)}</span>,
        subtitle: space.direct ? space.name : `#${space.name}`,
        detail: hit.snippet ? highlight(hit.snippet, terms) : undefined,
        aside: formatFeedTime(hit.updatedAt),
        dest: { kind: 'space', orgId: space.orgId, spaceId: space.spaceId, rail: board ? { kind: 'whiteboard', path: hit.path } : { kind: 'file', path: hit.path } },
      }
    })
    // A note already ranked by its title is not listed twice for its text;
    // the same for a chat. Transcript hits split the way the rows do: a
    // code-mode chat's text belongs to the Code scope, never to Chats.
    const noteHits: Row[] = content.notes
      .filter((r) => !navKeys.has(`note:${r.path}`))
      .map((r) => ({
        key: `note-hit:${r.path}`,
        kind: 'note-hit',
        icon: FileText,
        title: r.title,
        detail: r.preview,
        dest: { kind: 'note', path: r.path },
      }))
    const transcripts: Row[] = scope === 'code'
      ? []
      : content.transcripts
        .filter((r) => !codeIds.has(r.path) && !navKeys.has(`chat:${r.path}`))
        .map((r) => ({
          key: `transcript:${r.path}`,
          kind: 'transcript',
          icon: MessageSquare,
          title: r.title,
          detail: r.preview,
          dest: { kind: 'chat', sessionId: r.path },
        }))
    const codeTranscripts: Row[] = scope === 'chats'
      ? []
      : content.transcripts
        .filter((r) => codeIds.has(r.path) && !navKeys.has(`code:${r.path}`))
        .map((r) => ({
          key: `code-transcript:${r.path}`,
          kind: 'code-transcript',
          icon: Code2,
          title: r.title,
          detail: r.preview,
          dest: { kind: 'code-session', sessionId: r.path },
        }))
    return [
      { heading: 'Messages', rows: messages },
      { heading: 'Discussions', rows: topics },
      { heading: 'Files in spaces', rows: files },
      { heading: 'In notes', rows: noteHits },
      { heading: 'In chats', rows: transcripts },
      { heading: 'In code chats', rows: codeTranscripts },
    ].filter((g) => g.rows.length > 0)
  }, [navGroups, spaceHits, rosterNames, content, terms, scope, codeIds])

  const groups = [...navGroups.filter((g) => g.rows.length > 0), ...contentGroups]
  const count = groups.reduce((n, g) => n + g.rows.length, 0)
  const contentPending = searching && needle.length >= 2 && contentGroups.length === 0

  // Picking a row closes the palette and goes there — in that order, so the
  // destination's own focus and dialogs are not fighting a closing one.
  const select = useCallback((row: Row) => {
    analytics.searchResultSelected(row.kind)
    onOpenChange(false)
    onNavigate(row.dest)
  }, [onOpenChange, onNavigate])

  const emptyLabel = sigil
    ? `No ${sigil === '#' ? 'space' : 'person'} matches ${needle ? `"${needle}"` : 'yet'}.`
    : `No matches${scope === 'all' ? '' : ` in ${SCOPE_LABEL[scope]}`}.`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[14%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Search and go to</DialogTitle>
          <DialogDescription>
            Jump to a section, space, person, discussion, chat, code chat, or note, or search across spaces, chats, and Brain.
          </DialogDescription>
        </DialogHeader>
        <Command
          shouldFilter={false}
          loop
          className="rounded-2xl [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground/80 [&_[data-slot=command-input-wrapper]]:h-13 [&_[data-slot=command-input-wrapper]_svg]:size-4.5"
        >
          <CommandInput
            ref={inputRef}
            autoFocus
            placeholder={PLACEHOLDER[scope]}
            value={query}
            onValueChange={setQuery}
            className="h-13 text-base"
            onKeyDown={(e) => {
              if (e.key === 'Tab') {
                e.preventDefault()
                cycleScope(e.shiftKey ? -1 : 1)
              }
            }}
          />
          <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
            {scopes.map((s) => (
              <button
                key={s.key}
                type="button"
                aria-pressed={scope === s.key}
                onClick={() => setScope(s.key)}
                className={cn(
                  'rounded-md px-2 py-0.5 text-xs font-medium transition-colors',
                  scope === s.key ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {s.label}
              </button>
            ))}
            {searching && needle.length >= 2 && <span className="ml-auto pr-1 text-[11px] text-muted-foreground">Searching…</span>}
          </div>
          <CommandList className="max-h-[min(60vh,520px)] px-1 py-1">
            {count === 0 && (
              <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                {!q ? (
                  scope === 'brain' ? 'No notes yet. Type to search your notes and files.' : `Nothing to show in ${SCOPE_LABEL[scope]} yet.`
                ) : contentPending ? (
                  'Searching…'
                ) : (
                  <>
                    <p>{emptyLabel}</p>
                    {scope !== 'all' && !sigil && (
                      <button type="button" onClick={() => setScope('all')} className="mt-1.5 text-xs text-primary hover:underline">
                        Search everything instead
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
            {groups.map((g) => (
              <CommandGroup key={g.heading} heading={g.heading} className="p-0 pb-1">
                {g.rows.map((row) => (
                  <PaletteRow key={row.key} row={row} onSelect={select} />
                ))}
              </CommandGroup>
            ))}
            {spaceHits.truncated && (
              <div className="px-3 pb-1.5 pt-0.5 text-[10.5px] text-muted-foreground/80">
                Showing the top matches across spaces. Refine the query, or search inside one space with {chord('K', { shift: true })}.
              </div>
            )}
          </CommandList>
          <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><Kbd>↑↓</Kbd> Navigate</span>
            <span className="flex items-center gap-1"><Kbd>↵</Kbd> Open</span>
            <span className="flex items-center gap-1"><Kbd>Tab</Kbd> Scope</span>
            <span className="flex items-center gap-1"><Kbd>#</Kbd> Space <Kbd>@</Kbd> Person</span>
            <span className="ml-auto flex items-center gap-1"><Kbd>esc</Kbd> Close</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

function PaletteRow({ row, onSelect }: { row: Row; onSelect: (row: Row) => void }) {
  const Icon = row.icon
  return (
    <CommandItem value={row.key} onSelect={() => onSelect(row)} className="items-start gap-2.5 px-2 py-1.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 truncate text-sm">{row.title}</span>
          {row.subtitle && <span className="min-w-0 truncate text-xs text-muted-foreground">{row.subtitle}</span>}
        </div>
        {row.detail && <div className="line-clamp-1 text-xs text-muted-foreground">{row.detail}</div>}
      </div>
      {row.aside && <span className="ml-auto shrink-0 self-center text-[11px] text-muted-foreground">{row.aside}</span>}
    </CommandItem>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1 py-px font-mono text-[10px] text-muted-foreground">
      {children}
    </kbd>
  )
}
