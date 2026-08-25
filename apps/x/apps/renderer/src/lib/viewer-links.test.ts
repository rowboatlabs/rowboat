import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { Markdown } from 'tiptap-markdown'
import { allowRelativeAndAppHrefs } from './viewer-links'

const ok = () => false

describe('allowRelativeAndAppHrefs', () => {
    it('accepts relative paths and app:// URLs', () => {
        expect(allowRelativeAndAppHrefs('roadmap.md', { defaultValidate: ok })).toBe(true)
        expect(allowRelativeAndAppHrefs('decisions/sso.md', { defaultValidate: ok })).toBe(true)
        expect(allowRelativeAndAppHrefs('../a.md', { defaultValidate: ok })).toBe(true)
        expect(allowRelativeAndAppHrefs('design%20notes.md', { defaultValidate: ok })).toBe(true)
        expect(allowRelativeAndAppHrefs(`app://space-blob/o/s/${'a'.repeat(64)}`, { defaultValidate: ok })).toBe(true)
    })
    it('still rejects dangerous or scheme-carrying hrefs', () => {
        expect(allowRelativeAndAppHrefs('javascript:alert(1)', { defaultValidate: ok })).toBe(false)
        expect(allowRelativeAndAppHrefs('java\nscript:alert(1)', { defaultValidate: ok })).toBe(false)
        expect(allowRelativeAndAppHrefs('data:text/html,x', { defaultValidate: ok })).toBe(false)
        expect(allowRelativeAndAppHrefs('//evil.com/x', { defaultValidate: ok })).toBe(false)
        expect(allowRelativeAndAppHrefs('vbscript:x', { defaultValidate: ok })).toBe(false)
    })
    it('defers to the default validator for normal absolute URLs', () => {
        expect(allowRelativeAndAppHrefs('https://example.com/x', { defaultValidate: (u) => u.startsWith('https:') })).toBe(true)
    })
})

// The regression this guards: TipTap's default isAllowedUri drops the link
// MARK at parse time for hrefs like `decisions/sso.md` and app:// blob links —
// the file view rendered them as plain text. Mirror the viewer's Link config
// and prove the marks survive.
function render(md: string): string {
    const editor = new Editor({
        editable: false,
        extensions: [
            StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
            Link.configure({
                openOnClick: true,
                HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
                isAllowedUri: allowRelativeAndAppHrefs,
            }),
            Markdown.configure({ html: true, breaks: true, tightLists: false, transformCopiedText: false, transformPastedText: false }),
        ],
        content: md,
    })
    const html = editor.getHTML()
    editor.destroy()
    return html
}

describe('RichMarkdownViewer link parsing (relaxed validator)', () => {
    it('keeps nested relative links', () => {
        expect(render('see [sso](decisions/sso.md)')).toContain('href="decisions/sso.md"')
    })
    it('keeps bare relative and app:// links', () => {
        expect(render('see [r](roadmap.md)')).toContain('href="roadmap.md"')
        const hash = 'a'.repeat(64)
        expect(render(`see [b](app://space-blob/o/s/${hash})`)).toContain(`href="app://space-blob/o/s/${hash}"`)
    })
    it('still drops javascript: links (no anchor is produced)', () => {
        expect(render('see [x](javascript:alert(1))')).not.toContain('href=')
    })
})
