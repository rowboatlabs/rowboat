// Markdown formatting as pure text transforms on (value, selection) — the
// grammar behind the composer's Slack-style toolbar and its keyboard chords.
// The wire format is plain markdown, so there is no document model: every
// action rewrites the string and says where the selection lands.

export interface FormatResult {
    next: string
    selStart: number
    selEnd: number
}

/**
 * Wrap the selection — or an empty caret — in a symmetric inline marker
 * (** * ~~ `); fired again on an already-wrapped selection, unwrap (toggle).
 */
export function toggleInline(value: string, start: number, end: number, marker: string): FormatResult {
    const selected = value.slice(start, end)
    const before = value.slice(0, start)
    const after = value.slice(end)
    if (before.endsWith(marker) && after.startsWith(marker)) {
        return {
            next: `${before.slice(0, -marker.length)}${selected}${after.slice(marker.length)}`,
            selStart: start - marker.length,
            selEnd: end - marker.length,
        }
    }
    if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= marker.length * 2) {
        const inner = selected.slice(marker.length, selected.length - marker.length)
        return { next: `${before}${inner}${after}`, selStart: start, selEnd: start + inner.length }
    }
    // Empty caret lands between the markers, ready to type.
    return { next: `${before}${marker}${selected}${marker}${after}`, selStart: start + marker.length, selEnd: end + marker.length }
}

export type LinePrefixKind = 'bullet' | 'ordered' | 'quote'

const LINE_PREFIX_RE = /^(?:[-*+]\s+|\d+\.\s+|>\s?)/

function hasPrefix(line: string, kind: LinePrefixKind): boolean {
    return kind === 'bullet' ? /^[-*+]\s/.test(line) : kind === 'ordered' ? /^\d+\.\s/.test(line) : /^>\s?/.test(line)
}

/**
 * Toggle a line prefix (- / 1. / >) across every line the selection touches.
 * All lines already carrying THIS prefix → strip it; otherwise set it,
 * replacing any other list/quote prefix (the Slack behavior). Ordered lists
 * renumber 1..n. Blank lines pass through untouched.
 */
export function toggleLinePrefix(value: string, start: number, end: number, kind: LinePrefixKind): FormatResult {
    const from = value.lastIndexOf('\n', start - 1) + 1
    const toBreak = value.indexOf('\n', end)
    const to = toBreak === -1 ? value.length : toBreak
    const lines = value.slice(from, to).split('\n')
    const nonEmpty = lines.filter((l) => l.trim().length > 0)
    const removing = nonEmpty.length > 0 && nonEmpty.every((l) => hasPrefix(l, kind))
    let counter = 0
    const nextLines = lines.map((l) => {
        if (l.trim().length === 0 && lines.length > 1) return l
        const stripped = l.replace(LINE_PREFIX_RE, '')
        if (removing) return stripped
        counter += 1
        const prefix = kind === 'bullet' ? '- ' : kind === 'ordered' ? `${counter}. ` : '> '
        return `${prefix}${stripped}`
    })
    const block = nextLines.join('\n')
    const next = `${value.slice(0, from)}${block}${value.slice(to)}`
    if (start === end && lines.length === 1) {
        // A lone caret stays put on its line, shifted by the prefix delta.
        const delta = (nextLines[0]?.length ?? 0) - (lines[0]?.length ?? 0)
        const pos = Math.min(Math.max(start + delta, from), from + block.length)
        return { next, selStart: pos, selEnd: pos }
    }
    // A multi-line selection keeps the whole transformed block selected.
    return { next, selStart: from, selEnd: from + block.length }
}

/**
 * Fence the selection as a code block (unwrap when the selection already is
 * one). The fences take their own lines; an empty caret lands inside, ready
 * to type or paste.
 */
export function toggleCodeBlock(value: string, start: number, end: number): FormatResult {
    const selected = value.slice(start, end)
    const fenced = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(selected)
    if (fenced) {
        const inner = fenced[1] ?? ''
        return { next: `${value.slice(0, start)}${inner}${value.slice(end)}`, selStart: start, selEnd: start + inner.length }
    }
    const before = value.slice(0, start)
    const after = value.slice(end)
    const open = `${before && !before.endsWith('\n') ? '\n' : ''}\`\`\`\n`
    const close = `\n\`\`\`${after && !after.startsWith('\n') ? '\n' : ''}`
    const selStart = start + open.length
    return { next: `${before}${open}${selected}${close}${after}`, selStart, selEnd: selStart + selected.length }
}

/** Replace the selection with a markdown link; no selection links the URL itself. */
export function insertLink(value: string, start: number, end: number, url: string, text?: string): FormatResult {
    const label = (text ?? value.slice(start, end)) || url
    const md = `[${label}](${url})`
    const pos = start + md.length
    return { next: `${value.slice(0, start)}${md}${value.slice(end)}`, selStart: pos, selEnd: pos }
}
