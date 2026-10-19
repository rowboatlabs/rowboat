import { useEffect, useState, type ReactNode } from 'react'
import { Check, Copy, ExternalLink, Hash, Loader2, Plug, Plus } from 'lucide-react'
import { refreshMembers } from '@/hooks/use-space-members'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import type { AgentSetup, Logo, SetupStep, SetupValue } from '@/lib/agent-kinds'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

// How to connect an agent with a new key (Harbor spec §8 Connectors,
// 2026-09-30): the body of the Agents dialog's Connect screen. It renders the
// steps the agent's setup gives for this key (lib/agent-kinds.ts), in whichever
// of its routes the person picks, and ends with the app's own step: add the
// agent to spaces, right there (2026-10-08), then mention it.

/** An official mark for light and dark themes, or the generic one. */
export function AgentLogo({ logo, className }: { logo: Logo | undefined; className?: string }) {
    if (!logo) {
        return (
            <span className={cn('flex shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground', className)}>
                <Plug className="size-[55%]" />
            </span>
        )
    }
    // `[.dark_&]:`, not `dark:`: index.css compiles `dark:` against the OS setting, App.css against the
    // app's theme class, so `dark:` fires under a dark OS even when the app is light. This follows the app.
    return (
        <>
            <img src={logo.light} alt="" className={cn('shrink-0 rounded-md [.dark_&]:hidden', className)} />
            <img src={logo.dark} alt="" className={cn('hidden shrink-0 rounded-md [.dark_&]:block', className)} />
        </>
    )
}

/**
 * On screen, a long token (a key, a secret, an id) reads as its ends: the
 * lines stay short enough to read, and a shared screen shows no secret. Copy
 * copies the full text.
 */
function shortened(text: string): string {
    return text.replace(/[A-Za-z0-9_-]{25,}/g, (token) => `${token.slice(0, 6)}…${token.slice(-4)}`)
}

function CopyButton({ text, label }: { text: string; label: string }) {
    const [copied, setCopied] = useState(false)
    return (
        <button
            type="button"
            aria-label={label}
            onClick={() =>
                void navigator.clipboard.writeText(text).then(
                    () => {
                        setCopied(true)
                        setTimeout(() => setCopied(false), 1500)
                    },
                    () => toast('Could not copy', 'error'),
                )
            }
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-accent"
        >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            {copied ? 'Copied' : 'Copy'}
        </button>
    )
}

/**
 * Code to paste, under a bar with what it is and Copy. It never widens the
 * dialog: a line that doesn't fit wraps at a space where it can, and its
 * wrapped part is indented so each command still reads as one.
 */
function CodeBlock({ text, caption, label, secret }: { text: string; caption: string; label: string; secret?: boolean }) {
    const lines = (secret ? shortened(text) : text).split('\n')
    return (
        <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-muted/50">
            <div className="flex items-center justify-between gap-2 border-b border-border py-1 pr-1 pl-3">
                <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{caption}</span>
                <CopyButton text={text} label={label} />
            </div>
            <div className="px-3 py-2 font-mono text-[11px] leading-[1.7] text-foreground">
                {lines.map((line, i) => (
                    <div key={i} className="-indent-4 pl-4 whitespace-pre-wrap [overflow-wrap:anywhere]">
                        {line}
                    </div>
                ))}
            </div>
        </div>
    )
}

/** One value to paste (a key, an address), with Copy beside it and what it is before it. */
export function CopyField({ value }: { value: SetupValue }) {
    return (
        <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-muted/50 py-1 pr-1 pl-3">
            {value.label && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{value.label}</span>}
            <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">{value.secret ? shortened(value.text) : value.text}</code>
            <CopyButton text={value.text} label={`Copy ${value.label ?? value.text}`} />
        </div>
    )
}

function Step({ n, title, note, children }: { n: number; title: string; note?: string; children?: ReactNode }) {
    return (
        <li className="flex min-w-0 gap-3">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">{n}</span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 pb-1">
                <div className="text-[13px] font-medium text-foreground">{title}</div>
                {note && <div className="text-xs text-muted-foreground">{note}</div>}
                {children}
            </div>
        </li>
    )
}

/**
 * Your spaces, each with Add, or Added once the agent is in it. Membership is
 * read from each space's roster; adding is the same operation as Add people.
 */
function AddToSpaces({ org, agentId, agentName }: { org: OrgWithSpaces; agentId: string; agentName: string }) {
    const [inSpaces, setInSpaces] = useState<{ agentId: string; ids: ReadonlySet<string> } | null>(null)
    const [adding, setAdding] = useState<string | null>(null)
    const spaceIds = org.spaces.map((space) => space.id).join(',')

    useEffect(() => {
        let live = true
        void Promise.all(
            org.spaces.map(async (space) => {
                const { members } = await window.ipc.invoke('spaces:listMembers', { orgId: org.id, spaceId: space.id }).catch(() => ({ members: [] }))
                return members.some((m) => m.id === agentId) ? space.id : null
            }),
        ).then((ids) => live && setInSpaces({ agentId, ids: new Set(ids.filter((id): id is string => id !== null)) }))
        return () => {
            live = false
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the space list's ids, not its identity
    }, [org.id, agentId, spaceIds])

    if (org.spaces.length === 0) return <div className="text-xs text-muted-foreground">No spaces yet. Create one, then add {agentName} from its Add people.</div>
    const known = inSpaces?.agentId === agentId ? inSpaces.ids : null

    const add = async (spaceId: string, spaceName: string) => {
        setAdding(spaceId)
        try {
            await window.ipc.invoke('spaces:addMembers', { orgId: org.id, spaceId, memberIds: [agentId] })
            refreshMembers(org.id, spaceId, { force: true })
            setInSpaces((prev) => ({ agentId, ids: new Set([...(prev?.agentId === agentId ? prev.ids : []), spaceId]) }))
            toast(`Added ${agentName} to #${spaceName}`, 'success')
        } catch (err) {
            toast(err instanceof Error ? err.message : `Could not add ${agentName}`, 'error')
        } finally {
            setAdding(null)
        }
    }

    return (
        <ul aria-label="Spaces" className="flex max-h-48 flex-col overflow-y-auto rounded-md border border-border">
            {org.spaces.map((space) => {
                const added = known?.has(space.id) ?? false
                return (
                    <li key={space.id} className="flex items-center gap-2 border-b border-border px-2.5 py-1.5 last:border-b-0">
                        <Hash className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-xs text-foreground">{space.name}</span>
                        {added ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Check className="size-3" /> Added</span>
                        ) : (
                            <button
                                type="button"
                                aria-label={`Add ${agentName} to #${space.name}`}
                                disabled={!known || adding !== null}
                                onClick={() => void add(space.id, space.name)}
                                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-accent disabled:opacity-50"
                            >
                                {adding === space.id ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />} Add
                            </button>
                        )}
                    </li>
                )
            })}
        </ul>
    )
}

function StepBody({ step }: { step: SetupStep }) {
    return (
        <>
            {step.code && (
                <CodeBlock
                    text={step.code.text}
                    caption={step.code.caption}
                    {...(step.code.secret ? { secret: true } : {})}
                    label={step.code.copyLabel ?? (step.code.text.includes('\n') ? 'Copy the commands' : `Copy ${step.code.text}`)}
                />
            )}
            {step.valuesNote && <div className="pt-1 text-xs text-muted-foreground">{step.valuesNote}</div>}
            {step.values?.map((value, i) => <CopyField key={i} value={value} />)}
        </>
    )
}

export function ConnectAgent({ org, setup: kind, agentKind, agentInstance, agentId, agentName, agentKey }: {
    org: OrgWithSpaces
    setup: AgentSetup
    /** What the agent is, for a setup that offers several kinds (Agent37: Hermes or OpenClaw). */
    agentKind?: string
    /** The platform instance the agent is (Agent37), for steps that name it. */
    agentInstance?: string
    agentId: string
    agentName: string
    agentKey: string
}) {
    const wantsHome = kind.wantsHomeChannel === true
    // The home channel is the owner's DM with the agent; a result counts only for the agent it was opened for.
    const [home, setHome] = useState<{ agentId: string; spaceId: string | null } | null>(null)
    const homeReady = !wantsHome || home?.agentId === agentId
    const [routeId, setRouteId] = useState<string | null>(null)

    useEffect(() => {
        if (!wantsHome) return
        let live = true
        window.ipc.invoke('spaces:openDirect', { orgId: org.id, memberId: agentId }).then(
            ({ space }) => live && setHome({ agentId, spaceId: space.id }),
            // No home is not fatal: Hermes then asks for one in new threads.
            () => live && setHome({ agentId, spaceId: null }),
        )
        return () => {
            live = false
        }
    }, [wantsHome, org.id, agentId])

    if (!homeReady) {
        return (
            <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Preparing the {kind.label} setup…
            </div>
        )
    }

    const routes = kind.setup({ orgUrl: org.baseUrl, agentKey, ...(agentKind ? { kind: agentKind } : {}), ...(agentInstance ? { instance: agentInstance } : {}), ...(home?.spaceId ? { homeChannel: home.spaceId } : {}) })
    const route = routes.find((r) => r.id === routeId) ?? routes[0]!
    return (
        <div className="flex min-w-0 flex-col gap-3">
            {routes.length > 1 && (
                <div role="radiogroup" aria-label="How to set it up" className="flex gap-1 self-start rounded-lg bg-muted p-0.5">
                    {routes.map((r) => (
                        <button
                            key={r.id}
                            type="button"
                            role="radio"
                            aria-checked={r.id === route.id}
                            onClick={() => setRouteId(r.id)}
                            className={cn(
                                'rounded-md px-2.5 py-1 text-xs',
                                r.id === route.id ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                            )}
                        >
                            {r.label}
                        </button>
                    ))}
                </div>
            )}
            <ol className="flex min-w-0 flex-col gap-4">
                {route.steps.map((step, i) => (
                    <Step key={`${route.id}-${i}`} n={i + 1} title={step.title} {...(step.note ? { note: step.note } : {})}>
                        <StepBody step={step} />
                    </Step>
                ))}
                <Step n={route.steps.length + 1} title="Add it to spaces" note={`Add ${agentName} to the spaces it should work in, then mention it there.`}>
                    <AddToSpaces org={org} agentId={agentId} agentName={agentName} />
                </Step>
            </ol>
            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>Long values are shortened on screen; Copy copies them in full.</span>
                {kind.docsUrl && (
                    <button
                        type="button"
                        onClick={() => window.open(kind.docsUrl, '_blank')}
                        className="inline-flex shrink-0 items-center gap-1 underline-offset-2 hover:text-foreground hover:underline"
                    >
                        {kind.label} setup docs <ExternalLink className="size-3" />
                    </button>
                )}
            </div>
        </div>
    )
}
