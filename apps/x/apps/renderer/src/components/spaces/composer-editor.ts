import { Extension, Node, mergeAttributes, type Editor } from '@tiptap/core'
import { Fragment, Slice, type Mark, type Node as ProseMirrorNode, type NodeType, type Schema } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
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

// ---------------------------------------------------------------------------
// Fenced code. Markdown nodes come from input rules and the toolbar; a fence
// typed or pasted as TEXT is just backticks in a paragraph, and the
// serializer escapes those (\`\`\`), so the posted message showed the
// backticks instead of a code block. Three paths make a real codeBlock node
// of it: a plain-text paste (clipboardTextParser — the fence's lines land
// verbatim, blank lines included), an HTML paste whose lines arrived as
// paragraphs (transformPasted), and a fence line typed at the caret
// (openFenceLine / closeFenceLine, which the hosts wire to Enter and
// Shift+Enter). The prose around a fence stays literal, as every paste does.
// ---------------------------------------------------------------------------

interface FenceOpen {
    /** The fence marker (``` or ~~~, possibly longer); the closer must match it. */
    marker: string
    language: string
}

/** A line that opens a fence: the marker, then an optional info string whose first word is the language. */
function matchFenceOpen(line: string): FenceOpen | null {
    const m = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/.exec(line)
    return m ? { marker: m[1]!, language: m[2]! } : null
}

/** A line that closes a fence: the opener's character, at least as many of them, nothing else. */
function isFenceClose(line: string, marker?: string): boolean {
    const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)
    if (!m) return false
    return !marker || (m[1]![0] === marker[0] && m[1]!.length >= marker.length)
}

/**
 * How far a pasted slice opens at an edge: into a paragraph (the default
 * parser's shape — the first line joins the paragraph the caret is in),
 * never into a code block, whose text must not merge into prose.
 */
function edgeDepth(node: ProseMirrorNode | undefined, paragraph: NodeType, max: number): number {
    return node && node.type === paragraph ? Math.min(max, 1) : 0
}

/**
 * Pasted text as blocks with its fences made real: each closed fence becomes
 * a codeBlock holding its lines verbatim (blank lines included); every other
 * line is a paragraph, exactly as ProseMirror's own text parser lays it out.
 * Null when there is no closed fence — the default parser keeps its job.
 */
export function parseFencedText(text: string, schema: Schema, marks: readonly Mark[] = []): Slice | null {
    const codeBlock = schema.nodes.codeBlock
    const paragraph = schema.nodes.paragraph
    if (!codeBlock || !paragraph) return null
    const lines = text.replace(/\r\n?/g, '\n').split('\n')
    const blocks: ProseMirrorNode[] = []
    let fenced = false
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!
        const open = matchFenceOpen(line)
        let close = -1
        if (open) {
            for (let j = i + 1; j < lines.length; j++) {
                if (isFenceClose(lines[j]!, open.marker)) {
                    close = j
                    break
                }
            }
        }
        if (open && close >= 0) {
            const code = lines.slice(i + 1, close).join('\n')
            blocks.push(codeBlock.create({ language: open.language || null }, code ? schema.text(code) : null))
            fenced = true
            i = close
        } else if (line) {
            blocks.push(paragraph.create(null, schema.text(line, marks)))
        }
    }
    if (!fenced) return null
    return new Slice(Fragment.from(blocks), edgeDepth(blocks[0], paragraph, 1), edgeDepth(blocks[blocks.length - 1], paragraph, 1))
}

type PasteUnit =
    | { kind: 'line'; nodes: ProseMirrorNode[]; text: string; block: number }
    | { kind: 'block'; node: ProseMirrorNode }

/**
 * The same conversion for a slice already parsed: an HTML paste (a code
 * editor, a rendered page) delivers fence lines as paragraphs, or as one
 * paragraph broken by hard breaks. Top-level paragraphs read as lines, a
 * closed fence's lines fold into a codeBlock, and the lines around it
 * regroup as they came. Untouched when no closed fence is found.
 */
export function fenceSlice(slice: Slice, schema: Schema): Slice {
    const codeBlock = schema.nodes.codeBlock
    const paragraph = schema.nodes.paragraph
    const hardBreak = schema.nodes.hardBreak
    if (!codeBlock || !paragraph) return slice
    const units: PasteUnit[] = []
    slice.content.forEach((node, _offset, index) => {
        if (node.type !== paragraph) {
            units.push({ kind: 'block', node })
            return
        }
        let nodes: ProseMirrorNode[] = []
        const flush = () => {
            units.push({ kind: 'line', nodes, text: nodes.map((n) => n.text ?? '').join(''), block: index })
            nodes = []
        }
        node.forEach((child) => {
            if (hardBreak && child.type === hardBreak) flush()
            else nodes.push(child)
        })
        flush()
    })
    const out: PasteUnit[] = []
    let fenced = false
    for (let i = 0; i < units.length; i++) {
        const unit = units[i]!
        const open = unit.kind === 'line' ? matchFenceOpen(unit.text) : null
        let close = -1
        if (open) {
            for (let j = i + 1; j < units.length; j++) {
                const u = units[j]!
                if (u.kind === 'line' && isFenceClose(u.text, open.marker)) {
                    close = j
                    break
                }
            }
        }
        if (open && close >= 0) {
            const code = units
                .slice(i + 1, close)
                .map((u) => (u.kind === 'line' ? u.text : u.node.textBetween(0, u.node.content.size, '\n')))
                .join('\n')
            out.push({ kind: 'block', node: codeBlock.create({ language: open.language || null }, code ? schema.text(code) : null) })
            fenced = true
            i = close
        } else {
            out.push(unit)
        }
    }
    if (!fenced) return slice
    // Lines regroup as they came: consecutive lines from one source paragraph
    // rejoin with hard breaks; lines from different ones stay apart.
    const blocks: ProseMirrorNode[] = []
    let para: ProseMirrorNode[] | null = null
    let paraBlock = -1
    const flushPara = () => {
        if (para) blocks.push(paragraph.create(null, para))
        para = null
    }
    for (const unit of out) {
        if (unit.kind === 'block') {
            flushPara()
            blocks.push(unit.node)
        } else if (para && unit.block === paraBlock && hardBreak) {
            para.push(hardBreak.create(), ...unit.nodes)
        } else {
            flushPara()
            para = [...unit.nodes]
            paraBlock = unit.block
        }
    }
    flushPara()
    return new Slice(
        Fragment.from(blocks),
        edgeDepth(blocks[0], paragraph, slice.openStart),
        edgeDepth(blocks[blocks.length - 1], paragraph, slice.openEnd),
    )
}

/**
 * Enter or Shift+Enter on a line that is only an opening fence (```, ```ts):
 * the line becomes a real code block with the caret inside — what typing a
 * fence in a chat means. Only at the end of a top-level paragraph; anywhere
 * else the keys keep their meaning. False = not handled.
 */
export function openFenceLine(editor: Editor): boolean {
    const { state } = editor
    const { $from, empty } = state.selection
    const codeBlock = state.schema.nodes.codeBlock
    if (!empty || !codeBlock || $from.depth !== 1 || $from.parent.type !== state.schema.nodes.paragraph) return false
    if ($from.parentOffset !== $from.parent.content.size) return false
    // The caret's line: whatever follows the paragraph's last hard break.
    let lineStart = 0
    $from.parent.forEach((child, offset) => {
        if (child.type.name === 'hardBreak') lineStart = offset + child.nodeSize
    })
    const open = matchFenceOpen($from.parent.textBetween(lineStart, $from.parentOffset))
    if (!open) return false
    const block = codeBlock.create({ language: open.language || null })
    const tr = state.tr
    if (lineStart === 0) {
        // The paragraph IS the fence line: it becomes the code block.
        tr.replaceWith($from.before(), $from.after(), block)
        tr.setSelection(TextSelection.create(tr.doc, $from.before() + 1))
    } else {
        // A fence typed under prose: cut the line (and the break before it),
        // open the block right after the paragraph.
        tr.delete($from.start() + lineStart - 1, $from.pos)
        const at = tr.mapping.map($from.after())
        tr.insert(at, block)
        tr.setSelection(TextSelection.create(tr.doc, at + 1))
    }
    editor.view.dispatch(tr.scrollIntoView())
    return true
}

/**
 * Enter at the end of a code block whose last line is only a closing fence:
 * the fence line goes and the caret leaves the block — typed markdown's way
 * out (Shift+Enter, the editor's own exit, keeps working). False = not handled.
 */
export function closeFenceLine(editor: Editor): boolean {
    const { state } = editor
    const { $from, empty } = state.selection
    const paragraph = state.schema.nodes.paragraph
    if (!empty || !paragraph || $from.parent.type.name !== 'codeBlock') return false
    if ($from.parentOffset !== $from.parent.content.size) return false
    const text = $from.parent.textContent
    const newline = text.lastIndexOf('\n')
    if (!isFenceClose(text.slice(newline + 1))) return false
    // The caret lands in the paragraph after the block — the empty one the
    // editor keeps after a trailing block (StarterKit's TrailingNode) when
    // there is one, a fresh one otherwise.
    const after = $from.after()
    const next = state.doc.nodeAt(after)
    const emptyNext = !!next && next.type === paragraph && next.content.size === 0
    const tr = state.tr
    if (newline < 0 && emptyNext) {
        // Nothing but the closer: the block goes.
        tr.delete($from.before(), after)
        tr.setSelection(TextSelection.create(tr.doc, $from.before() + 1))
    } else if (newline < 0) {
        // Nothing but the closer, nothing after: the block reverts to a paragraph.
        tr.delete($from.start(), $from.pos)
        tr.setBlockType($from.start(), $from.start(), paragraph)
    } else {
        tr.delete($from.start() + newline, $from.pos)
        const at = tr.mapping.map(after)
        if (!emptyNext) tr.insert(at, paragraph.create())
        tr.setSelection(TextSelection.create(tr.doc, at + 1))
    }
    editor.view.dispatch(tr.scrollIntoView())
    return true
}

/**
 * A pasted slice that opens into a code block at either edge, closed there.
 * ProseMirror re-opens every external paste as far as it goes, and its range
 * fitter then pours an open code block's text into the paragraph the caret
 * sits in ("here's the error:" + a pasted block became one line of prose).
 * Closed, the block lands as a block — after the paragraph, or splitting it.
 */
function closeCodeEdges(slice: Slice, schema: Schema): Slice {
    const codeBlock = schema.nodes.codeBlock
    if (!codeBlock) return slice
    const openStart = slice.openStart && slice.content.firstChild?.type === codeBlock ? 0 : slice.openStart
    const openEnd = slice.openEnd && slice.content.lastChild?.type === codeBlock ? 0 : slice.openEnd
    if (openStart === slice.openStart && openEnd === slice.openEnd) return slice
    return new Slice(slice.content, openStart, openEnd)
}

/** The paste hooks above, as an extension — ahead of the defaults so a text paste reaches parseFencedText first. */
const CodeFences = Extension.create({
    name: 'codeFences',
    priority: 1000,
    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: new PluginKey('codeFences'),
                props: {
                    // Null declines: ProseMirror falls through to its own text
                    // parser when there is no fence (the prop's runtime contract).
                    clipboardTextParser: (text, $context) => parseFencedText(text, this.editor.schema, $context.marks()) as Slice,
                    transformPasted: (slice) => fenceSlice(slice, this.editor.schema),
                    handlePaste: (view, event, slice) => {
                        // The editor's own copies carry their open depths on
                        // purpose (a code selection pasted into prose pastes as
                        // text); only what came from outside closes.
                        if (event.clipboardData?.getData('text/html').includes('data-pm-slice')) return false
                        const closed = closeCodeEdges(slice, this.editor.schema)
                        if (closed === slice) return false
                        // The default paste's own dispatch, with the metas the paste rules key on.
                        view.dispatch(view.state.tr.replaceSelection(closed).scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'))
                        return true
                    },
                },
            }),
        ]
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
            // (Fences are the one exception: CodeFences makes them code blocks.)
            transformPastedText: false,
            transformCopiedText: false,
        }),
        CodeFences,
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
