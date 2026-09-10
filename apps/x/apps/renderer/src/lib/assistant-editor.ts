import { Node, type Editor } from '@tiptap/core'
import type { Node as DocumentNode } from '@tiptap/pm/model'
import { TableMap } from '@tiptap/pm/tables'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { Markdown } from 'tiptap-markdown'

interface MarkdownWriter {
  out: string
  inTable: boolean
  write: (value: string) => void
  renderInline: (node: DocumentNode) => void
  closeBlock: (node: DocumentNode) => void
}

// Clipboard tables often have no header or have merged/multi-paragraph cells.
// Serialize a rectangular grid instead of tiptap-markdown's lossy [table]
// fallback. Empty headers keep the first data row as data; spans reserve cells.
const AssistantTable = Table.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownWriter, node: DocumentNode) {
          state.inTable = true
          const map = TableMap.get(node)
          const seen = new Set<number>()
          const hasHeader = node.firstChild?.firstChild?.type.name === 'tableHeader'
          const delimiter = `| ${Array(map.width).fill('---').join(' | ')} |\n`
          if (!hasHeader) state.write(`| ${Array(map.width).fill('').join(' | ')} |\n${delimiter}`)
          for (let row = 0; row < map.height; row++) {
            state.write('| ')
            for (let col = 0; col < map.width; col++) {
              if (col) state.write(' | ')
              const pos = map.map[row * map.width + col]
              const cell = node.nodeAt(pos)
              if (!seen.has(pos) && cell) {
                seen.add(pos)
                const start = state.out.length
                cell.descendants((child) => {
                  if (!child.isTextblock) return true
                  if (state.out.length > start) state.write('<br>')
                  state.renderInline(child)
                  return false
                })
                state.out = state.out.slice(0, start) + state.out.slice(start)
                  .replace(/\r?\n/g, '<br>').replace(/(?<!\\)\|/g, '\\|')
              }
            }
            state.write(' |\n')
            if (row === 0 && hasHeader) state.write(delimiter)
          }
          state.closeBlock(node)
          state.inTable = false
        },
      },
    }
  },
})

export const AssistantFileMention = Node.create({
  name: 'assistantFileMention',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: false,
  addAttributes: () => ({ path: { default: '' }, label: { default: '' } }),
  parseHTML: () => [{ tag: 'span[data-assistant-file]', getAttrs: element => ({
    path: element.getAttribute('data-assistant-file') ?? '',
    label: element.textContent?.replace(/^@/, '') ?? '',
  }) }],
  renderHTML: ({ node }) => ['span', { 'data-assistant-file': node.attrs.path, class: 'assistant-file-mention' }, `@${node.attrs.label}`],
  renderText: ({ node }) => `@${node.attrs.label}`,
  addStorage: () => ({ markdown: {
    serialize(state: MarkdownWriter, node: DocumentNode) { state.write(`@${node.attrs.label}`) },
  } }),
})

export function assistantEditorExtensions(placeholder: () => string) {
  return [
    StarterKit.configure({ link: false }),
    Link.configure({ openOnClick: false }),
    Placeholder.configure({ placeholder }),
    AssistantTable.configure({ resizable: false }), TableRow, TableCell, TableHeader,
    AssistantFileMention,
    Markdown.configure({ html: true, breaks: true, tightLists: true, transformPastedText: false, transformCopiedText: false }),
  ]
}

export function assistantMarkdown(editor: Editor): string {
  return (editor.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown().replace(/\n+$/, '')
}

/** Plain spreadsheet clipboard data, including quoted tabs/newlines and empty cells. */
export function clipboardTable(text: string): string[][] | null {
  if (!text.includes('\t')) return null
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"' && (quoted || cell === '')) {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++ }
      else quoted = !quoted
    } else if (!quoted && (c === '\t' || c === '\n' || c === '\r')) {
      row.push(cell); cell = ''
      if (c !== '\t') {
        rows.push(row); row = []
        if (c === '\r' && text[i + 1] === '\n') i++
      }
    } else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  if (quoted || !rows.length || rows[0].length < 2 || rows.some(r => r.length !== rows[0].length)) return null
  return rows
}

export function tableContent(rows: string[][]) {
  return { type: 'table', content: rows.map(row => ({ type: 'tableRow', content: row.map(value => ({
    type: 'tableCell', content: [{ type: 'paragraph', content: value.split(/\r?\n/).flatMap((line, i) => [
      ...(i ? [{ type: 'hardBreak' }] : []), ...(line ? [{ type: 'text', text: line }] : []),
    ]) }],
  })) })) }
}
