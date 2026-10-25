import { spaces } from '@x/shared'

// A todo list (2026-10-25, Arjun's request in Main): a plain markdown file at
// todos/<name>.md that the files pane opens in its own editor, the way a
// whiteboard is a file at whiteboards/<name>.excalidraw. Markdown underneath
// so mobile, search and agents read and edit it unchanged, and so harbor's
// line merge does the collaboration: one item per line, so two people editing
// different items merge clean and moving an item touches two lines.
//
//   ## Backlog
//   - [ ] Draft pricing page [@Ramnique](#member:01M0…)
//   - [x] Ship Show more
//
// A section is a `##` heading; an item is a top-level `- [ ]` line, assigned
// by a trailing mention token. Every other line is kept as it was and moves
// with its section, so a hand-edited file round-trips byte for byte.

export const TODO_DIR = 'todos'

/** What "New todo list" files: one section to start typing into. */
export const NEW_TODO_LIST_CONTENT = '## To do\n'

export function isTodoListPath(path: string): boolean {
    return path.startsWith(`${TODO_DIR}/`) && /\.md$/i.test(path)
}

/** A typed list name → its asset path; null when nothing usable remains. */
export function todoListPathForName(name: string): string | null {
    const cleaned = name.trim().replace(/\//g, '-').replace(/\.md$/i, '').trim()
    return cleaned ? `${TODO_DIR}/${cleaned}.md` : null
}

/** "todos/launch.md" → "launch". */
export function todoListDisplayName(path: string): string {
    const base = path.slice(path.lastIndexOf('/') + 1)
    return base.replace(/\.md$/i, '')
}

export interface TodoAssignee {
    id: string
    /** The token's label: the name when it was written. The roster's current name wins on screen. */
    label: string
}

export interface TodoItem {
    /** The line as stored. Unchanged items serialize from it, so they never rewrite. */
    raw: string
    done: boolean
    text: string
    assignee: TodoAssignee | null
    /** Indented lines under the item (notes, sub-bullets). They move with it. */
    extra: string[]
}

export type TodoEntry = { kind: 'item'; item: TodoItem } | { kind: 'raw'; line: string }

export interface TodoSection {
    /** The `## ` line; null only for the lines before the first heading. */
    heading: string | null
    title: string
    entries: TodoEntry[]
}

export interface TodoDoc {
    /** sections[0] is always the part before the first heading (heading null). */
    sections: TodoSection[]
    trailingNewline: boolean
}

const HEADING_RE = /^##[ \t]+(.*?)[ \t]*$/
const ITEM_RE = /^([-*+]) \[( |x|X)\](?: (.*))?$/
const ASSIGNEE_RE = /[ \t]*\[@([^\]\n]*)\]\(#member:([^)\s]+)\)[ \t]*$/
const FENCE_RE = /^\s*(```+|~~~+)/

export function itemsOf(section: TodoSection): TodoItem[] {
    return section.entries.flatMap((e) => (e.kind === 'item' ? [e.item] : []))
}

function parseItem(line: string): TodoItem | null {
    const m = line.match(ITEM_RE)
    if (!m) return null
    let text = m[3] ?? ''
    let assignee: TodoAssignee | null = null
    const a = text.match(ASSIGNEE_RE)
    if (a) {
        assignee = { id: a[2]!, label: a[1]! }
        text = text.slice(0, a.index)
    }
    return { raw: line, done: m[2] !== ' ', text: text.trim(), assignee, extra: [] }
}

export function parseTodoList(content: string): TodoDoc {
    const trailingNewline = content.endsWith('\n')
    const lines = content === '' ? [] : (trailingNewline ? content.slice(0, -1) : content).split('\n')
    const sections: TodoSection[] = [{ heading: null, title: '', entries: [] }]
    let current = sections[0]!
    let fence: string | null = null
    let lastItem: TodoItem | null = null
    let i = 0
    // Frontmatter is the preamble's, verbatim.
    if (lines[0] === '---') {
        const end = lines.indexOf('---', 1)
        if (end > 0) {
            for (; i <= end; i += 1) current.entries.push({ kind: 'raw', line: lines[i]! })
        }
    }
    for (; i < lines.length; i += 1) {
        const line = lines[i]!
        const fenceMark = line.match(FENCE_RE)?.[1]
        if (fence !== null || fenceMark) {
            if (fenceMark) {
                if (fence === null) fence = fenceMark[0]!
                else if (fenceMark[0] === fence) fence = null
            }
            // A fence inside an item's notes stays with the item.
            if (lastItem && /^\s/.test(line)) lastItem.extra.push(line)
            else {
                lastItem = null
                current.entries.push({ kind: 'raw', line })
            }
            continue
        }
        const heading = line.match(HEADING_RE)
        if (heading) {
            current = { heading: line, title: heading[1]!, entries: [] }
            sections.push(current)
            lastItem = null
            continue
        }
        const item = parseItem(line)
        if (item) {
            current.entries.push({ kind: 'item', item })
            lastItem = item
            continue
        }
        if (lastItem && line.trim() !== '' && /^\s/.test(line)) {
            lastItem.extra.push(line)
            continue
        }
        lastItem = null
        current.entries.push({ kind: 'raw', line })
    }
    return { sections, trailingNewline }
}

export function serializeTodoList(doc: TodoDoc): string {
    const lines: string[] = []
    for (const section of doc.sections) {
        if (section.heading !== null) lines.push(section.heading)
        for (const entry of section.entries) {
            if (entry.kind === 'raw') lines.push(entry.line)
            else lines.push(entry.item.raw, ...entry.item.extra)
        }
    }
    if (lines.length === 0) return ''
    return lines.join('\n') + (doc.trailingNewline ? '\n' : '')
}

function oneLine(text: string): string {
    return text.replace(/\s*\n\s*/g, ' ').trim()
}

export function formatItem(item: Pick<TodoItem, 'done' | 'text' | 'assignee'>, bullet = '-'): string {
    const text = oneLine(item.text)
    const token = item.assignee ? spaces.mentionToken({ kind: 'member', id: item.assignee.id, label: item.assignee.label }) : ''
    return `${bullet} [${item.done ? 'x' : ' '}]${text ? ` ${text}` : ''}${token ? ` ${token}` : ''}`
}

// ---------------------------------------------------------------------------
// Edits. Each one is a function of the document, so a save that conflicts can
// re-read the file and apply the same edit to what is there now. Refs carry
// enough to find their target again after someone else's change moved it.
// ---------------------------------------------------------------------------

export interface SectionRef {
    index: number
    heading: string | null
}

export interface ItemRef {
    section: SectionRef
    index: number
    raw: string
}

export type TodoEdit = (doc: TodoDoc) => TodoDoc | null

export function sectionRef(doc: TodoDoc, index: number): SectionRef {
    return { index, heading: doc.sections[index]?.heading ?? null }
}

export function itemRef(doc: TodoDoc, section: number, index: number): ItemRef {
    return { section: sectionRef(doc, section), index, raw: itemsOf(doc.sections[section]!)[index]?.raw ?? '' }
}

function findSection(doc: TodoDoc, ref: SectionRef): number {
    if (doc.sections[ref.index]?.heading === ref.heading) return ref.index
    if (ref.heading === null) return 0
    return doc.sections.findIndex((s) => s.heading === ref.heading)
}

function findItem(doc: TodoDoc, ref: ItemRef): { section: number; index: number } | null {
    const s = findSection(doc, ref.section)
    if (s >= 0 && itemsOf(doc.sections[s]!)[ref.index]?.raw === ref.raw) return { section: s, index: ref.index }
    for (let si = 0; si < doc.sections.length; si += 1) {
        const i = itemsOf(doc.sections[si]!).findIndex((it) => it.raw === ref.raw)
        if (i >= 0) return { section: si, index: i }
    }
    return null
}

function clone(doc: TodoDoc): TodoDoc {
    return { ...doc, sections: doc.sections.map((s) => ({ ...s, entries: [...s.entries] })) }
}

/** The entry position of the index-th item; past the last item, the slot after it (before trailing blank lines). */
function entryIndexForItem(section: TodoSection, index: number): number {
    let seen = 0
    let afterLast = -1
    for (let e = 0; e < section.entries.length; e += 1) {
        const entry = section.entries[e]!
        if (entry.kind !== 'item') continue
        if (seen === index) return e
        seen += 1
        afterLast = e + 1
    }
    if (afterLast >= 0) return afterLast
    // No items yet: after any prose, before the blank lines that end the section.
    let end = section.entries.length
    while (end > 0) {
        const entry = section.entries[end - 1]!
        if (entry.kind === 'raw' && entry.line.trim() === '') end -= 1
        else break
    }
    return end
}

function removeItemAt(section: TodoSection, index: number): TodoItem {
    const e = entryIndexForItem(section, index)
    const [entry] = section.entries.splice(e, 1)
    return (entry as { kind: 'item'; item: TodoItem }).item
}

function insertItemAt(section: TodoSection, index: number, item: TodoItem): void {
    section.entries.splice(entryIndexForItem(section, index), 0, { kind: 'item', item })
}

export function addSection(title: string): TodoEdit {
    return (doc) => {
        const clean = oneLine(title)
        if (!clean) return null
        const next = clone(doc)
        const last = next.sections[next.sections.length - 1]!
        const lastEntry = last.entries[last.entries.length - 1]
        // A blank line between sections, the way people write them.
        const lastIsBlank = lastEntry?.kind === 'raw' && lastEntry.line.trim() === ''
        if ((last.heading !== null || last.entries.length > 0) && !lastIsBlank) last.entries.push({ kind: 'raw', line: '' })
        next.sections.push({ heading: `## ${clean}`, title: clean, entries: [] })
        next.trailingNewline = true
        return next
    }
}

export function renameSection(ref: SectionRef, title: string): TodoEdit {
    return (doc) => {
        const clean = oneLine(title)
        const s = findSection(doc, ref)
        if (!clean || s <= 0) return null
        const next = clone(doc)
        next.sections[s] = { ...next.sections[s]!, heading: `## ${clean}`, title: clean }
        return next
    }
}

/** Deletes the heading and everything under it, items included. */
export function deleteSection(ref: SectionRef): TodoEdit {
    return (doc) => {
        const s = findSection(doc, ref)
        if (s <= 0) return null
        const next = clone(doc)
        next.sections.splice(s, 1)
        return next
    }
}

/** `to` is the section index it lands at (1 = first heading). */
export function moveSection(ref: SectionRef, to: number): TodoEdit {
    return (doc) => {
        const s = findSection(doc, ref)
        if (s <= 0 || to < 1 || to >= doc.sections.length || to === s) return null
        const next = clone(doc)
        const [moved] = next.sections.splice(s, 1)
        // The last section may lack the blank line that separates sections.
        const ensureGap = (section: TodoSection) => {
            const last = section.entries[section.entries.length - 1]
            if (!(last?.kind === 'raw' && last.line.trim() === '')) section.entries.push({ kind: 'raw', line: '' })
        }
        if (to < next.sections.length) ensureGap(moved!)
        next.sections.splice(to, 0, moved!)
        if (to === next.sections.length - 1) ensureGap(next.sections[to - 1]!)
        return next
    }
}

export function addItem(section: SectionRef, text: string, assignee: TodoAssignee | null = null): TodoEdit {
    return (doc) => {
        const s = findSection(doc, section)
        const clean = oneLine(text)
        if (s < 0 || !clean) return null
        const next = clone(doc)
        const target = next.sections[s]!
        const fields = { done: false, text: clean, assignee }
        insertItemAt(target, itemsOf(target).length, { ...fields, raw: formatItem(fields), extra: [] })
        return next
    }
}

export function updateItem(ref: ItemRef, patch: Partial<Pick<TodoItem, 'done' | 'text' | 'assignee'>>): TodoEdit {
    return (doc) => {
        const at = findItem(doc, ref)
        if (!at) return null
        const next = clone(doc)
        const section = next.sections[at.section]!
        const e = entryIndexForItem(section, at.index)
        const old = (section.entries[e] as { kind: 'item'; item: TodoItem }).item
        const fields = { done: patch.done ?? old.done, text: patch.text !== undefined ? oneLine(patch.text) : old.text, assignee: patch.assignee !== undefined ? patch.assignee : old.assignee }
        if (!fields.text) return null
        const bullet = old.raw.match(ITEM_RE)?.[1] ?? '-'
        section.entries[e] = { kind: 'item', item: { ...old, ...fields, raw: formatItem(fields, bullet) } }
        return next
    }
}

export function deleteItem(ref: ItemRef): TodoEdit {
    return (doc) => {
        const at = findItem(doc, ref)
        if (!at) return null
        const next = clone(doc)
        removeItemAt(next.sections[at.section]!, at.index)
        return next
    }
}

/**
 * Moves an item to sit before the item now at `to` in the target section
 * (`to` = its item count appends). Positions are read before the move, the
 * way a drop indicator shows them.
 */
export function moveItem(ref: ItemRef, toSection: SectionRef, to: number): TodoEdit {
    return (doc) => {
        const at = findItem(doc, ref)
        const s = findSection(doc, toSection)
        if (!at || s < 0) return null
        let index = to
        if (at.section === s) {
            if (index === at.index || index === at.index + 1) return null
            if (at.index < index) index -= 1
        }
        const next = clone(doc)
        const item = removeItemAt(next.sections[at.section]!, at.index)
        insertItemAt(next.sections[s]!, Math.min(index, itemsOf(next.sections[s]!).length), item)
        return next
    }
}
