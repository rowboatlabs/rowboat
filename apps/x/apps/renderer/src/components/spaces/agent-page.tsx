import { useEffect, useState, type ReactNode } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConnectAgent, CopyField } from '@/components/spaces/agent-setup'
import { refreshAgentCapabilities } from '@/hooks/use-space-invocations'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { BUILT_IN_CONNECTION, PLATFORMS, setupFor } from '@/lib/agent-kinds'
import { toast } from '@/lib/toast'

// One agent's page in the Agents dialog (2026-10-01): its defaults, its setup
// steps, and its keys, any time after it was added. Defaults are for the
// options its connector declares (Harbor spec §8 Invocation options): Harbor
// fills them into every invocation whose invoker picked none, which is how a
// first mention from another agent or a DM skips Replicas's "which
// environment?". The setup steps are the ones shown when it was added; Harbor
// keeps only a key's hash, so the key reads as a placeholder until its owner
// makes a new one here, which fills the steps in.

/** Stands in for the key in the setup steps: the real one was shown once, when it was made. */
export const KEY_PLACEHOLDER = 'YOUR_AGENT_KEY'

function when(iso: string | undefined): string {
    return iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'never'
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
    return (
        <section className="flex min-w-0 flex-col gap-2">
            <div>
                <h3 className="text-xs font-semibold text-foreground">{title}</h3>
                {note && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{note}</p>}
            </div>
            {children}
        </section>
    )
}

export function AgentPage({ org, listing, isAdmin, onChanged }: {
    org: OrgWithSpaces
    listing: spaces.AgentListing
    isAdmin: boolean
    /** Reload the listing after a change to keys or the platform key. */
    onChanged: () => Promise<void>
}) {
    const { agent, keys, credential, hook } = listing
    const setup = setupFor(agent)
    const mine = agent.ownerId === org.memberId
    const live = keys.filter((k) => !k.revokedAt)
    // A key made here, shown this once and filled into the setup steps.
    const [secret, setSecret] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const [confirming, setConfirming] = useState<string | null>(null)

    const newKey = async () => {
        if (busy) return
        setBusy(true)
        try {
            const { key } = await window.ipc.invoke('spaces:createAgentKey', { orgId: org.id, agentId: agent.id })
            setSecret(key.secret)
            await onChanged()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not create a key', 'error')
        } finally {
            setBusy(false)
        }
    }

    const revoke = async (keyId: string) => {
        if (busy) return
        setBusy(true)
        try {
            await window.ipc.invoke('spaces:revokeAgentKey', { orgId: org.id, agentId: agent.id, keyId })
            setConfirming(null)
            toast('Key revoked', 'success')
            await onChanged()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not revoke the key', 'error')
        } finally {
            setBusy(false)
        }
    }

    // Jev is built in (2026-10-07): no setup steps, no keys, nothing to set.
    if (agent.agentConnection === BUILT_IN_CONNECTION) {
        return (
            <Section
                title="Built in"
                note={`${agent.displayName} comes with Rowboat and runs on Rowboat's own key. Add it to a space and it reads every message there, tagging the people and agents a message needs.`}
            >
                {null}
            </Section>
        )
    }

    return (
        <div className="flex min-w-0 flex-col gap-6">
            <DefaultsSection orgId={org.id} agent={agent} canEdit={mine} />

            <Section
                title="Setup"
                note={
                    secret
                        ? 'This is the only time this key is shown. The steps below use it.'
                        : `A key is shown only once, when it is made. Where the steps say ${KEY_PLACEHOLDER}, use that key${mine ? ', or make a new one to fill them in' : ''}.`
                }
            >
                <ConnectAgent org={org} setup={setup} {...(agent.agentKind ? { agentKind: agent.agentKind } : {})} {...(agent.agentInstance ? { agentInstance: agent.agentInstance } : {})} agentId={agent.id} agentName={agent.displayName} agentKey={secret ?? KEY_PLACEHOLDER} />
            </Section>

            {setup.alerts && (
                <AlertsSection org={org} agent={agent} hook={hook} note={setup.alerts.note} canSet={mine} canClear={mine || isAdmin} onChanged={onChanged} />
            )}

            <Section title="Keys" note="Each key lets whatever runs the agent act as it. Revoking one cuts that off at once.">
                {live.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">No active keys.</p>
                ) : (
                    <ul className="flex flex-col gap-1">
                        {live.map((k) => (
                            <li key={k.id} className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                                <span className="min-w-0 truncate">Key made {when(k.createdAt)} · last used {when(k.lastUsedAt)}</span>
                                {(mine || isAdmin) && (
                                    <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => (confirming === k.id ? void revoke(k.id) : setConfirming(k.id))}
                                        className="shrink-0 rounded px-1.5 py-0.5 text-destructive hover:bg-destructive/10"
                                    >
                                        {confirming === k.id ? 'Confirm revoke' : 'Revoke'}
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
                {mine && (
                    <Button size="sm" variant="outline" className="self-start" disabled={busy} onClick={() => void newKey()}>
                        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />} New key
                    </Button>
                )}
                {credential && <CredentialRow orgId={org.id} agent={agent} credential={credential} canReplace={mine} onReplaced={onChanged} />}
                {agent.agentInstance && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                        {PLATFORMS[agent.agentConnection ?? '']?.label ?? 'Platform'} instance {agent.agentInstance}: this agent is that instance, and stays on it.
                    </p>
                )}
            </Section>
        </div>
    )
}

/**
 * The defaults for the options the agent's connector declares (Environment,
 * Plan first, …). Its owner changes them; everyone else reads them. Each
 * change saves at once.
 */
function DefaultsSection({ orgId, agent, canEdit }: { orgId: string; agent: spaces.Member; canEdit: boolean }) {
    const [state, setState] = useState<{ options: spaces.InvocationOption[]; defaults: Record<string, string | boolean> } | null>(null)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        let live = true
        window.ipc.invoke('spaces:getAgentCapabilities', { orgId, agentId: agent.id }).then(
            ({ capabilities, defaults }) => live && setState({ options: capabilities.options, defaults: defaults ?? {} }),
            () => live && setState({ options: [], defaults: {} }),
        )
        return () => {
            live = false
        }
    }, [orgId, agent.id])

    if (!state || state.options.length === 0) return null

    const save = async (key: string, value: string | boolean | undefined) => {
        const next = { ...state.defaults }
        if (value === undefined || value === '') delete next[key]
        else next[key] = value
        setSaving(true)
        try {
            const { defaults } = await window.ipc.invoke('spaces:setAgentOptionDefaults', { orgId, agentId: agent.id, defaults: next })
            setState({ ...state, defaults })
            void refreshAgentCapabilities(orgId, agent.id)
            toast('Default saved', 'success')
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not save the default', 'error')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Section
            title="Defaults"
            note={`Used whenever whoever mentions ${agent.displayName} doesn't pick: a mention, a DM, or another agent handing work to it.${canEdit ? '' : ' Only its owner can change these.'}`}
        >
            <div className="flex flex-col gap-2">
                {state.options.map((option) =>
                    option.type === 'select' ? (
                        <label key={option.key} className="flex items-center justify-between gap-3 text-xs">
                            <span className="text-foreground">{option.label}</span>
                            <select
                                aria-label={`Default ${option.label}`}
                                value={String(state.defaults[option.key] ?? '')}
                                disabled={!canEdit || saving}
                                onChange={(e) => void save(option.key, e.target.value)}
                                className="h-8 max-w-[16rem] rounded-md border border-border bg-background px-2 text-xs disabled:opacity-60"
                            >
                                <option value="">No default (ask)</option>
                                {option.choices.map((choice) => (
                                    <option key={choice.id} value={choice.id}>{choice.label}</option>
                                ))}
                            </select>
                        </label>
                    ) : (
                        <label key={option.key} className="flex items-center justify-between gap-3 text-xs">
                            <span className="text-foreground">{option.label}</span>
                            <input
                                type="checkbox"
                                aria-label={`${option.label} by default`}
                                checked={state.defaults[option.key] === true}
                                disabled={!canEdit || saving}
                                onChange={(e) => void save(option.key, e.target.checked ? true : undefined)}
                                className="size-4 accent-foreground disabled:opacity-60"
                            />
                        </label>
                    ),
                )}
            </div>
        </Section>
    )
}

/**
 * Where the service's alerts land (Harbor spec §8 Alerts, 2026-10-03): its
 * owner picks a space the agent is in and gets a secret address, shown this
 * once, to paste into the service's webhook settings. Getting a new one stops
 * the old; the owner or an admin turns alerts off.
 */
function AlertsSection({ org, agent, hook, note, canSet, canClear, onChanged }: {
    org: OrgWithSpaces
    agent: spaces.Member
    hook: spaces.AgentHook | undefined
    note: string
    canSet: boolean
    canClear: boolean
    onChanged: () => Promise<void>
}) {
    const [spaceId, setSpaceId] = useState(hook?.spaceId ?? '')
    const [url, setUrl] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const spaceName = (id: string) => org.spaces.find((s) => s.id === id)?.name ?? 'a space'

    const set = async () => {
        if (!spaceId || busy) return
        setBusy(true)
        try {
            const result = await window.ipc.invoke('spaces:setAgentHook', { orgId: org.id, agentId: agent.id, spaceId })
            setUrl(result.url)
            await onChanged()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not set up alerts', 'error')
        } finally {
            setBusy(false)
        }
    }

    const clear = async () => {
        if (busy) return
        setBusy(true)
        try {
            await window.ipc.invoke('spaces:clearAgentHook', { orgId: org.id, agentId: agent.id })
            setUrl(null)
            toast('Alerts turned off', 'success')
            await onChanged()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not turn alerts off', 'error')
        } finally {
            setBusy(false)
        }
    }

    return (
        <Section title="Alerts" note={url ? `This is the only time this address is shown. ${note}` : note}>
            {hook && !url && (
                <p className="text-[11px] text-muted-foreground">
                    Posting to #{spaceName(hook.spaceId)} since {when(hook.setAt)}. A new address stops the old one.
                </p>
            )}
            {url && <CopyField value={{ label: 'URL', text: url, secret: true }} />}
            {canSet && (
                <div className="flex items-center gap-1.5">
                    <select
                        aria-label="Space for alerts"
                        value={spaceId}
                        disabled={busy}
                        onChange={(e) => setSpaceId(e.target.value)}
                        className="h-8 max-w-[16rem] rounded-md border border-border bg-background px-2 text-xs disabled:opacity-60"
                    >
                        <option value="">Pick a space {agent.displayName} is in</option>
                        {org.spaces.map((s) => (
                            <option key={s.id} value={s.id}>#{s.name}</option>
                        ))}
                    </select>
                    <Button size="sm" variant="outline" className="h-8" disabled={!spaceId || busy} onClick={() => void set()}>
                        {busy && <Loader2 className="size-3 animate-spin" />}
                        {hook ? 'New address' : 'Get address'}
                    </Button>
                </div>
            )}
            {hook && canClear && (
                <button type="button" disabled={busy} onClick={() => void clear()} className="self-start rounded px-1.5 py-0.5 text-[11px] text-destructive hover:bg-destructive/10">
                    Turn alerts off
                </button>
            )}
        </Section>
    )
}

/** A platform agent's key (Replicas, PostHog, Cal.com): its last characters, whether the platform rejected it, and Replace for its owner. */
export function CredentialRow({ orgId, agent, credential, canReplace, onReplaced }: {
    orgId: string
    agent: spaces.Member
    credential: spaces.AgentCredential
    canReplace: boolean
    onReplaced: () => Promise<void>
}) {
    const [editing, setEditing] = useState(false)
    const [secret, setSecret] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const platform = PLATFORMS[agent.agentConnection ?? '']?.label ?? 'Platform'
    const save = async () => {
        setSaving(true)
        setError(null)
        try {
            await window.ipc.invoke('spaces:setAgentCredential', { orgId, agentId: agent.id, secret: secret.trim() })
            setEditing(false)
            setSecret('')
            toast(`${platform} key replaced`, 'success')
            await onReplaced()
        } catch (err) {
            setError(err instanceof Error ? err.message : `Could not replace the ${platform} key`)
        } finally {
            setSaving(false)
        }
    }
    return (
        <div className="mt-1.5 flex flex-col gap-1 text-[11px]">
            <div className="flex items-center justify-between gap-2 text-muted-foreground">
                <span className="min-w-0 truncate">
                    {platform} key {credential.hint}
                    {credential.rejectedAt && <span className="text-destructive"> · Key rejected: replace it to bring the agent back</span>}
                </span>
                {canReplace && !editing && (
                    <button type="button" onClick={() => setEditing(true)} className="shrink-0 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground">
                        Replace
                    </button>
                )}
            </div>
            {editing && (
                <form
                    className="flex items-center gap-1.5"
                    onSubmit={(e) => {
                        e.preventDefault()
                        if (secret.trim()) void save()
                    }}
                >
                    <Input
                        type="password"
                        value={secret}
                        onChange={(e) => setSecret(e.target.value)}
                        placeholder={`New ${platform} key`}
                        aria-label={`New ${platform} key`}
                        className="h-7 text-xs"
                        autoFocus
                    />
                    <Button type="submit" size="sm" className="h-7" disabled={!secret.trim() || saving}>
                        {saving && <Loader2 className="size-3 animate-spin" />}
                        Save
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => (setEditing(false), setSecret(''), setError(null))}>
                        Cancel
                    </Button>
                </form>
            )}
            {error && <span className="text-destructive">{error}</span>}
        </div>
    )
}
