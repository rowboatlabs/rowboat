import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { assistantEditorExtensions, assistantMarkdown, clipboardTable, tableContent } from './assistant-editor'

const editors: Editor[] = []
function editor(content: string | object = '') {
  const e = new Editor({ element: document.createElement('div'), extensions: assistantEditorExtensions(() => ''), content })
  editors.push(e)
  return e
}
afterEach(() => { editors.splice(0).forEach(e => e.destroy()) })

describe('assistant rich input', () => {
  it('preserves formatted clipboard HTML as Markdown', () => {
    const e = editor('<p><strong>Bold</strong> and <em>italic</em> <a href="https://example.com">link</a></p><ul><li>First</li><li>Second</li></ul><blockquote><p>Quote</p></blockquote>')
    const md = assistantMarkdown(e)
    expect(md).toContain('**Bold** and *italic* [link](https://example.com)')
    expect(md).toContain('- First\n- Second')
    expect(md).toContain('> Quote')
    expect(editor(md).getHTML()).toContain('<strong>Bold</strong>')
  })
  it('keeps headerless spreadsheet data, empty cells and escaped pipes', () => {
    const e = editor('<table><tr><td>Apples</td><td>3</td></tr><tr><td>A | B</td><td></td></tr></table>')
    const md = assistantMarkdown(e)
    expect(md).toContain('| Apples | 3 |')
    expect(md).toContain('| A \\| B |  |')
    expect(md).not.toContain('[table]')
    const restored = editor(md)
    expect(restored.getHTML()).toContain('Apples')
    expect(restored.getHTML()).toContain('A | B')
  })
  it('keeps multi-paragraph cells and reserves merged cells', () => {
    const md = assistantMarkdown(editor('<table><tr><th colspan="2">Header</th></tr><tr><td><p>First</p><p>Second</p></td><td>Value</td></tr></table>'))
    expect(md).toContain('| Header |  |')
    expect(md).toContain('| First<br>Second | Value |')
  })
  it('parses quoted spreadsheet cells without splitting embedded tabs/newlines', () => {
    const rows = clipboardTable('Name\tNotes\r\nA\t"two\nlines"\r\nB\t"x\ty"\r\n')
    expect(rows).toEqual([['Name', 'Notes'], ['A', 'two\nlines'], ['B', 'x\ty']])
    expect(assistantMarkdown(editor({ type: 'doc', content: [tableContent(rows!)] }))).toContain('two<br>lines')
    expect(clipboardTable('plain\ntext')).toBeNull()
    expect(clipboardTable('Apples\t3')).toEqual([['Apples', '3']])
    expect(clipboardTable('one\ttwo\nindented code')).toBeNull()
  })
})
