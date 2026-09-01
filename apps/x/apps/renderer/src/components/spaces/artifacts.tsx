import { useState } from 'react'
import { Bot, ChevronDown, ChevronRight, FileText, Loader2, PanelRightClose } from 'lucide-react'
import type { spaces } from '@x/shared'
import { cn } from '@/lib/utils'
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { stripThreadRef, type ArtifactGroup } from '@/lib/spaces-conventions'
import { MemberText } from '@/components/spaces/member-text'
import { attributionLabel, formatFeedTime } from '@/lib/spaces-presentation'
import { toast } from '@/lib/toast'

// Files changed here — output only: the change-sets made from a topic, grouped
// by file with their version span. The rail holds the list + a diff preview;
// a one-line summary under the topic's opener is the stamp and the way in.

function FileTile() {
    return (
        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <FileText className="size-3.5" />
        </span>
    )
}

function versionLabel(g: ArtifactGroup): string {
    return g.fromVersion === 0 ? `new · v${g.toVersion}` : `v${g.fromVersion} → v${g.toVersion}`
}

export function FoldIntoFileButton({ entries, onPick, busy }: {
    entries: spaces.SpacesAssetEntry[]
    onPick: (path: string) => void
    busy?: boolean
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    disabled={busy}
                    className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border px-2 py-0.5 text-[11.5px] text-foreground/90 hover:bg-accent disabled:opacity-50"
                    title="Ask your Rowboat to fold this topic’s decision into a file"
                >
                    {busy ? <Loader2 className="size-3 animate-spin" /> : <Bot className="size-3" />} Fold into file… <ChevronDown className="size-3 text-muted-foreground" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
                <DropdownMenuLabel className="text-[13px] text-muted-foreground">Fold this topic into</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {entries.length === 0 && <DropdownMenuItem disabled>No files in this space yet</DropdownMenuItem>}
                {entries.map((e) => (
                    <DropdownMenuItem key={e.path} onClick={() => onPick(e.path)}>
                        <FileText className="size-3.5 mr-2 text-muted-foreground" /> <code className="text-xs">{e.path}</code>
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

/** "Files changed here": the files this topic changed, newest first. A row opens the file; diff opens the dialog. */
export function ArtifactsRail({ org, space, groups, memberNames, working, entries, onFold, folding, onOpenFile, onCollapse }: {
    org: OrgWithSpaces
    space: spaces.Space
    groups: ArtifactGroup[]
    memberNames: Map<string, string>
    working: boolean
    entries: spaces.SpacesAssetEntry[]
    onFold: (path: string) => void
    folding: boolean
    onOpenFile: (path: string) => void
    onCollapse: () => void
}) {
    const [diffView, setDiffView] = useState<{ title: string; unified: string } | null>(null)
    const [diffBusy, setDiffBusy] = useState<string | null>(null)

    const openDiff = async (g: ArtifactGroup) => {
        setDiffBusy(g.assetPath)
        try {
            const res = await window.ipc.invoke('spaces:diff', { orgId: org.id, spaceId: space.id, path: g.assetPath, from: g.fromVersion, to: g.toVersion })
            setDiffView({ title: `${g.assetPath} · ${versionLabel(g)}`, unified: res.unified })
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not load the diff', 'error')
        } finally {
            setDiffBusy(null)
        }
    }

    return (
        <aside className="w-80 shrink-0 flex flex-col min-h-0 border-l border-border">
            <div className="flex items-center gap-2 pl-3.5 pr-1.5 h-9 shrink-0 border-b border-border">
                <span className="whitespace-nowrap text-[13px] text-muted-foreground">Files changed here</span>
                <span className="text-xs text-muted-foreground">{groups.length === 0 ? 'none yet' : groups.length}</span>
                <span className="flex-1" />
                <FoldIntoFileButton entries={entries} onPick={onFold} busy={folding} />
                <button type="button" title="Hide" onClick={onCollapse} className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                    <PanelRightClose className="size-3.5" />
                </button>
            </div>
            <div className="flex flex-1 min-h-0 flex-col gap-1.5 overflow-y-auto px-2.5 pt-2.5 pb-2">
                {groups.length === 0 && !working && (
                    <div className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                        Nothing changed from this topic yet. Ask @rowboat to fold a decision into a file, or pick one above.
                    </div>
                )}
                {groups.map((g) => (
                    <div key={g.assetPath} className="group/row flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-2 hover:border-foreground/20">
                        <button type="button" onClick={() => onOpenFile(g.assetPath)} className="flex min-w-0 flex-1 items-center gap-2 text-left" title="Open the file">
                            <FileTile />
                            <div className="min-w-0 flex-1">
                                <div className="text-[12.5px]"><code className="text-xs">{g.assetPath}</code> <span className="text-muted-foreground">{versionLabel(g)}</span></div>
                                <div className="truncate text-[11px] text-muted-foreground">
                                    {attributionLabel(g.latest.attribution, memberNames)} · {formatFeedTime(g.latest.committedAt)}
                                    {g.latest.reason && stripThreadRef(g.latest.reason) ? <> · “<MemberText text={stripThreadRef(g.latest.reason)} />”</> : ''}
                                </div>
                            </div>
                        </button>
                        {g.fromVersion > 0 && (
                            <button
                                type="button"
                                title="What this topic changed"
                                onClick={() => void openDiff(g)}
                                className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                                {diffBusy === g.assetPath ? <Loader2 className="size-3 animate-spin" /> : 'diff'}
                            </button>
                        )}
                    </div>
                ))}
                {working && (
                    <div className="flex items-center gap-2 px-1 py-1 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> A Rowboat is working in this topic…</div>
                )}
            </div>
            <Dialog open={diffView !== null} onOpenChange={(open) => !open && setDiffView(null)}>
                <DialogContent className="max-w-3xl">
                    <DialogHeader><DialogTitle className="font-mono text-sm">{diffView?.title}</DialogTitle></DialogHeader>
                    <div className="max-h-[60vh] overflow-auto rounded border border-border">
                        <UnifiedDiff unified={diffView?.unified ?? ''} />
                    </div>
                </DialogContent>
            </Dialog>
        </aside>
    )
}

/** One-line stamp under a topic's opener: what it produced, and the way into the rail. */
export function ArtifactsSummary({ groups, working, railOpen, onToggleRail, entries, onFold, folding }: {
    groups: ArtifactGroup[]
    working: boolean
    railOpen: boolean
    onToggleRail: () => void
    entries: spaces.SpacesAssetEntry[]
    onFold: (path: string) => void
    folding: boolean
}) {
    return (
        <div className="mt-1.5 flex items-center gap-2 px-1">
            <button
                type="button"
                onClick={onToggleRail}
                title={railOpen ? 'Hide the files changed here' : 'Show the files changed here'}
                className="inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11.5px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
                <FileText className="size-3 shrink-0" />
                {groups.length === 0 ? (
                    <span>No files changed here yet</span>
                ) : (
                    <span className="truncate">
                        <span className="font-medium text-foreground/90">{groups.length} {groups.length === 1 ? 'file' : 'files'} changed here</span>
                        <span> · {groups.map((g) => g.assetPath).join(', ')}</span>
                    </span>
                )}
                {working && <Loader2 className="size-3 shrink-0 animate-spin" />}
                {railOpen ? <ChevronRight className="size-3 shrink-0 rotate-180" /> : <ChevronRight className="size-3 shrink-0" />}
            </button>
            {groups.length === 0 && <FoldIntoFileButton entries={entries} onPick={onFold} busy={folding} />}
        </div>
    )
}

export function UnifiedDiff({ unified }: { unified: string }) {
    const lines = unified.split('\n')
    return (
        <pre className="m-0 whitespace-pre-wrap break-words p-0 font-mono text-[11.5px] leading-relaxed">
            {lines.map((line, i) => {
                const kind = line.startsWith('+++') || line.startsWith('---') || line.startsWith('===') ? 'meta'
                    : line.startsWith('@@') ? 'hunk'
                    : line.startsWith('+') ? 'add'
                    : line.startsWith('-') ? 'del'
                    : 'ctx'
                return (
                    <div
                        key={i}
                        className={cn(
                            'px-2.5',
                            kind === 'meta' && 'text-muted-foreground/70',
                            kind === 'hunk' && 'bg-muted/60 text-muted-foreground',
                            kind === 'add' && 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
                            kind === 'del' && 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300',
                            kind === 'ctx' && 'text-foreground/80',
                        )}
                    >
                        {line || ' '}
                    </div>
                )
            })}
        </pre>
    )
}
