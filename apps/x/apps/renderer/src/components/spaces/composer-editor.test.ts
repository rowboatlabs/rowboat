import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { caretContext, composerExtensions, composerMarkdown } from './composer-editor'

// The composer's contract: what the editor holds serializes back to the
// exact markdown the wire (and every downstream consumer: drafts, slash
// commands, @rowboat detection) expects. These tests pin that round trip.

let editors: Editor[] = []

function makeEditor(content = ''): Editor {
    const editor = new Editor({
        element: document.createElement('div'),
        extensions: composerExtensions(() => ''),
        content,
    })
    editors.push(editor)
    return editor
}

afterEach(() => {
    for (const e of editors) e.destroy()
    editors = []
})

describe('markdown round trip', () => {
    const cases: [string, string][] = [
        ['plain text', 'hello world'],
        ['bold', '**bold** text'],
        ['italic', 'an *italic* word'],
        ['strike', '~~gone~~ now'],
        ['inline code', 'run `npm test` now'],
        ['link', '[docs](https://example.com)'],
        ['bullet list', '- one\n- two'],
        ['ordered list', '1. one\n2. two'],
        ['blockquote', '> quoted'],
        ['code block', '```\nconst x = 1\nconst y = 2\n```'],
        ['image', '![](https://example.com/cat.gif)'],
        ['two paragraphs', 'first\n\nsecond'],
        ['line break', 'first\nsecond'],
        ['slash command draft', '/ask how do I ship this'],
        ['mention text (prose)', '@Ada Lovelace can you look?'],
        ['member mention token', '[@Ada Lovelace](#member:01HADA) can you look?'],
        ['here token', 'standup [@here](#here)'],
        ['rowboat token', '[@rowboat](#rowboat) summarise this'],
    ]
    it.each(cases)('%s', (_name, md) => {
        expect(composerMarkdown(makeEditor(md))).toBe(md)
    })

    it('serializes an empty doc to the empty string', () => {
        expect(composerMarkdown(makeEditor(''))).toBe('')
    })
})

describe('formatting commands produce wire markdown', () => {
    it('toggleBold', () => {
        const e = makeEditor('hello')
        e.chain().selectAll().toggleBold().run()
        expect(composerMarkdown(e)).toBe('**hello**')
    })

    it('toggleStrike', () => {
        const e = makeEditor('hello')
        e.chain().selectAll().toggleStrike().run()
        expect(composerMarkdown(e)).toBe('~~hello~~')
    })

    it('toggleBulletList', () => {
        const e = makeEditor('hello')
        e.chain().selectAll().toggleBulletList().run()
        expect(composerMarkdown(e)).toBe('- hello')
    })

    it('toggleBlockquote', () => {
        const e = makeEditor('hello')
        e.chain().selectAll().toggleBlockquote().run()
        expect(composerMarkdown(e)).toBe('> hello')
    })

    it('toggleCodeBlock turns the paragraph into a fence', () => {
        const e = makeEditor('hello')
        e.chain().selectAll().toggleCodeBlock().run()
        expect(composerMarkdown(e)).toBe('```\nhello\n```')
    })

    it('text typed inside a code block keeps literal markdown characters', () => {
        const e = makeEditor('```\nhello\n```')
        e.chain().focus('end').insertContent({ type: 'text', text: ' *raw*' }).run()
        expect(composerMarkdown(e)).toBe('```\nhello *raw*\n```')
    })

    it('a mention token parses to ONE atom node and serializes back to the same token', () => {
        const body = 'hey [@Ada Lovelace](#member:01HADA) and [@here](#here), [@rowboat](#rowboat) go'
        const editor = makeEditor(body)
        const mentions: Array<{ kind: string; id: string | null; label: string }> = []
        editor.state.doc.descendants((node) => {
            if (node.type.name === 'mention') mentions.push(node.attrs as { kind: string; id: string | null; label: string })
        })
        expect(mentions).toEqual([
            { kind: 'member', id: '01HADA', label: 'Ada Lovelace' },
            { kind: 'here', id: null, label: 'here' },
            { kind: 'rowboat', id: null, label: 'rowboat' },
        ])
        expect(composerMarkdown(editor)).toBe(body)
    })

    it('Shift+Enter serializes as a newline, never a backslash escape', () => {
        const e = makeEditor('one')
        e.chain().focus('end').setHardBreak().insertContent({ type: 'text', text: 'two' }).run()
        expect(composerMarkdown(e)).toBe('one\ntwo')
    })

    it('a break before a line that opens a block leaves no stray backslash', () => {
        // CommonMark's `\` hard break renders as itself once the next line
        // starts a list/heading/quote — the case that put backslashes in
        // sent messages.
        const e = makeEditor('Plan:')
        e.chain().focus('end').setHardBreak().insertContent({ type: 'text', text: '- one' }).run()
        expect(composerMarkdown(e)).toBe('Plan:\n- one')
    })

    it('a break inside a list item indents the continuation', () => {
        const e = makeEditor('- one')
        e.chain().focus('end').setHardBreak().insertContent({ type: 'text', text: 'two' }).run()
        expect(composerMarkdown(e)).toBe('- one\n  two')
    })

    it('a bare @name stays text — nothing rewrites prose into an address', () => {
        const editor = makeEditor('@Ada Lovelace can you look?')
        let nodes = 0
        editor.state.doc.descendants((node) => {
            if (node.type.name === 'mention') nodes += 1
        })
        expect(nodes).toBe(0)
        expect(composerMarkdown(editor)).toBe('@Ada Lovelace can you look?')
    })
})

describe('caretContext', () => {
    it('reports the text before the caret in the current block', () => {
        const e = makeEditor('hello @ro')
        e.commands.focus('end')
        expect(caretContext(e)).toEqual({ text: 'hello @ro', from: e.state.selection.from })
    })

    it('reads a hard break as a newline, so "@" after Shift+Enter sits on a word boundary', () => {
        const e = makeEditor('hello')
        e.chain().focus('end').setHardBreak().insertContent({ type: 'text', text: '@ro' }).run()
        expect(caretContext(e)?.text).toBe('hello\n@ro')
    })

    it('is null for a range selection and inside code', () => {
        const e = makeEditor('hello')
        e.commands.selectAll()
        expect(caretContext(e)).toBeNull()
        const code = makeEditor('```\nx\n```')
        code.commands.focus('end')
        expect(caretContext(code)).toBeNull()
    })
})
