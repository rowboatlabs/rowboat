import { createContext, useContext, useMemo, useState, type ComponentProps, type ReactNode } from 'react'
import { Streamdown } from 'streamdown'
import { FileDown, FileText, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { useMemberNames } from '@/components/spaces/member-text'
import {
    decorateMentions,
    parseAssetWireUrl,
    parseBlobAppUrl,
    resolveSpaceLink,
    rewriteBlobLinks,
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

type StreamdownComponents = NonNullable<ComponentProps<typeof Streamdown>['components']>

const spaceComponents: StreamdownComponents = {
    img: ({ src, alt }) => {
        const url = typeof src === 'string' ? src : ''
        if (url.startsWith('app://space-blob/')) {
            return (
                <img
                    src={url}
                    alt={alt ?? ''}
                    loading="lazy"
                    className="my-1 block max-h-80 max-w-full rounded-lg border border-border object-contain"
                />
            )
        }
        // Non-blob images (external URLs) keep default treatment.
        return <img src={url} alt={alt ?? ''} loading="lazy" className="max-w-full" />
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
    // root); the contract's canonical asset URL for this space opens the same way.
    const filePath = resolveSpaceLink(url, '') ?? (refs ? parseAssetWireUrl(url, refs) : null)
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
        return decorateMentions(withBlobs, memberNames)
    }, [body, refs, memberNames])
    return (
        <div className={cn(className)}>
            <Streamdown components={spaceComponents}>{text}</Streamdown>
        </div>
    )
}
