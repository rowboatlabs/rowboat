import { createContext, useContext, useMemo, useState, type ComponentProps, type ReactNode } from 'react'
import { Streamdown } from 'streamdown'
import { FileDown, FileText, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/lib/toast'
import { useMemberNames } from '@/components/spaces/member-text'
import {
    decorateMentions,
    parseAssetWireUrl,
    parseBlobAppUrl,
    parseSpaceFileAppUrl,
    resolveSpaceLink,
    rewriteBlobLinks,
    rewriteFileLinks,
    type SpaceRefs,
} from '@/lib/spaces-presentation'

// The one markdown renderer for space bodies (messages, thread parents).
// Three responsibilities layered over Streamdown, all space-specific:
//   1. mentions — decorateMentions via the members context (the mapMentions
//      walker; fix-it-once rule from the mention sweep),
//   2. blobs — the org's canonical https blob links rewrite to app://space-blob
//      (served by main through the content-addressed cache), images render
//      inline, non-image blob links render as a download card, and
//   3. file links — a relative link in a message points at a space file
//      (resolved from the root; plain markdown on the wire), as does the
//      contract's canonical …/f/<path> form; both open in the file pane.
// Every message-rendering path goes through here — fix it once.

const SpaceRefsContext = createContext<SpaceRefs | null>(null)

/** Mounted once per space pane, beside SpaceMembersProvider. */
export function SpaceRefsProvider({ refs, children }: { refs: SpaceRefs; children: ReactNode }) {
    return <SpaceRefsContext.Provider value={refs}>{children}</SpaceRefsContext.Provider>
}

export function useSpaceRefs(): SpaceRefs | null {
    return useContext(SpaceRefsContext)
}

const SpaceNavContext = createContext<((path: string) => void) | null>(null)

/** Mounted beside SpaceRefsProvider — lets any rendered file link open the file pane. */
export function SpaceNavProvider({ onOpenFile, children }: { onOpenFile: (path: string) => void; children: ReactNode }) {
    return <SpaceNavContext.Provider value={onOpenFile}>{children}</SpaceNavContext.Provider>
}

/** An attached non-image file inside a message: name + download on tap. */
function BlobLinkCard({ href, children }: { href: string; children?: ReactNode }) {
    const parsed = parseBlobAppUrl(href)
    const [saving, setSaving] = useState(false)
    if (!parsed) return null
    const suggestedName = (() => {
        try {
            const name = new URL(href).searchParams.get('name')
            if (name) return name
        } catch {
            // fall through to the link text
        }
        return typeof children === 'string' ? children : undefined
    })()
    const save = async () => {
        if (saving) return
        setSaving(true)
        try {
            const res = await window.ipc.invoke('spaces:saveBlob', {
                orgId: parsed.orgId,
                spaceId: parsed.spaceId,
                hash: parsed.hash,
                ...(suggestedName ? { suggestedName } : {}),
            })
            if (res.saved) toast('Saved', 'success')
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not download', 'error')
        } finally {
            setSaving(false)
        }
    }
    return (
        <button
            type="button"
            onClick={() => void save()}
            title="Download"
            className="my-0.5 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground/90 hover:border-foreground/30"
        >
            {saving ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : <FileDown className="size-3.5 shrink-0 text-muted-foreground" />}
            <span className="truncate">{children}</span>
        </button>
    )
}

/**
 * Discord-style viewer: the image large on a dimmed backdrop. Esc or a click
 * outside closes; the row under the image carries the source-specific action
 * (download for blobs, open-original for external links).
 */
function ImageLightbox({ src, alt, open, onOpenChange, children }: {
    src: string
    alt: string
    open: boolean
    onOpenChange: (open: boolean) => void
    children?: ReactNode
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                showCloseButton={false}
                className="flex w-auto max-w-[92vw] flex-col items-center border-none bg-transparent p-0 shadow-none outline-none sm:max-w-[92vw]"
            >
                <DialogTitle className="sr-only">{alt || 'Image'}</DialogTitle>
                <img src={src} alt={alt} className="max-h-[82vh] max-w-[92vw] rounded-lg object-contain" />
                {children && <div className="flex items-center gap-3 self-start text-xs">{children}</div>}
            </DialogContent>
        </Dialog>
    )
}

/** An uploaded image in a message: inline preview, click to view, download from the viewer. */
function BlobImage({ src, alt }: { src: string; alt: string }) {
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const parsed = parseBlobAppUrl(src)
    const save = async () => {
        if (saving || !parsed) return
        setSaving(true)
        try {
            const name = (() => {
                try {
                    return new URL(src).searchParams.get('name') ?? undefined
                } catch {
                    return undefined
                }
            })()
            const res = await window.ipc.invoke('spaces:saveBlob', {
                orgId: parsed.orgId,
                spaceId: parsed.spaceId,
                hash: parsed.hash,
                ...(name ? { suggestedName: name } : {}),
            })
            if (res.saved) toast('Saved', 'success')
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not download', 'error')
        } finally {
            setSaving(false)
        }
    }
    return (
        <>
            <img
                src={src}
                alt={alt}
                loading="lazy"
                onClick={() => setOpen(true)}
                className="my-1 block max-h-80 max-w-full cursor-zoom-in rounded-lg border border-border object-contain"
            />
            <ImageLightbox src={src} alt={alt} open={open} onOpenChange={setOpen}>
                {parsed && (
                    <button type="button" onClick={() => void save()} className="text-white/80 hover:text-white hover:underline">
                        {saving ? 'Saving…' : 'Download'}
                    </button>
                )}
            </ImageLightbox>
        </>
    )
}

/** A direct https image address — the path itself names an image (query strings welcome). */
export function isDirectImageUrl(url: string): boolean {
    try {
        const u = new URL(url)
        return u.protocol === 'https:' && /\.(gif|png|jpe?g|webp)$/i.test(u.pathname)
    } catch {
        return false
    }
}

/** The bare text of a link, when it has one (an autolinked URL renders its own address). */
function plainLabel(children: ReactNode): string | null {
    if (typeof children === 'string') return children
    if (Array.isArray(children) && children.length === 1 && typeof children[0] === 'string') return children[0]
    return null
}

/**
 * An external image (a pasted GIF link, a markdown image). Same frame as blob
 * images; a URL that never loads falls back to the plain link it came from.
 */
function ExternalImage({ src, alt }: { src: string; alt: string }) {
    const [failed, setFailed] = useState(false)
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const save = async () => {
        if (saving) return
        setSaving(true)
        try {
            const res = await window.ipc.invoke('spaces:saveImageUrl', { url: src })
            if (res.saved) toast('Saved', 'success')
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not download', 'error')
        } finally {
            setSaving(false)
        }
    }
    if (failed) {
        return (
            <a href={src} target="_blank" rel="noreferrer">
                {alt || src}
            </a>
        )
    }
    return (
        <>
            <img
                src={src}
                alt={alt}
                title={src}
                loading="lazy"
                onClick={() => setOpen(true)}
                onError={() => setFailed(true)}
                className="my-1 block max-h-80 max-w-full cursor-zoom-in rounded-lg border border-border object-contain"
            />
            <ImageLightbox src={src} alt={alt} open={open} onOpenChange={setOpen}>
                <button type="button" onClick={() => void save()} className="text-white/80 hover:text-white hover:underline">
                    {saving ? 'Saving…' : 'Download'}
                </button>
                <a href={src} target="_blank" rel="noreferrer" className="text-white/80 hover:text-white hover:underline">
                    Open original
                </a>
            </ImageLightbox>
        </>
    )
}

type StreamdownComponents = NonNullable<ComponentProps<typeof Streamdown>['components']>

const spaceComponents: StreamdownComponents = {
    img: ({ src, alt }) => {
        const url = typeof src === 'string' ? src : ''
        if (url.startsWith('app://space-blob/')) {
            return <BlobImage src={url} alt={alt ?? ''} />
        }
        return <ExternalImage src={url} alt={alt ?? ''} />
    },
    a: SpaceAnchor,
}

function SpaceAnchor({ href, children, ...rest }: ComponentProps<'a'>) {
    const refs = useContext(SpaceRefsContext)
    const openFile = useContext(SpaceNavContext)
    const url = typeof href === 'string' ? href : ''
    if (url.startsWith('app://space-blob/')) {
        return <BlobLinkCard href={url}>{children}</BlobLinkCard>
    }
    // A relative link in a message is a file link (resolved from the space
    // root — rewritten pre-parse to app://space-file so Streamdown's URL
    // hardening doesn't strip it); the contract's canonical asset URL for
    // this space opens the same way.
    const filePath = parseSpaceFileAppUrl(url)?.path
        ?? resolveSpaceLink(url, '')
        ?? (refs ? parseAssetWireUrl(url, refs) : null)
    // A pasted GIF/image address shows the picture, not the URL — but only
    // when the link IS its own text; a labelled [link](url) stays a link.
    // No <a> wrapper: the failure fallback is itself the link.
    if (!filePath && plainLabel(children) === url && isDirectImageUrl(url)) {
        return <ExternalImage src={url} alt="" />
    }
    if (filePath && openFile) {
        return (
            <button
                type="button"
                onClick={() => openFile(filePath)}
                title={filePath}
                className="inline-flex max-w-full items-baseline gap-1 align-baseline text-primary underline underline-offset-2 hover:opacity-80"
            >
                <FileText className="size-3 shrink-0 self-center" />
                <span className="truncate">{children}</span>
            </button>
        )
    }
    return (
        <a href={url} target="_blank" rel="noreferrer" {...rest}>
            {children}
        </a>
    )
}

export function SpaceMarkdown({ body, className }: { body: string; className?: string }) {
    const refs = useContext(SpaceRefsContext)
    const memberNames = useMemberNames()
    const text = useMemo(() => {
        const withBlobs = refs ? rewriteBlobLinks(body, refs) : body
        const withFiles = refs ? rewriteFileLinks(withBlobs, refs) : withBlobs
        return decorateMentions(withFiles, memberNames)
    }, [body, refs, memberNames])
    return (
        <div className={cn(className)}>
            <Streamdown components={spaceComponents}>{text}</Streamdown>
        </div>
    )
}
