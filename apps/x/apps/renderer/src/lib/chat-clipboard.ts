import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { TableKit } from '@tiptap/extension-table'
import { Markdown } from 'tiptap-markdown'

/** Parse Markdown through an allowlisted editor schema, never raw response HTML. */
export function messageClipboardHtml(markdown: string): string {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false }),
      TableKit,
      Markdown.configure({ html: false, breaks: true }),
    ],
    content: markdown,
    editable: false,
  })
  try {
    return editor.getHTML()
  } finally {
    editor.destroy()
  }
}

/** Markdown remains available to text-only destinations and older clipboard APIs. */
export async function copyChatMessage(markdown: string): Promise<void> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([messageClipboardHtml(markdown)], { type: 'text/html' }),
        'text/plain': new Blob([markdown], { type: 'text/plain' }),
      })])
      return
    } catch {
      // Some hosts expose rich clipboard writes but reject a MIME type.
      // Only report success once at least the text fallback has completed.
    }
  }
  await navigator.clipboard.writeText(markdown)
}
