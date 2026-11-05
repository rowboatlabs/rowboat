import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Folder, Loader2 } from 'lucide-react'
import { spaces } from '@x/shared'
import { arrayBufferToBase64 } from '@/lib/spaces-upload'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { fail } from './agent-hosting-state'
import { Empty, FormCard, Row, RowAction, Rows, ScreenHeader, Tag } from './agent-tabs'
import { toast } from '@/lib/toast'

type SortKey = 'name' | 'size' | 'modifiedAt'
const names = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const validName = (name: string) => name.length > 0 && name.length <= 255 && name.trim() === name && name !== '.' && name !== '..' && !/[\/\\\x00-\x1f\x7f]/.test(name)
function sizeLabel(size?: number) {
    if (size === undefined) return '—'
    if (size < 1000) return `${size} B`
    const unit = Math.min(Math.floor(Math.log(size) / Math.log(1000)), 3)
    return `${(size / 1000 ** unit).toFixed(1)} ${['B', 'KB', 'MB', 'GB'][unit]}`
}
function modified(entry: spaces.HostingFileEntry) {
    const value = Date.parse(entry.modifiedAt ?? '')
    return Number.isFinite(value) ? value : undefined
}

export function FilesScreen({ orgId, agentId, home, onDirtyChange }: { orgId: string; agentId: string; home: string; onDirtyChange?: (dirty: boolean) => void }) {
    const [query, setQuery] = useState('')
    const [sort, setSort] = useState<SortKey>('name')
    const [descending, setDescending] = useState(false)
    const [editingPath, setEditingPath] = useState(false)
    const [newFile, setNewFile] = useState<string | null>(null)
    const [createError, setCreateError] = useState<string | null>(null)
    const [pending, setPending] = useState<(() => void) | null>(null)
    const listingRequest = useRef(0)
    const currentPath = useRef(home)
    const [path, setPath] = useState(home)
    const [directoryDraft, setDirectoryDraft] = useState(home)
    const picker = useRef<HTMLInputElement>(null)
    const uploading = useRef(false)
    const [uploadStatus, setUploadStatus] = useState<string | null>(null)
    const [uploadErrors, setUploadErrors] = useState<string[]>([])
    const [entries, setEntries] = useState<spaces.HostingFileEntry[] | null>(null)
    const [open, setOpen] = useState<{ path: string; content: string; truncated: boolean } | null>(null)
    const [preview, setPreview] = useState<{ path: string; url: string; mime: string } | null>(null)
    const [fileError, setFileError] = useState<string | null>(null)
    const [dragging, setDragging] = useState(false)
    useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url) }, [preview])
    const [draft, setDraft] = useState('')
    const [busy, setBusy] = useState(false)
    const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null)
    const [folder, setFolder] = useState<string | null>(null)

    const dirty = open !== null && draft !== open.content
    useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false) }, [dirty, onDirtyChange])
    const guard = (action: () => void) => {
        if (dirty) setPending(() => action)
        else action()
    }
    useEffect(() => {
        if (!dirty) return
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
        window.addEventListener('beforeunload', warn)
        return () => window.removeEventListener('beforeunload', warn)
    }, [dirty])

    const list = useCallback(async (dir: string) => {
        const request = ++listingRequest.current
        setBusy(true)
        try {
            const page = await window.ipc.invoke('spaces:listHostingFiles', { orgId, agentId, path: dir })
            if (request !== listingRequest.current) return
            if (page.path !== currentPath.current) {
                setQuery('')
                setOpen(null)
                setPreview(null)
                setNewFile(null)
                setFolder(null)
                setRenaming(null)
            }
            currentPath.current = page.path
            setPath(page.path)
            setDirectoryDraft(page.path)
            setEntries(page.entries)
            setEditingPath(false)
            setFileError(null)
        } catch (err) {
            if (request === listingRequest.current) setFileError(err instanceof Error ? err.message : 'Could not list the files')
        } finally {
            if (request === listingRequest.current) setBusy(false)
        }
    }, [orgId, agentId])
    useEffect(() => {
        currentPath.current = home
        setEntries(null)
        setOpen(null)
        setPreview(null)
        setQuery('')
        void list(home)
        return () => { listingRequest.current++ }
    }, [list, home])
    const navigate = (dir: string) => guard(() => void list(dir))
    const visible = useMemo(() => (entries ?? []).filter(e => e.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a, b) => {
        if ((a.kind === 'dir') !== (b.kind === 'dir')) return a.kind === 'dir' ? -1 : 1
        const tie = names.compare(a.name, b.name) || a.name.localeCompare(b.name)
        if (sort === 'name') return (descending ? -1 : 1) * tie
        const av = sort === 'size' ? (a.kind === 'dir' ? undefined : a.size) : modified(a)
        const bv = sort === 'size' ? (b.kind === 'dir' ? undefined : b.size) : modified(b)
        if (av === undefined || bv === undefined) return av === bv ? tie : av === undefined ? 1 : -1
        return (descending ? -1 : 1) * (av - bv) || tie
    }), [entries, query, sort, descending])
    const sortBy = (key: SortKey) => {
        if (key === sort) setDescending(value => !value)
        else { setSort(key); setDescending(false) }
    }
    const segments = path.split('/').filter(Boolean)
    const createFile = async () => {
        if (newFile === null || !validName(newFile) || busy) return
        setCreateError(null)
        if (entries?.some(e => e.name === newFile)) { setCreateError('A file or folder with this name already exists.'); return }
        setBusy(true)
        try {
            const result = await window.ipc.invoke('spaces:createHostingFile', { orgId, agentId, directory: path, name: newFile })
            setQuery('')
            setNewFile(null)
            await list(path)
            setPreview(null)
            setOpen({ path: result.path, content: '', truncated: false })
            setDraft('')
            toast('File created', 'success')
        } catch (err) {
            setCreateError(err instanceof Error ? err.message : 'Could not create the file')
        } finally { setBusy(false) }
    }

    const upload = async (files: File[]) => {
        if (busy || uploading.current || !files.length) return
        uploading.current = true
        setBusy(true)
        setUploadErrors([])
        const destination = path
        const errors: string[] = []
        let count = 0
        for (const [index, file] of files.entries()) {
            setUploadStatus(`Uploading ${index + 1} of ${files.length}: ${file.name}`)
            try {
                if (file.size > spaces.MAX_HOSTING_UPLOAD_BYTES) throw new Error('Files must be 100 MB or smaller')
                const bytes = arrayBufferToBase64(await file.arrayBuffer())
                await window.ipc.invoke('spaces:uploadHostingFile', { orgId, agentId, directory: destination, name: file.name, bytes })
                count++
            } catch (err) {
                errors.push(`${file.name}: ${err instanceof Error ? err.message : 'Upload failed'}`)
            }
        }
        if (count) toast(`Uploaded ${count} ${count === 1 ? 'file' : 'files'}`, 'success')
        setUploadErrors(errors)
        await list(destination)
        setUploadStatus(null)
        uploading.current = false
        setBusy(false)
    }

    const fileBlob = async (file: string) => {
        const result = await window.ipc.invoke('spaces:downloadHostingFile', { orgId, agentId, path: file })
        const bytes = Uint8Array.from(atob(result.bytes), c => c.charCodeAt(0))
        return { blob: new Blob([bytes], { type: result.mime }), mime: result.mime }
    }
    const download = async (file: string) => {
        setBusy(true)
        setFileError(null)
        try {
            const { blob } = await fileBlob(file)
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = file.split('/').pop() || 'download'
            document.body.appendChild(link)
            link.click()
            link.remove()
            // Let the browser consume the URL before releasing it (2026-11-02).
            setTimeout(() => URL.revokeObjectURL(url), 1000)
        } catch (err) {
            setFileError(err instanceof Error ? err.message : 'Could not download the file')
        } finally { setBusy(false) }
    }
    const read = async (file: string) => {
        setBusy(true)
        setOpen(null)
        setPreview(null)
        setFileError(null)
        try {
            if (/\.(png|jpe?g|gif|webp|pdf)$/i.test(file)) {
                const { blob, mime } = await fileBlob(file)
                if (mime === 'application/octet-stream') throw new Error('Preview is unavailable for this file. Download it to open it on your computer.')
                setPreview({ path: file, mime, url: URL.createObjectURL(blob) })
                return
            }
            const got = await window.ipc.invoke('spaces:readHostingFile', { orgId, agentId, path: file })
            setOpen(got)
            setDraft(got.content)
        } catch (err) {
            setFileError(err instanceof Error ? err.message : 'Could not read the file')
        } finally {
            setBusy(false)
        }
    }
    const save = async () => {
        if (!open) return
        setBusy(true)
        try {
            await window.ipc.invoke('spaces:writeHostingFile', { orgId, agentId, path: open.path, content: draft })
            setOpen({ ...open, content: draft, truncated: false })
            toast('Saved', 'success')
            await list(path)
        } catch (err) {
            fail(err, 'Could not save the file')
        } finally {
            setBusy(false)
        }
    }
    const act = async (what: () => Promise<unknown>, fallback: string) => {
        setBusy(true)
        try {
            await what()
            await list(path)
            setRenaming(null)
            setFolder(null)
        } catch (err) {
            const message = err instanceof Error ? err.message : fallback
            if (folder !== null) setCreateError(message)
            else setFileError(message)
        } finally {
            setBusy(false)
        }
    }
    const dir = path.replace(/\/+$/, '')
    const parent = dir.split('/').slice(0, -1).join('/') || '/'
    return (
        <div className="flex flex-col gap-4" aria-label="Agent files" onDragOver={(event) => {
            if (!Array.from(event.dataTransfer.types).includes('Files')) return
            event.preventDefault()
            event.dataTransfer.dropEffect = busy || entries === null ? 'none' : 'copy'
            setDragging(true)
        }} onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
        }} onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            if (busy || entries === null) return
            if (Array.from(event.dataTransfer.items ?? []).some(item => item.webkitGetAsEntry?.()?.isDirectory)) {
                setUploadErrors(['Folders cannot be uploaded. Select individual files.'])
                return
            }
            void upload(Array.from(event.dataTransfer.files))
        }}>
            <AlertDialog open={pending !== null} onOpenChange={value => { if (!value) setPending(null) }}>
                <AlertDialogContent>
                    <AlertDialogHeader><AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle><AlertDialogDescription>Your edits have not been saved to the agent.</AlertDialogDescription></AlertDialogHeader>
                    <AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={() => { const action = pending; setPending(null); action?.() }}>Discard changes</AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            {dragging && <p role="status">{busy ? 'Wait for the current operation to finish.' : `Drop files to upload into ${path}`}</p>}
            <ScreenHeader
                title="Files"
                note={`Upload files from your computer into ${path} (up to 100 MB each). Drop files here to upload. Text files open to edit.`}
                action={
                    <div className="flex gap-2">
                        <input ref={picker} type="file" multiple className="hidden" aria-label="Choose files to upload" disabled={busy || entries === null} onChange={(event) => {
                            const files = Array.from(event.target.files ?? [])
                            event.target.value = ''
                            void upload(files)
                        }} />
                        <Button size="sm" variant="outline" disabled={busy || entries === null} onClick={() => picker.current?.click()}>
                            {uploadStatus && <Loader2 className="size-3.5 animate-spin" />} Upload files
                        </Button>
                        <DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="outline" disabled={busy || entries === null}>New</Button></DropdownMenuTrigger>
                            <DropdownMenuContent><DropdownMenuItem onSelect={() => { setFolder(null); setNewFile(''); setCreateError(null) }}>New file</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => { setNewFile(null); setFolder(''); setCreateError(null) }}>New folder</DropdownMenuItem></DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                }
            />
            <nav aria-label="File breadcrumbs" className="flex min-w-0 flex-wrap items-center gap-1 text-xs">
                <Button size="xs" variant="ghost" disabled={busy} onClick={() => navigate(home)}>Home</Button>
                <Button size="xs" variant="ghost" disabled={busy} onClick={() => navigate('/')} aria-label="Root directory">/</Button>
                {segments.length > 3 && <DropdownMenu><DropdownMenuTrigger asChild><Button size="xs" variant="ghost" disabled={busy} aria-label="Ancestor directories">…</Button></DropdownMenuTrigger><DropdownMenuContent>
                    {segments.slice(0, -2).map((segment, i) => <DropdownMenuItem key={i} onSelect={() => navigate('/' + segments.slice(0, i + 1).join('/'))}>{segment}</DropdownMenuItem>)}
                </DropdownMenuContent></DropdownMenu>}
                {segments.map((segment, i) => (segments.length <= 3 || i >= segments.length - 2) && <span key={i} className="flex min-w-0 items-center gap-1">
                    <Button size="xs" variant="ghost" className="max-w-40 truncate" disabled={busy || i === segments.length - 1} aria-current={i === segments.length - 1 ? 'page' : undefined} title={segment} onClick={() => navigate('/' + segments.slice(0, i + 1).join('/'))}>{segment}</Button>
                    {i < segments.length - 1 && <span aria-hidden="true">/</span>}
                </span>)}
                <Button size="xs" variant="ghost" disabled={busy} onClick={() => { setDirectoryDraft(path); setEditingPath(value => !value) }}>Edit path</Button>
                {path !== '/' && <Button size="xs" variant="ghost" disabled={busy} onClick={() => navigate(parent)}>Up</Button>}
            </nav>
            {editingPath && <form className="flex items-center gap-1.5" onSubmit={event => { event.preventDefault(); if (!busy) navigate(directoryDraft) }}>
                <Input data-file-directory-input value={directoryDraft} disabled={busy} onChange={event => setDirectoryDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setEditingPath(false) } }} aria-label="Directory" className="h-8 min-w-0 flex-1 font-mono text-xs" autoFocus spellCheck={false} />
                <Button type="submit" size="sm" variant="outline" disabled={busy || !directoryDraft.startsWith('/')}>Go</Button>
            </form>}
            <div className="flex items-center gap-2">
                <Input type="search" aria-label="Search this folder" placeholder="Search this folder…" value={query} onChange={event => setQuery(event.target.value)} className="h-8 min-w-0 flex-1" />
                {query && <Button size="xs" variant="ghost" onClick={() => setQuery('')}>Clear search</Button>}
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void list(path)}>Refresh</Button>
            </div>
            {entries !== null && <p className="text-xs text-muted-foreground" aria-live="polite">{visible.length} of {entries.length} items</p>}
            <div className="flex gap-2" role="group" aria-label="Sort files">
                {(['name', 'size', 'modifiedAt'] as const).map(key => <Button key={key} size="xs" variant="ghost" aria-label={`Sort by ${key === 'modifiedAt' ? 'modified' : key}`} onClick={() => sortBy(key)}>{key === 'modifiedAt' ? 'Modified' : key === 'name' ? 'Name' : 'Size'}{sort === key ? descending ? ' ↓' : ' ↑' : ''}</Button>)}
            </div>
            {newFile !== null && <FormCard title={`New file in ${path}`} onSubmit={() => guard(() => void createFile())}>
                <div className="flex flex-wrap items-center gap-1.5"><Input aria-label="File name" value={newFile} onChange={event => { setNewFile(event.target.value); setCreateError(null) }} autoFocus placeholder="notes.txt" />
                    <Button type="submit" size="sm" disabled={busy || !validName(newFile)}>Create file</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setNewFile(null)}>Cancel</Button></div>
                {newFile && !validName(newFile) && <p className="text-xs text-destructive">Use a filename without slashes, control characters, or surrounding spaces.</p>}
                {createError && <p role="alert" className="text-xs text-destructive">{createError}</p>}
            </FormCard>}
            {uploadStatus && <p role="status" className="text-xs text-muted-foreground">{uploadStatus}</p>}
            {uploadErrors.length > 0 && <div role="alert" className="text-xs text-destructive">{uploadErrors.map((message, i) => <p key={i}>{message}</p>)}</div>}
            {folder !== null && (
                <FormCard title={`New folder in ${dir || '/'}`} onSubmit={() => validName(folder) && void act(() => window.ipc.invoke('spaces:makeHostingDir', { orgId, agentId, path: `${dir}/${folder.trim()}` }), 'Could not make the folder')}>
                    <div className="flex flex-wrap items-center gap-1.5">
                        <Input value={folder} onChange={(e) => { setFolder(e.target.value); setCreateError(null) }} placeholder="name" aria-label="Folder name" className="h-8 w-56 font-mono text-xs" autoFocus />
                        <Button type="submit" size="sm" disabled={!validName(folder) || busy}>Create folder</Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setFolder(null)}>Cancel</Button>
                    </div>
                    {createError && <p role="alert" className="text-xs text-destructive">{createError}</p>}
                </FormCard>
            )}
            {entries === null ? (
                <Empty>Loading…</Empty>
            ) : (
                <Rows label="Files" className="max-h-72 overflow-auto">
                    {visible.length === 0 && <Row className="text-muted-foreground">{entries.length ? 'No matching files.' : 'Empty folder.'}</Row>}
                    {visible.map((e) => (
                        <Row key={e.path} className="font-mono">
                            <button type="button" disabled={busy} onClick={() => (e.kind === 'dir' ? navigate(e.path) : guard(() => void read(e.path)))} className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-foreground">
                                {e.kind === 'dir' ? <Folder className="size-3.5 shrink-0 text-muted-foreground" /> : <FileText className="size-3.5 shrink-0 text-muted-foreground" />}
                                <span className="truncate">{e.name}{e.kind === 'dir' ? '/' : ''}</span>
                            </button>
                            <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">{sizeLabel(e.kind === 'dir' ? undefined : e.size)}</span>
                            <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground sm:block" title={e.modifiedAt}>{modified(e) === undefined ? '—' : new Date(modified(e)!).toLocaleDateString()}</span>
                            {e.kind === 'file' && <RowAction disabled={busy} onClick={() => void download(e.path)}>Download <span className="sr-only">{e.name}</span></RowAction>}
                            {renaming?.from === e.path ? (
                                <form
                                    className="flex items-center gap-1"
                                    onSubmit={(ev) => {
                                        ev.preventDefault()
                                        void act(() => window.ipc.invoke('spaces:moveHostingFile', { orgId, agentId, from: renaming.from, to: renaming.to }), 'Could not move it')
                                    }}
                                >
                                    <Input value={renaming.to} onChange={(ev) => setRenaming({ from: renaming.from, to: ev.target.value })} aria-label="New path" className="h-7 w-56 font-mono text-xs" autoFocus />
                                    <Button type="submit" size="xs" disabled={busy}>Move</Button>
                                    <Button type="button" size="xs" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
                                </form>
                            ) : (
                                <RowAction disabled={busy} onClick={() => guard(() => { setOpen(null); setRenaming({ from: e.path, to: e.path }) })}>Rename</RowAction>
                            )}
                        </Row>
                    ))}
                </Rows>
            )}
            {fileError && <p role="alert" className="text-sm text-destructive">{fileError}</p>}
            {preview && <div className="overflow-hidden rounded-lg border border-border">
                <div className="flex items-center gap-2 border-b p-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{preview.path}</span>
                    <Button size="xs" variant="ghost" onClick={() => setPreview(null)}>Close preview</Button>
                </div>
                {preview.mime === 'application/pdf'
                    ? <iframe src={preview.url} title="PDF preview" className="h-96 w-full border-0 bg-white" onError={() => setFileError('Could not preview this PDF. Download it to open it on your computer.')} />
                    : <img src={preview.url} alt={preview.path.split('/').pop()} className="max-h-96 max-w-full object-contain" onError={() => setFileError('Could not preview this image. Download it to open it on your computer.')} />}
            </div>}
            {open && (
                <div className="overflow-hidden rounded-lg border border-border">
                    <div className="flex items-center gap-2 border-b border-border bg-muted/40 py-1.5 pr-1.5 pl-3">
                        <span className="min-w-0 truncate font-mono text-xs font-medium text-foreground">{open.path}</span>
                        {open.truncated && <Tag tone="warn">cut at 1 MB</Tag>}
                        {draft !== open.content && <Tag tone="accent">edited</Tag>}
                        <div className="ml-auto flex gap-1">
                            <Button size="xs" disabled={busy || open.truncated || draft === open.content} onClick={() => void save()}>Save</Button>
                            <Button size="xs" variant="ghost" onClick={() => guard(() => setOpen(null))}>Close</Button>
                        </div>
                    </div>
                    <Textarea key={open.path} disabled={busy} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="File content" className="min-h-40 rounded-none border-0 font-mono text-xs focus-visible:ring-0" spellCheck={false} />
                </div>
            )}
        </div>
    )
}
