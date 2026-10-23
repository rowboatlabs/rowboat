import { afterEach, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import type { spaces } from '@x/shared'
import { composerExtensions, composerMarkdown } from './composer-editor'
import { pastedMemberMentions } from './pasted-member-mentions'

const editors: Editor[] = []
const bot = { id: 'bot-1', displayName: 'Greptile', kind: 'agent', role: 'member' } as spaces.Member
function editor(members = [bot], content = '') {
    const instance = new Editor({ element: document.createElement('div'), extensions: composerExtensions(() => ''), content })
    instance.registerPlugin(pastedMemberMentions(members))
    editors.push(instance)
    return instance
}
const pasteEvent = () => new Event('paste') as ClipboardEvent
afterEach(() => { for (const e of editors.splice(0)) e.destroy() })

it('pastes a copied bot command as a real, visible member mention', () => {
    const e = editor([bot, bot])
    e.view.pasteText('@Greptile status https://github.com/hrsvrn/hrsvrn/pull/1', pasteEvent())
    expect(composerMarkdown(e)).toContain('[@Greptile](#member:bot-1) status')
    expect(e.view.dom.querySelector('[data-mention="member"]')?.textContent).toBe('@Greptile')
    expect(composerMarkdown(e)).toContain('https://github.com/hrsvrn/hrsvrn/pull/1')
})
it('matches full names case-insensitively, including names with spaces', () => {
    const e = editor([bot, { ...bot, id: 'bot-2', displayName: 'Review Bot' }])
    e.view.pasteText('@greptile hello @Review Bot!', pasteEvent())
    expect(composerMarkdown(e)).toBe('[@Greptile](#member:bot-1) hello [@Review Bot](#member:bot-2)!')
})
it('does not guess duplicate names, unknown names, or broadcast mentions', () => {
    const e = editor([bot, { ...bot, id: 'duplicate' }])
    e.view.pasteText('@Greptile @Missing @here @rowboat', pasteEvent())
    expect(e.view.dom.querySelector('[data-mention]')).toBeNull()
})
it('leaves email addresses, partial names, and departed members alone', () => {
    const e = editor([bot, { ...bot, id: 'gone', displayName: 'Old', removedAt: '2026-10-23' }])
    e.view.pasteText('user@Greptile.com @GreptileOther @Old', pasteEvent())
    expect(e.view.dom.querySelector('[data-mention]')).toBeNull()
})
it('preserves rich formatting and leaves links, code and block quotes inert', () => {
    const e = editor()
    e.view.pasteHTML('<p><strong>@Greptile hello</strong></p><p><code>@Greptile</code> <a href="https://example.com">@Greptile</a></p><blockquote><p>@Greptile</p></blockquote><pre><code>@Greptile</code></pre>', pasteEvent())
    expect(e.view.dom.querySelectorAll('[data-mention="member"]')).toHaveLength(1)
    expect(e.view.dom.querySelector('strong')?.textContent).toContain('hello')
    expect(e.view.dom.querySelector('blockquote')?.textContent).toBe('@Greptile')
    expect(e.view.dom.querySelector('pre')?.textContent).toBe('@Greptile')
})
it('does not resolve mentions when pasting into an existing code block', () => {
    const e = editor()
    e.commands.toggleCodeBlock()
    e.view.pasteText('@Greptile status', pasteEvent())
    expect(e.view.dom.querySelector('[data-mention]')).toBeNull()
})
