import { describe, expect, it } from 'vitest'
import {
    addItem,
    addSection,
    deleteItem,
    deleteSection,
    isTodoListPath,
    itemRef,
    itemsOf,
    moveItem,
    moveSection,
    parseTodoList,
    renameSection,
    sectionRef,
    serializeTodoList,
    todoListPathForName,
    updateItem,
    type TodoEdit,
} from './todo-list'

const ARJUN = '01M0KTADMQSQ35V1M2WH15XNTY'

const run = (content: string, edit: (doc: ReturnType<typeof parseTodoList>) => TodoEdit): string | null => {
    const doc = parseTodoList(content)
    const next = edit(doc)(doc)
    return next ? serializeTodoList(next) : null
}

describe('todo list paths', () => {
    it('recognises markdown under todos/', () => {
        expect(isTodoListPath('todos/launch.md')).toBe(true)
        expect(isTodoListPath('todos/q4/launch.md')).toBe(true)
        expect(isTodoListPath('notes/launch.md')).toBe(false)
        expect(isTodoListPath('todos/launch.txt')).toBe(false)
    })
    it('turns a typed name into a path', () => {
        expect(todoListPathForName(' Launch ')).toBe('todos/Launch.md')
        expect(todoListPathForName('a/b.md')).toBe('todos/a-b.md')
        expect(todoListPathForName('  ')).toBeNull()
    })
})

describe('parseTodoList', () => {
    it('reads sections, items, done and assignees', () => {
        const doc = parseTodoList(`## Backlog\n- [ ] Draft pricing [@Arjun](#member:${ARJUN})\n- [x] Ship it\n## Done\n`)
        expect(doc.sections.map((s) => s.title)).toEqual(['', 'Backlog', 'Done'])
        expect(itemsOf(doc.sections[1]!)).toMatchObject([
            { text: 'Draft pricing', done: false, assignee: { id: ARJUN, label: 'Arjun' } },
            { text: 'Ship it', done: true, assignee: null },
        ])
    })

    it('round-trips a hand-edited file byte for byte', () => {
        const files = [
            '',
            '## A',
            '## A\n',
            '---\ntitle: x\n## not a heading\n---\n# Launch\n\nSome prose.\n\n## Backlog\n- [ ] one\n  a note under one\n  - [ ] a sub-task\n\n* [X] star bullet\n### Sub heading\n- plain bullet\n```\n## in a fence\n- [ ] in a fence\n```\n\n## Done\n- [x] shipped [@A](#member:X)  \n\n\n',
            '- [ ] before any heading\n## Later\n- [ ]\n',
        ]
        for (const f of files) expect(serializeTodoList(parseTodoList(f))).toBe(f)
    })

    it('leaves fenced and nested checkboxes alone', () => {
        const doc = parseTodoList('## A\n```\n- [ ] code\n```\n- [ ] real\n  - [ ] nested\n')
        expect(itemsOf(doc.sections[1]!).map((i) => i.text)).toEqual(['real'])
        expect(itemsOf(doc.sections[1]!)[0]!.extra).toEqual(['  - [ ] nested'])
    })
})

describe('edits', () => {
    const base = '## Backlog\n- [ ] one\n- [ ] two\n  note on two\n\n## Doing\n- [ ] three\n'

    it('adds a section at the end with a blank line before it', () => {
        expect(run(base, () => addSection('Done'))).toBe(`${base}\n## Done\n`)
        expect(run('', () => addSection('To do'))).toBe('## To do\n')
    })

    it('adds an item after the last one, before the blank line', () => {
        expect(run(base, (d) => addItem(sectionRef(d, 1), 'new', { id: ARJUN, label: 'Arjun' })))
            .toBe(`## Backlog\n- [ ] one\n- [ ] two\n  note on two\n- [ ] new [@Arjun](#member:${ARJUN})\n\n## Doing\n- [ ] three\n`)
        expect(run('## Empty\n\n## Next\n', (d) => addItem(sectionRef(d, 1), 'x'))).toBe('## Empty\n- [ ] x\n\n## Next\n')
    })

    it('ticks, retitles and assigns by rewriting only that line', () => {
        expect(run(base, (d) => updateItem(itemRef(d, 1, 0), { done: true }))).toBe(base.replace('- [ ] one', '- [x] one'))
        expect(run(base, (d) => updateItem(itemRef(d, 1, 0), { text: 'uno' }))).toBe(base.replace('- [ ] one', '- [ ] uno'))
        const assigned = run(base, (d) => updateItem(itemRef(d, 1, 0), { assignee: { id: ARJUN, label: 'Arjun' } }))!
        expect(assigned).toBe(base.replace('- [ ] one', `- [ ] one [@Arjun](#member:${ARJUN})`))
        expect(run(assigned, (d) => updateItem(itemRef(d, 1, 0), { assignee: null }))).toBe(base)
        expect(run(base, (d) => updateItem(itemRef(d, 1, 0), { text: '  ' }))).toBeNull()
    })

    it('moves an item and its notes across sections', () => {
        expect(run(base, (d) => moveItem(itemRef(d, 1, 1), sectionRef(d, 2), 0)))
            .toBe('## Backlog\n- [ ] one\n\n## Doing\n- [ ] two\n  note on two\n- [ ] three\n')
        expect(run(base, (d) => moveItem(itemRef(d, 2, 0), sectionRef(d, 1), 2)))
            .toBe('## Backlog\n- [ ] one\n- [ ] two\n  note on two\n- [ ] three\n\n## Doing\n')
    })

    it('reorders within a section, positions read before the move', () => {
        expect(run(base, (d) => moveItem(itemRef(d, 1, 0), sectionRef(d, 1), 2)))
            .toBe('## Backlog\n- [ ] two\n  note on two\n- [ ] one\n\n## Doing\n- [ ] three\n')
        expect(run(base, (d) => moveItem(itemRef(d, 1, 0), sectionRef(d, 1), 1))).toBeNull()
    })

    it('deletes items and sections', () => {
        expect(run(base, (d) => deleteItem(itemRef(d, 1, 1)))).toBe('## Backlog\n- [ ] one\n\n## Doing\n- [ ] three\n')
        expect(run(base, (d) => deleteSection(sectionRef(d, 1)))).toBe('## Doing\n- [ ] three\n')
        expect(run(base, (d) => deleteSection(sectionRef(d, 0)))).toBeNull()
    })

    it('renames and reorders sections', () => {
        expect(run(base, (d) => renameSection(sectionRef(d, 2), 'In progress'))).toBe(base.replace('## Doing', '## In progress'))
        expect(run(base, (d) => moveSection(sectionRef(d, 2), 1)))
            .toBe('## Doing\n- [ ] three\n\n## Backlog\n- [ ] one\n- [ ] two\n  note on two\n\n')
        expect(run(base, (d) => moveSection(sectionRef(d, 1), 2)))
            .toBe('## Doing\n- [ ] three\n\n## Backlog\n- [ ] one\n- [ ] two\n  note on two\n\n')
    })

    it('finds its target again after someone else changed the file', () => {
        const doc = parseTodoList(base)
        const edit = updateItem(itemRef(doc, 2, 0), { done: true })
        // Meanwhile someone added a section above and an item before "three".
        const theirs = parseTodoList('## New\n\n' + base.replace('## Doing\n', '## Doing\n- [ ] zero\n'))
        expect(serializeTodoList(edit(theirs)!)).toContain('- [x] three')
        // And an item someone deleted can't be edited.
        expect(edit(parseTodoList('## Backlog\n'))).toBeNull()
    })
})
