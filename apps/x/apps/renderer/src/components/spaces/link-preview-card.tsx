import { useMemo, useState } from 'react'
import { useLinkPreview } from '@/hooks/use-link-preview'
import { isDirectImageUrl } from '@/components/spaces/space-markdown'
import { isTrustedDomain, linkDomain } from '@/lib/trusted-domains'

// Discord-style unfurl under a message: site, title, description, thumbnail.
// Only links on TRUSTED domains unfurl — a preview is a silent network
// request, and the trust gate on clicks would mean nothing if every posted
// URL got fetched anyway. One card per message (the first qualifying link).

/** The message's first https link worth a card — skips image tiles and untrusted domains. */
function firstPreviewUrl(body: string): string | null {
    const m = /https:\/\/[^\s<>)"'\]]+/.exec(body)
    if (!m) return null
    const url = m[0].replace(/[.,;:!?]+$/, '')
    if (isDirectImageUrl(url)) return null
    const domain = linkDomain(url)
    return domain && isTrustedDomain(domain) ? url : null
}

export function MessageLinkPreview({ body }: { body: string }) {
    const url = useMemo(() => firstPreviewUrl(body), [body])
    const preview = useLinkPreview(url)
    const [imageFailed, setImageFailed] = useState(false)
    if (!url || !preview) return null
    const open = () => window.open(preview.url)
    return (
        <div className="mt-1 flex max-w-md items-start gap-3 rounded-lg border-l-4 border-l-blue-500/70 bg-muted/40 py-2 pl-3 pr-3">
            <div className="min-w-0 flex-1">
                {preview.siteName && <div className="text-[11px] text-muted-foreground">{preview.siteName}</div>}
                {preview.title && (
                    <button
                        type="button"
                        onClick={open}
                        title={preview.url}
                        className="block max-w-full truncate text-left text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400"
                    >
                        {preview.title}
                    </button>
                )}
                {preview.description && (
                    <div className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{preview.description}</div>
                )}
            </div>
            {preview.imageUrl && !imageFailed && (
                <img
                    src={preview.imageUrl}
                    alt=""
                    loading="lazy"
                    onError={() => setImageFailed(true)}
                    onClick={open}
                    className="size-16 shrink-0 cursor-pointer rounded-md border border-border object-cover"
                />
            )}
        </div>
    )
}
