import { FileConflictNotice, useSpaceFileSave, type SavedSpaceFile } from './file-conflict'
import { createContext, memo, useContext, useMemo, useRef, useState, type ComponentProps, type CSSProperties, type ReactNode } from 'react'
import type { spaces } from '@x/shared'
import { BlobPreview } from '@/components/spaces/blob-preview'
import { Streamdown } from 'streamdown'
import { Eye, FileDown, FilePlus2, FileText, Loader2, MessageSquare, X } from 'lucide-react'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ImageLightbox as SharedImageLightbox } from '@/components/image-lightbox'
import { isTrustedDomain, linkDomain, trustDomain } from '@/lib/trusted-domains'
import { userMessageRemarkPlugins } from '@/lib/markdown-render'
import { toast } from '@/lib/toast'
import { MemberProfilePopover } from '@/components/spaces/atoms'
import { SpaceNavContext, SpaceRefsContext, SpaceRefsProvider, useSpaceNav, useSpaceRefs, type SpaceNav } from '@/components/spaces/space-nav'
export { SpaceRefsProvider, useSpaceNav, useSpaceRefs, type SpaceNav }
import { useMemberNames, useSpaceProfiles } from '@/components/spaces/member-text'
import { findSpace, useSpacesOrgs } from '@/hooks/use-spaces'
import {
    imageDimsFromUrl,
    parseAssetWireUrl,
    parseBlobAppUrl,
    parseSpaceFileAppUrl,
    parseSpaceMemberAppUrl,
    parseSpacePathAppUrl,
    parseMemberWireUrl,
    parseMessageWireUrl,
    parseSpaceRefAppUrl,
    parseSpaceWireUrl,
    resolveSpaceLink,
    rewriteBlobLinks,
    rewriteFileLinks,
    rewriteMentionLinks,
    separateImageParagraphs,
    HERE_APP_URL,
    ROWBOAT_APP_URL,
    type SpaceRefs,
} from '@/lib/spaces-presentation'
import { isInviteUrl, openServerDialog } from '@/lib/server-dialog'

// The one markdown renderer for space bodies (messages, thread parents).
// Three responsibilities layered over Streamdown, all space-specific:
//   1. mentions — the wire's link tokens (protocol mentions.ts) rewrite to
//      app://space-member/<id> (a person) or app://space-ref/<id> (a space)
//      pre-parse and render as chips keyed on the ID, the name coming from
//      the members context or the reader's own org listing (never from the
//      label); the contract's canonical …/s/<spaceId> link is the same chip,
//   2. blobs — the org's canonical https blob links rewrite to app://space-blob
//      (served by main through the content-addressed cache), images render
//      inline, non-image blob links render as a preview card, and
//   3. file links — the contract's canonical …/a/<assetId> form names a file
//      by id (any space; this one opens in the file pane, another one
//      navigates there, one the reader is not in renders muted), and a
//      relative link in a message resolves through the space's listing
//      (path → id, from the root; plain markdown on the wire).
// Every message-rendering path goes through here — fix it once.

/** The space's live listing, indexed both ways: relative links resolve path → id; links by id show their path. */
export interface SpaceAssetsIndex {
    byPath: ReadonlyMap<string, spaces.SpacesAssetEntry>
    byId: ReadonlyMap<string, spaces.SpacesAssetEntry>
}

const EMPTY_ASSETS: SpaceAssetsIndex = { byPath: new Map(), byId: new Map() }
const SpaceAssetsContext = createContext<SpaceAssetsIndex>(EMPTY_ASSETS)

/** Mounted beside SpaceRefsProvider with the pane's listing — so anchors resolve synchronously, at render time. */
export function SpaceAssetsProvider({ entries, children }: { entries: readonly spaces.SpacesAssetEntry[]; children: ReactNode }) {
    // The pane refetches the listing on every live event, usually landing an
    // equal array; every message body memoizes on this index, so it must only
    // change when an id, path, or trash state actually did.
    const signature = entries.map((e) => `${e.id}\u0000${e.path}\u0000${e.state ?? ''}`).join('\n')
    const latest = useRef(entries)
    latest.current = entries
    const index = useMemo<SpaceAssetsIndex>(() => {
        const live = latest.current.filter((e) => e.state !== 'deleted')
        return { byPath: new Map(live.map((e) => [e.path, e])), byId: new Map(live.map((e) => [e.id, e])) }
    }, [signature])
    return <SpaceAssetsContext.Provider value={index}>{children}</SpaceAssetsContext.Provider>
}

export function useSpaceAssets(): SpaceAssetsIndex {
    return useContext(SpaceAssetsContext)
}

const AttachmentNavContext = createContext<((src: string, name: string) => void) | null>(null)


/** Mounted beside SpaceRefsProvider — lets every org link in rendered markdown open what it names: a file, a space, a message, a person's DM. */
export function SpaceNavProvider({ onOpenFile, onOpenSpaceFile, onOpenSpace, onOpenMessage, onOpenDirect, resolveOrg, resolveSpace, onOpenAttachment, children }: SpaceNav & { onOpenAttachment?: (src: string, name: string) => void; children: ReactNode }) {
    const nav = useMemo<SpaceNav>(
        () => ({
            onOpenFile,
            ...(onOpenSpaceFile ? { onOpenSpaceFile } : {}),
            ...(onOpenSpace ? { onOpenSpace } : {}),
            ...(onOpenMessage ? { onOpenMessage } : {}),
            ...(onOpenDirect ? { onOpenDirect } : {}),
            ...(resolveOrg ? { resolveOrg } : {}),
            ...(resolveSpace ? { resolveSpace } : {}),
        }),
        [onOpenFile, onOpenSpaceFile, onOpenSpace, onOpenMessage, onOpenDirect, resolveOrg, resolveSpace],
    )
    return <SpaceNavContext.Provider value={nav}><AttachmentNavContext.Provider value={onOpenAttachment ?? null}>{children}</AttachmentNavContext.Provider></SpaceNavContext.Provider>
}

/** Attachments preview on tap; saving to space files keeps the original link intact. */
function BlobLinkCard({ href, children }: { href: string; children?: ReactNode }) {
    const parsed = parseBlobAppUrl(href)
    const openAttachment = useContext(AttachmentNavContext)
    const [saveOpen, setSaveOpen] = useState(false)
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
        <>
            <span className="my-0.5 inline-flex max-w-full items-center rounded-lg border border-border bg-background text-xs font-medium text-foreground/90">
                <button type="button" onClick={() => openAttachment?.(href, suggestedName || 'Attachment')} title="Preview file" className="inline-flex min-w-0 items-center gap-1.5 px-2.5 py-1.5 hover:bg-accent">
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{children}</span>
                </button>
                <button type="button" onClick={() => setSaveOpen(true)} title="Save to space files" aria-label="Save to space files" className="shrink-0 p-2 hover:bg-accent"><FilePlus2 className="size-3.5" /></button>
                <button type="button" disabled={saving} onClick={() => void save()} title="Download" aria-label="Download" className="shrink-0 p-2 hover:bg-accent">
                    {saving ? <Loader2 className="size-3.5 animate-spin" /> : <FileDown className="size-3.5" />}
                </button>
            </span>
            {saveOpen && <SaveToSpaceDialog src={href} suggestedName={suggestedName} onClose={() => setSaveOpen(false)} />}
        </>
    )
}

/** One gallery per message, using rendered tile order (including pasted image URLs). */
const MessageImageGalleryContext = createContext<((image: HTMLImageElement) => void) | null>(null)

function MessageImageGallery({ children }: { children: ReactNode }) {
    const container = useRef<HTMLDivElement>(null)
    const [gallery, setGallery] = useState<{ images: { src: string; alt: string }[]; index: number } | null>(null)
    const openImage = (image: HTMLImageElement) => {
        const tiles = Array.from(container.current?.querySelectorAll<HTMLImageElement>('img[data-message-image]') ?? [])
        const index = tiles.indexOf(image)
        if (index < 0) return
        setGallery({ images: tiles.map((tile) => ({ src: tile.src, alt: tile.alt })), index })
    }
    const selected = gallery?.images[gallery.index]
    return (
        <MessageImageGalleryContext.Provider value={openImage}>
            <div ref={container}>{children}</div>
            <SharedImageLightbox
                open={Boolean(selected)}
                onOpenChange={(open) => { if (!open) setGallery(null) }}
                src={selected?.src ?? ''}
                name={selected?.alt || 'Image'}
                actions={selected && <SpaceImageActions key={selected.src} src={selected.src} />}
                navigation={gallery ? {
                    index: gallery.index,
                    count: gallery.images.length,
                    onPrevious: () => setGallery((current) => current && ({ ...current, index: Math.max(0, current.index - 1) })),
                    onNext: () => setGallery((current) => current && ({ ...current, index: Math.min(current.images.length - 1, current.index + 1) })),
                } : undefined}
            />
        </MessageImageGalleryContext.Provider>
    )
}

/** Source-specific actions always follow the currently selected image. */
function SpaceImageActions({ src }: { src: string }) {
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [saveOpen, setSaveOpen] = useState(false)
    const parsed = parseBlobAppUrl(src)
    const save = async () => {
        if (saving) return
        setSaving(true)
        setError(null)
        try {
            const res = parsed
                ? await window.ipc.invoke('spaces:saveBlob', {
                    ...parsed,
                    suggestedName: new URL(src).searchParams.get('name') ?? undefined,
                })
                : await window.ipc.invoke('spaces:saveImageUrl', { url: src })
            if (res.saved) toast('Saved', 'success')
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not download')
        } finally {
            setSaving(false)
        }
    }
    return (
        <>
            <button type="button" disabled={saving} onClick={() => void save()} className="text-white/80 hover:text-white hover:underline">
                {saving ? 'Saving…' : 'Download'}
            </button>
            {parsed ? (
                <button type="button" onClick={() => setSaveOpen(true)} className="text-white/80 hover:text-white hover:underline">Save to space files</button>
            ) : (
                <a href={src} target="_blank" rel="noreferrer" className="text-white/80 hover:text-white hover:underline">Open original</a>
            )}
            {error && <p role="alert" className="absolute right-0 top-full mt-2 w-72 rounded-md bg-background p-3 text-xs text-destructive shadow-lg">{error}</p>}
            {saveOpen && <SaveToSpaceDialog src={src} onClose={() => setSaveOpen(false)} />}
        </>
    )
}

/** Standalone tiles outside a message retain a single-image viewer. */
function ImageLightbox({ src, alt, open, onOpenChange, children }: {
    src: string
    alt: string
    open: boolean
    onOpenChange: (open: boolean) => void
    children?: ReactNode
}) {
    return <SharedImageLightbox src={src} name={alt || 'Image'} open={open} onOpenChange={onOpenChange} actions={children} />
}

/** An uploaded image in a message: inline preview, click to view, download from the viewer. */
// Chat images render as uniform tiles: one consistent height, side by
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
 * Promote a chat attachment into the space's files. The bytes are
 * already in the org's blob store; saving is one proposeChange referencing
 * the hash. Duplicate names use the same explicit choices as direct uploads.
 */
function SaveToSpaceDialog({ src, suggestedName, onSaved, onClose }: { src: string; suggestedName?: string; onSaved?: (saved: SavedSpaceFile) => void; onClose: () => void }) {
    const parsed = parseBlobAppUrl(src)
    const suggested = (() => {
        try {
            return new URL(src).searchParams.get('name') ?? ''
        } catch {
            return ''
        }
    })()
    const [path, setPath] = useState(suggested || suggestedName || (parsed ? `attachment-${parsed.hash.slice(0, 8)}` : ''))
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const fileSave = useSpaceFileSave(parsed?.orgId ?? '', parsed?.spaceId ?? '')
    if (!parsed) return null
    const save = async () => {
        const cleaned = path.split('/').filter((s) => s && s !== '.' && s !== '..').join('/')
        if (saving) return
        if (!cleaned) { setError('Enter a file name.'); return }
        setSaving(true)
        setError(null)
        try {
            const saved = await fileSave.save({ path: cleaned, getBlob: async () => parsed.hash, reason: 'saved from chat' })
            if (!saved) { onClose(); return }
            toast('Saved to space files', 'success')
            onSaved?.(saved)
            onClose()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save to space files')
        } finally {
            setSaving(false)
        }
    }
    return (
        <Dialog open onOpenChange={(o) => { if (!o && !saving) onClose() }}>
            <DialogContent className="sm:max-w-md">
                <DialogTitle>Save to space files</DialogTitle>
                <div className="text-sm text-muted-foreground">
                    Save this attachment in Files for everyone in the space. It will still be available in this message.
                </div>
                <input
                    autoFocus
                    value={path}
                    onChange={(e) => { setPath(e.target.value); setError(null) }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') void save()
                    }}
                    aria-label="File name"
                    disabled={saving}
                    placeholder="File name"
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none focus:border-foreground/30"
                />
                {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
                {fileSave.conflict && <FileConflictNotice conflict={fileSave.conflict} onChoose={fileSave.choose} />}
                {!fileSave.conflict && <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" disabled={saving} onClick={onClose}>Cancel</Button>
                    <Button size="sm" disabled={saving} onClick={() => void save()}>
                        {saving ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null} Save
                    </Button>
                </div>}
            </DialogContent>
        </Dialog>
    )
}

export function BlobImage({ src, alt }: { src: string; alt: string }) {
    const imageRef = useRef<HTMLImageElement>(null)
    const openGallery = useContext(MessageImageGalleryContext)
    const preview = () => {
        if (openGallery && imageRef.current) openGallery(imageRef.current)
        else setOpen(true)
    }
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
            <span className="relative inline-block align-top">
            <ContextMenu>
                <ContextMenuTrigger asChild>
                    <img
                        src={src}
                        ref={imageRef}
                        data-message-image
                        role="button"
                        tabIndex={0}
                        aria-label={`Preview ${alt || 'image'}`}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); preview() }
                        }}
                        alt={alt}
                        loading="lazy"
                        onClick={preview}
                        // The row has its own context menu — the image's wins here.
                        onContextMenu={(e) => e.stopPropagation()}
                        onLoad={() => setLoaded(true)}
                        style={style}
                        className={cn(TILE_CLASS, !style && 'h-60 max-w-[360px]', dims && !loaded && 'animate-pulse')}
                    />
                </ContextMenuTrigger>
                <ContextMenuContent>
                    <ContextMenuItem onSelect={preview}>
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
            {parsed && <button type="button" title="Save to space files" aria-label={`Save ${alt || 'image'} to space files`} onClick={() => setSaveOpen(true)} className="absolute bottom-3 right-3 rounded-md border border-border bg-background p-1.5 text-foreground shadow-sm hover:bg-accent"><FilePlus2 className="size-3.5" /></button>}
            </span>
            <ImageLightbox src={src} alt={alt} open={open} onOpenChange={setOpen}>
                <SpaceImageActions src={src} />
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

/**
 * An external image (a pasted GIF link, a markdown image). Same frame as blob
 * images; a URL that never loads falls back to the plain link it came from.
 */
function ExternalImage({ src, alt }: { src: string; alt: string }) {
    const imageRef = useRef<HTMLImageElement>(null)
    const openGallery = useContext(MessageImageGalleryContext)
    const preview = () => {
        if (openGallery && imageRef.current) openGallery(imageRef.current)
        else setOpen(true)
    }
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
                ref={imageRef}
                data-message-image
                role="button"
                tabIndex={0}
                aria-label={`Preview ${alt || 'image'}`}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); preview() }
                }}
                alt={alt}
                title={src}
                loading="lazy"
                onClick={preview}
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
 * A hostname short enough to label a button with. Tunnel and preview hosts
 * (ngrok, vercel, codespaces) carry a long random head, so it is the head that
 * goes: the registrable domain at the tail is the part the trust decision
 * actually turns on, and the dialog shows the full URL above regardless.
 */
function shortDomain(domain: string): string {
    return domain.length <= 28 ? domain : `…${domain.slice(-27)}`
}

/**
 * An external link: blue, clickable — and gated. The first click on a domain
 * shows the full destination and offers to trust the domain (stored locally);
 * links to trusted domains open straight in the system browser.
 */
function ExternalLink({ href, children }: { href: string; children?: ReactNode }) {
    const [confirming, setConfirming] = useState(false)
    const cancelRef = useRef<HTMLButtonElement>(null)
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
                className="cursor-pointer break-words text-[var(--stream-link)] no-underline underline-offset-2 hover:underline"
            >
                {children}
            </a>
            {confirming && (
                <Dialog open onOpenChange={(o) => { if (!o) setConfirming(false) }}>
                    <DialogContent
                        className="sm:max-w-md"
                        // The trust control leads the row, so the opening focus
                        // is pinned past it: Enter on a gate like this one must
                        // not mean "trust this domain forever".
                        onOpenAutoFocus={(e) => { e.preventDefault(); cancelRef.current?.focus() }}
                    >
                        <DialogTitle>Leaving Rowboat</DialogTitle>
                        {/* min-w-0 throughout: these are grid children, which
                            size to their content by default and would push a
                            long hostname straight through the card's edge. */}
                        <div className="min-w-0 text-sm text-muted-foreground">
                            This link opens in your browser:
                            <div className="mt-2 max-h-24 overflow-y-auto break-all rounded-md bg-muted px-2 py-1.5 font-mono text-xs text-foreground">{href}</div>
                        </div>
                        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                            {/* The one control the message gets to size, so it
                                leads the row and takes the whole line when it
                                wraps — shrinking and eliding, never growing. */}
                            <Button
                                variant="outline"
                                size="sm"
                                className="mr-auto min-w-0 max-w-full"
                                title={domain}
                                aria-label={`Trust ${domain}`}
                                onClick={() => { trustDomain(domain); setConfirming(false); open() }}
                            >
                                <span className="min-w-0 truncate">Trust {shortDomain(domain)}</span>
                            </Button>
                            {/* Grouped so the answer to the dialog never splits
                                across lines when the trust control wraps. */}
                            <div className="flex shrink-0 items-center gap-2">
                                <Button ref={cancelRef} variant="ghost" size="sm" onClick={() => setConfirming(false)}>Cancel</Button>
                                <Button size="sm" onClick={() => { setConfirming(false); open() }}>Open link</Button>
                            </div>
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
}

/** The blue chip — a person who is not you, or a space; one class so the two read as the same kind of thing. */
const CHIP_CLASS = 'rounded-[4px] px-[3px] py-px font-medium bg-[var(--stream-mention-wash)] text-[var(--stream-link)]'

/**
 * A mention chip, keyed on the ID the token carries — the name is the roster's
 * current one, never the label (two members with the same name can no longer
 * collide). Only the chip is tinted, never the row: amber when it addresses
 * you (@you, @here), blue for anyone else. A member chip opens their profile.
 */
function MentionChip({ memberId, broadcast, fallback }: { memberId?: string; broadcast?: 'here' | 'rowboat'; fallback: string }) {
    const names = useMemberNames()
    const { selfId } = useSpaceProfiles()
    const label = broadcast ? `@${broadcast}` : `@${(memberId !== undefined ? names.get(memberId) : undefined) ?? fallback.replace(/^@/, '')}`
    const addressesMe = broadcast === 'here' || (!!selfId && memberId === selfId)
    const chip = addressesMe ? 'rounded-[4px] px-[3px] py-px font-medium bg-[var(--stream-you-wash)] text-[var(--stream-you-ink)]' : CHIP_CLASS
    // @here and @rowboat address the room and your agent — no profile to open.
    if (broadcast || memberId === undefined || !names.has(memberId)) {
        return <strong className={chip}>{label}</strong>
    }
    return (
        <MemberProfilePopover id={memberId}>
            <button type="button" className={cn(chip, 'cursor-pointer hover:brightness-95 dark:hover:brightness-110')}>
                {label}
            </button>
        </MemberProfilePopover>
    )
}

/**
 * A space reference as a `#Name` chip, keyed on the space's ID: the name is
 * the reader's own listing's (a shared space by name, a DM by the other
 * person's), never the token's label. Clicking opens the space. A space the
 * reader is not in — not in their listing — is not theirs to open: the label
 * renders muted, the way a file link into such a space does. `orgAddress`
 * comes with a canonical https link; a token is read on the pane's own org.
 */
function SpaceChip({ spaceId, orgAddress, fallback }: { spaceId: string; orgAddress?: string; fallback: string }) {
    const refs = useContext(SpaceRefsContext)
    const nav = useContext(SpaceNavContext)
    const { orgs } = useSpacesOrgs()
    const org = orgAddress !== undefined ? orgs.find((o) => o.address === orgAddress) : orgs.find((o) => o.id === refs?.orgId)
    const space = org ? findSpace(org, spaceId) : undefined
    if (!org || !space) {
        // A bare canonical URL is its own label; anything else reads as a #name.
        const muted = /^https:\/\//.test(fallback) ? fallback : `#${fallback.replace(/^#/, '')}`
        return <span title="Not available to you" className="text-muted-foreground">{muted}</span>
    }
    const label = `#${org.directLabels[space.id] ?? space.name}`
    if (!nav?.onOpenSpace) return <strong className={CHIP_CLASS}>{label}</strong>
    return (
        <button type="button" onClick={() => nav.onOpenSpace?.(org.id, space.id)} title="Open space" className={cn(CHIP_CLASS, 'cursor-pointer hover:brightness-95 dark:hover:brightness-110')}>
            {label}
        </button>
    )
}

/**
 * The contract's link to a person (https://<org>/u/<memberId>): an @Name
 * chip that opens the DM with them. Distinct from a mention token — a link
 * never addresses anyone — but drawn the same way, so a person reads the
 * same everywhere. The name comes from the roster; the label is a hint.
 */
function PersonLinkChip({ orgAddress, memberId, fallback }: { orgAddress: string; memberId: string; fallback: string }) {
    const refs = useContext(SpaceRefsContext)
    const nav = useContext(SpaceNavContext)
    const names = useMemberNames()
    // A bare pasted URL is its own label — never a name; the id stands in.
    const hint = /^https:\/\//.test(fallback) ? memberId : fallback.replace(/^@/, '')
    const orgId = orgAddress === refs?.orgAddress ? refs.orgId : (nav?.resolveOrg?.(orgAddress) ?? null)
    if (!orgId) return <span title="Not available to you" className="text-muted-foreground">{`@${hint}`}</span>
    const name = `@${names.get(memberId) ?? hint}`
    if (!nav?.onOpenDirect) return <strong className={CHIP_CLASS}>{name}</strong>
    return (
        <button type="button" onClick={() => nav.onOpenDirect?.(orgId, memberId)} title="Message them" className={cn(CHIP_CLASS, 'cursor-pointer hover:brightness-95 dark:hover:brightness-110')}>
            {name}
        </button>
    )
}

/** The contract's link to a message ("Copy link"): a chip that jumps to it, in this space or another the reader is in. */
function MessageLinkChip({ orgAddress, spaceId, messageId, children }: { orgAddress: string; spaceId: string; messageId: string; children?: ReactNode }) {
    const refs = useContext(SpaceRefsContext)
    const nav = useContext(SpaceNavContext)
    const orgId = orgAddress === refs?.orgAddress && spaceId === refs.spaceId ? refs.orgId : (nav?.resolveSpace?.(orgAddress, spaceId) ?? null)
    const label = plainLabel(children)
    const text = label && !/^https:\/\//.test(label) ? label : 'message'
    if (!orgId || !nav?.onOpenMessage) {
        return (
            <span title="Not available to you" className="inline-flex max-w-full items-baseline gap-1 align-baseline text-muted-foreground underline decoration-dotted underline-offset-2">
                <MessageSquare className="size-3 shrink-0 self-center" />
                <span className="truncate">{text}</span>
            </span>
        )
    }
    return (
        <button
            type="button"
            onClick={() => nav.onOpenMessage?.(orgId, spaceId, messageId)}
            title="Go to message"
            className="inline-flex max-w-full items-baseline gap-1 align-baseline text-primary underline underline-offset-2 hover:opacity-80"
        >
            <MessageSquare className="size-3 shrink-0 self-center" />
            <span className="truncate">{text}</span>
        </button>
    )
}

/** A link into a space file: open (by id) here or in another space, or muted when it leads nowhere the reader can go. */
type FileLinkTarget =
    | { kind: 'open'; assetId: string; title: string }
    | { kind: 'elsewhere'; orgId: string; spaceId: string; assetId: string }
    | { kind: 'muted'; title: string }

/**
 * What a file-shaped href leads to. Canonical https asset links name an id in
 * any space; app://space-file is the render form of a resolved relative link;
 * app://space-path a relative link the listing did not know at rewrite time
 * (tried once more here — the listing may have landed since); a bare relative
 * href (a renderer without the rewrite pass) resolves the same way.
 */
function fileLinkTarget(url: string, refs: SpaceRefs | null, assets: SpaceAssetsIndex, nav: SpaceNav | null): FileLinkTarget | null {
    const byId = (assetId: string): FileLinkTarget => ({ kind: 'open', assetId, title: assets.byId.get(assetId)?.path ?? assetId })
    const byPath = (path: string): FileLinkTarget => {
        const entry = assets.byPath.get(path)
        return entry ? byId(entry.id) : { kind: 'muted', title: `No file at ${path}` }
    }
    const wire = parseAssetWireUrl(url)
    if (wire) {
        if (refs && wire.orgAddress === refs.orgAddress && wire.spaceId === refs.spaceId) return byId(wire.assetId)
        const orgId = nav?.resolveSpace?.(wire.orgAddress, wire.spaceId) ?? null
        return orgId ? { kind: 'elsewhere', orgId, spaceId: wire.spaceId, assetId: wire.assetId } : { kind: 'muted', title: 'Not available to you' }
    }
    const app = parseSpaceFileAppUrl(url)
    if (app) return byId(app.assetId)
    const dangling = parseSpacePathAppUrl(url)
    if (dangling) return byPath(dangling.path)
    const relative = resolveSpaceLink(url, '')
    return relative ? byPath(relative) : null
}

function SpaceAnchor({ href, children }: ComponentProps<'a'>) {
    const refs = useContext(SpaceRefsContext)
    const nav = useContext(SpaceNavContext)
    const assets = useContext(SpaceAssetsContext)
    const url = typeof href === 'string' ? href : ''
    // Mention tokens arrive here as app links (rewriteMentionLinks) — chips, by id.
    const mentionId = parseSpaceMemberAppUrl(url)
    if (mentionId !== null) return <MentionChip memberId={mentionId} fallback={plainLabel(children) ?? mentionId} />
    if (url === HERE_APP_URL) return <MentionChip broadcast="here" fallback="@here" />
    if (url === ROWBOAT_APP_URL) return <MentionChip broadcast="rowboat" fallback="@rowboat" />
    const spaceRefId = parseSpaceRefAppUrl(url)
    if (spaceRefId !== null) return <SpaceChip spaceId={spaceRefId} fallback={plainLabel(children) ?? spaceRefId} />
    const person = parseMemberWireUrl(url)
    if (person) return <PersonLinkChip orgAddress={person.orgAddress} memberId={person.memberId} fallback={plainLabel(children) ?? person.memberId} />
    const messageLink = parseMessageWireUrl(url)
    if (messageLink) return <MessageLinkChip {...messageLink}>{children}</MessageLinkChip>
    const spaceWire = parseSpaceWireUrl(url)
    if (spaceWire) return <SpaceChip spaceId={spaceWire.spaceId} orgAddress={spaceWire.orgAddress} fallback={plainLabel(children) ?? spaceWire.spaceId} />
    // An invite link pasted into a message joins from right here — no browser
    // round trip through the org's landing page.
    if (isInviteUrl(url)) {
        return (
            <button type="button" onClick={() => openServerDialog({ kind: 'join', inviteUrl: url })} title="Join with this invite" className="inline-flex max-w-full items-baseline gap-1 align-baseline text-primary underline underline-offset-2 hover:opacity-80">
                <span className="truncate">{children}</span>
            </button>
        )
    }
    if (url.startsWith('app://space-blob/')) {
        return <BlobLinkCard href={url}>{children}</BlobLinkCard>
    }
    const target = fileLinkTarget(url, refs, assets, nav)
    // A pasted GIF/image address shows the picture, not the URL — but only
    // when the link IS its own text; a labelled [link](url) stays a link.
    // No <a> wrapper: the failure fallback is itself the link.
    if (!target && plainLabel(children) === url && isDirectImageUrl(url)) {
        return <ExternalImage src={url} alt="" />
    }
    if (target?.kind === 'muted' || (target && target.kind === 'elsewhere' && !nav?.onOpenSpaceFile) || (target?.kind === 'open' && !nav)) {
        const title = target.kind === 'muted' ? target.title : 'Not available here'
        return (
            <span title={title} className="inline-flex max-w-full items-baseline gap-1 align-baseline text-muted-foreground underline decoration-dotted underline-offset-2">
                <FileText className="size-3 shrink-0 self-center" />
                <span className="truncate">{children}</span>
            </span>
        )
    }
    if (target && nav) {
        const open = target.kind === 'open'
            ? () => nav.onOpenFile(target.assetId)
            : () => nav.onOpenSpaceFile?.(target.orgId, target.spaceId, target.assetId)
        return (
            <button
                type="button"
                onClick={open}
                title={target.kind === 'open' ? target.title : 'Open in its space'}
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
// is by far the heaviest thing in a row — same body, same refs means the row's
// markdown stands (the chips read the members context themselves).
export const SpaceMarkdown = memo(function SpaceMarkdown({ body, className }: { body: string; className?: string }) {
    const refs = useContext(SpaceRefsContext)
    const assets = useContext(SpaceAssetsContext)
    const text = useMemo(() => {
        const withBlobs = refs ? rewriteBlobLinks(body, refs) : body
        // Relative links resolve through the listing (path → id) here, at
        // render time; the listing changes rarely, so re-rendering on it is cheap.
        const withFiles = refs ? rewriteFileLinks(withBlobs, refs, (path) => assets.byPath.get(path)?.id ?? null) : withBlobs
        // Pre-separator messages joined text and images in one paragraph —
        // normalize so every message gets text above, a clean tile row below.
        // Mentions last: their app links must never look like file links.
        return rewriteMentionLinks(separateImageParagraphs(withFiles))
    }, [body, refs, assets])
    return (
        <div className={cn(className)}>
            <MessageImageGallery key={text}>
                {/* Chat line breaks are newlines on the wire (both composers
                    write them that way), so a single newline inside a
                    paragraph has to render as one — remarkBreaks, same as
                    every other typed-message surface. */}
                <Streamdown components={spaceComponents} remarkPlugins={userMessageRemarkPlugins}>{text}</Streamdown>
            </MessageImageGallery>
        </div>
    )
})


/** Attachment content occupies the same document column as saved space files. */
export function AttachmentColumn({ src, onDismiss, onSaved }: { src: string; onDismiss: () => void; onSaved: (saved: SavedSpaceFile) => void }) {
    const name = new URL(src).searchParams.get('name') || 'Attachment'
    const [saveOpen, setSaveOpen] = useState(false)
    const [downloading, setDownloading] = useState(false)
    const download = async () => {
        const parsed = parseBlobAppUrl(src)
        if (!parsed || downloading) return
        setDownloading(true)
        try {
            await window.ipc.invoke('spaces:saveBlob', { ...parsed, suggestedName: name })
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not download', 'error')
        } finally { setDownloading(false) }
    }
    return (
        <section aria-label="Attachment preview" className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
                <span className="min-w-0 flex-1 truncate font-mono text-foreground/80" title={name}>{name}</span>
                <button type="button" onClick={() => setSaveOpen(true)} className="flex shrink-0 items-center gap-1 hover:text-foreground"><FilePlus2 className="size-3" /> Save to space files</button>
                <button type="button" disabled={downloading} onClick={() => void download()} className="flex shrink-0 items-center gap-1 hover:text-foreground"><FileDown className="size-3" /> Download</button>
                <button type="button" aria-label="Close attachment preview" onClick={onDismiss} className="rounded p-1 hover:bg-accent hover:text-foreground"><X className="size-3.5" /></button>
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto"><BlobPreview src={src} name={name} /></div>
            {saveOpen && <SaveToSpaceDialog src={src} suggestedName={name} onSaved={onSaved} onClose={() => setSaveOpen(false)} />}
        </section>
    )
}
