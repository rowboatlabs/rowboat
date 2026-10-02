import { useRef, useState } from 'react'
import { FileText, FolderPlus, MoreHorizontal, PenTool, Plus, Trash2, Upload } from 'lucide-react'
import { spaces } from '@x/shared'
import { FileListContextMenu } from '@/components/file-list-context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
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
            <section
                className="spaces-files-view group/section flex min-h-0 flex-1 flex-col" aria-label="All files"
                onDragOver={(e) => { if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault() }}
                onDrop={(e) => {
                    if (!Array.from(e.dataTransfer.types).includes('Files')) return
                    e.preventDefault()
                    const files = Array.from(e.dataTransfer.files)
                    if (files.length > 0) onUploadFiles(files)
                }}
            >
                <div className="spaces-pane-header flex shrink-0 items-center gap-2 border-b border-border"><h2 className="flex-1 text-[13px] font-semibold">All files <span className="ml-1 font-normal text-muted-foreground">{liveFiles}</span></h2>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                aria-label="Add to files"
                                title="New file, folder, board, or upload"
                                className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                                <Plus className="size-3.5" />
                            </button>
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
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                aria-label="Files options"
                                className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                                <MoreHorizontal className="size-3.5" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={onOpenTrash}>
                                <Trash2 className="size-3.5 mr-2" /> Trash
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
                    <FileListContextMenu actions={[
                        { label: 'New file', onSelect: () => { setCreatingBoard(false); setCreatingFile({ prefix: '' }) } },
                        { label: 'New folder', onSelect: () => { setCreatingBoard(false); setCreatingFolder(true) } },
                        { label: 'New board', onSelect: () => { setCreatingFile(null); setCreatingFolder(false); setCreatingBoard(true) } },
                        { label: 'Upload files…', onSelect: () => uploadInputRef.current?.click() },
                    ]}>
                    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
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
                            onStartCreate={(prefix) => setCreatingFile({ prefix })}
                            creatingFolder={creatingFolder}
                            onCreateFolder={(path) => {
                                setCreatingFolder(false)
                                onAddFolder(path)
                            }}
                            onCancelCreateFolder={() => setCreatingFolder(false)}
                            onRemoveFolder={onRemoveFolder}
                        />
                        {creatingBoard && (
                            <div className="flex items-center gap-1.5 px-1 pt-1">
                                <PenTool className="size-3 shrink-0 text-muted-foreground" />
                                <input
                                    autoFocus
                                    placeholder="Board name…"
                                    className="h-7 min-w-0 flex-1 rounded-md border border-transparent bg-[var(--rowboat-wash)] px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-border"
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
            </section>
    </>
}
