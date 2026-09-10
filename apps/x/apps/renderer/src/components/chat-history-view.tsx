import { useProjects } from '@/hooks/use-projects'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink, MessagesSquare, MoreVertical, Pencil, SearchIcon, SquarePen, Trash2 } from 'lucide-react'
import type { SessionOrigin, SpaceThreadOrigin } from '@x/shared/src/origins.js'
import { isChatListSession } from '@x/shared/src/sessions.js'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatRelativeTime } from '@/lib/relative-time'
import { findSpace, useSpacesOrgs, type OrgWithSpaces } from '@/hooks/use-spaces'

type Run = {
  id: string
  title?: string
  createdAt: string
  modifiedAt: string
  agentId: string
  /** Set when something outside the runtime owns the session (a space thread). */
  origin?: SessionOrigin
}

type ChatHistoryViewProps = {
  /** EVERY session, owned or not — this pane is where owned sessions become reachable. */
  runs: Run[]
  currentRunId?: string | null
  processingRunIds?: Set<string>
  onSelectRun: (runId: string) => void
  onOpenInNewTab?: (runId: string) => void
  onRenameRun?: (runId: string, title: string) => void
  onDeleteRun: (runId: string) => Promise<void> | void
  onNewChat?: () => void
  onOpenSearch?: () => void
  /** Jump to the thread that owns a space-thread session. */
  onOpenSpaceThread?: (origin: SpaceThreadOrigin) => void
}

// ---------------------------------------------------------------------------
// Two lists, never merged: the person's own assistant chats, and Mentions —
// the sessions the @rowboat mention machinery owns, one per space thread.
// The header tab picks which; in Mentions the chips narrow to one space.
// Names come from the live org roster when it is loaded (renames, DM display
// names) and fall back to what the session recorded at creation.
// ---------------------------------------------------------------------------

type HistoryTab = 'chats' | 'mentions'

const HISTORY_TAB_KEY = 'chat-history.tab'

function readHistoryTab(): HistoryTab {
  try {
    return localStorage.getItem(HISTORY_TAB_KEY) === 'mentions' ? 'mentions' : 'chats'
  } catch {
    return 'chats'
  }
}

function spaceKey(origin: SpaceThreadOrigin): string {
  return `${origin.orgId}/${origin.spaceId}`
}

/** A stable hue per space so its chip reads the same everywhere in the list. */
function spaceHue(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return h % 360
}

interface SpaceFacet {
  key: string
  origin: SpaceThreadOrigin
  /** Space name, or the other person's name for a DM. */
  label: string
  orgName?: string
  isDirect: boolean
  count: number
  latestMs: number
}

function resolveSpace(origin: SpaceThreadOrigin, orgs: OrgWithSpaces[]): Pick<SpaceFacet, 'label' | 'orgName' | 'isDirect'> {
  const org = orgs.find((o) => o.id === origin.orgId)
  if (!org) return { label: origin.spaceName, isDirect: false }
  const space = findSpace(org, origin.spaceId)
  const isDirect = org.directs.some((s) => s.id === origin.spaceId)
  const label = isDirect
    ? (org.directLabels[origin.spaceId] ?? space?.name ?? origin.spaceName)
    : (space?.name ?? origin.spaceName)
  return { label, orgName: org.name, isDirect }
}

function SpaceDot({ hue, className }: { hue: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-2 shrink-0 rounded-full', className)}
      style={{ backgroundColor: `hsl(${hue} 62% 52%)` }}
    />
  )
}

/** The chip on a row: which space (and DM-ness) a thread session belongs to, and whose org. */
function SpaceChip({ facet }: { facet: SpaceFacet }) {
  return (
    <span
      className="inline-flex max-w-[280px] shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
      title={facet.orgName ? `${facet.label} · ${facet.orgName}` : facet.label}
    >
      <SpaceDot hue={spaceHue(facet.key)} />
      {facet.isDirect && <span className="text-muted-foreground/70">DM</span>}
      <span className="truncate text-foreground/80">{facet.label}</span>
      {facet.orgName && <span className="truncate text-muted-foreground/70">· {facet.orgName}</span>}
    </span>
  )
}

/** The header's view picker — two lists, one shown at a time. */
function HistoryTabs({
  value,
  mentionCount,
  onChange,
}: {
  value: HistoryTab
  mentionCount: number
  onChange: (tab: HistoryTab) => void
}) {
  const tab = (id: HistoryTab, label: string, count?: number) => {
    const selected = value === id
    return (
      <button
        type="button"
        role="tab"
        aria-selected={selected}
        onClick={() => onChange(id)}
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors',
          selected
            ? 'bg-background text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.12)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.5)]'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {label}
        {count !== undefined && (
          <span className={cn('rounded-full px-1.5 py-px text-[11px] tabular-nums', selected ? 'bg-muted text-muted-foreground' : 'bg-muted/60 text-muted-foreground')}>
            {count}
          </span>
        )}
      </button>
    )
  }
  return (
    <div role="tablist" aria-label="History view" className="inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {tab('chats', 'Assistant chats')}
      {tab('mentions', 'Space chats', mentionCount)}
    </div>
  )
}

/** A filter chip in the facet row: one space, its org, and its thread count. */
function FacetChip({
  facet,
  selected,
  onClick,
}: {
  facet: SpaceFacet
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'inline-flex max-w-[260px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors',
        selected
          ? 'border-foreground/80 bg-foreground text-background'
          : 'border-border/70 bg-background text-foreground hover:bg-accent',
      )}
    >
      <SpaceDot hue={spaceHue(facet.key)} className={cn(selected && 'ring-1 ring-background/60')} />
      {facet.isDirect && <span className={cn('text-[10px] uppercase tracking-wide', selected ? 'text-background/70' : 'text-muted-foreground')}>DM</span>}
      <span className="truncate font-medium">{facet.label}</span>
      {facet.orgName && (
        <span className={cn('truncate', selected ? 'text-background/70' : 'text-muted-foreground')}>· {facet.orgName}</span>
      )}
      <span className={cn('tabular-nums', selected ? 'text-background/70' : 'text-muted-foreground')}>{facet.count}</span>
    </button>
  )
}

function recencyMs(run: Run): number {
  const ms = new Date(run.modifiedAt).getTime()
  return Number.isNaN(ms) ? 0 : ms
}

export function ChatHistoryView({
  runs,
  currentRunId,
  processingRunIds,
  onSelectRun,
  onOpenInNewTab,
  onRenameRun,
  onDeleteRun,
  onNewChat,
  onOpenSearch,
  onOpenSpaceThread,
}: ChatHistoryViewProps) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [tab, setTab] = useState<HistoryTab>(readHistoryTab)
  // Mentions only: narrow to one space (its facet key); null = every space.
  const [spaceFilter, setSpaceFilter] = useState<string | null>(null)
  const { orgs } = useSpacesOrgs()
  const { projects } = useProjects()

  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_TAB_KEY, tab)
    } catch {
      // per-viewer convenience only
    }
  }, [tab])

  const sortedRuns = useMemo(() => [...runs].sort((a, b) => recencyMs(b) - recencyMs(a)), [runs])

  const chatRuns = useMemo(() => sortedRuns.filter(isChatListSession), [sortedRuns])
  const threadRuns = useMemo(
    () => sortedRuns.filter((r): r is Run & { origin: SpaceThreadOrigin } => r.origin?.kind === 'space_thread'),
    [sortedRuns],
  )

  // One facet per space, from the sessions' own metadata: busiest first.
  const facets = useMemo(() => {
    const byKey = new Map<string, SpaceFacet>()
    for (const run of threadRuns) {
      const key = spaceKey(run.origin)
      const existing = byKey.get(key)
      if (existing) {
        existing.count += 1
        existing.latestMs = Math.max(existing.latestMs, recencyMs(run))
        continue
      }
      byKey.set(key, { key, origin: run.origin, ...resolveSpace(run.origin, orgs), count: 1, latestMs: recencyMs(run) })
    }
    return [...byKey.values()].sort((a, b) => b.count - a.count || b.latestMs - a.latestMs || a.label.localeCompare(b.label))
  }, [threadRuns, orgs])
  const facetByKey = useMemo(() => new Map(facets.map((f) => [f.key, f])), [facets])

  const hasThreads = threadRuns.length > 0
  // The Mentions tab only exists once there is something to list; a remembered
  // "mentions" pick with nothing to show falls back to chats.
  const showMentions = tab === 'mentions' && hasThreads
  // A filter whose space vanished (last thread deleted) reads as "all spaces"
  // — derived, so no effect has to reset state.
  const activeFacet = showMentions && spaceFilter ? facetByKey.get(spaceFilter) ?? null : null
  const effectiveFilter = activeFacet ? activeFacet.key : null

  const visibleRuns = useMemo(() => {
    if (!showMentions) return chatRuns
    if (activeFacet) return threadRuns.filter((r) => spaceKey(r.origin) === activeFacet.key)
    return threadRuns
  }, [showMentions, chatRuns, activeFacet, threadRuns])

  const changeTab = useCallback((next: HistoryTab) => {
    setTab(next)
    setSpaceFilter(null)
  }, [])

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDeleteId) return
    const id = pendingDeleteId
    setPendingDeleteId(null)
    await onDeleteRun(id)
  }, [pendingDeleteId, onDeleteRun])

  const startRename = useCallback((run: Run) => {
    setRenameDraft(run.title || '')
    setRenamingId(run.id)
  }, [])

  const commitRename = useCallback((runId: string) => {
    const title = renameDraft.trim()
    const current = runs.find((r) => r.id === runId)
    setRenamingId(null)
    if (!title || title === (current?.title ?? '')) return
    onRenameRun?.(runId, title)
  }, [renameDraft, runs, onRenameRun])

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  const subtitle = (() => {
    if (activeFacet) {
      const where = activeFacet.isDirect ? `your DM with ${activeFacet.label}` : activeFacet.label
      const org = activeFacet.orgName ? ` (${activeFacet.orgName})` : ''
      return `${plural(activeFacet.count, 'thread', 'threads')} where Rowboat was mentioned in ${where}${org}, newest first.`
    }
    if (showMentions) {
      return `${plural(threadRuns.length, 'thread', 'threads')} where Rowboat was mentioned across your spaces, newest first.`
    }
    if (chatRuns.length === 0) return 'Every conversation you have with the assistant shows up here.'
    return `${plural(chatRuns.length, 'conversation', 'conversations')} with the assistant, newest first.`
  })()

  const emptyMessage = activeFacet
    ? 'No threads in this space yet.'
    : hasThreads && !showMentions
      ? 'No assistant chats yet. The Space chats tab lists the conversations Rowboat had inside your spaces.'
      : 'No chats yet.'

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#f8f8f9] dark:bg-[#0b0b0d]">
      <div className="mx-auto w-full max-w-[1120px] shrink-0 px-[30px] pt-[34px] pb-5">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-[24px] font-[650] tracking-[-0.02em] text-[#0d0e11] dark:text-[#f4f5f7]">Chat history</h1>
          <div className="flex items-center gap-2">
            {hasThreads && <HistoryTabs value={showMentions ? 'mentions' : 'chats'} mentionCount={threadRuns.length} onChange={changeTab} />}
            {hasThreads && <span className="mx-1 h-5 w-px bg-border/70" aria-hidden="true" />}
            {onOpenSearch && (
              <button
                type="button"
                onClick={onOpenSearch}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
              >
                <SearchIcon className="size-4" />
                <span>Search</span>
              </button>
            )}
            {onNewChat && (
              <Button size="sm" onClick={onNewChat}>
                <SquarePen className="size-4" />
                New chat
              </Button>
            )}
          </div>
        </div>
        <p className="mt-1 text-[14px] text-black/50 dark:text-white/[0.52]">{subtitle}</p>

        {showMentions && facets.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by space">
            <button
              type="button"
              onClick={() => setSpaceFilter(null)}
              aria-pressed={effectiveFilter === null}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors',
                effectiveFilter === null
                  ? 'border-foreground/80 bg-foreground text-background'
                  : 'border-border/70 bg-background text-foreground hover:bg-accent',
              )}
            >
              All spaces
            </button>
            <span className="mx-1 h-4 w-px bg-border/70" aria-hidden="true" />
            {facets.map((facet) => (
              <FacetChip
                key={facet.key}
                facet={facet}
                selected={effectiveFilter === facet.key}
                onClick={() => setSpaceFilter((prev) => (prev === facet.key ? null : facet.key))}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1120px] px-[30px] pb-12">
          {visibleRuns.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
              {emptyMessage}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
              <div className="flex items-center border-b border-border/60 bg-muted/30 px-4 py-3 text-[13px] text-muted-foreground">
                <div className="min-w-0 flex-1">{showMentions ? 'Thread' : 'Conversation'}</div>
                <div className="w-28 shrink-0 text-right">Last modified</div>
                <div className="w-7 shrink-0" />
              </div>

              {visibleRuns.map((run) => {
                const isActive = currentRunId === run.id
                const isProcessing = processingRunIds?.has(run.id)
                const threadOrigin = run.origin?.kind === 'space_thread' ? run.origin : null
                const facet = threadOrigin ? facetByKey.get(spaceKey(threadOrigin)) ?? null : null
                const openThread = threadOrigin && onOpenSpaceThread
                  ? () => onOpenSpaceThread(threadOrigin)
                  : null
                return (
                  <ContextMenu key={run.id}>
                    <ContextMenuTrigger asChild>
                      <div
                        className={cn(
                          'group relative border-b border-border/50 transition-colors last:border-b-0 hover:bg-muted/20',
                          isActive && 'bg-muted/30',
                        )}
                      >
                        {renamingId === run.id ? (
                          <div className="flex items-center px-4 py-1.5">
                            <input
                              autoFocus
                              value={renameDraft}
                              onChange={(e) => setRenameDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  commitRename(run.id)
                                } else if (e.key === 'Escape') {
                                  e.preventDefault()
                                  setRenamingId(null)
                                }
                              }}
                              onBlur={() => commitRename(run.id)}
                              className="h-7 min-w-0 flex-1 rounded-md border border-transparent bg-[var(--rowboat-wash)] px-2 text-sm outline-none focus:border-border focus:ring-1 focus:ring-ring"
                            />
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={(e) => {
                                if (e.metaKey && onOpenInNewTab) {
                                  onOpenInNewTab(run.id)
                                } else {
                                  onSelectRun(run.id)
                                }
                              }}
                              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm"
                            >
                              <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                                {run.title || (threadOrigin ? '(Untitled thread)' : '(Untitled chat)')}
                              </span>
                              {projects.find((p) => p.chats.some((chat) => chat.id === run.id)) && <span className="rounded bg-accent px-2 py-0.5 text-xs text-muted-foreground">{projects.find((p) => p.chats.some((chat) => chat.id === run.id))?.name}</span>}
                              {facet && <SpaceChip facet={facet} />}
                              <span className="w-28 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                                {formatRelativeTime(run.modifiedAt)}
                              </span>
                              <span className="w-7 shrink-0" />
                            </button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  aria-label="Chat options"
                                  onClick={(e) => e.stopPropagation()}
                                  className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 data-[state=open]:opacity-100"
                                >
                                  <MoreVertical className="size-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-52">
                                {openThread && (
                                  <DropdownMenuItem onClick={openThread}>
                                    <MessagesSquare className="mr-2 size-4" />
                                    Open thread in space
                                  </DropdownMenuItem>
                                )}
                                {onOpenInNewTab && (
                                  <DropdownMenuItem onClick={() => onOpenInNewTab(run.id)}>
                                    <ExternalLink className="mr-2 size-4" />
                                    Open in new tab
                                  </DropdownMenuItem>
                                )}
                                {(openThread || onOpenInNewTab) && <DropdownMenuSeparator />}
                                {onRenameRun && (
                                  <DropdownMenuItem onClick={() => startRename(run)}>
                                    <Pencil className="mr-2 size-4" />
                                    Rename
                                  </DropdownMenuItem>
                                )}
                                {!isProcessing && (
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onClick={() => setPendingDeleteId(run.id)}
                                  >
                                    <Trash2 className="mr-2 size-4" />
                                    Delete
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </>
                        )}
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-52">
                      {openThread && (
                        <ContextMenuItem onClick={openThread}>
                          <MessagesSquare className="mr-2 size-4" />
                          Open thread in space
                        </ContextMenuItem>
                      )}
                      {onOpenInNewTab && (
                        <ContextMenuItem onClick={() => onOpenInNewTab(run.id)}>
                          <ExternalLink className="mr-2 size-4" />
                          Open in new tab
                        </ContextMenuItem>
                      )}
                      {(openThread || onOpenInNewTab) && <ContextMenuSeparator />}
                      {onRenameRun && (
                        <ContextMenuItem onClick={() => startRename(run)}>
                          <Pencil className="mr-2 size-4" />
                          Rename
                        </ContextMenuItem>
                      )}
                      {!isProcessing && (
                        <ContextMenuItem
                          variant="destructive"
                          onClick={() => setPendingDeleteId(run.id)}
                        >
                          <Trash2 className="mr-2 size-4" />
                          Delete
                        </ContextMenuItem>
                      )}
                    </ContextMenuContent>
                  </ContextMenu>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <Dialog open={!!pendingDeleteId} onOpenChange={(open) => { if (!open) setPendingDeleteId(null) }}>
        <DialogContent showCloseButton={false} className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete chat</DialogTitle>
            <DialogDescription>
              {runs.find((r) => r.id === pendingDeleteId)?.origin?.kind === 'space_thread'
                ? 'Are you sure you want to delete this thread’s conversation? The next @rowboat mention in the thread starts a fresh one.'
                : 'Are you sure you want to delete this chat?'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDeleteId(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleConfirmDelete()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
