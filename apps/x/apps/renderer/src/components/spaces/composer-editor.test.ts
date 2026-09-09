import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { caretContext, composerExtensions, composerMarkdown } from './composer-editor'
import { encodeMentions, resolveMentions } from '@/lib/spaces-presentation'

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
        ['slash command draft', '/ask how do I ship this'],
        ['mention text', '@Ada Lovelace can you look?'],
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

    it('literal text inserted as a text node survives as text (escaped on the wire)', () => {
        const e = makeEditor('')
        e.chain().insertContent({ type: 'text', text: 'a * b _c_' }).run()
        const md = composerMarkdown(e)
        expect(e.getText()).toBe('a * b _c_')
        // Whatever escaping the serializer chose, it must parse back to the same text.
        expect(makeEditor(md).getText()).toBe('a * b _c_')
    })
})

describe('inline message editor round trip', () => {
    // The edit box seeds the editor with the posted body (mentions resolved to
    // names) and saves what it serializes back (mentions re-encoded). Opening
    // an edit and saving it untouched must reproduce the wire body exactly —
    // otherwise editing rewrites messages nobody changed.
    const members = [
        { id: '01HXAMPLEULIDHARSH000000', displayName: 'Harsh' },
        { id: '01HXAMPLEULIDRAMNIQUE000', displayName: 'Ramnique Singh' },
    ]
    const names = new Map(members.map((m) => [m.id, m.displayName]))
    const bodies: [string, string][] = [
        ['a mention', '@01HXAMPLEULIDHARSH000000 see a bunch of things like this'],
        ['a multi-word mention', 'hey @01HXAMPLEULIDRAMNIQUE000 can you look?'],
        ['two mentions and formatting', '@01HXAMPLEULIDHARSH000000 **please** ping @01HXAMPLEULIDRAMNIQUE000'],
        ['@rowboat and @here keep their handles', '@rowboat summarise for @here'],
        ['a mention mid-list', '- ask @01HXAMPLEULIDHARSH000000\n- then ship'],
        ['an id cited in code stays literal', 'the id `@01HXAMPLEULIDHARSH000000` is the wire form'],
    ]
    it.each(bodies)('%s', (_name, body) => {
        const editor = makeEditor(resolveMentions(body, names))
        expect(encodeMentions(composerMarkdown(editor), members)).toBe(body)
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
