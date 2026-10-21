import { useSpaceAccess } from '@/lib/spaces-access'
import { useRef, useState } from 'react'
import { FileText, FolderPlus, MoreHorizontal, PenTool, Plus, Trash2, Upload } from 'lucide-react'
import { spaces } from '@x/shared'
import { FileListContextMenu } from '@/components/file-list-context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { SpacesPage } from '@/components/spaces/page-shell'
import { FileTree } from '@/components/spaces/files-tab'
import type { RailSelection } from '@/lib/spaces-selection'

/** Full-space file browser. Retains the tree's creation, move, rename and trash actions. */
export function SpaceFilesView({ orgId, orgAddress, spaceId, entries, draftFolders, unreadAssetIds, selection, onSelect,
    onCreateFile, onCreateBoard, onUploadFiles, onOpenTrash, onAddFolder, onRemoveFolder,
}: {
    orgId: string
    orgAddress: string
    spaceId: string
    entries: spaces.SpacesAssetEntry[]
    draftFolders: readonly string[]
    unreadAssetIds: ReadonlySet<string>
    selection: RailSelection
    onSelect: (selection: RailSelection) => void
    onCreateFile: (path: string) => void
    onCreateBoard: (path: string) => void
    onUploadFiles: (files: File[]) => void
    onOpenTrash: () => void
    onAddFolder: (path: string) => void
    onRemoveFolder: (path: string) => void
}) {
    const { writable } = useSpaceAccess()
    const [creatingFile, setCreatingFile] = useState<{ prefix: string } | null>(null)
    const [creatingFolder, setCreatingFolder] = useState(false)
    const [creatingBoard, setCreatingBoard] = useState(false)
    const uploadInputRef = useRef<HTMLInputElement | null>(null)
    const selectedAssetId = selection.kind === 'file' || selection.kind === 'whiteboard' ? selection.assetId : null
    const openEntry = (assetId: string) => {
        const entry = entries.find((e) => e.id === assetId)
        onSelect(entry && spaces.isWhiteboardPath(entry.path) ? { kind: 'whiteboard', assetId } : { kind: 'file', assetId })
    }
    const createBoard = (name: string) => {
        setCreatingBoard(false)
        const path = spaces.whiteboardPathForName(name)
        if (path) onCreateBoard(path)
    }
    const liveFiles = entries.filter((e) => !e.state).length
    return <>
        <input ref={uploadInputRef} type="file" multiple className="hidden" onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length > 0) onUploadFiles(files)
            e.target.value = ''
        }} />
            <div
                className="spaces-files-view flex min-h-0 min-w-0 flex-1 flex-col"
                onDragOver={(e) => { if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault() }}
                onDrop={(e) => {
                    if (!writable || !Array.from(e.dataTransfer.types).includes('Files')) return
                    e.preventDefault()
                    const files = Array.from(e.dataTransfer.files)
                    if (files.length > 0) onUploadFiles(files)
                }}
            >
            <SpacesPage label="All files" title="Files" count={liveFiles}
                subtitle="Docs, boards and uploads everyone in this space can open. Drop files anywhere here to upload."
                actions={<>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild disabled={!writable}>
                            <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label="Files options">
                                <MoreHorizontal className="size-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={onOpenTrash}>
                                <Trash2 className="size-3.5 mr-2" /> Trash
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild disabled={!writable}>
                            <Button size="sm" aria-label="Add to files" title="New file, folder, board, or upload">
                                <Plus className="size-4" /> New
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => uploadInputRef.current?.click()}>
                                <Upload className="size-3.5 mr-2" /> Upload files…
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setCreatingBoard(false); setCreatingFile({ prefix: '' }) }}>
                                <FileText className="size-3.5 mr-2" /> New file
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setCreatingBoard(false); setCreatingFolder(true) }}>
                                <FolderPlus className="size-3.5 mr-2" /> New folder
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setCreatingFile(null); setCreatingFolder(false); setCreatingBoard(true) }}>
                                <PenTool className="size-3.5 mr-2" /> New board
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </>}>
                    <FileListContextMenu actions={writable ? [
                        { label: 'New file', onSelect: () => { setCreatingBoard(false); setCreatingFile({ prefix: '' }) } },
                        { label: 'New folder', onSelect: () => { setCreatingBoard(false); setCreatingFolder(true) } },
                        { label: 'New board', onSelect: () => { setCreatingFile(null); setCreatingFolder(false); setCreatingBoard(true) } },
                        { label: 'Upload files…', onSelect: () => uploadInputRef.current?.click() },
                    ] : []}>
                    <div className="-mx-1">
                        <FileTree
                            orgId={orgId}
                            orgAddress={orgAddress}
                            spaceId={spaceId}
                            entries={entries}
                            draftFolders={draftFolders}
                            selectedAssetId={selectedAssetId}
                            unreadAssetIds={unreadAssetIds}
                            onOpenFile={openEntry}
                            creating={creatingFile}
                            onCreateFile={(path) => {
                                setCreatingFile(null)
                                onCreateFile(path)
                            }}
                            onCancelCreate={() => setCreatingFile(null)}
                            onStartCreate={writable ? (prefix) => setCreatingFile({ prefix }) : undefined}
                            creatingFolder={creatingFolder}
                            onCreateFolder={(path) => {
                                setCreatingFolder(false)
                                onAddFolder(path)
                            }}
                            onCancelCreateFolder={() => setCreatingFolder(false)}
                            onRemoveFolder={writable ? onRemoveFolder : undefined}
                        />
                        {creatingBoard && (
                            <div className="flex items-center gap-1.5 px-1 pt-1">
                                <PenTool className="size-4 shrink-0 text-muted-foreground" />
                                <input
                                    autoFocus
                                    placeholder="Board name…"
                                    className="h-9 min-w-0 flex-1 rounded-md border border-transparent bg-[var(--rowboat-wash)] px-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-border"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') createBoard(e.currentTarget.value)
                                        else if (e.key === 'Escape') setCreatingBoard(false)
                                    }}
                                    onBlur={(e) => (e.currentTarget.value.trim() ? createBoard(e.currentTarget.value) : setCreatingBoard(false))}
                                />
                            </div>
                        )}
                    </div>
                    </FileListContextMenu>
            </SpacesPage>
            </div>
    </>
}
