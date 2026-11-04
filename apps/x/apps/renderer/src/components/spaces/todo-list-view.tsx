import { useEffect, useMemo, useRef, useState } from 'react'
import { AlignLeft, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, ChevronRight, Columns3, GripVertical, Maximize2, MoreHorizontal, NotebookPen, Pencil, Plus, Rows3, Trash2, UserPlus, X } from 'lucide-react'
import { invokeSpace } from '@/lib/spaces-invoke'
import { canActInSpace, useSpaceAccess } from '@/lib/spaces-access'
import { useSpaceMembers } from '@/hooks/use-space-members'
import { isDeparted, isOthersPersonalAgent, isSwitchedOff } from '@/lib/spaces-direct'
import { useOrgSettings } from '@/hooks/use-org-settings'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { MemberAvatar } from '@/components/spaces/atoms'
import { SpaceMarkdown } from '@/components/spaces/space-markdown'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    addItem, addSection, deleteItem, deleteSection, itemDetails, itemRef, itemsOf, moveItem, moveSection, parseTodoList, renameSection, sectionRef, serializeTodoList, updateItem,
    type ItemRef, type TodoAssignee, type TodoDoc, type TodoEdit, type TodoItem,
} from '@/lib/todo-list'

type TodoView = 'document' | 'board'

/** Enter commits and Escape cancels, both through the blur, so a commit can't run twice. */
function commitKeys(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') e.currentTarget.dataset.cancel = '1'
    if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
}

// Document or board is each reader's own choice, per list, on this device
// (2026-10-25, Arjun): nothing about it is written to the file.
function viewKey(orgId: string, spaceId: string, assetId: string): string {
    return `spaces:todo-view:${orgId}/${spaceId}/${assetId}`
}

// Board columns are resizable, each reader's own widths per list on this
// device (2026-11-04, Arjun): keyed by section title, nothing written to the file.
function columnsKey(orgId: string, spaceId: string, assetId: string): string {
    return `spaces:todo-columns:${orgId}/${spaceId}/${assetId}`
}
const COLUMN_DEFAULT_WIDTH = 272
const COLUMN_MIN_WIDTH = 200
const COLUMN_MAX_WIDTH = 640

function readWidths(key: string): Record<string, number> {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '{}')
        return parsed && typeof parsed === 'object' ? parsed as Record<string, number> : {}
    } catch {
        return {}
    }
}

/**
 * The todo list editor (lib/todo-list.ts has the format). Every action is one
 * small propose against the version on screen, queued so actions in quick
 * succession chain. A clean merge adopts the merged text; a conflict re-reads
 * and applies the same action to what is there now.
 */
export function TodoListView({ orgId, spaceId, selfMemberId, assetId, content, version, onSaved }: {
    orgId: string
    spaceId: string
    /** Who is reading: their own personal agent may be assigned, anyone else's not. */
    selfMemberId: string
    assetId: string
    content: string
    version: number
    /** A save landed (or failed): the column rereads the file. */
    onSaved: () => void
}) {
    const { writable } = useSpaceAccess()
    const members = useSpaceMembers(orgId, spaceId)
    const [view, setViewState] = useState<TodoView>(() => (localStorage.getItem(viewKey(orgId, spaceId, assetId)) === 'board' ? 'board' : 'document'))
    const setView = (next: TodoView) => {
        localStorage.setItem(viewKey(orgId, spaceId, assetId), next)
        setViewState(next)
    }

    // The server's text, and the edits on top of it not yet saved. The refs
    // are what the save loop reads; the state is what paints.
    const [server, setServer] = useState({ content, version })
    const [pending, setPending] = useState<TodoEdit[]>([])
    const serverRef = useRef(server)
    const pendingRef = useRef(pending)
    const busy = useRef(false)
    const sync = () => {
        setServer(serverRef.current)
        setPending(pendingRef.current)
    }
    // A newer version from the column's reread (someone else's change, or our own save coming back).
    useEffect(() => {
        if (busy.current || version <= serverRef.current.version) return
        serverRef.current = { content, version }
        setServer(serverRef.current)
    }, [content, version])

    const flush = async () => {
        if (busy.current) return
        busy.current = true
        try {
            while (pendingRef.current.length > 0) {
                const edit = pendingRef.current[0]!
                let base = serverRef.current
                let settled = false
                for (let attempt = 0; attempt < 3 && !settled; attempt += 1) {
                    const next = edit(parseTodoList(base.content))
                    if (!next) {
                        toast('That changed meanwhile — showing the latest', 'error')
                        settled = true
                        break
                    }
                    const newContent = serializeTodoList(next)
                    if (newContent === base.content) {
                        settled = true
                        break
                    }
                    const result = await invokeSpace('spaces:proposeChange', {
                        orgId, spaceId, input: { assetId, baseVersion: base.version, newContent },
                    })
                    if (result.outcome === 'applied') {
                        base = { content: newContent, version: result.version }
                        settled = true
                    } else if (result.outcome === 'merged') {
                        base = { content: result.mergedContent, version: result.version }
                        settled = true
                    } else {
                        base = { content: result.currentContent, version: result.currentVersion }
                    }
                }
                if (!settled) toast('Someone is editing the same lines — try again', 'error')
                serverRef.current = base
                pendingRef.current = pendingRef.current.slice(1)
                sync()
            }
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not save', 'error')
            pendingRef.current = []
            sync()
        } finally {
            busy.current = false
            onSaved()
        }
    }

    const apply = (edit: TodoEdit) => {
        if (!writable || !canActInSpace(orgId, spaceId)) return
        pendingRef.current = [...pendingRef.current, edit]
        sync()
        void flush()
    }

    const doc = useMemo(
        () => pending.reduce<TodoDoc>((d, edit) => edit(d) ?? d, parseTodoList(server.content)),
        [server.content, pending],
    )
    // An assignee is a mention, so someone else's personal agent is left out (2026-10-30), and Ro while it is off.
    const settings = useOrgSettings(orgId)
    const roster = useMemo(() => members.filter((m) => !isDeparted(m) && !isOthersPersonalAgent(m, selfMemberId) && !isSwitchedOff(m, settings)), [members, selfMemberId, settings])
    const names = useMemo(() => new Map(members.map((m) => [m.id, m.displayName])), [members])

    const [widths, setWidths] = useState(() => readWidths(columnsKey(orgId, spaceId, assetId)))
    const resizeColumn = (title: string, width: number, save: boolean) => setWidths((prev) => {
        const next = { ...prev, [title]: width }
        if (save) localStorage.setItem(columnsKey(orgId, spaceId, assetId), JSON.stringify(next))
        return next
    })

    // The open card, by position: an edit keeps an item where it is, and a
    // move from the card follows it (2026-11-04, Arjun: details read on a
    // card you open, as Trello's do, instead of folding open in place).
    const [card, setCard] = useState<{ section: number; index: number } | null>(null)
    const cardSection = card ? doc.sections[card.section] : undefined
    const cardItem = card && cardSection ? itemsOf(cardSection)[card.index] : undefined
    useEffect(() => {
        if (card && !cardItem) setCard(null)
    }, [card, cardItem])

    // Drag and drop is the browser's own (HTML5): an item carries its ref,
    // and the drop line shows where it lands. The item menu's "Move to" does
    // the same without a mouse.
    const dragging = useRef<ItemRef | null>(null)
    const [drop, setDrop] = useState<{ section: number; index: number } | null>(null)
    const endDrag = () => {
        dragging.current = null
        setDrop(null)
    }
    const dropAt = (section: number, index: number) => {
        const from = dragging.current
        endDrag()
        if (from) apply(moveItem(from, sectionRef(doc, section), index))
    }

    // Lines before the first heading are a section only when they hold items.
    const shown = doc.sections.map((s, i) => ({ section: s, index: i })).filter(({ section, index }) => index > 0 || itemsOf(section).length > 0)
    const headed = doc.sections.length - 1

    const sectionProps = (index: number) => ({
        doc, index, writable, roster, names, drop, dragging, view,
        isFirst: index <= 1, isLast: index === headed,
        onApply: apply, onOpenItem: (i: number) => setCard({ section: index, index: i }), onDrop: dropAt, onDragOverAt: (s: number, i: number) => setDrop({ section: s, index: i }), onDragEnd: endDrag,
    })

    return (
        <div className={cn('flex flex-1 flex-col', view === 'board' && 'min-h-0')}>
            <div className="flex shrink-0 items-center gap-2 px-5 pt-3">
                <div className="flex-1" />
                <div role="radiogroup" aria-label="View" className="inline-flex rounded-md border border-border p-0.5 text-xs">
                    {([['document', Rows3, 'Document'], ['board', Columns3, 'Board']] as const).map(([value, Icon, label]) => (
                        <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={view === value}
                            onClick={() => setView(value)}
                            className={cn('inline-flex items-center gap-1 rounded px-2 py-1', view === value ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
                        >
                            <Icon className="size-3.5" /> {label}
                        </button>
                    ))}
                </div>
            </div>
            {view === 'board' ? (
                <div className="flex min-h-0 flex-1 items-start gap-3 overflow-x-auto px-5 py-4">
                    {shown.map(({ index }) => {
                        const title = index === 0 ? '' : doc.sections[index]!.title
                        const width = widths[title] ?? COLUMN_DEFAULT_WIDTH
                        return (
                            <div key={`${index}:${doc.sections[index]!.heading}`} style={{ width }} className="relative flex max-h-full shrink-0 flex-col rounded-lg bg-[var(--rowboat-wash)]">
                                <TodoSectionBlock {...sectionProps(index)} />
                                <ColumnResizeHandle
                                    label={title || 'No section'}
                                    width={width}
                                    onResize={(w) => resizeColumn(title, w, false)}
                                    onCommit={(w) => resizeColumn(title, w, true)}
                                />
                            </div>
                        )
                    })}
                    {writable && <div className="w-72 shrink-0"><AddSection onAdd={(title) => apply(addSection(title))} /></div>}
                </div>
            ) : (
                <div className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-5 py-4">
                    {shown.map(({ index }) => (
                        <div key={`${index}:${doc.sections[index]!.heading}`}>
                            <TodoSectionBlock {...sectionProps(index)} />
                        </div>
                    ))}
                    {shown.length === 0 && !writable && <p className="text-sm text-muted-foreground">This list is empty.</p>}
                    {writable && <AddSection onAdd={(title) => apply(addSection(title))} />}
                </div>
            )}
            {card && cardItem && (
                <TodoCardDialog
                    item={cardItem}
                    sectionTitle={card.section === 0 ? 'No section' : cardSection!.title}
                    sections={doc.sections.map((s, si) => ({ title: si === 0 ? 'No section' : s.title, index: si })).filter((s) => s.index > 0 && s.index !== card.section)}
                    writable={writable}
                    roster={roster}
                    names={names}
                    onApply={(make) => apply(make(itemRef(doc, card.section, card.index)))}
                    onMoveTo={(to) => {
                        const index = itemsOf(doc.sections[to]!).length
                        apply(moveItem(itemRef(doc, card.section, card.index), sectionRef(doc, to), index))
                        setCard({ section: to, index })
                    }}
                    onDelete={() => {
                        apply(deleteItem(itemRef(doc, card.section, card.index)))
                        setCard(null)
                    }}
                    onClose={() => setCard(null)}
                />
            )}
        </div>
    )
}

/** A board column's right edge: drag, arrow keys, or double-click to reset (the thread pane's handle, sideways). */
function ColumnResizeHandle({ label, width, onResize, onCommit }: {
    label: string
    width: number
    onResize: (width: number) => void
    onCommit: (width: number) => void
}) {
    const drag = useRef<{ x: number; width: number; current: number } | null>(null)
    const [dragging, setDragging] = useState(false)
    const clamp = (value: number) => Math.round(Math.max(COLUMN_MIN_WIDTH, Math.min(COLUMN_MAX_WIDTH, value)))
    const finish = () => {
        if (!drag.current) return
        onCommit(clamp(drag.current.current))
        drag.current = null
        setDragging(false)
    }
    return (
        <div
            role="separator"
            aria-label={`Resize ${label}`}
            aria-orientation="vertical"
            aria-valuemin={COLUMN_MIN_WIDTH}
            aria-valuemax={COLUMN_MAX_WIDTH}
            aria-valuenow={width}
            aria-valuetext={`${width} pixels`}
            tabIndex={0}
            title="Drag to resize · Arrow keys to adjust · Double-click to reset"
            className={cn(
                'absolute inset-y-1 -right-2 z-10 w-3 cursor-col-resize touch-none select-none outline-none',
                'after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded-full after:transition-colors hover:after:bg-primary/40 focus-visible:after:bg-primary',
                dragging && 'after:bg-primary',
            )}
            onPointerDown={(event) => {
                if (event.button !== 0) return
                event.preventDefault()
                event.currentTarget.focus()
                event.currentTarget.setPointerCapture(event.pointerId)
                drag.current = { x: event.clientX, width, current: width }
                setDragging(true)
            }}
            onPointerMove={(event) => {
                if (!drag.current) return
                const next = clamp(drag.current.width + event.clientX - drag.current.x)
                drag.current.current = next
                onResize(next)
            }}
            onPointerUp={finish}
            onPointerCancel={finish}
            onLostPointerCapture={finish}
            onDoubleClick={() => onCommit(COLUMN_DEFAULT_WIDTH)}
            onKeyDown={(event) => {
                const step = event.shiftKey ? 40 : 10
                const next = event.key === 'ArrowRight' ? width + step
                    : event.key === 'ArrowLeft' ? width - step
                    : event.key === 'Home' ? COLUMN_MIN_WIDTH
                    : event.key === 'End' ? COLUMN_MAX_WIDTH : null
                if (next === null) return
                event.preventDefault()
                onCommit(clamp(next))
            }}
        />
    )
}

function TodoSectionBlock({ doc, index, writable, roster, names, drop, dragging, view, isFirst, isLast, onApply, onOpenItem, onDrop, onDragOverAt, onDragEnd }: {
    doc: TodoDoc
    index: number
    writable: boolean
    roster: ReturnType<typeof useSpaceMembers>
    names: Map<string, string>
    drop: { section: number; index: number } | null
    dragging: React.RefObject<ItemRef | null>
    view: TodoView
    isFirst: boolean
    isLast: boolean
    onApply: (edit: TodoEdit) => void
    onOpenItem: (index: number) => void
    onDrop: (section: number, index: number) => void
    onDragOverAt: (section: number, index: number) => void
    onDragEnd: () => void
}) {
    const section = doc.sections[index]!
    const items = itemsOf(section)
    const ref = sectionRef(doc, index)
    const [renaming, setRenaming] = useState(false)
    const [adding, setAdding] = useState(false)
    const board = view === 'board'
    const line = <div className="mx-2 h-0.5 rounded bg-primary" />
    const commitRename = (value: string) => {
        setRenaming(false)
        if (value.trim() && value.trim() !== section.title) onApply(renameSection(ref, value))
    }
    return (
        <div
            className={cn('flex min-h-0 flex-col', board && 'p-2')}
            onDragOver={(e) => {
                if (!dragging.current) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (drop?.section !== index || drop.index !== items.length) onDragOverAt(index, items.length)
            }}
            onDrop={(e) => {
                e.preventDefault()
                onDrop(index, drop?.section === index ? drop.index : items.length)
            }}
        >
            <div className={cn('group/section flex items-center gap-2', board ? 'px-1.5 pb-1.5' : 'border-b border-border pb-1.5 mb-1')}>
                {renaming ? (
                    <input
                        autoFocus
                        defaultValue={section.title}
                        aria-label="Section name"
                        className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm font-semibold outline-none"
                        onKeyDown={commitKeys}
                        onBlur={(e) => (e.currentTarget.dataset.cancel ? setRenaming(false) : commitRename(e.currentTarget.value))}
                    />
                ) : (
                    <h3
                        className={cn('min-w-0 flex-1 truncate font-semibold', board ? 'text-sm' : 'text-base', index === 0 && 'text-muted-foreground')}
                        onDoubleClick={() => writable && index > 0 && setRenaming(true)}
                    >
                        {index === 0 ? 'No section' : section.title}
                    </h3>
                )}
                <span className="text-xs text-muted-foreground">{items.filter((i) => i.done).length}/{items.length}</span>
                {writable && index > 0 && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button type="button" aria-label={`${section.title} options`} className="inline-flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/section:opacity-100 data-[state=open]:opacity-100">
                                <MoreHorizontal className="size-3.5" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
                            <DropdownMenuItem onClick={() => setRenaming(true)}><Pencil className="size-3.5 mr-2" /> Rename</DropdownMenuItem>
                            <DropdownMenuItem disabled={isFirst} onClick={() => onApply(moveSection(ref, index - 1))}>
                                {board ? <ArrowLeft className="size-3.5 mr-2" /> : <ArrowUp className="size-3.5 mr-2" />} Move {board ? 'left' : 'up'}
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={isLast} onClick={() => onApply(moveSection(ref, index + 1))}>
                                {board ? <ArrowRight className="size-3.5 mr-2" /> : <ArrowDown className="size-3.5 mr-2" />} Move {board ? 'right' : 'down'}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => {
                                if (items.length === 0 || window.confirm(`Delete "${section.title}" and its ${items.length} item${items.length === 1 ? '' : 's'}?`)) onApply(deleteSection(ref))
                            }}>
                                <Trash2 className="size-3.5 mr-2" /> Delete section
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>
            <div className={cn('flex min-h-0 flex-col', board && 'gap-1.5 overflow-y-auto px-0.5 pb-0.5')}>
                {items.map((item, i) => (
                    <div key={`${i}:${item.raw}`}>
                        {drop?.section === index && drop.index === i && line}
                        <TodoItemRow
                            item={item}
                            board={board}
                            writable={writable}
                            roster={roster}
                            names={names}
                            sections={doc.sections.map((s, si) => ({ title: si === 0 ? 'No section' : s.title, index: si })).filter((s) => s.index > 0 && s.index !== index)}
                            onApply={(make) => onApply(make(itemRef(doc, index, i)))}
                            onOpen={() => onOpenItem(i)}
                            onMoveTo={(to) => onApply(moveItem(itemRef(doc, index, i), sectionRef(doc, to), itemsOf(doc.sections[to]!).length))}
                            onDragStart={(e) => {
                                dragging.current = itemRef(doc, index, i)
                                e.dataTransfer.effectAllowed = 'move'
                                e.dataTransfer.setData('application/x-rowboat-todo', item.raw)
                            }}
                            onDragOver={(e) => {
                                if (!dragging.current) return
                                e.preventDefault()
                                e.stopPropagation()
                                const rect = e.currentTarget.getBoundingClientRect()
                                const at = e.clientY < rect.top + rect.height / 2 ? i : i + 1
                                if (drop?.section !== index || drop.index !== at) onDragOverAt(index, at)
                            }}
                            onDragEnd={onDragEnd}
                        />
                    </div>
                ))}
                {drop?.section === index && drop.index === items.length && line}
                {items.length === 0 && !adding && <p className={cn('px-2 py-1.5 text-xs text-muted-foreground', board && 'rounded-md border border-dashed border-border py-4 text-center')}>No items yet</p>}
            </div>
            {writable && (adding ? (
                <input
                    autoFocus
                    placeholder="New item… (Enter to add, Esc to stop)"
                    aria-label="New item"
                    className="mt-1 h-8 rounded-md border border-border bg-background px-2 text-sm outline-none"
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                            onApply(addItem(ref, e.currentTarget.value))
                            e.currentTarget.value = ''
                        }
                        if (e.key === 'Escape') setAdding(false)
                    }}
                    onBlur={(e) => {
                        if (e.currentTarget.value.trim()) onApply(addItem(ref, e.currentTarget.value))
                        setAdding(false)
                    }}
                />
            ) : (
                <button type="button" onClick={() => setAdding(true)} className="mt-1 inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground">
                    <Plus className="size-3.5" /> Add item
                </button>
            ))}
        </div>
    )
}

/** The first line of an item's details, as plain text, for the collapsed row. */
function detailsPreview(details: string): string {
    const line = details.split('\n').find((l) => l.trim()) ?? ''
    return line.replace(/^\s*(?:[#>]+|[-*+]|\d+\.)\s*/, '').replace(/[*_`~]/g, '').trim()
}

function TodoItemRow({ item, board, writable, roster, names, sections, onApply, onOpen, onMoveTo, onDragStart, onDragOver, onDragEnd }: {
    item: TodoItem
    board: boolean
    writable: boolean
    roster: ReturnType<typeof useSpaceMembers>
    names: Map<string, string>
    sections: { title: string; index: number }[]
    onApply: (make: (ref: ItemRef) => TodoEdit) => void
    onOpen: () => void
    onMoveTo: (section: number) => void
    onDragStart: (e: React.DragEvent<HTMLDivElement>) => void
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => void
    onDragEnd: () => void
}) {
    const [editing, setEditing] = useState(false)
    // Details start collapsed for every reader (2026-11-03, Arjun): the list stays scannable, a card opens on demand.
    const details = itemDetails(item)
    const [open, setOpen] = useState(false)
    const [editingDetails, setEditingDetails] = useState(false)
    const commit = (value: string) => {
        setEditing(false)
        if (value.trim() && value.trim() !== item.text) onApply((ref) => updateItem(ref, { text: value }))
    }
    const commitDetails = (value: string) => {
        setEditingDetails(false)
        if (value.trim() !== details) onApply((ref) => updateItem(ref, { details: value }))
    }
    const toggle = (
        <input
            type="checkbox"
            checked={item.done}
            disabled={!writable}
            aria-label={item.done ? `Mark "${item.text}" not done` : `Mark "${item.text}" done`}
            onChange={(e) => onApply((ref) => updateItem(ref, { done: e.target.checked }))}
            className="mt-1 size-4 shrink-0 cursor-pointer accent-primary"
        />
    )
    const assign = (
        <AssigneePicker
            assignee={item.assignee}
            writable={writable}
            roster={roster}
            names={names}
            onAssign={(assignee) => onApply((ref) => updateItem(ref, { assignee }))}
        />
    )
    const menu = writable && (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Item options" className={cn(
                    'inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/item:opacity-100 data-[state=open]:opacity-100',
                    board && 'absolute right-1 top-1 bg-background',
                )}>
                    <MoreHorizontal className="size-3.5" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
                <DropdownMenuItem onClick={onOpen}><Maximize2 className="size-3.5 mr-2" /> Open card</DropdownMenuItem>
                {!board && <DropdownMenuItem onClick={() => setEditing(true)}><Pencil className="size-3.5 mr-2" /> Edit</DropdownMenuItem>}
                <DropdownMenuItem onClick={() => {
                    if (board) return onOpen()
                    setOpen(true)
                    setEditingDetails(true)
                }}><NotebookPen className="size-3.5 mr-2" /> {details ? 'Edit details' : 'Add details'}</DropdownMenuItem>
                {sections.length > 0 && (
                    <DropdownMenuSub>
                        <DropdownMenuSubTrigger><ArrowRight className="size-3.5 mr-2" /> Move to</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                            {sections.map((s) => (
                                <DropdownMenuItem key={s.index} onClick={() => onMoveTo(s.index)}>{s.title}</DropdownMenuItem>
                            ))}
                        </DropdownMenuSubContent>
                    </DropdownMenuSub>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onApply((ref) => deleteItem(ref))}><Trash2 className="size-3.5 mr-2" /> Delete</DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )

    // A board card is a Trello card (2026-11-04, Arjun: which card was folded
    // open was unclear): the title and its badges, and a click opens it.
    if (board) {
        return (
            <div
                draggable={writable}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDragEnd={onDragEnd}
                onClick={(e) => {
                    // Menus and pickers render in portals but bubble here; only the card's own surface opens it.
                    const target = e.target as HTMLElement
                    if (e.currentTarget.contains(target) && !target.closest('button, input, a')) onOpen()
                }}
                className="group/item relative cursor-pointer rounded-md border border-border bg-background px-2.5 py-2 shadow-xs hover:border-foreground/25"
            >
                <div className="flex items-start gap-2">
                    {toggle}
                    <button
                        type="button"
                        onClick={onOpen}
                        className={cn('min-w-0 flex-1 break-words py-0.5 text-left text-sm', item.done && 'text-muted-foreground line-through')}
                    >
                        {item.text || <span className="text-muted-foreground">Untitled</span>}
                    </button>
                </div>
                {(details || item.assignee) && (
                    <div className="mt-1 flex items-center gap-2 pl-6 text-muted-foreground">
                        {details && (
                            <span title="This card has details" aria-label="Has details" role="img">
                                <AlignLeft className="size-3.5" />
                            </span>
                        )}
                        <div className="flex-1" />
                        {assign}
                    </div>
                )}
                {menu}
            </div>
        )
    }

    // A document row: the disclosure sits in its own column on the left, as
    // in an outline, and a folded row previews its details' first line.
    return (
        <div
            draggable={writable && !editing && !editingDetails}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            className="group/item rounded-md px-1 py-0.5 hover:bg-accent/50"
        >
            <div className="flex items-start gap-1">
                {writable && <GripVertical aria-hidden className="mt-[5px] size-3.5 shrink-0 cursor-grab text-muted-foreground opacity-0 group-hover/item:opacity-100" />}
                <span className="inline-flex size-6 shrink-0 items-center justify-center">
                    {details && (
                        <button
                            type="button"
                            aria-expanded={open}
                            aria-label={open ? 'Hide details' : 'Show details'}
                            title={open ? 'Hide details' : 'Show details'}
                            onClick={() => setOpen(!open)}
                            className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                            <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
                        </button>
                    )}
                </span>
                {toggle}
                <div className="ml-1 min-w-0 flex-1">
                    {editing ? (
                        <input
                            autoFocus
                            defaultValue={item.text}
                            aria-label="Item text"
                            className="h-7 w-full rounded-md border border-border bg-background px-2 text-sm outline-none"
                            onKeyDown={commitKeys}
                            onBlur={(e) => (e.currentTarget.dataset.cancel ? setEditing(false) : commit(e.currentTarget.value))}
                        />
                    ) : (
                        <div
                            className={cn('break-words py-0.5 text-sm', item.done && 'text-muted-foreground line-through', writable && 'cursor-text')}
                            onClick={() => writable && setEditing(true)}
                        >
                            {item.text || <span className="text-muted-foreground">Untitled</span>}
                        </div>
                    )}
                    {editingDetails ? (
                        <DetailsEditor details={details} onCommit={commitDetails} onCancel={() => setEditingDetails(false)} />
                    ) : details && (open ? (
                        <div
                            className={cn('mb-1 min-w-0 break-words border-l-2 border-border pl-3 text-sm text-muted-foreground', writable && 'cursor-text')}
                            onDoubleClick={() => writable && setEditingDetails(true)}
                        >
                            <SpaceMarkdown body={details} />
                        </div>
                    ) : (
                        <button type="button" onClick={() => setOpen(true)} className="block w-full truncate pb-0.5 text-left text-xs text-muted-foreground hover:text-foreground">
                            {detailsPreview(details) || 'Details'}
                        </button>
                    ))}
                </div>
                {assign}
                {menu}
            </div>
        </div>
    )
}

/** Markdown details: blur or ⌘/Ctrl+Enter saves, Escape cancels. */
function DetailsEditor({ details, onCommit, onCancel }: { details: string; onCommit: (value: string) => void; onCancel: () => void }) {
    return (
        <textarea
            autoFocus
            defaultValue={details}
            rows={Math.min(12, Math.max(3, details.split('\n').length + 1))}
            placeholder="Details, in markdown… (⌘/Ctrl+Enter to save, Esc to cancel)"
            aria-label="Item details"
            className="mt-1 block w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none"
            onKeyDown={(e) => {
                if (e.key === 'Escape') e.currentTarget.dataset.cancel = '1'
                if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) e.currentTarget.blur()
            }}
            onBlur={(e) => (e.currentTarget.dataset.cancel ? onCancel() : onCommit(e.currentTarget.value))}
        />
    )
}

/** An opened card: everything about one item, editable in place. */
function TodoCardDialog({ item, sectionTitle, sections, writable, roster, names, onApply, onMoveTo, onDelete, onClose }: {
    item: TodoItem
    sectionTitle: string
    sections: { title: string; index: number }[]
    writable: boolean
    roster: ReturnType<typeof useSpaceMembers>
    names: Map<string, string>
    onApply: (make: (ref: ItemRef) => TodoEdit) => void
    onMoveTo: (section: number) => void
    onDelete: () => void
    onClose: () => void
}) {
    const details = itemDetails(item)
    const [editingDetails, setEditingDetails] = useState(false)
    const commitTitle = (value: string) => {
        if (value.trim() && value.trim() !== item.text) onApply((ref) => updateItem(ref, { text: value }))
    }
    return (
        <Dialog open onOpenChange={(next) => !next && onClose()}>
            <DialogContent
                className="max-h-[85vh] gap-5 overflow-y-auto sm:max-w-xl"
                // Escape in a field cancels that edit first; the next one closes the card.
                onEscapeKeyDown={(e) => {
                    const el = document.activeElement
                    if (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type === 'text')) {
                        e.preventDefault()
                        el.dataset.cancel = '1'
                        el.blur()
                    }
                }}
            >
                <DialogHeader className="gap-1.5 pr-6">
                    <div className="flex items-start gap-3">
                        <input
                            type="checkbox"
                            checked={item.done}
                            disabled={!writable}
                            aria-label={item.done ? `Mark "${item.text}" not done` : `Mark "${item.text}" done`}
                            onChange={(e) => onApply((ref) => updateItem(ref, { done: e.target.checked }))}
                            className="mt-1.5 size-4 shrink-0 cursor-pointer accent-primary"
                        />
                        <DialogTitle className={cn('min-w-0 flex-1 text-lg leading-7', !writable && 'break-words')}>
                            {writable ? (
                                <input
                                    key={item.text}
                                    defaultValue={item.text}
                                    aria-label="Item text"
                                    className="w-full rounded-md border border-transparent bg-transparent px-1.5 -mx-1.5 outline-none hover:border-border focus:border-border"
                                    onKeyDown={commitKeys}
                                    onBlur={(e) => {
                                        if (e.currentTarget.dataset.cancel) {
                                            delete e.currentTarget.dataset.cancel
                                            e.currentTarget.value = item.text
                                        } else commitTitle(e.currentTarget.value)
                                    }}
                                />
                            ) : item.text || 'Untitled'}
                        </DialogTitle>
                    </div>
                    <DialogDescription asChild>
                        <div className="flex items-center gap-1 pl-7 text-sm text-muted-foreground">
                            in{' '}
                            {writable && sections.length > 0 ? (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <button type="button" aria-label={`Section: ${sectionTitle}`} className="inline-flex items-center gap-0.5 rounded px-1 font-medium text-foreground hover:bg-accent">
                                            {sectionTitle} <ChevronDown className="size-3.5" />
                                        </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="start">
                                        {sections.map((s) => (
                                            <DropdownMenuItem key={s.index} onClick={() => onMoveTo(s.index)}>Move to {s.title}</DropdownMenuItem>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            ) : <span className="font-medium text-foreground">{sectionTitle}</span>}
                        </div>
                    </DialogDescription>
                </DialogHeader>
                <div className="flex items-center gap-3 pl-7 text-sm">
                    <span className="w-20 text-muted-foreground">Assignee</span>
                    <AssigneePicker
                        assignee={item.assignee}
                        writable={writable}
                        roster={roster}
                        names={names}
                        labelled
                        onAssign={(assignee) => onApply((ref) => updateItem(ref, { assignee }))}
                    />
                </div>
                <div className="pl-7">
                    <div className="mb-1.5 flex items-center gap-2">
                        <h4 className="flex-1 text-sm font-semibold">Details</h4>
                        {writable && details && !editingDetails && (
                            <button type="button" onClick={() => setEditingDetails(true)} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
                                <Pencil className="size-3" /> Edit
                            </button>
                        )}
                    </div>
                    {editingDetails ? (
                        <DetailsEditor
                            details={details}
                            onCommit={(value) => {
                                setEditingDetails(false)
                                if (value.trim() !== details) onApply((ref) => updateItem(ref, { details: value }))
                            }}
                            onCancel={() => setEditingDetails(false)}
                        />
                    ) : details ? (
                        <div className={cn('min-w-0 break-words text-sm', writable && 'cursor-text')} onDoubleClick={() => writable && setEditingDetails(true)}>
                            <SpaceMarkdown body={details} />
                        </div>
                    ) : writable ? (
                        <button type="button" onClick={() => setEditingDetails(true)} className="block w-full rounded-md bg-accent/60 px-3 py-3 text-left text-sm text-muted-foreground hover:bg-accent">
                            Add more detail…
                        </button>
                    ) : <p className="text-sm text-muted-foreground">No details.</p>}
                </div>
                {writable && (
                    <div className="flex justify-end border-t border-border pt-3">
                        <button type="button" onClick={onDelete} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                            <Trash2 className="size-3.5" /> Delete
                        </button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}

/**
 * People and agents alike (2026-10-25): assigning notifies no one and starts
 * no agent. It is a mention token in the file, which only messages act on.
 */
function AssigneePicker({ assignee, writable, roster, names, labelled, onAssign }: {
    assignee: TodoAssignee | null
    writable: boolean
    roster: ReturnType<typeof useSpaceMembers>
    names: Map<string, string>
    /** On an opened card: always shown, with the name beside the face. */
    labelled?: boolean
    onAssign: (assignee: TodoAssignee | null) => void
}) {
    const [open, setOpen] = useState(false)
    const name = assignee ? names.get(assignee.id) ?? assignee.label : null
    const face = assignee
        ? <MemberAvatar id={assignee.id} name={name!} size="sm" />
        : <UserPlus className="size-3.5" />
    if (!writable) {
        if (labelled) return <span className="inline-flex items-center gap-2">{assignee ? <>{face} {name}</> : <span className="text-muted-foreground">No one</span>}</span>
        return assignee ? <span title={name!} className="shrink-0">{face}</span> : null
    }
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    title={assignee ? `Assigned to ${name}` : 'Assign'}
                    aria-label={assignee ? `Assigned to ${name}` : 'Assign'}
                    className={cn(
                        'inline-flex shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground',
                        labelled ? 'gap-2 px-1.5 py-1 -mx-1.5 hover:bg-accent'
                            : assignee ? '' : 'size-6 opacity-0 hover:bg-accent focus-visible:opacity-100 group-hover/item:opacity-100 data-[state=open]:opacity-100',
                    )}
                >
                    {face}
                    {labelled && <span className={assignee ? 'text-foreground' : ''}>{assignee ? name : 'Assign'}</span>}
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-0">
                <Command>
                    <CommandInput placeholder="Assign to…" />
                    <CommandList>
                        <CommandEmpty>No one by that name</CommandEmpty>
                        <CommandGroup>
                            {assignee && (
                                <CommandItem value="unassign" onSelect={() => { setOpen(false); onAssign(null) }}>
                                    <X className="size-3.5 mr-2" /> Unassign
                                </CommandItem>
                            )}
                            {roster.map((m) => (
                                <CommandItem key={m.id} value={`${m.displayName} ${m.id}`} onSelect={() => { setOpen(false); onAssign({ id: m.id, label: m.displayName }) }}>
                                    <MemberAvatar id={m.id} name={m.displayName} size="sm" agent={m.kind === 'agent'} agentKind={m.agentKind} className="mr-2" />
                                    <span className="truncate">{m.displayName}</span>
                                    {m.kind === 'agent' && <span className="ml-auto text-xs text-muted-foreground">agent</span>}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}

function AddSection({ onAdd }: { onAdd: (title: string) => void }) {
    const [adding, setAdding] = useState(false)
    if (!adding) {
        return (
            <button type="button" onClick={() => setAdding(true)} className="inline-flex w-full items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground hover:border-foreground/30 hover:text-foreground">
                <Plus className="size-3.5" /> Add section
            </button>
        )
    }
    const commit = (value: string) => {
        setAdding(false)
        if (value.trim()) onAdd(value)
    }
    return (
        <input
            autoFocus
            placeholder="Section name…"
            aria-label="Section name"
            className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none"
            onKeyDown={commitKeys}
            onBlur={(e) => (e.currentTarget.dataset.cancel ? setAdding(false) : commit(e.currentTarget.value))}
        />
    )
}
