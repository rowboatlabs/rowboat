import { Extension, type Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'

// The Spaces composer's TipTap setup. The editor is the input surface only —
// markdown stays the wire format: tiptap-markdown parses drafts/seeds INTO
// the doc, and composerMarkdown() serializes the doc back out on every
// update, so everything downstream of the composer (drafts, slash commands,
// @rowboat detection, buildBody) keeps operating on the same markdown string
// a textarea used to hold. StarterKit's input rules give the Slack behavior
// of `**bold**` converting live as you type.

/**
 * Slack's formatting chords on top of TipTap's defaults (⌘B/⌘I bold/italic,
 * ⌘E code, ⌘⇧7/8 ordered/bullet come built in).
 */
const ChatFormatKeys = Extension.create({
    name: 'chatFormatKeys',
    addKeyboardShortcuts() {
        return {
            'Mod-Shift-x': () => this.editor.commands.toggleStrike(),
            'Mod-Shift-c': () => this.editor.commands.toggleCode(),
            'Mod-Shift-9': () => this.editor.commands.toggleBlockquote(),
            'Mod-Alt-Shift-c': () => this.editor.commands.toggleCodeBlock(),
        }
    },
})

/**
 * The chat editor's extension set. `getPlaceholder` is read per render so a
 * changing placeholder prop never needs an editor rebuild.
 */
export function composerExtensions(getPlaceholder: () => string) {
    return [
        StarterKit.configure({ link: false }),
        Link.configure({ openOnClick: false, autolink: true }),
        // Pasted GIF/image links become the image itself (matches what the
        // message will show); serializes back to ![](url).
        Image,
        Placeholder.configure({ placeholder: () => getPlaceholder() }),
        Markdown.configure({
            html: false,
            breaks: true,
            tightLists: true,
            // Pastes stay literal text — a pasted `*` must not turn italic.
            transformPastedText: false,
            transformCopiedText: false,
        }),
        ChatFormatKeys,
    ]
}

/** The doc as wire markdown (tiptap-markdown's serializer), sans trailing newlines. */
export function composerMarkdown(editor: Editor): string {
    const storage = editor.storage as unknown as { markdown: { getMarkdown: () => string } }
    return storage.markdown.getMarkdown().replace(/\n+$/, '')
}

/** The caret's text block up to the caret — what the @/:emoji: triggers match against. */
export interface CaretContext {
    text: string
    /** The caret's document position (deleting a trigger counts back from here). */
    from: number
}

/**
 * null when autocompletes have no business firing: a range selection, a code
 * block or inline-code caret (the same guards the notes editor uses).
 */
export function caretContext(editor: Editor): CaretContext | null {
    const { selection } = editor.state
    if (!selection.empty) return null
    const { $from } = selection
    if (!$from.parent.isTextblock || $from.parent.type.name === 'codeBlock') return null
    if (editor.isActive('code')) return null
    // Leaf nodes (hard breaks, images) read as newlines so an "@" right
    // after a Shift+Enter still sits on a word boundary, like in a textarea.
    return { text: $from.parent.textBetween(0, $from.parentOffset, '\n', '\n'), from: selection.from }
}
