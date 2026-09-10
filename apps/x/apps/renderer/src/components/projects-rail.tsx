import { useEffect, useRef, useState } from 'react'
import { ChevronRight, CornerDownRight, File, FilePlus, Folder, FolderOpen, FolderPlus, Loader2, MoreHorizontal, PanelLeftClose, Pin, Plus, Presentation, Upload } from 'lucide-react'
import { SecondaryRail } from './secondary-rail'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog'
import { Input } from './ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu'
import { useProjects, type Project } from '@/hooks/use-projects'
import { useSessionTitle } from '@/lib/session-title'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'

type TreeNode = { path: string; name: string; kind: 'file' | 'dir'; children?: TreeNode[] }
type Actions = {
    remove: (path: string) => Promise<void>
    copyPath: (path: string) => void
    revealInFileManager: (path: string, isDir: boolean) => void
    createNote: (path?: string) => void
    createPresentation: (path?: string) => void
    addGoogleDoc: (path?: string) => void
    createFolder: (path?: string) => Promise<string>
}
function ChatRow({ chat, selected, onOpen, working }: { working: boolean; chat: Project['chats'][number]; selected: boolean; onOpen: () => void }) {
    const title = useSessionTitle(chat.id)
    return <button onClick={onOpen} title={title ?? chat.title ?? 'New chat'} aria-current={selected ? 'page' : undefined}
        className={cn('flex h-8 w-full items-center gap-2 rounded pl-7 pr-2 text-left text-[13px]', selected ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50')}>
        {working ? <Loader2 className="size-3.5 shrink-0 animate-spin" aria-label="Working" /> : <CornerDownRight className="size-3.5 shrink-0" />}
        <span className="truncate">{title ?? chat.title ?? 'New chat'}</span>
    </button>
}
export function ProjectsRail({ tree, selectedPath, selectedFile, selectedChat, processingRunIds, actions, onSelect, onOpenChat, onNewChat, onOpenFile, onCreateProject }: {
    processingRunIds: Set<string>
    tree: TreeNode[]; selectedPath: string | null; selectedFile: string | null; selectedChat: string | null
    actions: Actions; onSelect: (project: Project) => void; onOpenChat: (project: Project, id: string) => void
    onNewChat: (project: Project) => Promise<void>; onOpenFile: (path: string) => void; onCreateProject: (name: string) => Promise<string>
}) {
    const { projects, ready, error, refresh } = useProjects()
    const [open, setOpen] = useState(() => localStorage.getItem('projects:railOpen') !== 'false')
    const [expanded, setExpanded] = useState<Set<string>>(new Set())
    const [folders, setFolders] = useState<Set<string>>(new Set())
    const [filesCollapsed, setFilesCollapsed] = useState(false)
    const [projectsCollapsed, setProjectsCollapsed] = useState(false)
    const [split, setSplit] = useState(() => Number(localStorage.getItem('projects:railSplit')) || 55)
    const [dialog, setDialog] = useState<{ kind: 'project' | 'rename'; path?: string; name: string } | null>(null)
    const [busy, setBusy] = useState(false)
    const [dialogError, setDialogError] = useState('')
    const uploadRef = useRef<HTMLInputElement>(null)
    const uploadFolderRef = useRef<HTMLInputElement>(null)
    const uploadTarget = useRef<string | null>(null)
    const bodyRef = useRef<HTMLDivElement>(null)
    const dragCleanup = useRef<(() => void) | null>(null)
    useEffect(() => () => dragCleanup.current?.(), [])
    const project = projects.find((p) => selectedPath === p.path || selectedPath?.startsWith(`${p.path}/`))
    const selectedProjectId = project?.id
    useEffect(() => { if (selectedProjectId) setExpanded((prev) => new Set(prev).add(selectedProjectId)) }, [selectedProjectId])
    const find = (nodes: TreeNode[], target: string): TreeNode | undefined => {
        for (const node of nodes) {
            if (node.path === target) return node
            if (target.startsWith(`${node.path}/`)) { const found = find(node.children ?? [], target); if (found) return found }
        }
    }
    const run = async (fn: () => Promise<unknown>) => {
        try { await fn(); await refresh() } catch (e) { toast(e instanceof Error ? e.message : 'Project action failed', 'error') }
    }
    const upload = async (files: File[]) => {
        const target = uploadTarget.current ?? project?.path
        if (!target) return
        await run(async () => {
            for (const file of files) {
                const name = file.webkitRelativePath || file.name
                let destination = `${target}/${name}`
                let suffix = 1
                while ((await window.ipc.invoke('workspace:exists', { path: destination })).exists) {
                    const dot = name.lastIndexOf('.')
                    destination = `${target}/${dot > name.lastIndexOf('/') ? `${name.slice(0, dot)} (${suffix++})${name.slice(dot)}` : `${name} (${suffix++})`}`
                }
                const data = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader()
                    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
                    reader.onerror = () => reject(reader.error)
                    reader.readAsDataURL(file)
                })
                await window.ipc.invoke('workspace:writeFile', { path: destination, data, opts: { encoding: 'base64', mkdirp: true } })
            }
        })
    }
    const beginRename = (path: string, name: string) => { setDialogError(''); setDialog({ kind: 'rename', path, name }) }
    const submit = async () => {
        if (!dialog) return
        const name = dialog.name.trim()
        if (!name || /[/\\]/.test(name) || name === '.' || name === '..') { setDialogError('Enter a name without path separators.'); return }
        setBusy(true)
        try {
            if (dialog.kind === 'project') {
                const path = await onCreateProject(name)
                await refresh()
                // Discovery assigns the stable id before selection.
                const { projects: latest } = await window.ipc.invoke('projects:list', null)
                const created = latest.find((p) => p.path === path)
                if (created) onSelect(created)
            } else {
                const from = dialog.path!
                const to = `${from.slice(0, from.lastIndexOf('/'))}/${name}`
                if (from !== to) await window.ipc.invoke('workspace:rename', { from, to })
                await refresh()
                if (project?.path === from) onSelect({ ...project, path: to, name })
                else if (selectedFile === from) onOpenFile(to)
            }
            setDialog(null)
        } catch (e) { setDialogError(e instanceof Error ? e.message : 'Could not save') }
        finally { setBusy(false) }
    }
    const renderFiles = (nodes: TreeNode[], depth = 0): React.ReactNode => [...nodes].sort((a,b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1).map((node) => <div key={node.path}>
        <div className="group/file flex items-center rounded hover:bg-accent/50">
            <button className={cn('flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded pr-1 text-left text-[13px]', selectedFile === node.path && 'bg-accent')} style={{ paddingLeft: 8 + depth * 12 }}
                onClick={() => node.kind === 'file' ? onOpenFile(node.path) : setFolders((prev) => { const next = new Set(prev); if (next.has(node.path)) next.delete(node.path); else next.add(node.path); return next })}>
                {node.kind === 'dir' ? <ChevronRight className={cn('size-3 shrink-0', folders.has(node.path) && 'rotate-90')} /> : <File className="size-3.5 shrink-0 text-muted-foreground" />}
                <span className="truncate">{node.name}</span>
            </button>
            {fileMenu(node)}
        </div>
        {node.kind === 'dir' && folders.has(node.path) && renderFiles(node.children ?? [], depth + 1)}
    </div>)
    let menuChanged: (open: boolean) => void = () => {}
    const fileMenu = (node: TreeNode) => <DropdownMenu onOpenChange={(open) => menuChanged(open)}>
        <DropdownMenuTrigger asChild><button aria-label={`Actions for ${node.name}`} className="mr-1 rounded p-1 text-muted-foreground opacity-0 group-hover/file:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"><MoreHorizontal className="size-3.5" /></button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
            {node.kind === 'dir' && <><DropdownMenuItem onClick={() => actions.createNote(node.path)}>New note</DropdownMenuItem><DropdownMenuItem onClick={() => void run(() => actions.createFolder(node.path))}>New folder</DropdownMenuItem><DropdownMenuSeparator /></>}
            <DropdownMenuItem onClick={() => beginRename(node.path, node.name)}>Rename</DropdownMenuItem>
            <DropdownMenuItem onClick={() => actions.copyPath(node.path)}>Copy path</DropdownMenuItem>
            <DropdownMenuItem onClick={() => actions.revealInFileManager(node.path, node.kind === 'dir')}>Show in file manager</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void run(() => actions.remove(node.path))}>Move to trash</DropdownMenuItem>
        </DropdownMenuContent>
    </DropdownMenu>
    return <>
        <SecondaryRail open={open} onTogglePin={() => setOpen((prev) => { localStorage.setItem('projects:railOpen', String(!prev)); return !prev })} widthStorageKey="projects:railWidth"
            persistent={<><input ref={uploadRef} hidden type="file" multiple onChange={(e) => { void upload(Array.from(e.target.files ?? [])); e.target.value = '' }} /><input ref={uploadFolderRef} hidden type="file" multiple {...{ webkitdirectory: '' }} onChange={(e) => { void upload(Array.from(e.target.files ?? [])); e.target.value = '' }} /></>}>
            {({ togglePin, onMenuOpenChange }) => {
                menuChanged = onMenuOpenChange
                return <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col pt-2">
                    <div className="flex h-9 shrink-0 items-center px-3">
                        <span className="flex-1 text-sm font-semibold">Projects</span>
                        <button title={open ? 'Collapse project rail' : 'Pin project rail'} aria-label={open ? 'Collapse project rail' : 'Pin project rail'} onClick={togglePin} className="rounded p-1 text-muted-foreground hover:bg-accent">{open ? <PanelLeftClose className="size-4" /> : <Pin className="size-4" />}</button>
                    </div>
                    <section className="flex min-h-0 flex-col" style={{ flex: projectsCollapsed ? '0 0 auto' : filesCollapsed ? '1 1 0' : `0 0 ${split}%` }}>
                        <div className="flex h-8 shrink-0 items-center px-3"><button onClick={() => setProjectsCollapsed(!projectsCollapsed)} className="flex-1 text-left text-[13px] font-semibold text-muted-foreground">Projects</button><button aria-label="New project" onClick={() => { setDialogError(''); setDialog({ kind: 'project', name: '' }) }} className="rounded p-1 hover:bg-accent"><Plus className="size-3.5" /></button></div>
                        {!projectsCollapsed && <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                            {!ready && <Loader2 className="m-3 size-4 animate-spin" />}
                            {error && <button className="p-2 text-xs text-destructive" onClick={() => void refresh()}>{error} · Retry</button>}
                            {ready && !error && projects.length === 0 && <p className="p-2 text-xs text-muted-foreground">Create a project to organize chats and local files.</p>}
                            {projects.map((item) => <div key={item.id}>
                                <div className={cn('group/file flex h-8 items-center rounded', project?.id === item.id ? 'bg-accent/60' : 'hover:bg-accent/50')}>
                                    <button aria-label={`${expanded.has(item.id) ? 'Collapse' : 'Expand'} ${item.name}`} aria-expanded={expanded.has(item.id)} className="p-1" onClick={() => setExpanded((prev) => { const next = new Set(prev); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next })}><ChevronRight className={cn('size-3', expanded.has(item.id) && 'rotate-90')} /></button>
                                    <button title={item.name} onClick={() => onSelect(item)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px]"><Folder className="size-3.5 shrink-0 text-muted-foreground" /><span className="truncate">{item.name}</span></button>
                                    <button aria-label={`New chat in ${item.name}`} title="New chat" className="rounded p-1 hover:bg-accent" onClick={() => void run(() => onNewChat(item))}><Plus className="size-3.5" /></button>
                                    {fileMenu({ ...item, kind: 'dir' })}
                                </div>
                                {expanded.has(item.id) && <div>{item.chats.map((chat) => <ChatRow key={chat.id} working={processingRunIds.has(chat.id)} chat={chat} selected={selectedChat === chat.id && project?.id === item.id} onOpen={() => onOpenChat(item, chat.id)} />)}{item.chats.length === 0 && <button className="h-8 pl-7 text-xs text-muted-foreground hover:text-foreground" onClick={() => void run(() => onNewChat(item))}>Start a chat with Rowboat</button>}</div>}
                            </div>)}
                        </div>}
                    </section>
                    <div className="h-1.5 shrink-0 cursor-row-resize border-t border-border hover:bg-primary/20" title="Drag to resize" onMouseDown={(e) => {
                        if (filesCollapsed || projectsCollapsed) return
                        e.preventDefault()
                        const rect = bodyRef.current?.getBoundingClientRect()
                        if (!rect) return
                        const move = (ev: MouseEvent) => { const value = Math.min(80, Math.max(20, (ev.clientY - rect.top - 36) / rect.height * 100)); setSplit(value); localStorage.setItem('projects:railSplit', String(value)) }
                        const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); dragCleanup.current = null }
                        dragCleanup.current?.()
                        dragCleanup.current = up
                        window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
                    }} />
                    <section className="flex min-h-0 flex-col" style={{ flex: filesCollapsed ? '0 0 auto' : '1 1 0' }} onDragOver={(e) => { if (project && Array.from(e.dataTransfer.types).includes('Files')) { e.preventDefault(); e.stopPropagation() } }} onDrop={(e) => { if (project && e.dataTransfer.files.length) { e.preventDefault(); e.stopPropagation(); uploadTarget.current = project.path; void upload(Array.from(e.dataTransfer.files)) } }}>
                        <div className="flex h-8 shrink-0 items-center px-3"><button onClick={() => setFilesCollapsed(!filesCollapsed)} className="flex-1 text-left text-[13px] font-semibold text-muted-foreground">Files</button>
                            {project && <DropdownMenu onOpenChange={onMenuOpenChange}><DropdownMenuTrigger asChild><button aria-label="Add to project files" className="rounded p-1 hover:bg-accent"><Plus className="size-3.5" /></button></DropdownMenuTrigger><DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => actions.createNote(project.path)}><FilePlus className="mr-2 size-3.5" />New note</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => void run(() => actions.createFolder(project.path))}><FolderPlus className="mr-2 size-3.5" />New folder</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => actions.createPresentation(project.path)}><Presentation className="mr-2 size-3.5" />New presentation</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => actions.addGoogleDoc(project.path)}>Add Google Doc</DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => { uploadTarget.current = project.path; uploadRef.current?.click() }}><Upload className="mr-2 size-3.5" />Add files…</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => { uploadTarget.current = project.path; uploadFolderRef.current?.click() }}><FolderPlus className="mr-2 size-3.5" />Add folder…</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => actions.revealInFileManager(project.path, true)}><FolderOpen className="mr-2 size-3.5" />Open local folder</DropdownMenuItem>
                            </DropdownMenuContent></DropdownMenu>}
                        </div>
                        {!filesCollapsed && <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">{project ? renderFiles(find(tree, project.path)?.children ?? []) : <p className="p-2 text-xs text-muted-foreground">Select a project to see its files.</p>}</div>}
                    </section>
                </div>
            }}
        </SecondaryRail>
        <Dialog open={!!dialog} onOpenChange={(value) => { if (!value && !busy) setDialog(null) }}><DialogContent><DialogHeader><DialogTitle>{dialog?.kind === 'project' ? 'New project' : 'Rename'}</DialogTitle></DialogHeader><form onSubmit={(e) => { e.preventDefault(); void submit() }}><Input autoFocus aria-label="Name" value={dialog?.name ?? ''} onChange={(e) => setDialog((prev) => prev ? { ...prev, name: e.target.value } : prev)} />{dialogError && <p role="alert" className="mt-2 text-sm text-destructive">{dialogError}</p>}<DialogFooter className="mt-4"><Button type="button" variant="outline" disabled={busy} onClick={() => setDialog(null)}>Cancel</Button><Button disabled={busy} type="submit">{busy ? 'Saving…' : 'Save'}</Button></DialogFooter></form></DialogContent></Dialog>
    </>
}
