import { useMemo, useState } from 'react'
import { Globe, X } from 'lucide-react'
import { useLinkPreview } from '@/hooks/use-link-preview'
import { previewUrls } from '@/lib/spaces-unfurl'

// Slack-style unfurls under a message: a gray accent bar, favicon + site
// name, the title as a link, the description, the og:image below. Which
// links qualify is lib/spaces-unfurl.ts; the × hides a card for this
// install.

// Hidden cards, per install (like the trust list): `${messageId}|${url}`.
const HIDDEN_KEY = 'spaces:hiddenLinkPreviews'
const HIDDEN_MAX = 500

function hiddenList(): string[] {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]')
        return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
    } catch {
        return []
    }
}

function hideKey(messageId: string, url: string): string {
    return `${messageId}|${url}`
}

function hidePreview(messageId: string, url: string): void {
    try {
        const next = [...hiddenList(), hideKey(messageId, url)].slice(-HIDDEN_MAX)
        localStorage.setItem(HIDDEN_KEY, JSON.stringify(next))
    } catch {
        // Quota/private mode: the card just comes back next session.
    }
}

export function MessageLinkPreview({ body, messageId }: { body: string; messageId?: string }) {
    const urls = useMemo(() => previewUrls(body), [body])
    // Bumping re-reads the hidden list; the localStorage write is the store.
    const [, setHiddenTick] = useState(0)
    if (urls.length === 0) return null
    const hidden = new Set(hiddenList())
    const visible = messageId ? urls.filter((u) => !hidden.has(hideKey(messageId, u))) : urls
    if (visible.length === 0) return null
    return (
        <>
            {visible.map((url) => (
                <LinkPreviewCard
                    key={url}
                    url={url}
                    onHide={messageId ? () => {
                        hidePreview(messageId, url)
                        setHiddenTick((t) => t + 1)
                    } : undefined}
                />
            ))}
        </>
    )
}

function LinkPreviewCard({ url, onHide }: { url: string; onHide?: () => void }) {
    const preview = useLinkPreview(url)
    const [imageFailed, setImageFailed] = useState(false)
    const [faviconFailed, setFaviconFailed] = useState(false)
    if (!preview) return null
    const open = () => window.open(preview.url)
    return (
        <div className="group/unfurl relative mt-1 max-w-md">
            {/* Slack's anatomy: the rounded accent bar down the left, content beside it. */}
            <span aria-hidden className="absolute bottom-0.5 left-0 top-0.5 w-1 rounded-full bg-border" />
            <div className="min-w-0 py-0.5 pl-4 pr-6">
                <div className="flex items-center gap-1.5">
                    {preview.favicon && !faviconFailed ? (
                        <img src={preview.favicon} alt="" onError={() => setFaviconFailed(true)} className="size-4 shrink-0 rounded-[3px]" />
                    ) : (
                        <Globe className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate text-[13px] font-semibold text-foreground/90">
                        {preview.siteName ?? new URL(preview.url).hostname.replace(/^www\./, '')}
                    </span>
                </div>
                {preview.title && (
                    <button
                        type="button"
                        onClick={open}
                        title={preview.url}
                        className="mt-0.5 line-clamp-2 max-w-full text-left text-[15px] font-bold leading-snug text-[var(--stream-link)] hover:underline"
                    >
                        {preview.title}
                    </button>
                )}
                {preview.description && (
                    <div className="mt-0.5 line-clamp-3 text-[13px] leading-snug text-foreground/80">{preview.description}</div>
                )}
                {preview.imageUrl && !imageFailed && (
                    <img
                        src={preview.imageUrl}
                        alt=""
                        loading="lazy"
                        onError={() => setImageFailed(true)}
                        onClick={open}
                        className="mt-1.5 max-h-56 max-w-full cursor-pointer rounded-lg border border-border object-cover"
                    />
                )}
            </div>
            {onHide && (
                <button
                    type="button"
                    onClick={onHide}
                    aria-label="Remove preview"
                    title="Remove preview"
                    className="absolute right-0 top-0.5 hidden size-5 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground group-hover/unfurl:flex"
                >
                    <X className="size-3.5" />
                </button>
            )}
        </div>
    )
}
