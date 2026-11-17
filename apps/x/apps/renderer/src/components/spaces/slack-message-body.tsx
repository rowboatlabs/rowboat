import type { ReactNode } from 'react'

const decode = (text: string) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
function link(target: string, label: string, key: number): ReactNode {
    try {
        const url = new URL(target)
        if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) {
            return <a key={key} className="underline text-primary break-all" href={url.href} target="_blank" rel="noopener noreferrer">{decode(label)}</a>
        }
    } catch { /* Unavailable source links stay text. */ }
    return <span key={key}>{decode(label)}</span>
}
// 2026-11-17: render Slack syntax independently of Rowboat mentions and embed previews.
function inline(text: string, depth = 0): ReactNode {
    if (depth > 8) return decode(text)
    const pattern = /`([^`\n]+)`|<(https?:\/\/[^>|\s]+)(?:\|([^>]*))?>|<@([^>|]+)(?:\|([^>]*))?>|<#([^>|]+)(?:\|([^>]*))?>|<!(here|channel|everyone)>|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~/g
    const nodes: ReactNode[] = []
    let end = 0
    for (const m of text.matchAll(pattern)) {
        nodes.push(decode(text.slice(end, m.index)))
        const key = m.index!
        if (m[1] !== undefined) nodes.push(<code key={key} className="rounded bg-muted px-1 font-mono text-[0.9em]">{decode(m[1])}</code>)
        else if (m[2] !== undefined) nodes.push(link(m[2], m[3] || m[2], key))
        else if (m[4] !== undefined) nodes.push(<span key={key} className="text-muted-foreground">@{decode(m[5] || m[4])}</span>)
        else if (m[6] !== undefined) nodes.push(<span key={key} className="text-muted-foreground">#{decode(m[7] || m[6])}</span>)
        else if (m[8] !== undefined) nodes.push(<span key={key} className="text-muted-foreground">@{m[8]}</span>)
        else if (m[9] !== undefined) nodes.push(<strong key={key}>{inline(m[9], depth + 1)}</strong>)
        else if (m[10] !== undefined) nodes.push(<em key={key}>{inline(m[10], depth + 1)}</em>)
        else if (m[11] !== undefined) nodes.push(<s key={key}>{inline(m[11], depth + 1)}</s>)
        end = key + m[0].length
    }
    nodes.push(decode(text.slice(end)))
    return nodes
}
export function SlackMessageBody({ body }: { body: string }) {
    const parts = body.split(/(```[\s\S]*?```)/g)
    return <div className="whitespace-pre-wrap break-words">{parts.map((part, i) => part.startsWith('```') && part.endsWith('```')
        ? <pre key={i} className="my-2 max-w-full overflow-x-auto rounded bg-muted p-3 text-sm"><code>{decode(part.slice(3, -3))}</code></pre>
        : <span key={i}>{part.split('\n').map((line, j, lines) => line.startsWith('&gt; ') || line.startsWith('> ')
            ? <span key={j} className="block border-l-2 border-border pl-3 text-muted-foreground">{inline(line.replace(/^(?:&gt;|>) /, ''))}</span>
            : <span key={j}>{inline(line)}{j < lines.length - 1 ? '\n' : ''}</span>)}</span>)}</div>
}
