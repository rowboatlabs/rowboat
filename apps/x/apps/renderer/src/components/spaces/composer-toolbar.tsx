import { useState, type RefObject } from 'react'
import {
    BoldIcon, CodeIcon, CodeSquareIcon, ItalicIcon, LinkIcon, ListIcon, ListOrderedIcon, QuoteIcon, StrikethroughIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { isMac } from '@/lib/shortcut'
import { insertLink, toggleCodeBlock, toggleInline, toggleLinePrefix, type FormatResult } from '@/lib/spaces-format'

// The Slack-style formatting bar over a markdown textarea (the space composer
// and the message editor). The wire format is plain markdown, so every button
// is a TEXT transform on (value, selection) — no document model, no editor
// swap; the `@`/`:emoji:`/slash machinery underneath never notices. The
// transforms themselves live in lib/spaces-format.ts; this wires them to a
// textarea.

const mod = isMac ? '⌘' : 'Ctrl+'

interface ToolDef {
    key: string
    title: string
    icon: typeof BoldIcon
    run: (value: string, start: number, end: number) => FormatResult
}

const GROUPS: ToolDef[][] = [
    [
        { key: 'bold', title: `Bold (${mod}B)`, icon: BoldIcon, run: (v, s, e) => toggleInline(v, s, e, '**') },
        { key: 'italic', title: `Italic (${mod}I)`, icon: ItalicIcon, run: (v, s, e) => toggleInline(v, s, e, '*') },
        { key: 'strike', title: `Strikethrough (${mod}⇧X)`, icon: StrikethroughIcon, run: (v, s, e) => toggleInline(v, s, e, '~~') },
    ],
    // The link button lives between the groups (its popover renders separately).
    [
        { key: 'ordered', title: `Ordered list (${mod}⇧7)`, icon: ListOrderedIcon, run: (v, s, e) => toggleLinePrefix(v, s, e, 'ordered') },
        { key: 'bullet', title: `Bulleted list (${mod}⇧8)`, icon: ListIcon, run: (v, s, e) => toggleLinePrefix(v, s, e, 'bullet') },
    ],
    [
        { key: 'quote', title: `Blockquote (${mod}⇧9)`, icon: QuoteIcon, run: (v, s, e) => toggleLinePrefix(v, s, e, 'quote') },
    ],
    [
        { key: 'code', title: `Code (${mod}E)`, icon: CodeIcon, run: (v, s, e) => toggleInline(v, s, e, '`') },
        { key: 'codeblock', title: `Code block (${mod}⌥⇧C)`, icon: CodeSquareIcon, run: toggleCodeBlock },
    ],
]

/**
 * The bar itself. `onCaret` lets an owner that tracks the caret (the composer
 * drives its autocompletes off it) stay in sync with the restored selection.
 */
export function FormattingToolbar({ textareaRef, value, onChange, onCaret, className }: {
    textareaRef: RefObject<HTMLTextAreaElement | null>
    value: string
    onChange: (next: string) => void
    onCaret?: (pos: number) => void
    className?: string
}) {
    const [linkOpen, setLinkOpen] = useState(false)
    // The selection as it stood when the link popover opened — its inputs
    // steal focus, so the live selection is gone by submit time.
    const [linkCtx, setLinkCtx] = useState<{ start: number; end: number; text: string; url: string }>({ start: 0, end: 0, text: '', url: '' })

    const apply = (run: ToolDef['run']) => {
        const el = textareaRef.current
        if (!el) return
        const start = el.selectionStart ?? value.length
        const end = el.selectionEnd ?? start
        const r = run(value, Math.min(start, end), Math.max(start, end))
        onChange(r.next)
        requestAnimationFrame(() => {
            const node = textareaRef.current
            if (!node) return
            node.focus()
            node.setSelectionRange(r.selStart, r.selEnd)
            onCaret?.(r.selEnd)
        })
    }

    const openLink = () => {
        const el = textareaRef.current
        const start = el?.selectionStart ?? value.length
        const end = el?.selectionEnd ?? start
        setLinkCtx({ start: Math.min(start, end), end: Math.max(start, end), text: value.slice(Math.min(start, end), Math.max(start, end)), url: '' })
        setLinkOpen(true)
    }

    const submitLink = () => {
        const url = linkCtx.url.trim()
        if (!url) return
        const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`
        const r = insertLink(value, linkCtx.start, linkCtx.end, withScheme, linkCtx.text.trim() || undefined)
        onChange(r.next)
        setLinkOpen(false)
        requestAnimationFrame(() => {
            const node = textareaRef.current
            if (!node) return
            node.focus()
            node.setSelectionRange(r.selStart, r.selEnd)
            onCaret?.(r.selEnd)
        })
    }

    const button = (t: ToolDef) => (
        <Tooltip key={t.key} delayDuration={400}>
            <TooltipTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t.title}
                    className="size-7 text-muted-foreground hover:text-foreground"
                    // Keep the textarea focused (and its selection alive) through the click.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => apply(t.run)}
                >
                    <t.icon className="size-4" />
                </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{t.title}</TooltipContent>
        </Tooltip>
    )

    const separator = <span className="mx-1 h-4 w-px shrink-0 bg-border" />

    return (
        <div className={cn('flex items-center', className)}>
            {GROUPS[0]!.map(button)}
            {separator}
            <Popover open={linkOpen} onOpenChange={setLinkOpen}>
                <PopoverTrigger asChild>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Link"
                        className="size-7 text-muted-foreground hover:text-foreground"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={openLink}
                    >
                        <LinkIcon className="size-4" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="start" sideOffset={6} className="w-72 p-2.5">
                    <div className="flex flex-col gap-2">
                        <Input
                            placeholder="Text"
                            value={linkCtx.text}
                            onChange={(e) => setLinkCtx((c) => ({ ...c, text: e.target.value }))}
                            className="h-8 text-sm"
                        />
                        <Input
                            autoFocus
                            placeholder="Link"
                            value={linkCtx.url}
                            onChange={(e) => setLinkCtx((c) => ({ ...c, url: e.target.value }))}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault()
                                    submitLink()
                                }
                            }}
                            className="h-8 text-sm"
                        />
                        <div className="flex justify-end gap-1.5">
                            <Button type="button" variant="ghost" size="sm" className="h-7" onClick={() => setLinkOpen(false)}>
                                Cancel
                            </Button>
                            <Button type="button" size="sm" className="h-7" disabled={!linkCtx.url.trim()} onClick={submitLink}>
                                Add
                            </Button>
                        </div>
                    </div>
                </PopoverContent>
            </Popover>
            {separator}
            {GROUPS[1]!.map(button)}
            {separator}
            {GROUPS[2]!.map(button)}
            {separator}
            {GROUPS[3]!.map(button)}
        </div>
    )
}
