import { Extension, Node, mergeAttributes, type Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'
import { mentionToken, type MentionRef } from '@x/shared/dist/spaces.js'

// The Spaces composer's TipTap setup. The editor is the input surface only —
// markdown stays the wire format: tiptap-markdown parses drafts/seeds INTO
// the doc, and composerMarkdown() serializes the doc back out on every
// update, so everything downstream of the composer (drafts, slash commands,
// @rowboat detection, buildBody) keeps operating on the same markdown string
// a textarea used to hold. StarterKit's input rules give the editor behavior
// of `**bold**` converting live as you type.

/**
 * the conversation formatting chords on top of TipTap's defaults (⌘B/⌘I bold/italic,
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
 * Shift+Enter writes a plain newline, not CommonMark's backslash escape.
 *
 * tiptap-markdown serializes a hard break as `\` followed by a newline, which
 * only reads as a line break while the paragraph keeps going: the moment the
 * next line opens a block of its own (`- item`, `# heading`, `> quote`), the
 * backslash has nothing to escape and renders as itself. That is where the
 * trailing backslashes in sent messages came from, and every plain-text
 * surface off the same body (copies, quotes, excerpts, thread titles, the
 * text handed to @rowboat) showed them unconditionally. A newline carries the
 * break instead — the composer parses one straight back to a hard break
 * (markdown-it `breaks`), and so does every renderer of a space body. Inside
 * a table a newline would end the row, so those keep the HTML break.
 */
function serializeHardBreak(
    state: { write(text: string): void; inTable?: boolean },
    node: ProseMirrorNode,
    parent: ProseMirrorNode,
    index: number,
): void {
    for (let i = index + 1; i < parent.childCount; i++) {
        if (parent.child(i).type !== node.type) {
            state.write(state.inTable ? '<br>' : '\n')
            return
        }
    }
}

/**
 * StarterKit owns the hardBreak node and doesn't re-export it, so the kit is
 * re-wrapped to hand that one extension the markdown spec above —
 * tiptap-markdown reads an extension's own spec before falling back to its
 * default, and everything else in the kit passes through untouched.
 */
const ChatStarterKit = StarterKit.extend({
    addExtensions() {
        return (this.parent?.() ?? []).map((extension) =>
            extension.name === 'hardBreak'
                ? extension.extend({ addStorage: () => ({ markdown: { serialize: serializeHardBreak, parse: {} } }) })
                : extension,
        )
    },
})

type MentionKind = 'member' | 'here' | 'rowboat'

function refOf(attrs: { kind: MentionKind; id: string | null; label: string }): MentionRef {
    if (attrs.kind === 'member') return { kind: 'member', id: attrs.id ?? '', label: attrs.label }
    return { kind: attrs.kind }
}

/**
 * A mention as ONE node (the Discord/Slack composer shape): an inline atom
 * carrying kind + id + label, rendered as a pill, deleted in one backspace,
 * serialized to the wire's link token (`[@Name](#member:<id>)`, `[@here](#here)`,
 * `[@rowboat](#rowboat)` — protocol mentions.ts) and parsed back from it, so
 * drafts, seeds, and the inline edit box round-trip. The autocomplete inserts
 * it; nothing ever rewrites typed text into an address.
 */
export const MentionNode = Node.create({
    name: 'mention',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: false,
    // Above Link (1000): markdown-it hands the parser `<a href="#member:…">`,
    // and the link mark must not claim it first.
    priority: 1001,
    addAttributes() {
        return { kind: { default: 'member' }, id: { default: null }, label: { default: '' } }
    },
    parseHTML() {
        return [
            // Rule priority (ProseMirror's, not TipTap's): mark rules are
            // collected before node rules at equal priority, so without this
            // the Link mark would claim the anchor first.
            {
                tag: 'a[href^="#member:"]',
                priority: 1001,
                getAttrs: (el) => {
                    const a = el as HTMLAnchorElement
                    const id = decodeURIComponent((a.getAttribute('href') ?? '').slice('#member:'.length))
                    return id ? { kind: 'member', id, label: (a.textContent ?? '').replace(/^@/, '') } : false
                },
            },
            { tag: 'a[href="#here"]', priority: 1001, getAttrs: () => ({ kind: 'here', id: null, label: 'here' }) },
            { tag: 'a[href="#rowboat"]', priority: 1001, getAttrs: () => ({ kind: 'rowboat', id: null, label: 'rowboat' }) },
            {
                tag: 'span[data-mention]',
                priority: 1001,
                getAttrs: (el) => ({
                    kind: el.getAttribute('data-mention'),
                    id: el.getAttribute('data-id') || null,
                    label: el.getAttribute('data-label') ?? '',
                }),
            },
        ]
    },
    renderHTML({ node, HTMLAttributes }) {
        const attrs = node.attrs as { kind: MentionKind; id: string | null; label: string }
        const label = attrs.kind === 'member' ? attrs.label : attrs.kind
        return [
            'span',
            mergeAttributes(HTMLAttributes, {
                'data-mention': attrs.kind,
                'data-id': attrs.id ?? '',
                'data-label': label,
                class: 'composer-mention',
            }),
            `@${label}`,
        ]
    },
    renderText({ node }) {
        const attrs = node.attrs as { kind: MentionKind; label: string }
        return `@${attrs.kind === 'member' ? attrs.label : attrs.kind}`
    },
    addStorage() {
        return {
            markdown: {
                serialize(state: { write(text: string): void }, node: ProseMirrorNode) {
                    state.write(mentionToken(refOf(node.attrs as { kind: MentionKind; id: string | null; label: string })))
                },
                parse: {
                    // handled by markdown-it (a link) + parseHTML above
                },
            },
        }
    },
})

/**
 * The chat editor's extension set. `getPlaceholder` is read per render so a
 * changing placeholder prop never needs an editor rebuild.
 */
export function composerExtensions(getPlaceholder: () => string) {
    return [
        ChatStarterKit.configure({ link: false }),
        Link.configure({ openOnClick: false, autolink: true }),
        MentionNode,
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
