import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Streamdown } from 'streamdown'
import { ArrowLeft, Check, ChevronRight, Clock, History, Loader2, Pencil, Plus, X } from 'lucide-react'
import type { spaces } from '@x/shared'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { RichMarkdownViewer } from '@/components/rich-markdown-viewer'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { MemberText } from '@/components/spaces/member-text'
import { attributionLabel, buildFileTree, formatFeedTime, type FileTreeNode } from '@/lib/spaces-presentation'
import { toast } from '@/lib/toast'
import { MemberAvatar } from '@/components/spaces/atoms'

// Files: the tree (README first) and the file column — rendered file
// with one-tap checkboxes, Edit → draft→apply (merged / conflict handled),
// History with diffs. Unchanged behaviour from the design pass.

// ---------------------------------------------------------------------------
// Files rail — the space's tree, README first, unread dots on moved files
// ---------------------------------------------------------------------------

/** The space's file tree (README first, folders collapsible) — rendered inside the space rail. */
export function FileTree({ entries, selectedPath, unreadPaths, onOpenFile, creating, onCreateFile, onCancelCreate }: {
    entries: spaces.SpacesAssetEntry[]
    selectedPath: string | null
    /** Files with a change by someone else (or an agent) since the read mark. */
    unreadPaths: ReadonlySet<string>
    onOpenFile: (path: string) => void
    /** When true, shows the new-file input at the bottom of the tree. */
    creating: boolean
    onCreateFile: (path: string) => void
    onCancelCreate: () => void
}) {
    const tree = useMemo(() => buildFileTree(entries), [entries])
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
    const [newPath, setNewPath] = useState('')

    const toggle = (path: string) =>
        setCollapsed((prev) => {
            const next = new Set(prev)
            if (next.has(path)) next.delete(path)
            else next.add(path)
            return next
        })

    const renderNode = (node: FileTreeNode, depth: number): ReactNode => {
        const pad = { paddingLeft: `${8 + depth * 12}px` }
        if (node.kind === 'dir') {
            const open = !collapsed.has(node.path)
            return (
                <div key={node.path}>
                    <button
                        type="button"
                        style={pad}
                        onClick={() => toggle(node.path)}
                        className="flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-[13px] text-foreground/90 hover:bg-accent/50"
                    >
                        <ChevronRight className={cn('size-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
                        <span className="truncate">{node.name}</span>
                    </button>
                    {open && node.children.map((child) => renderNode(child, depth + 1))}
                </div>
            )
        }
        const active = node.path === selectedPath
        const unread = unreadPaths.has(node.path)
        return (
            <button
                key={node.path}
                type="button"
                style={pad}
                onClick={() => onOpenFile(node.path)}
                className={cn(
                    'flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-[13px] text-left',
                    active ? 'bg-accent font-medium text-foreground' : 'text-foreground/90 hover:bg-accent/50',
                )}
            >
                <span className="w-3 shrink-0" />
                <span className="truncate flex-1">{node.name}</span>
                {unread && !active && <span className="size-1.5 rounded-full bg-foreground shrink-0" aria-label="updated since you last read" />}
            </button>
        )
    }

    return (
        <div className="flex flex-col">
            {tree.map((node) => renderNode(node, 0))}
            {tree.length === 0 && !creating && <div className="px-2 py-1 text-xs text-muted-foreground">No files yet.</div>}
            {creating && (
                <div className="flex items-center gap-1 px-1 pt-1">
                    <Input
                        autoFocus
                        value={newPath}
                        placeholder="path/to/file.md"
                        className="h-7 text-xs"
                        onChange={(e) => setNewPath(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && newPath.trim()) {
                                onCreateFile(newPath.trim())
                                setNewPath('')
                            }
                            if (e.key === 'Escape') onCancelCreate()
                        }}
                    />
                    <Button size="icon" variant="ghost" className="size-7" onClick={onCancelCreate}>
                        <X className="size-3.5" />
                    </Button>
                </div>
            )}
        </div>
    )
}

// ---------------------------------------------------------------------------
// File column: meta line + rendered file; Edit → draft→apply (the novel
// interaction): a draft is explicit, applying is deliberate, a stale base that
// merges shows a notice, a conflict blocks nothing and loses nothing.
// ---------------------------------------------------------------------------

interface DraftState {
    baseVersion: number
    text: string
    reason: string
    conflict: Extract<spaces.ProposeChangeResult, { outcome: 'conflict' }> | null
}

export function FileColumn({ org, space, path, memberNames, refreshTick, onChanged, crumb }: {
    org: OrgWithSpaces
    space: spaces.Space
    path: string
    memberNames: Map<string, string>
    refreshTick: number
    onChanged: () => void
    /** Where the reader came from (a topic) — renders "← <label>" and makes Esc go back there. */
    crumb?: { label: string; onBack: () => void } | null
}) {
    const [asset, setAsset] = useState<spaces.ReadAssetResult | null>(null)
    const [missing, setMissing] = useState(false)
    const [draft, setDraft] = useState<DraftState | null>(null)
    const [applying, setApplying] = useState(false)
    const [historyOpen, setHistoryOpen] = useState(false)
    const [diffView, setDiffView] = useState<{ title: string; unified: string } | null>(null)

    const load = useCallback(async () => {
        try {
            const res = await window.ipc.invoke('spaces:readAsset', { orgId: org.id, spaceId: space.id, path })
            setAsset(res)
            setMissing(false)
        } catch {
            setAsset(null)
            setMissing(true)
        }
    }, [org.id, space.id, path])

    useEffect(() => {
        void load()
    }, [load, refreshTick])

    // Esc returns to the topic this file was opened from (only when not editing).
    const crumbBack = crumb?.onBack
    const editing = draft !== null
    useEffect(() => {
        if (!crumbBack || editing) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return
            const target = e.target as HTMLElement | null
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
            e.preventDefault()
            crumbBack()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [crumbBack, editing])

    const beginEdit = () => {
        setDraft({ baseVersion: asset?.version ?? 0, text: asset?.content ?? '', reason: '', conflict: null })
    }

    const apply = async () => {
        if (!draft) return
        setApplying(true)
        try {
            const result = await window.ipc.invoke('spaces:proposeChange', {
                orgId: org.id,
                spaceId: space.id,
                input: {
                    assetPath: path,
                    baseVersion: draft.baseVersion,
                    newContent: draft.text,
                    ...(draft.reason.trim() ? { reason: draft.reason.trim() } : {}),
                },
            })
            if (result.outcome === 'applied') {
                toast(`Applied — now v${result.version}`, 'success')
                setDraft(null)
                await load()
                onChanged()
            } else if (result.outcome === 'merged') {
                // The base moved while drafting but the merge was clean: what
                // now exists is mergedContent, not the draft (contract rule).
                toast(`Applied with concurrent changes folded in — now v${result.version}`, 'success')
                setDraft(null)
                await load()
                onChanged()
            } else {
                setDraft({ ...draft, conflict: result })
            }
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not apply', 'error')
        } finally {
            setApplying(false)
        }
    }

    const showDiff = async (from: number, to: number) => {
        try {
            const res = await window.ipc.invoke('spaces:diff', { orgId: org.id, spaceId: space.id, path, from, to })
            setDiffView({ title: `${path} · v${from} → v${to}`, unified: res.unified })
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not load the diff', 'error')
        }
    }

    // One-tap micro change-set: checkbox ticks in view mode apply directly.
    const toggleCheckbox = async (lineIndex: number) => {
        if (!asset) return
        const lines = asset.content.split('\n')
        const line = lines[lineIndex]
        if (line === undefined) return
        if (/\[ \]/.test(line)) lines[lineIndex] = line.replace('[ ]', '[x]')
        else if (/\[[xX]\]/.test(line)) lines[lineIndex] = line.replace(/\[[xX]\]/, '[ ]')
        else return
        try {
            const result = await window.ipc.invoke('spaces:proposeChange', {
                orgId: org.id,
                spaceId: space.id,
                input: { assetPath: path, baseVersion: asset.version, newContent: lines.join('\n') },
            })
            if (result.outcome === 'conflict') toast('Someone changed this line at the same time — refresh and retry', 'error')
            else {
                await load()
                onChanged()
            }
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not apply', 'error')
        }
    }

    const last = asset?.recentHistory[0]
    const fileName = path.split('/').pop() ?? path

    if (missing && !draft) {
        return (
            <section className="flex-1 min-w-0 flex flex-col">
                <div className="p-8 text-sm text-muted-foreground">
                    <p className="mb-3"><code className="font-mono text-xs">{path}</code> doesn&apos;t exist yet.</p>
                    <Button size="sm" onClick={beginEdit}><Plus className="size-3.5 mr-1" /> Create it</Button>
                </div>
            </section>
        )
    }

    return (
        <section className="flex-1 min-w-0 min-h-0 flex flex-col border-r border-border">
            <div className="flex items-center gap-2 px-5 h-9 shrink-0 text-xs text-muted-foreground">
                {crumb && (
                    <button
                        type="button"
                        onClick={crumb.onBack}
                        title="Back to the topic (Esc)"
                        className="inline-flex max-w-[16rem] shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-foreground/80 hover:bg-accent hover:text-foreground"
                    >
                        <ArrowLeft className="size-3 shrink-0" /> <span className="truncate">{crumb.label}</span>
                    </button>
                )}
                <code className="font-mono text-[11.5px] text-foreground/80 truncate" title={path}>{fileName}</code>
                {!draft && last && (
                    <span className="truncate">
                        · updated {formatFeedTime(last.committedAt)} by {attributionLabel(last.attribution, memberNames)}
                    </span>
                )}
                {!draft && asset && !last && <span>· v{asset.version}</span>}
                <div className="flex-1" />
                {!draft && asset && (
                    <>
                        <button type="button" className="hover:text-foreground flex items-center gap-1" onClick={beginEdit}>
                            <Pencil className="size-3" /> Edit
                        </button>
                        <button
                            type="button"
                            className={cn('hover:text-foreground flex items-center gap-1', historyOpen && 'text-foreground')}
                            onClick={() => setHistoryOpen((v) => !v)}
                        >
                            <History className="size-3" /> History
                        </button>
                    </>
                )}
                {draft && (
                    <>
                        <Input
                            value={draft.reason}
                            placeholder="Why? (optional — shows in history forever)"
                            className="h-6 text-xs w-72"
                            onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                        />
                        <Button size="sm" className="h-6 text-xs" disabled={applying} onClick={() => void apply()}>
                            {applying ? <Loader2 className="size-3 mr-1 animate-spin" /> : <Check className="size-3 mr-1" />}
                            Apply{draft.conflict ? ` against v${draft.conflict.currentVersion}` : ''}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setDraft(null)}>
                            <X className="size-3 mr-1" /> Discard
                        </Button>
                    </>
                )}
            </div>
            <div className="mx-5 border-t border-border" />
            {draft?.conflict && (
                <ConflictNotice
                    conflict={draft.conflict}
                    memberNames={memberNames}
                    onUseCurrent={() => {
                        setDraft({
                            baseVersion: draft.conflict!.currentVersion,
                            text: draft.conflict!.currentContent,
                            reason: draft.reason,
                            conflict: null,
                        })
                    }}
                    onRebase={() => setDraft({ ...draft, baseVersion: draft.conflict!.currentVersion })}
                />
            )}
            <div className="flex-1 min-h-0 flex">
                <div className="flex-1 min-w-0 min-h-0 overflow-y-auto">
                    {draft ? (
                        <Textarea
                            value={draft.text}
                            spellCheck={false}
                            className="w-full h-full min-h-full rounded-none border-0 font-mono text-sm resize-none focus-visible:ring-0 px-5 py-4"
                            onChange={(e) => setDraft({ ...draft, text: e.target.value, conflict: null })}
                        />
                    ) : asset ? (
                        <InteractiveMarkdown content={asset.content} onToggleCheckbox={(i) => void toggleCheckbox(i)} />
                    ) : (
                        <div className="p-5 text-sm text-muted-foreground">Loading…</div>
                    )}
                </div>
                {historyOpen && asset && !draft && (
                    <HistoryPanel
                        org={org}
                        space={space}
                        path={path}
                        memberNames={memberNames}
                        refreshTick={refreshTick}
                        onClose={() => setHistoryOpen(false)}
                        onShowDiff={(from, to) => void showDiff(from, to)}
                    />
                )}
            </div>
            <Dialog open={diffView !== null} onOpenChange={(open) => !open && setDiffView(null)}>
                <DialogContent className="max-w-3xl">
                    <DialogHeader>
                        <DialogTitle className="font-mono text-sm">{diffView?.title}</DialogTitle>
                    </DialogHeader>
                    <pre className="max-h-[60vh] overflow-auto text-xs bg-muted/50 rounded p-3 whitespace-pre-wrap">
                        {diffView?.unified}
                    </pre>
                </DialogContent>
            </Dialog>
        </section>
    )
}

function ConflictNotice({ conflict, memberNames, onUseCurrent, onRebase }: {
    conflict: Extract<spaces.ProposeChangeResult, { outcome: 'conflict' }>
    memberNames: Map<string, string>
    onUseCurrent: () => void
    onRebase: () => void
}) {
    const lastWriter = conflict.recentHistory[0]
    return (
        <div className="border-b border-border bg-muted/40 px-5 py-2 text-xs space-y-1">
            <div className="font-medium">
                Nothing was saved — {lastWriter ? attributionLabel(lastWriter.attribution, memberNames) : 'someone'} changed
                {' '}the same {conflict.regions.length === 1 ? 'region' : `${conflict.regions.length} regions`} while you were drafting (now v{conflict.currentVersion}).
            </div>
            {conflict.regions.map((region, i) => (
                <div key={i} className="pl-2 border-l-2 border-border">
                    <span className="text-muted-foreground">
                        lines {region.baseStart > region.baseEnd ? `at ${region.baseEnd}+` : `${region.baseStart}–${region.baseEnd}`}:
                    </span>
                    <span className="text-muted-foreground"> theirs </span>
                    <code>{region.current.join(' ⏎ ') || '(deleted)'}</code>
                    <span className="text-muted-foreground"> · yours </span>
                    <code>{region.proposed.join(' ⏎ ') || '(deleted)'}</code>
                </div>
            ))}
            <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" className="h-6 text-xs" onClick={onRebase}>
                    Keep my draft, I&apos;ve folded theirs in
                </Button>
                <Button size="sm" variant="outline" className="h-6 text-xs" onClick={onUseCurrent}>
                    Start over from v{conflict.currentVersion}
                </Button>
            </div>
        </div>
    )
}

function HistoryPanel({ org, space, path, memberNames, refreshTick, onClose, onShowDiff }: {
    org: OrgWithSpaces
    space: spaces.Space
    path: string
    memberNames: Map<string, string>
    refreshTick: number
    onClose: () => void
    onShowDiff: (from: number, to: number) => void
}) {
    const [changeSets, setChangeSets] = useState<spaces.ChangeSet[]>([])

    useEffect(() => {
        let cancelled = false
        void window.ipc
            .invoke('spaces:assetHistory', { orgId: org.id, spaceId: space.id, path, limit: 100 })
            .then((res) => {
                if (!cancelled) setChangeSets(res.changeSets)
            })
            .catch(() => {})
        return () => {
            cancelled = true
        }
    }, [org.id, space.id, path, refreshTick])

    return (
        <aside className="w-72 shrink-0 border-l border-border flex flex-col min-h-0">
            <div className="flex items-center justify-between pl-3 pr-1.5 h-9 shrink-0">
                <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    History
                </span>
                <Button variant="ghost" size="icon" className="size-6" onClick={onClose}><X className="size-3.5" /></Button>
            </div>
            <div className="flex-1 overflow-y-auto">
                {changeSets.map((cs) => (
                    <button
                        key={cs.id}
                        className="w-full text-left px-3 py-2 border-b border-border/50 hover:bg-accent/40"
                        onClick={() => onShowDiff(cs.baseVersion, cs.resultVersion)}
                    >
                        <div className="flex items-center gap-2">
                            <MemberAvatar id={cs.attribution.memberId} name={memberNames.get(cs.attribution.memberId) ?? cs.attribution.memberId} size="sm" />
                            <div className="text-xs font-medium truncate">{attributionLabel(cs.attribution, memberNames)}</div>
                        </div>
                        {cs.reason && <div className="text-xs text-muted-foreground mt-1 pl-7">&ldquo;<MemberText text={cs.reason} />&rdquo;</div>}
                        <div className="text-[10.5px] text-muted-foreground mt-1 pl-7 flex items-center gap-1">
                            <Clock className="size-2.5" /> {formatFeedTime(cs.committedAt)} · v{cs.resultVersion}
                        </div>
                    </button>
                ))}
                {changeSets.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">No history yet.</div>}
            </div>
        </aside>
    )
}

// ---------------------------------------------------------------------------
// Markdown view with one-tap checkboxes. RichMarkdownViewer renders read-only;
// checkbox lines get an interactive row instead.
// ---------------------------------------------------------------------------

function InteractiveMarkdown({ content, onToggleCheckbox }: {
    content: string
    onToggleCheckbox: (lineIndex: number) => void
}) {
    const lines = content.split('\n')
    const hasCheckboxes = lines.some((l) => /- \[[ xX]\]/.test(l))
    if (!hasCheckboxes) {
        return (
            <div className="px-5 py-4 max-w-2xl">
                <RichMarkdownViewer content={content} />
            </div>
        )
    }
    return (
        <div className="px-5 py-4 max-w-2xl space-y-0.5">
            {lines.map((line, i) => {
                const checkbox = line.match(/^(\s*)- \[([ xX])\] (.*)$/)
                if (checkbox) {
                    const checked = checkbox[2] !== ' '
                    return (
                        <div key={i} className="flex items-start gap-2 text-sm" style={{ paddingLeft: `${(checkbox[1]?.length ?? 0) * 8}px` }}>
                            <input
                                type="checkbox"
                                checked={checked}
                                className="mt-1 cursor-pointer"
                                onChange={() => onToggleCheckbox(i)}
                            />
                            <span className={checked ? 'line-through text-muted-foreground' : ''}>{checkbox[3]}</span>
                        </div>
                    )
                }
                return line.trim() === '' ? (
                    <div key={i} className="h-2" />
                ) : (
                    <div key={i} className="text-sm [&_p]:my-0">
                        <Streamdown>{line}</Streamdown>
                    </div>
                )
            })}
        </div>
    )
}

