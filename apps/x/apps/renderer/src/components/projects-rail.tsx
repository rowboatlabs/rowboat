import { useEffect, useRef, useState } from 'react'
import { ChevronsDownUp, ChevronsUpDown, ChevronRight, CornerDownRight, File, FilePlus, Folder, FolderOpen, FolderPlus, Loader2, MoreHorizontal, Plus, Presentation, Upload } from 'lucide-react'
import { FileListContextMenu } from './file-list-context-menu'
import { SecondaryRail } from './secondary-rail'
import { SecondaryRailToggle } from './secondary-rail-toggle'
import { SecondaryRailDivider, SecondaryRailSectionHeader } from './secondary-rail-section'
import { useSecondaryRailSections } from '@/hooks/use-secondary-rail-sections'
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
    const [open, setOpen] = useState(true)
    // Track exceptions so projects discovered asynchronously also start expanded.
    const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set())
    const expanded = new Set(projects.filter(item => !collapsedProjects.has(item.id)).map(item => item.id))
    const [folders, setFolders] = useState<Set<string>>(new Set())
    const {
        bodyRef, bottomRef: filesRef, topStyle: projectsStyle, bottomStyle: filesStyle,
        topCollapsed: projectsCollapsed, bottomCollapsed: filesCollapsed,
        toggleTop: toggleProjects, toggleBottom: toggleFiles, resizing, dividerProps,
    } = useSecondaryRailSections({ collapsedKey: 'projects:railCollapsed', heightKey: 'projects:filesHeight', topKey: 'projects' })
    const [dialog, setDialog] = useState<{ kind: 'project' | 'rename'; path?: string; name: string } | null>(null)
    const [busy, setBusy] = useState(false)
    const [dialogError, setDialogError] = useState('')
    const uploadRef = useRef<HTMLInputElement>(null)
    const uploadFolderRef = useRef<HTMLInputElement>(null)
    const uploadTarget = useRef<string | null>(null)
    const project = projects.find((p) => selectedPath === p.path || selectedPath?.startsWith(`${p.path}/`))
    const selectedProjectId = project?.id
    useEffect(() => { if (selectedProjectId) setCollapsedProjects((prev) => { const next = new Set(prev); next.delete(selectedProjectId); return next }) }, [selectedProjectId])
    const find = (nodes: TreeNode[], target: string): TreeNode | undefined => {
        for (const node of nodes) {
            if (node.path === target) return node
            if (target.startsWith(`${node.path}/`)) { const found = find(node.children ?? [], target); if (found) return found }
        }
    }
    const projectFiles = project ? (find(tree, project.path)?.children ?? []).filter(node => !project.isDefault || !projects.some(item => !item.isDefault && item.path === node.path)) : []
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
        <SecondaryRail open={open} onTogglePin={() => setOpen(value => !value)} widthStorageKey="projects:railWidth"
            persistent={<><input ref={uploadRef} hidden type="file" multiple onChange={(e) => { void upload(Array.from(e.target.files ?? [])); e.target.value = '' }} /><input ref={uploadFolderRef} hidden type="file" multiple {...{ webkitdirectory: '' }} onChange={(e) => { void upload(Array.from(e.target.files ?? [])); e.target.value = '' }} /></>}>
            {({ togglePin, onMenuOpenChange }) => {
                menuChanged = onMenuOpenChange
                return <div ref={bodyRef} className={cn('flex h-full min-h-0 flex-col', resizing && 'select-none')}>
                    <div className="flex shrink-0 items-center gap-0.5 px-2 py-1">
                        <span className="min-w-0 flex-1 px-1 text-[13px] font-semibold text-muted-foreground">Assistant</span>
                        <SecondaryRailToggle open={open} onToggle={togglePin} />
                    </div>
                    <section className="group/section flex min-h-0 flex-col" style={projectsStyle}>
                        <SecondaryRailSectionHeader label="Projects" collapsed={projectsCollapsed} count={projects.length} onToggle={toggleProjects}>
                            <button
                                type="button"
                                aria-label={expanded.size > 0 ? 'Collapse all project chats' : 'Expand all project chats'}
                                title={expanded.size > 0 ? 'Collapse all project chats' : 'Expand all project chats'}
                                onClick={() => {
                                    if (expanded.size > 0) setCollapsedProjects(new Set(projects.map(item => item.id)))
                                    else { setCollapsedProjects(new Set()); if (projectsCollapsed) toggleProjects() }
                                }}
                                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                                {expanded.size > 0 ? <ChevronsDownUp className="size-3.5" /> : <ChevronsUpDown className="size-3.5" />}
                            </button>
                            <button aria-label="New project" onClick={() => { setDialogError(''); setDialog({ kind: 'project', name: '' }) }} className="rounded p-1 hover:bg-accent"><Plus className="size-3.5" /></button></SecondaryRailSectionHeader>
                        {!projectsCollapsed && <FileListContextMenu onOpenChange={onMenuOpenChange} actions={[
                            { label: 'New project', onSelect: () => { setDialogError(''); setDialog({ kind: 'project', name: '' }) } },
                        ]}><div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                            {!ready && <Loader2 className="m-3 size-4 animate-spin" />}
                            {error && <button className="p-2 text-xs text-destructive" onClick={() => void refresh()}>{error} · Retry</button>}
                            {ready && !error && projects.length === 0 && <p className="p-2 text-xs text-muted-foreground">Create a project to organize chats and local files.</p>}
                            {projects.map((item) => <div key={item.id}>
                                <div className={cn('group/file flex h-8 items-center rounded', project?.id === item.id ? 'bg-accent/60' : 'hover:bg-accent/50')}>
                                    <button aria-label={`${expanded.has(item.id) ? 'Collapse' : 'Expand'} ${item.name}`} aria-expanded={expanded.has(item.id)} className="p-1" onClick={() => setCollapsedProjects((prev) => { const next = new Set(prev); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next })}><ChevronRight className={cn('size-3', expanded.has(item.id) && 'rotate-90')} /></button>
                                    <button title={item.name} onClick={() => onSelect(item)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px]"><Folder className="size-3.5 shrink-0 text-muted-foreground" /><span className="truncate">{item.name}</span></button>
                                    <button aria-label={`New chat in ${item.name}`} title="New chat" className="rounded p-1 hover:bg-accent" onClick={() => void run(() => onNewChat(item))}><Plus className="size-3.5" /></button>
                                    {!item.isDefault && fileMenu({ ...item, kind: 'dir' })}
                                </div>
                                {expanded.has(item.id) && <div>{item.chats.map((chat) => <ChatRow key={chat.id} working={processingRunIds.has(chat.id)} chat={chat} selected={selectedChat === chat.id && project?.id === item.id} onOpen={() => onOpenChat(item, chat.id)} />)}{item.chats.length === 0 && <button className="h-8 pl-7 text-xs text-muted-foreground hover:text-foreground" onClick={() => void run(() => onNewChat(item))}>Start a chat with Rowboat</button>}</div>}
                            </div>)}
                        </div></FileListContextMenu>}
                    </section>
                    <section ref={filesRef} className="group/section flex min-h-0 flex-col" style={filesStyle} onDragOver={(e) => { if (project && Array.from(e.dataTransfer.types).includes('Files')) { e.preventDefault(); e.stopPropagation() } }} onDrop={(e) => { if (project && e.dataTransfer.files.length) { e.preventDefault(); e.stopPropagation(); uploadTarget.current = project.path; void upload(Array.from(e.dataTransfer.files)) } }}>
                        <SecondaryRailDivider {...dividerProps} />
                        <SecondaryRailSectionHeader label="Files" collapsed={filesCollapsed} count={projectFiles.length} onToggle={toggleFiles}>
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
                        </SecondaryRailSectionHeader>
                        {!filesCollapsed && <FileListContextMenu onOpenChange={onMenuOpenChange} actions={project ? [
                            { label: 'New note', onSelect: () => actions.createNote(project.path) },
                            { label: 'New folder', onSelect: () => { void run(() => actions.createFolder(project.path)) } },
                            { label: 'New presentation', onSelect: () => actions.createPresentation(project.path) },
                            { label: 'Add Google Doc', onSelect: () => actions.addGoogleDoc(project.path) },
                            { label: 'Add files…', onSelect: () => { uploadTarget.current = project.path; uploadRef.current?.click() } },
                            { label: 'Add folder…', onSelect: () => { uploadTarget.current = project.path; uploadFolderRef.current?.click() } },
                        ] : []}><div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">{project ? renderFiles(projectFiles) : <p className="p-2 text-xs text-muted-foreground">Select a project to see its files.</p>}</div></FileListContextMenu>}
                    </section>
                </div>
            }}
        </SecondaryRail>
        <Dialog open={!!dialog} onOpenChange={(value) => { if (!value && !busy) setDialog(null) }}><DialogContent><DialogHeader><DialogTitle>{dialog?.kind === 'project' ? 'New project' : 'Rename'}</DialogTitle></DialogHeader><form onSubmit={(e) => { e.preventDefault(); void submit() }}><Input autoFocus aria-label="Name" value={dialog?.name ?? ''} onChange={(e) => setDialog((prev) => prev ? { ...prev, name: e.target.value } : prev)} />{dialogError && <p role="alert" className="mt-2 text-sm text-destructive">{dialogError}</p>}<DialogFooter className="mt-4"><Button type="button" variant="outline" disabled={busy} onClick={() => setDialog(null)}>Cancel</Button><Button disabled={busy} type="submit">{busy ? 'Saving…' : 'Save'}</Button></DialogFooter></form></DialogContent></Dialog>
    </>
}
