import type { ComponentProps } from 'react'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { Streamdown as BaseStreamdown, defaultRehypePlugins } from 'streamdown'

// Every Markdown the renderer shows through Streamdown was written by someone
// else: a Spaces message, a model's reply, a meeting summary. Streamdown parses
// raw HTML in it by default (rehype-raw) and only hardens URLs, so an
// <iframe srcdoc="<script>…"> in a message ran script in the app's own origin,
// where window.ipc is in reach (2026-10-09). Sanitizing right after the parse
// keeps the HTML GitHub allows (<br>, <details>, <sub>, tables) and drops the
// rest: scripts, frames, styles, event handlers. Import Streamdown from here,
// never from 'streamdown' (streamdown.test.tsx enforces it).

const schema = {
    ...defaultSchema,
    protocols: {
        ...defaultSchema.protocols,
        // The renderer's own URLs: Spaces rewrites mentions, files and blobs to
        // app:// before the parse (space-markdown.tsx); rowboat:// is a deep link.
        // An image may also be an object URL or inline data, as Streamdown allows.
        href: [...(defaultSchema.protocols?.href ?? []), 'app', 'rowboat'],
        src: [...(defaultSchema.protocols?.src ?? []), 'app', 'blob', 'data'],
    },
    attributes: {
        ...defaultSchema.attributes,
        // remark-math marks math for rehype-katex with these classes on <code>.
        code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-./, 'math-inline', 'math-display']],
    },
}

/** Parse raw HTML, sanitize it, then the rest of Streamdown's defaults. */
export const safeRehypePlugins = [
    defaultRehypePlugins.raw,
    [rehypeSanitize, schema],
    defaultRehypePlugins.katex,
    defaultRehypePlugins.harden,
] as NonNullable<ComponentProps<typeof BaseStreamdown>['rehypePlugins']>

export function Streamdown(props: ComponentProps<typeof BaseStreamdown>) {
    // Last, so no caller can switch the sanitizer off.
    return <BaseStreamdown {...props} rehypePlugins={safeRehypePlugins} />
}
