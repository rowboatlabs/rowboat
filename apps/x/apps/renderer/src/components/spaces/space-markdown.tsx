import { createContext, memo, useContext, useMemo, useState, type ComponentProps, type CSSProperties, type ReactNode } from 'react'
import { Streamdown } from 'streamdown'
import { Eye, FileDown, FilePlus2, FileText, Loader2 } from 'lucide-react'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ZoomableImage } from '@/components/image-lightbox'
import { isTrustedDomain, linkDomain, trustDomain } from '@/lib/trusted-domains'
import { toast } from '@/lib/toast'
import { MemberProfilePopover } from '@/components/spaces/atoms'
import { useMemberNames } from '@/components/spaces/member-text'
import {
    decorateMentions,
    imageDimsFromUrl,
    parseAssetWireUrl,
    parseBlobAppUrl,
    parseSpaceFileAppUrl,
    resolveSpaceLink,
    rewriteBlobLinks,
    rewriteFileLinks,
    separateImageParagraphs,
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
 * outside closes; scroll zooms, click toggles fit ⇄ zoomed, drag pans. The
 * row under the image carries the source-specific action (download for
 * blobs, open-original for external links).
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
                <ZoomableImage src={src} alt={alt} className="max-h-[82vh] max-w-[92vw] rounded-lg object-contain" />
                {children && <div className="flex items-center gap-3 self-start text-xs">{children}</div>}
            </DialogContent>
        </Dialog>
    )
}

/** An uploaded image in a message: inline preview, click to view, download from the viewer. */
// Chat images render as Slack-style tiles: one consistent height, side by
// side on a line (wrapping), very wide shots cropped to a max tile width —
// the lightbox has the full image. Small images keep their natural size
// (tiles never upscale).
const TILE_H = 240
const TILE_MAX_W = 360

/** The tile look: soft corners, hairline border, a whisper of elevation that lifts on hover. */
const TILE_CLASS =
    'mb-1 mr-1.5 inline-block cursor-zoom-in rounded-xl border border-border bg-muted object-cover align-top shadow-sm transition-shadow hover:shadow-md'

/** Tile geometry from known dimensions: exact box, reserved before load. */
function tileStyle(dims: { width: number; height: number } | null): CSSProperties | undefined {
    if (!dims) return undefined
    if (dims.height <= TILE_H && dims.width <= TILE_MAX_W) return { width: dims.width, height: dims.height }
    return { width: Math.round(Math.min(TILE_MAX_W, (TILE_H * dims.width) / dims.height)), height: TILE_H }
}

/**
 * Promote a chat image into the space's files — the record. The bytes are
 * already in the org's blob store; saving is one proposeChange referencing
 * the hash. baseVersion 0 = create: an occupied path fails with the server's
 * conflict error rather than silently overwriting someone's file.
 */
function SaveToSpaceDialog({ src, onClose }: { src: string; onClose: () => void }) {
    const parsed = parseBlobAppUrl(src)
    const suggested = (() => {
        try {
            return new URL(src).searchParams.get('name') ?? ''
        } catch {
            return ''
        }
    })()
    const [path, setPath] = useState(suggested || (parsed ? `image-${parsed.hash.slice(0, 8)}.png` : ''))
    const [saving, setSaving] = useState(false)
    if (!parsed) return null
    const save = async () => {
        const cleaned = path.split('/').filter((s) => s && s !== '.' && s !== '..').join('/')
        if (!cleaned || saving) return
        setSaving(true)
        try {
            await window.ipc.invoke('spaces:proposeChange', {
                orgId: parsed.orgId,
                spaceId: parsed.spaceId,
                input: { assetPath: cleaned, baseVersion: 0, blob: parsed.hash, reason: 'saved from chat' },
            })
            toast('Saved to space files', 'success')
            onClose()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not save to space files', 'error')
        } finally {
            setSaving(false)
        }
    }
    return (
        <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
            <DialogContent className="sm:max-w-md">
                <DialogTitle>Save to space files</DialogTitle>
                <div className="text-sm text-muted-foreground">
                    The image becomes a file in this space — in the file tree for everyone, versioned like any other file.
                </div>
                <input
                    autoFocus
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') void save()
                    }}
                    placeholder="folder/name.png"
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none focus:border-foreground/30"
                />
                <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
                    <Button size="sm" disabled={saving} onClick={() => void save()}>
                        {saving ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null} Save
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}

export function BlobImage({ src, alt }: { src: string; alt: string }) {
    const [open, setOpen] = useState(false)
    const [saveOpen, setSaveOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [loaded, setLoaded] = useState(false)
    const parsed = parseBlobAppUrl(src)
    // BlobInfo dimensions ride the link as display-only ?w=&h= — reserve the
    // tile's exact final box (shimmering until the bytes arrive), so a
    // loading image never shifts the stream. Without them the tile height
    // still holds; only the width settles on load.
    const dims = imageDimsFromUrl(src)
    const style = tileStyle(dims)
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
            <ContextMenu>
                <ContextMenuTrigger asChild>
                    <img
                        src={src}
                        alt={alt}
                        loading="lazy"
                        onClick={() => setOpen(true)}
                        // The row has its own context menu — the image's wins here.
                        onContextMenu={(e) => e.stopPropagation()}
                        onLoad={() => setLoaded(true)}
                        style={style}
                        className={cn(TILE_CLASS, !style && 'h-60 max-w-[360px]', dims && !loaded && 'animate-pulse')}
                    />
                </ContextMenuTrigger>
                <ContextMenuContent>
                    <ContextMenuItem onSelect={() => setOpen(true)}>
                        <Eye className="size-3.5 mr-2" /> View
                    </ContextMenuItem>
                    {parsed && (
                        <>
                            <ContextMenuItem onSelect={() => setSaveOpen(true)}>
                                <FilePlus2 className="size-3.5 mr-2" /> Save to space files…
                            </ContextMenuItem>
                            <ContextMenuItem onSelect={() => void save()}>
                                <FileDown className="size-3.5 mr-2" /> Download…
                            </ContextMenuItem>
                        </>
                    )}
                </ContextMenuContent>
            </ContextMenu>
            <ImageLightbox src={src} alt={alt} open={open} onOpenChange={setOpen}>
                {parsed && (
                    <>
                        <button type="button" onClick={() => void save()} className="text-white/80 hover:text-white hover:underline">
                            {saving ? 'Saving…' : 'Download'}
                        </button>
                        <button type="button" onClick={() => setSaveOpen(true)} className="text-white/80 hover:text-white hover:underline">
                            Save to space files
                        </button>
                    </>
                )}
            </ImageLightbox>
            {saveOpen && <SaveToSpaceDialog src={src} onClose={() => setSaveOpen(false)} />}
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

const MENTION_PILL_CLASS = 'rounded bg-indigo-500/15 px-1 py-px font-semibold text-indigo-600 dark:bg-indigo-400/25 dark:text-indigo-300'

/**
 * A mention pill. A real member's pill opens their profile on click — the
 * label carries the display name (decorateMentions), so the id comes from a
 * reverse lookup over the roster; @here, @rowboat, and a name the roster no
 * longer carries stay inert.
 */
function MentionPill({ label }: { label: string }) {
    const names = useMemberNames()
    const name = label.slice(1)
    let memberId: string | null = null
    for (const [id, display] of names) {
        if (display === name) {
            memberId = id
            break
        }
    }
    if (!memberId) return <span className={MENTION_PILL_CLASS}>{label}</span>
    return (
        <MemberProfilePopover id={memberId}>
            <button type="button" className={cn(MENTION_PILL_CLASS, 'cursor-pointer hover:bg-indigo-500/25 dark:hover:bg-indigo-400/35')}>
                {label}
            </button>
        </MemberProfilePopover>
    )
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
        return <ExternalLink href={src}>{alt || src}</ExternalLink>
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
                className={cn(TILE_CLASS, 'h-60 max-w-[360px]')}
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

/**
 * An external link: blue, clickable — and gated. The first click on a domain
 * shows the full destination and offers to trust the domain (stored locally);
 * links to trusted domains open straight in the system browser.
 */
function ExternalLink({ href, children }: { href: string; children?: ReactNode }) {
    const [confirming, setConfirming] = useState(false)
    const domain = linkDomain(href)
    // Only http(s) leaves the app; anything else renders inert.
    if (!domain) return <span>{children}</span>
    const open = () => window.open(href) // main routes this to the system browser
    return (
        <>
            <a
                href={href}
                title={href}
                onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (isTrustedDomain(domain)) open()
                    else setConfirming(true)
                }}
                className="cursor-pointer break-words text-blue-600 underline underline-offset-2 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
            >
                {children}
            </a>
            {confirming && (
                <Dialog open onOpenChange={(o) => { if (!o) setConfirming(false) }}>
                    <DialogContent className="sm:max-w-md">
                        <DialogTitle>Leaving Rowboat</DialogTitle>
                        <div className="text-sm text-muted-foreground">
                            This link opens in your browser:
                            <div className="mt-2 max-h-24 overflow-y-auto break-all rounded-md bg-muted px-2 py-1.5 font-mono text-xs text-foreground">{href}</div>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>Cancel</Button>
                            <Button variant="outline" size="sm" onClick={() => { trustDomain(domain); setConfirming(false); open() }}>
                                Trust {domain}
                            </Button>
                            <Button size="sm" onClick={() => { setConfirming(false); open() }}>Open link</Button>
                        </div>
                    </DialogContent>
                </Dialog>
            )}
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
    // Mentions arrive as **@Name** (decorateMentions): a strong that IS an
    // @-handle renders as a Discord-style pill (click = the member's
    // profile); any other bold stays bold.
    strong: ({ children }) => {
        const label = plainLabel(children)
        if (label?.startsWith('@')) return <MentionPill label={label} />
        return <strong>{children}</strong>
    },
}

function SpaceAnchor({ href, children }: ComponentProps<'a'>) {
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
    return <ExternalLink href={url}>{children}</ExternalLink>
}

// Memoized: a stream re-renders on every presence/typing frame, and markdown
// is by far the heaviest thing in a row — same body, same refs, same names
// (both contexts still cut through the memo) means the row's markdown stands.
export const SpaceMarkdown = memo(function SpaceMarkdown({ body, className }: { body: string; className?: string }) {
    const refs = useContext(SpaceRefsContext)
    const memberNames = useMemberNames()
    const text = useMemo(() => {
        const withBlobs = refs ? rewriteBlobLinks(body, refs) : body
        const withFiles = refs ? rewriteFileLinks(withBlobs, refs) : withBlobs
        // Pre-separator messages joined text and images in one paragraph —
        // normalize so every message gets text above, a clean tile row below.
        return decorateMentions(separateImageParagraphs(withFiles), memberNames)
    }, [body, refs, memberNames])
    return (
        <div className={cn(className)}>
            <Streamdown components={spaceComponents}>{text}</Streamdown>
        </div>
    )
})
