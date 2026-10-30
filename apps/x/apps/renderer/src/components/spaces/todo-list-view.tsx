import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Columns3, GripVertical, MoreHorizontal, Pencil, Plus, Rows3, Trash2, UserPlus, X } from 'lucide-react'
import { invokeSpace } from '@/lib/spaces-invoke'
import { canActInSpace, useSpaceAccess } from '@/lib/spaces-access'
import { useSpaceMembers } from '@/hooks/use-space-members'
import { isDeparted, isOthersPersonalAgent } from '@/lib/spaces-direct'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { MemberAvatar } from '@/components/spaces/atoms'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    addItem, addSection, deleteItem, deleteSection, itemRef, itemsOf, moveItem, moveSection, parseTodoList, renameSection, sectionRef, serializeTodoList, updateItem,
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
    // An assignee is a mention, so someone else's personal agent is left out (2026-10-30).
    const roster = useMemo(() => members.filter((m) => !isDeparted(m) && !isOthersPersonalAgent(m, selfMemberId)), [members, selfMemberId])
    const names = useMemo(() => new Map(members.map((m) => [m.id, m.displayName])), [members])

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
        onApply: apply, onDrop: dropAt, onDragOverAt: (s: number, i: number) => setDrop({ section: s, index: i }), onDragEnd: endDrag,
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
                    {shown.map(({ index }) => (
                        <div key={`${index}:${doc.sections[index]!.heading}`} className="flex max-h-full w-72 shrink-0 flex-col rounded-lg bg-[var(--rowboat-wash)]">
                            <TodoSectionBlock {...sectionProps(index)} />
                        </div>
                    ))}
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
        </div>
    )
}

function TodoSectionBlock({ doc, index, writable, roster, names, drop, dragging, view, isFirst, isLast, onApply, onDrop, onDragOverAt, onDragEnd }: {
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
            <div className={cn('flex min-h-0 flex-col', board && 'gap-1.5 overflow-y-auto')}>
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

function TodoItemRow({ item, board, writable, roster, names, sections, onApply, onMoveTo, onDragStart, onDragOver, onDragEnd }: {
    item: TodoItem
    board: boolean
    writable: boolean
    roster: ReturnType<typeof useSpaceMembers>
    names: Map<string, string>
    sections: { title: string; index: number }[]
    onApply: (make: (ref: ItemRef) => TodoEdit) => void
    onMoveTo: (section: number) => void
    onDragStart: (e: React.DragEvent<HTMLDivElement>) => void
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => void
    onDragEnd: () => void
}) {
    const [editing, setEditing] = useState(false)
    const commit = (value: string) => {
        setEditing(false)
        if (value.trim() && value.trim() !== item.text) onApply((ref) => updateItem(ref, { text: value }))
    }
    return (
        <div
            draggable={writable && !editing}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            className={cn(
                'group/item flex items-center gap-2 rounded-md px-1 py-1',
                board ? 'border border-border bg-background px-2 py-2 shadow-xs' : 'hover:bg-accent/50',
            )}
        >
            {writable && <GripVertical aria-hidden className="size-3.5 shrink-0 cursor-grab text-muted-foreground opacity-0 group-hover/item:opacity-100" />}
            <input
                type="checkbox"
                checked={item.done}
                disabled={!writable}
                aria-label={item.done ? `Mark "${item.text}" not done` : `Mark "${item.text}" done`}
                onChange={(e) => onApply((ref) => updateItem(ref, { done: e.target.checked }))}
                className="size-4 shrink-0 cursor-pointer accent-primary"
            />
            {editing ? (
                <input
                    autoFocus
                    defaultValue={item.text}
                    aria-label="Item text"
                    className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm outline-none"
                    onKeyDown={commitKeys}
                    onBlur={(e) => (e.currentTarget.dataset.cancel ? setEditing(false) : commit(e.currentTarget.value))}
                />
            ) : (
                <span
                    className={cn('min-w-0 flex-1 break-words text-sm', item.done && 'text-muted-foreground line-through', writable && 'cursor-text')}
                    onClick={() => writable && setEditing(true)}
                >
                    {item.text || <span className="text-muted-foreground">Untitled</span>}
                </span>
            )}
            <AssigneePicker
                assignee={item.assignee}
                writable={writable}
                roster={roster}
                names={names}
                onAssign={(assignee) => onApply((ref) => updateItem(ref, { assignee }))}
            />
            {writable && (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button type="button" aria-label="Item options" className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/item:opacity-100 data-[state=open]:opacity-100">
                            <MoreHorizontal className="size-3.5" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
                        <DropdownMenuItem onClick={() => setEditing(true)}><Pencil className="size-3.5 mr-2" /> Edit</DropdownMenuItem>
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
            )}
        </div>
    )
}

/**
 * People and agents alike (2026-10-25): assigning notifies no one and starts
 * no agent. It is a mention token in the file, which only messages act on.
 */
function AssigneePicker({ assignee, writable, roster, names, onAssign }: {
    assignee: TodoAssignee | null
    writable: boolean
    roster: ReturnType<typeof useSpaceMembers>
    names: Map<string, string>
    onAssign: (assignee: TodoAssignee | null) => void
}) {
    const [open, setOpen] = useState(false)
    const name = assignee ? names.get(assignee.id) ?? assignee.label : null
    const face = assignee
        ? <MemberAvatar id={assignee.id} name={name!} size="sm" />
        : <UserPlus className="size-3.5" />
    if (!writable) return assignee ? <span title={name!} className="shrink-0">{face}</span> : null
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    title={assignee ? `Assigned to ${name}` : 'Assign'}
                    aria-label={assignee ? `Assigned to ${name}` : 'Assign'}
                    className={cn(
                        'inline-flex shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground',
                        assignee ? '' : 'size-6 opacity-0 hover:bg-accent focus-visible:opacity-100 group-hover/item:opacity-100 data-[state=open]:opacity-100',
                    )}
                >
                    {face}
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
