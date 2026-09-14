import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { caretContext, closeFenceLine, composerExtensions, composerMarkdown, openFenceLine } from './composer-editor'

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

// jsdom has no ClipboardEvent; ProseMirror's paste entry points only hand
// the event to handlePaste, so any Event stands in.
const pasteEvent = () => new Event('paste') as unknown as ClipboardEvent
const nodeNames = (e: Editor) => e.state.doc.content.content.map((n) => n.type.name)
/** Keystrokes at the caret. (Any transaction lets StarterKit's TrailingNode add its empty paragraph after a trailing block.) */
const type = (e: Editor, text: string) => e.view.dispatch(e.state.tr.insertText(text))

describe('fenced code', () => {
    it('a plain-text paste with a fence becomes a code block — lines, blank lines and the language kept, the prose around it literal', () => {
        const e = makeEditor('')
        e.commands.focus('end')
        e.view.pasteText('Try this:\n```ts\nconst a = 1\n\nconst b = *2*\n```\nthen run it', pasteEvent())
        expect(nodeNames(e)).toEqual(['paragraph', 'codeBlock', 'paragraph'])
        expect(composerMarkdown(e)).toBe('Try this:\n\n```ts\nconst a = 1\n\nconst b = *2*\n```\n\nthen run it')
    })

    it('a pasted fence alone is one code block, and one pasted after typed text lands under it', () => {
        const alone = makeEditor('')
        alone.commands.focus('end')
        alone.view.pasteText('```\nconst x = 1\nconst y = 2\n```', pasteEvent())
        expect(composerMarkdown(alone)).toBe('```\nconst x = 1\nconst y = 2\n```')
        const after = makeEditor('hello')
        after.commands.focus('end')
        after.view.pasteText('```\ncode\n```', pasteEvent())
        expect(composerMarkdown(after)).toBe('hello\n\n```\ncode\n```')
        // Mid-sentence, the block splits the paragraph rather than merging into it.
        const mid = makeEditor('hello world')
        mid.commands.setTextSelection(6)
        mid.view.pasteText('```\ncode\n```', pasteEvent())
        expect(nodeNames(mid)).toEqual(['paragraph', 'codeBlock', 'paragraph'])
    })

    it('a pasted <pre> block (a rendered page, a code editor) stays a block after typed text too', () => {
        const e = makeEditor('here is the error:')
        e.commands.focus('end')
        e.view.pasteHTML('<pre><code class="language-sh">npm ERR! code 1</code></pre>', pasteEvent())
        expect(composerMarkdown(e)).toBe('here is the error:\n\n```sh\nnpm ERR! code 1\n```')
    })

    it('an unclosed fence, and text without one, paste as before — literal lines', () => {
        const open = makeEditor('')
        open.commands.focus('end')
        open.view.pasteText('```\ncode', pasteEvent())
        expect(composerMarkdown(open)).toBe('\\`\\`\\`\n\ncode')
        const plain = makeEditor('')
        plain.commands.focus('end')
        plain.view.pasteText('line1\nline2', pasteEvent())
        expect(composerMarkdown(plain)).toBe('line1\n\nline2')
    })

    it('an HTML paste whose fence lines arrived as paragraphs, or as one paragraph of hard breaks, folds into a code block', () => {
        const paragraphs = makeEditor('')
        paragraphs.commands.focus('end')
        paragraphs.view.pasteHTML('<p><strong>bold</strong> intro</p><p>```</p><p>x = 1</p><p>```</p>', pasteEvent())
        expect(composerMarkdown(paragraphs)).toBe('**bold** intro\n\n```\nx = 1\n```')
        const breaks = makeEditor('')
        breaks.commands.focus('end')
        breaks.view.pasteHTML('<p>see:<br>```py<br>print(1)<br>```<br>done</p>', pasteEvent())
        expect(nodeNames(breaks)).toEqual(['paragraph', 'codeBlock', 'paragraph'])
        expect(composerMarkdown(breaks)).toBe('see:\n\n```py\nprint(1)\n```\n\ndone')
    })

    it('openFenceLine turns a typed ```lang line into a code block, alone or under prose', () => {
        const alone = makeEditor('\\`\\`\\`js')
        alone.commands.focus('end')
        expect(openFenceLine(alone)).toBe(true)
        expect(nodeNames(alone)).toEqual(['codeBlock', 'paragraph'])
        type(alone, 'let a')
        expect(composerMarkdown(alone)).toBe('```js\nlet a\n```')
        const under = makeEditor('intro')
        under.chain().focus('end').setHardBreak().run()
        type(under, '```')
        expect(openFenceLine(under)).toBe(true)
        expect(nodeNames(under)).toEqual(['paragraph', 'codeBlock', 'paragraph'])
        type(under, 'x')
        expect(composerMarkdown(under)).toBe('intro\n\n```\nx\n```')
    })

    it('openFenceLine leaves any other line alone', () => {
        const e = makeEditor('not a fence')
        e.commands.focus('end')
        expect(openFenceLine(e)).toBe(false)
        expect(composerMarkdown(e)).toBe('not a fence')
    })

    it('closeFenceLine on a typed closing ``` leaves the block for the paragraph after it; a code line stays code', () => {
        const e = makeEditor('```\nhello\n```')
        e.commands.focus('end')
        type(e, '\n```')
        expect(closeFenceLine(e)).toBe(true)
        // The editor's own trailing paragraph is reused, not doubled.
        expect(nodeNames(e)).toEqual(['codeBlock', 'paragraph'])
        type(e, 'after')
        expect(composerMarkdown(e)).toBe('```\nhello\n```\n\nafter')
        const code = makeEditor('```\nhello\n```')
        code.commands.focus('end')
        expect(closeFenceLine(code)).toBe(false)
        expect(composerMarkdown(code)).toBe('```\nhello\n```')
    })

    it('closeFenceLine on a block holding nothing but the closer drops the block', () => {
        const e = makeEditor('```\n```')
        e.commands.focus('end')
        type(e, '```')
        expect(nodeNames(e)).toEqual(['codeBlock', 'paragraph'])
        expect(closeFenceLine(e)).toBe(true)
        expect(nodeNames(e)).toEqual(['paragraph'])
        expect(composerMarkdown(e)).toBe('')
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
