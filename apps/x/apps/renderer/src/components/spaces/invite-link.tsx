import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { invokeSpace } from '@/lib/spaces-invoke'
import * as analytics from '@/lib/analytics'
import { listNames } from '@/lib/spaces-invites'

type InviteLinkState =
    | { kind: 'loading' }
    | { kind: 'ready'; link: string; admits: string | null }
    | { kind: 'error'; message: string }

/** How much of the link's end stays visible when it is too long: enough of the token to recognise. */
const INVITE_LINK_TAIL = 10

/**
 * The link as plain monospace text, no box — a box says "type here". Too
 * long for the line, it truncates in the MIDDLE: the head gives way (an
 * ellipsis at its end) while the last characters stay put, so the token's
 * end is always there to recognise. The DOM holds the whole URL, so a click,
 * a drag or a copy carries all of it, not just what happens to be visible.
 */
function InviteLinkText({ link }: { link: string }) {
    const head = link.slice(0, -INVITE_LINK_TAIL)
    const tail = link.slice(-INVITE_LINK_TAIL)
    const selectAll = (el: HTMLElement) => {
        const selection = window.getSelection()
        if (!selection) return
        const range = document.createRange()
        range.selectNodeContents(el)
        selection.removeAllRanges()
        selection.addRange(range)
    }
    return (
        <span
            title={link}
            onClick={(e) => selectAll(e.currentTarget)}
            className="block w-full cursor-text select-text whitespace-nowrap font-mono text-xs leading-6"
        >
            {/* The head is an inline block (not a flex item) on purpose: block-level
                pieces would put a line break between them in copied text. Its
                width comes from spaces.css (.spaces-invite-link-head). */}
            <span
                className="spaces-invite-link-head inline-block overflow-hidden text-ellipsis align-bottom"
                style={{ '--tail': `${INVITE_LINK_TAIL}ch` } as React.CSSProperties}
            >{head}</span><span>{tail}</span>
        </span>
    )
}

/**
 * An invite link, minted when this mounts: the link as selectable text, a
 * Copy button that says "Copied" for a beat, and one line on what the link
 * admits. An invite is to the org (harbor, 2026-10-19), and accepting also
 * joins the org's default spaces, so the line is read back from the invite
 * itself rather than guessed from the spaces asked for. Mount it fresh (a
 * new `key`) for a new link; there is nothing stale to hand out.
 */
export function InviteLinkPanel({ orgId, spaceIds }: { orgId: string; spaceIds: string[] }) {
    const [state, setState] = useState<InviteLinkState>({ kind: 'loading' })
    const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
    const idsKey = spaceIds.join('|')

    useEffect(() => {
        let cancelled = false
        void (async () => {
            try {
                const { link } = await invokeSpace('spaces:createInvite', { orgId, spaceIds })
                // What it admits is a nicety: the link works without it.
                const admits = await window.ipc.invoke('spaces:resolveInviteLink', { url: link }).then(
                    ({ resolved }) => resolved.state === 'ok'
                        ? (resolved.spaces ?? []).length > 0
                            ? `Anyone with it can join ${resolved.org.name} and ${listNames((resolved.spaces ?? []).map((s) => `#${s.name}`))}.`
                            : `Anyone with it can join ${resolved.org.name}.`
                        : null,
                    () => null,
                )
                if (!cancelled) setState({ kind: 'ready', link, admits })
            } catch (err) {
                if (!cancelled) setState({ kind: 'error', message: err instanceof Error ? err.message : 'Could not create an invite' })
            }
        })()
        return () => { cancelled = true }
        // The joined key IS the dependency — the array identity changes every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orgId, idsKey])

    const copyLink = (link: string) =>
        navigator.clipboard.writeText(link).then(
            () => {
                analytics.spacesInviteLinkCopied()
                setCopy('copied')
                if (timer.current) clearTimeout(timer.current)
                timer.current = setTimeout(() => setCopy('idle'), 1000)
            },
            () => setCopy('failed'),
        )

    const link = state.kind === 'ready' ? state.link : ''
    return (
        <div className="flex flex-col gap-2">
            {state.kind === 'ready'
                ? <InviteLinkText link={state.link} />
                : <span className="block font-mono text-xs leading-6 text-muted-foreground">{state.kind === 'loading' ? 'Creating link…' : 'No link'}</span>}
            <div className="flex items-center justify-between gap-3">
                {state.kind === 'error'
                    ? <p className="text-xs text-destructive">{state.message}</p>
                    : copy === 'failed'
                        ? <p className="text-xs text-destructive">Could not copy. Select the link above and copy it instead.</p>
                        : <p className="text-xs text-muted-foreground">{state.kind === 'ready' ? state.admits ?? 'Anyone with it can join.' : ''}</p>}
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={state.kind !== 'ready'}
                    onClick={() => void copyLink(link)}
                    className="min-w-24 rounded-md"
                >
                    {copy === 'copied'
                        ? <><Check className="size-3.5 text-[var(--rowboat-success)]" /> Copied</>
                        : 'Copy link'}
                </Button>
            </div>
        </div>
    )
}
