import { useMemo, useState } from 'react'
import { Globe, X } from 'lucide-react'
import { useLinkPreview } from '@/hooks/use-link-preview'
import { useSpacesOrgs } from '@/hooks/use-spaces'
import { previewUrls } from '@/lib/spaces-unfurl'
import { cn } from '@/lib/utils'

// Conversation unfurls under a message: a compact horizontal card — favicon +
// site name, the title as a link, a two-line description, and the og:image as
// a small square thumbnail on the right (spaces redesign, 2026-10-21: the
// full-width image dwarfed the messages around it). Which links qualify is
// lib/spaces-unfurl.ts; the × hides a card for this install.

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
    const { orgs } = useSpacesOrgs()
    const urls = useMemo(() => previewUrls(body, orgs.map((org) => org.address)), [body, orgs])
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
    const showImage = !!preview.imageUrl && !imageFailed
    return (
        <div className="group/unfurl relative mt-2 flex max-w-[440px] items-center gap-3.5 rounded-xl border border-border bg-foreground/[0.03] p-3 transition-colors hover:border-foreground/15 hover:bg-foreground/[0.055]">
            <div className={cn('min-w-0 flex-1', onHide && !showImage && 'pr-5')}>
                <div className="flex items-center gap-1.5">
                    {preview.favicon && !faviconFailed ? (
                        <img src={preview.favicon} alt="" onError={() => setFaviconFailed(true)} className="size-3.5 shrink-0 rounded-[3px]" />
                    ) : (
                        <Globe className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate text-[11.5px] text-muted-foreground">
                        {preview.siteName ?? new URL(preview.url).hostname.replace(/^www\./, '')}
                    </span>
                </div>
                {preview.title && (
                    <button
                        type="button"
                        onClick={open}
                        title={preview.url}
                        className="mt-1 line-clamp-2 max-w-full text-left text-[13.5px] font-semibold leading-snug text-[var(--stream-link)] hover:underline"
                    >
                        {preview.title}
                    </button>
                )}
                {preview.description && (
                    <div className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-muted-foreground">{preview.description}</div>
                )}
            </div>
            {showImage && (
                <img
                    src={preview.imageUrl}
                    alt=""
                    loading="lazy"
                    onError={() => setImageFailed(true)}
                    onClick={open}
                    className="size-16 shrink-0 cursor-pointer rounded-lg border border-border object-cover"
                />
            )}
            {onHide && (
                <button
                    type="button"
                    onClick={onHide}
                    aria-label="Remove preview"
                    title="Remove preview"
                    className="absolute right-1.5 top-1.5 hidden size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-xs hover:text-foreground group-hover/unfurl:flex"
                >
                    <X className="size-3" />
                </button>
            )}
        </div>
    )
}
