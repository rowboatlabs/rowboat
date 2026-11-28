import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, ChevronRight, Loader2, Search } from 'lucide-react'
import type { spaces } from '@x/shared'
import { CONNECTION_NAME_MAX, CONNECTION_TRIGGERS_MAX } from '@x/shared/dist/spaces.js'
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { refreshMembers } from '@/hooks/use-space-members'
import { loadSpaceConnections, useSpaceConnections } from '@/hooks/use-space-connections'
import {
    configFields, configFromValues, configProblems, connectionStatusLabel, initialValues, refusalText,
    type ConfigField, type ConfigValues,
} from '@/lib/spaces-connections'
import { formatFeedTime, formatFullTimestamp } from '@/lib/spaces-presentation'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { ConnectionLogo } from './connection-logo'

// Space settings → Connections (spec §8 Space connections, 2026-11-28, "channel
// has direct connections" in the rowboat space): an org admin connects an app
// to this space, authorises it in the browser, chooses which of its events are
// posted here, and reviews what the filter skipped.
//
// Harbor sends no live event for a connection. The panel reads the list when
// it opens and after each change it makes, and every two seconds only while a
// connection waits on a person: that read is what moves `pending` to `active`.

const POLL_MS = 2_000

type Org = { id: string }

const kinds = (count: number) => `${count} ${count === 1 ? 'kind' : 'kinds'} of event`

/**
 * Hand the person to the app's authorisation page: the system browser on the
 * desktop (main routes window.open there), a new tab on the web.
 */
function openAuthorisation(url: string): void {
    window.open(url, '_blank', 'noopener,noreferrer')
}

export function SpaceConnectionsPanel({ org, space, names, writable }: {
    org: Org
    space: spaces.Space
    /** Member id to display name, for who connected each one. */
    names: ReadonlyMap<string, string>
    /** False on an archived space, where nothing new is connected. */
    writable: boolean
}) {
    const listed = useSpaceConnections(org.id, space.id)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [connecting, setConnecting] = useState(false)
    const [editing, setEditing] = useState<string | null>(null)
    // The authorisation address each connection was last given here, kept so the
    // row can offer it as a plain link: a browser may block a page opened after a
    // request (Safari does), and a link the person clicks is never blocked.
    const [links, setLinks] = useState<Readonly<Record<string, string>>>({})
    const [disconnecting, setDisconnecting] = useState<spaces.SpaceConnection | null>(null)
    // The connection made in this visit: once its app is authorised its editor opens, since choosing what it posts is the next step.
    const made = useRef<string | null>(null)

    const reload = useCallback(async () => {
        try {
            const next = await loadSpaceConnections(org.id, space.id)
            setLoadError(null)
            const fresh = next.connections.find((c) => c.id === made.current)
            if (fresh && fresh.status !== 'pending') {
                made.current = null
                if (fresh.status === 'active' && fresh.triggers.length === 0) setEditing(fresh.id)
            }
        } catch (err) {
            setLoadError(refusalText(err, 'Could not load connections'))
        }
    }, [org.id, space.id])

    useEffect(() => { void reload() }, [reload])

    const waiting = listed?.connections.some((c) => c.status === 'pending') ?? false
    useEffect(() => {
        if (!waiting) return
        let gone = false
        let timer = window.setTimeout(function tick() {
            void reload().then(() => { if (!gone) timer = window.setTimeout(tick, POLL_MS) })
        }, POLL_MS)
        return () => {
            gone = true
            window.clearTimeout(timer)
        }
    }, [waiting, reload])

    const authorise = (connectionId: string, url: string) => {
        setLinks((prev) => ({ ...prev, [connectionId]: url }))
        openAuthorisation(url)
    }

    return (
        <section className="py-7" aria-labelledby="space-connections-heading">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-xl">
                    <h2 id="space-connections-heading" className="text-base font-medium">Connections</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Connect an app, and what happens in it is posted here by the connection itself.</p>
                </div>
                {listed?.available && <Button disabled={!writable} onClick={() => setConnecting(true)}>Connect an app</Button>}
            </div>

            {!listed && !loadError && <p role="status" className="py-10 text-center text-sm text-muted-foreground">Loading connections…</p>}
            {loadError && (
                <div role="alert" className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
                    <div className="min-w-0 text-sm"><p className="font-medium">Could not load connections</p><p className="mt-0.5 text-muted-foreground">{loadError}</p></div>
                    <Button variant="outline" size="sm" onClick={() => void reload()}>Try again</Button>
                </div>
            )}
            {listed && !listed.available && <p role="status" className="mt-6 rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground">This server connects no apps to spaces.</p>}
            {listed?.available && listed.connections.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No apps are connected to this space.</p>}

            {listed && listed.connections.length > 0 && (
                <ul className="mt-3 divide-y divide-border">
                    {listed.connections.map((connection) => (
                        <ConnectionRow
                            key={connection.id}
                            org={org}
                            space={space}
                            connection={connection}
                            creator={names.get(connection.createdBy)}
                            filterAvailable={listed.filterAvailable}
                            editing={editing === connection.id}
                            link={links[connection.id]}
                            onEdit={(open) => setEditing(open ? connection.id : null)}
                            onAuthorise={(url) => authorise(connection.id, url)}
                            onChanged={reload}
                            onDisconnect={() => setDisconnecting(connection)}
                        />
                    ))}
                </ul>
            )}

            {connecting && (
                <ConnectAppDialog
                    org={org}
                    space={space}
                    onClose={() => setConnecting(false)}
                    onConnected={(connection, url) => {
                        setConnecting(false)
                        made.current = connection.id
                        authorise(connection.id, url)
                        // Its member has joined the space.
                        refreshMembers(org.id, space.id, { force: true })
                        void reload()
                    }}
                />
            )}
            {disconnecting && (
                <DisconnectDialog
                    org={org}
                    space={space}
                    connection={disconnecting}
                    onClose={() => setDisconnecting(null)}
                    onDisconnected={() => {
                        setDisconnecting(null)
                        // Its member has left the space.
                        refreshMembers(org.id, space.id, { force: true })
                        void reload()
                    }}
                />
            )}
        </section>
    )
}

function ConnectionRow({ org, space, connection, creator, filterAvailable, editing, link, onEdit, onAuthorise, onChanged, onDisconnect }: {
    org: Org
    space: spaces.Space
    connection: spaces.SpaceConnection
    creator: string | undefined
    filterAvailable: boolean
    editing: boolean
    link: string | undefined
    onEdit: (open: boolean) => void
    onAuthorise: (url: string) => void
    onChanged: () => Promise<void>
    onDisconnect: () => void
}) {
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const app = connection.app.name
    const act = async (run: () => Promise<unknown>, fallback: string) => {
        if (busy) return
        setBusy(true)
        setError(null)
        try {
            await run()
        } catch (err) {
            setError(refusalText(err, fallback))
        } finally {
            await onChanged()
            setBusy(false)
        }
    }
    const setPaused = (paused: boolean) => act(
        () => window.ipc.invoke('spaces:updateSpaceConnection', { orgId: org.id, spaceId: space.id, connectionId: connection.id, paused }),
        paused ? 'Could not pause the connection' : 'Could not resume the connection',
    )
    // A new address each time: the first one lapses, and an expired authorisation needs a new one anyway.
    const authorise = () => act(async () => {
        const { authorizeUrl } = await window.ipc.invoke('spaces:authorizeSpaceConnection', { orgId: org.id, spaceId: space.id, connectionId: connection.id })
        onAuthorise(authorizeUrl)
    }, `Could not open ${app}’s authorisation page`)

    const posts = [...new Set(connection.triggers.map((t) => t.name))]
    return (
        <li className="py-5" aria-label={connection.name}>
            <div className="flex flex-wrap items-start gap-3">
                <ConnectionLogo app={connection.app} />
                <div className="min-w-0 flex-1 basis-56">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">{connection.name}</span>
                        <span className={cn(
                            'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium leading-none',
                            connection.status === 'failed' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground',
                        )}>{connectionStatusLabel(connection)}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{app} · Connected by {creator ?? 'a former member'}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{posts.length > 0 ? `Posts: ${posts.join(', ')}` : 'Posts nothing yet'}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                        {connection.posted} posted, {connection.skipped} skipped this week
                        {' · '}
                        {connection.lastEventAt
                            ? <span title={formatFullTimestamp(connection.lastEventAt)}>Last event {formatFeedTime(connection.lastEventAt)}</span>
                            : 'No events yet'}
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {connection.status === 'active' && (
                        <Button variant="outline" size="sm" disabled={busy} onClick={() => void setPaused(!connection.paused)}>{connection.paused ? 'Resume' : 'Pause'}</Button>
                    )}
                    <Button variant="outline" size="sm" aria-expanded={editing} onClick={() => onEdit(!editing)}>Edit</Button>
                    <Button variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={onDisconnect}>Disconnect</Button>
                </div>
            </div>

            {connection.status === 'pending' && (
                <div role="status" className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-muted/60 px-3 py-2 text-sm">
                    <Loader2 aria-hidden className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                    <span>Waiting for you to authorise {app}…</span>
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => void authorise()}>Open the authorisation page again</Button>
                    {link && <a href={link} target="_blank" rel="noreferrer" className="text-xs text-[var(--rowboat-link)] hover:underline">The page did not open? Use this link.</a>}
                </div>
            )}
            {connection.status === 'failed' && (
                <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 px-3 py-2 text-sm">
                    <span className="min-w-0">{connection.problem ?? `${app} needs to be authorised again.`}</span>
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => void authorise()}>Reconnect</Button>
                </div>
            )}
            {connection.status === 'active' && connection.triggers.length === 0 && !editing && (
                <p className="mt-3 text-sm text-muted-foreground sm:ml-12">
                    {app} is authorised. <button type="button" className="text-[var(--rowboat-link)] hover:underline" onClick={() => onEdit(true)}>Choose what it posts</button>
                </p>
            )}
            {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}

            {editing && (
                <ConnectionEditor
                    org={org}
                    space={space}
                    connection={connection}
                    filterAvailable={filterAvailable}
                    onChanged={onChanged}
                    onClose={() => onEdit(false)}
                />
            )}
            <SkippedEvents org={org} space={space} connection={connection} showScore={filterAvailable} />
        </li>
    )
}

/** One trigger the editor holds: a kind of event with the settings typed for it. `saved` is the config it already has on the connection. */
interface Draft {
    id: number
    slug: string
    saved?: Record<string, unknown>
    values: ConfigValues
}

function ConnectionEditor({ org, space, connection, filterAvailable, onChanged, onClose }: {
    org: Org
    space: spaces.Space
    connection: spaces.SpaceConnection
    filterAvailable: boolean
    onChanged: () => Promise<void>
    onClose: () => void
}) {
    const id = useId()
    const app = connection.app.name
    const active = connection.status === 'active'
    const [name, setName] = useState(connection.name)
    const [types, setTypes] = useState<spaces.ConnectionTriggerType[] | null>(null)
    const [typesError, setTypesError] = useState<string | null>(null)
    const [drafts, setDrafts] = useState<Draft[]>([])
    const [attempted, setAttempted] = useState(false)
    const [saving, setSaving] = useState(false)
    const [filtering, setFiltering] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const nextId = useRef(0)
    const fieldsOf = useMemo(() => new Map((types ?? []).map((t) => [t.slug, configFields(t.config)])), [types])

    // What it posts can only be chosen once the app is authorised (Harbor refuses before), so the catalogue is asked for then.
    // The connection's own triggers are read once, as the editor opens: a later reload must not undo what is being typed.
    const savedTriggers = useRef(connection.triggers)
    useEffect(() => {
        if (!active) return
        let gone = false
        window.ipc.invoke('spaces:listConnectionTriggers', { orgId: org.id, app: connection.app.slug }).then(
            ({ triggers }) => {
                if (gone) return
                const fields = new Map(triggers.map((t) => [t.slug, configFields(t.config)]))
                setTypes(triggers)
                setDrafts(savedTriggers.current.filter((t) => fields.has(t.slug)).map((t) => ({
                    id: nextId.current++, slug: t.slug, saved: t.config, values: initialValues(fields.get(t.slug)!, t.config),
                })))
            },
            (err: unknown) => { if (!gone) setTypesError(refusalText(err, `Could not load what ${app} can post`)) },
        )
        return () => { gone = true }
    }, [active, org.id, connection.app.slug, app])

    // A trigger the app no longer offers cannot be sent back (Harbor checks each against the app's list), so saving drops it, and the editor says so.
    const withdrawn = types ? savedTriggers.current.filter((t) => !fieldsOf.has(t.slug)) : []
    const toggle = (type: spaces.ConnectionTriggerType, on: boolean) => setDrafts((prev) => on
        ? [...prev, { id: nextId.current++, slug: type.slug, values: initialValues(fieldsOf.get(type.slug) ?? []) }]
        : prev.filter((d) => d.slug !== type.slug))
    const setValue = (draftId: number, key: string, value: string | boolean) =>
        setDrafts((prev) => prev.map((d) => (d.id === draftId ? { ...d, values: { ...d.values, [key]: value } } : d)))
    const problemsOf = (draft: Draft) => configProblems(fieldsOf.get(draft.slug) ?? [], draft.values)
    const tooMany = drafts.length > CONNECTION_TRIGGERS_MAX

    const save = async (event: FormEvent) => {
        event.preventDefault()
        setAttempted(true)
        setError(null)
        const trimmed = name.trim()
        if (!trimmed || tooMany || drafts.some((d) => Object.keys(problemsOf(d)).length > 0)) return
        setSaving(true)
        try {
            await window.ipc.invoke('spaces:updateSpaceConnection', {
                orgId: org.id,
                spaceId: space.id,
                connectionId: connection.id,
                ...(trimmed !== connection.name ? { name: trimmed } : {}),
                // The whole set, as Harbor takes it: what is left out stops being listened for.
                ...(types ? { triggers: drafts.map((d) => ({ slug: d.slug, config: configFromValues(fieldsOf.get(d.slug) ?? [], d.values, d.saved) })) } : {}),
            })
            await onChanged()
            toast(`Saved ${trimmed}`, 'success')
            onClose()
        } catch (err) {
            // As Harbor worded it ("Issue created needs team_id"). A name sent with refused triggers was still saved, so the row is read again.
            setError(refusalText(err, 'Could not save the connection'))
            await onChanged()
        } finally {
            setSaving(false)
        }
    }

    // The switch acts at once, as the space's other switches do; it is not part of Save.
    const setFilter = async (filter: boolean) => {
        setFiltering(true)
        setError(null)
        try {
            await window.ipc.invoke('spaces:updateSpaceConnection', { orgId: org.id, spaceId: space.id, connectionId: connection.id, filter })
        } catch (err) {
            setError(refusalText(err, 'Could not change the filter'))
        } finally {
            await onChanged()
            setFiltering(false)
        }
    }

    return (
        <form noValidate onSubmit={(e) => void save(e)} aria-label={`Edit ${connection.name}`} className="mt-4 space-y-5 rounded-lg border border-border p-4">
            <div>
                <label htmlFor={`${id}-name`} className="mb-2 block text-sm">Name</label>
                <Input id={`${id}-name`} className="max-w-sm" value={name} maxLength={CONNECTION_NAME_MAX} disabled={saving} onChange={(e) => setName(e.target.value)} />
                <p className="mt-1 text-xs text-muted-foreground">What this space calls it. Its posts carry this name.</p>
                {attempted && !name.trim() && <p role="alert" className="mt-1 text-xs text-destructive">A connection needs a name</p>}
            </div>

            {filterAvailable && (
                <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
                    <div className="max-w-xl">
                        <h3 id={`${id}-filter`} className="text-sm font-medium">Only post what matters to this space</h3>
                        <p className="mt-1 text-xs text-muted-foreground">While this is on, each event from {app} is sent to Jev, a decision model from TypeSafe, which decides whether it is worth a post here. The events it skips are listed under Skipped events below.</p>
                    </div>
                    <Switch aria-labelledby={`${id}-filter`} checked={connection.filter} disabled={filtering} onCheckedChange={(on) => void setFilter(on)} />
                </div>
            )}

            <div className="border-t border-border pt-5">
                <h3 className="text-sm font-medium">What it posts</h3>
                {!active && <p className="mt-1 text-xs text-muted-foreground">Authorise {app} first, then choose what it posts.</p>}
                {active && !types && !typesError && <p role="status" className="mt-2 text-xs text-muted-foreground">Loading what {app} can post…</p>}
                {typesError && <p role="alert" className="mt-2 text-xs text-destructive">{typesError}</p>}
                {types && types.length === 0 && <p className="mt-2 text-xs text-muted-foreground">{app} has no events a space can receive.</p>}
                {types && types.length > 0 && (
                    <ul className="mt-3 space-y-4">
                        {types.map((type) => {
                            const mine = drafts.filter((d) => d.slug === type.slug)
                            const checkId = `${id}-${type.slug}`
                            return (
                                <li key={type.slug}>
                                    <div className="flex items-start gap-2">
                                        <input id={checkId} type="checkbox" className="mt-0.5 size-4 accent-primary" checked={mine.length > 0} disabled={saving}
                                            aria-describedby={type.description ? `${checkId}-about` : undefined} onChange={(e) => toggle(type, e.target.checked)} />
                                        <div className="min-w-0">
                                            <label htmlFor={checkId} className="text-sm font-medium">{type.name}</label>
                                            {type.description && <p id={`${checkId}-about`} className="text-xs text-muted-foreground">{type.description}</p>}
                                            {/* A polled event is not pushed by the app, so it arrives late (connection.ts `delivery`). */}
                                            {type.delivery === 'poll' && <p className="text-xs text-muted-foreground">{app} is checked for these on a timer, so they arrive with a delay.</p>}
                                        </div>
                                    </div>
                                    {/* The same event for two teams is two triggers (Harbor tells them apart by config), so one made elsewhere shows as a second form here. */}
                                    {mine.map((draft) => (
                                        <ConfigForm
                                            key={draft.id}
                                            id={`${checkId}-${draft.id}`}
                                            legend={`${type.name} settings`}
                                            fields={fieldsOf.get(type.slug) ?? []}
                                            values={draft.values}
                                            problems={attempted ? problemsOf(draft) : {}}
                                            disabled={saving}
                                            onChange={(key, value) => setValue(draft.id, key, value)}
                                        />
                                    ))}
                                </li>
                            )
                        })}
                    </ul>
                )}
                {withdrawn.length > 0 && (
                    <p className="mt-3 text-xs text-muted-foreground">{app} no longer offers {withdrawn.map((t) => t.name).join(', ')}. Saving removes {withdrawn.length === 1 ? 'it' : 'them'}.</p>
                )}
                {tooMany && <p role="alert" className="mt-3 text-xs text-destructive">A connection listens for at most {CONNECTION_TRIGGERS_MAX} kinds of event.</p>}
            </div>

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
                <Button type="submit" disabled={saving || (active && !types && !typesError)}>{saving ? 'Saving…' : 'Save'}</Button>
                <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancel</Button>
            </div>
        </form>
    )
}

/** The settings one trigger needs, drawn from its JSON Schema (lib/spaces-connections.ts). Nothing when it needs none. */
function ConfigForm({ id, legend, fields, values, problems, disabled, onChange }: {
    id: string
    legend: string
    fields: readonly ConfigField[]
    values: ConfigValues
    problems: Readonly<Record<string, string>>
    disabled: boolean
    onChange: (key: string, value: string | boolean) => void
}) {
    if (fields.length === 0) return null
    return (
        <fieldset className="mt-3 ml-6 grid gap-x-4 gap-y-3 sm:grid-cols-2">
            <legend className="sr-only">{legend}</legend>
            {fields.map((field) => {
                const inputId = `${id}-${field.key}`
                const problem = problems[field.key]
                const value = values[field.key]
                const described = [field.description ? `${inputId}-about` : '', problem ? `${inputId}-problem` : ''].filter(Boolean).join(' ') || undefined
                const text = typeof value === 'string' ? value : ''
                return (
                    <div key={field.key} className="min-w-0">
                        {field.kind === 'boolean' ? (
                            <label htmlFor={inputId} className="flex items-center gap-2 text-xs font-medium">
                                <input id={inputId} type="checkbox" className="size-4 accent-primary" checked={value === true} disabled={disabled} aria-describedby={described} onChange={(e) => onChange(field.key, e.target.checked)} />
                                {field.label}
                            </label>
                        ) : (
                            <>
                                {/* "required" is the input's own state for a screen reader; the words are for the eye. */}
                                <label htmlFor={inputId} className="mb-1 block text-xs font-medium">{field.label}{field.required && <span aria-hidden className="font-normal text-muted-foreground"> · required</span>}</label>
                                {field.kind === 'enum' ? (
                                    <select id={inputId} value={text} disabled={disabled} aria-required={field.required || undefined} aria-invalid={problem ? true : undefined} aria-describedby={described}
                                        className="h-8 w-full rounded-[10px] border border-transparent bg-[var(--rowboat-wash)] px-2 text-sm disabled:opacity-50 aria-invalid:border-destructive" onChange={(e) => onChange(field.key, e.target.value)}>
                                        <option value="">{field.required ? 'Choose…' : 'Not set'}</option>
                                        {(field.options ?? []).map((option, index) => <option key={index} value={String(index)}>{typeof option === 'string' ? option : JSON.stringify(option)}</option>)}
                                    </select>
                                ) : (
                                    // A number is typed as text and checked here: a number input would hide what was typed wrong, and with it the reason Save is blocked.
                                    <Input id={inputId} value={text} inputMode={field.kind === 'number' ? 'decimal' : undefined} disabled={disabled} aria-required={field.required || undefined}
                                        aria-invalid={problem ? true : undefined} aria-describedby={described} onChange={(e) => onChange(field.key, e.target.value)} />
                                )}
                            </>
                        )}
                        {field.description && <p id={`${inputId}-about`} className="mt-1 text-xs text-muted-foreground">{field.description}</p>}
                        {problem && <p id={`${inputId}-problem`} role="alert" className="mt-1 text-xs text-destructive">{problem}</p>}
                    </div>
                )
            })}
        </fieldset>
    )
}

/** What the filter kept out of the space, for an admin to check it is not skipping what matters. Read when opened. */
function SkippedEvents({ org, space, connection, showScore }: {
    org: Org
    space: spaces.Space
    connection: spaces.SpaceConnection
    /** False on a server without Jev: nothing was scored. */
    showScore: boolean
}) {
    const id = useId()
    const [open, setOpen] = useState(false)
    const [events, setEvents] = useState<spaces.ConnectionEvent[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    // Asked again when the week's count moves while it is open: the panel's own reload is the only signal there is.
    useEffect(() => {
        if (!open) return
        let gone = false
        window.ipc.invoke('spaces:listConnectionEvents', { orgId: org.id, spaceId: space.id, connectionId: connection.id, outcome: 'skipped' }).then(
            (res) => { if (!gone) { setEvents(res.events); setError(null) } },
            (err: unknown) => { if (!gone) setError(refusalText(err, 'Could not load skipped events')) },
        )
        return () => { gone = true }
    }, [open, org.id, space.id, connection.id, connection.skipped])
    const triggerNames = new Map(connection.triggers.map((t) => [t.slug, t.name]))
    return (
        // Indented to the row's text column, past the logo.
        <div className="mt-3 sm:ml-12">
            <button type="button" aria-expanded={open} aria-controls={id} className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" onClick={() => setOpen((v) => !v)}>
                {open ? <ChevronDown aria-hidden className="size-3.5" /> : <ChevronRight aria-hidden className="size-3.5" />}
                Skipped events
            </button>
            {open && (
                <div id={id} className="mt-2 ml-4">
                    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
                    {!events && !error && <p role="status" className="text-xs text-muted-foreground">Loading…</p>}
                    {events && events.length === 0 && <p className="text-xs text-muted-foreground">Nothing was skipped.</p>}
                    {events && events.length > 0 && (
                        <ul className="divide-y divide-border">
                            {events.map((event) => {
                                const trigger = triggerNames.get(event.trigger) ?? event.trigger
                                // The address is whatever the app sent: only a web address becomes a link.
                                const href = event.url && /^https?:\/\//i.test(event.url) ? event.url : undefined
                                return (
                                    <li key={event.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-xs">
                                        <span className="min-w-0 flex-1 basis-48 truncate text-sm">{event.title ?? trigger}</span>
                                        {event.title && <span className="text-muted-foreground">{trigger}</span>}
                                        <span className="text-muted-foreground" title={formatFullTimestamp(event.receivedAt)}>{formatFeedTime(event.receivedAt)}</span>
                                        {showScore && event.score !== undefined && (
                                            <span className="tabular-nums text-muted-foreground" title="Jev’s estimate that this was worth a post">{Math.round(event.score * 100)}% likely to matter</span>
                                        )}
                                        {href && <a href={href} target="_blank" rel="noreferrer" className="text-[var(--rowboat-link)] hover:underline">Open in {connection.app.name}</a>}
                                    </li>
                                )
                            })}
                        </ul>
                    )}
                </div>
            )}
        </div>
    )
}

function ConnectAppDialog({ org, space, onClose, onConnected }: {
    org: Org
    space: spaces.Space
    onClose: () => void
    onConnected: (connection: spaces.SpaceConnection, authorizeUrl: string) => void
}) {
    const id = useId()
    const [query, setQuery] = useState('')
    const [apps, setApps] = useState<spaces.ConnectionApp[] | null>(null)
    const [available, setAvailable] = useState(true)
    const [picked, setPicked] = useState<spaces.ConnectionApp | null>(null)
    const [name, setName] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const search = query.trim()

    // The server does the searching (its catalogue may be every app there is); a pause in typing is one request.
    useEffect(() => {
        let gone = false
        const timer = window.setTimeout(() => {
            window.ipc.invoke('spaces:listConnectionApps', { orgId: org.id, ...(search ? { search } : {}) }).then(
                (res) => { if (!gone) { setApps(res.apps); setAvailable(res.available); setError(null) } },
                (err: unknown) => { if (!gone) setError(refusalText(err, 'Could not load apps')) },
            )
        }, search ? 200 : 0)
        return () => {
            gone = true
            window.clearTimeout(timer)
        }
    }, [org.id, search])

    const pick = (app: spaces.ConnectionApp) => {
        setPicked(app)
        setName(app.name)
        setError(null)
    }
    const connect = async (event: FormEvent) => {
        event.preventDefault()
        if (!picked || busy) return
        setBusy(true)
        setError(null)
        try {
            const trimmed = name.trim()
            const { connection, authorizeUrl } = await window.ipc.invoke('spaces:createSpaceConnection', {
                orgId: org.id, spaceId: space.id, app: picked.slug, ...(trimmed ? { name: trimmed } : {}),
            })
            onConnected(connection, authorizeUrl)
        } catch (err) {
            setError(refusalText(err, `Could not connect ${picked.name}`))
            setBusy(false)
        }
    }

    return (
        <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
            <DialogContent className="max-w-md gap-0 p-0">
                <DialogHeader className="px-5 pt-5 pb-3">
                    <DialogTitle>{picked ? `Connect ${picked.name}` : 'Connect an app'}</DialogTitle>
                    <DialogDescription>{picked ? `Its updates are posted in ${space.name}.` : `Choose the app whose updates are posted in ${space.name}.`}</DialogDescription>
                </DialogHeader>
                {!picked ? (
                    <>
                        <div className="relative px-5 pb-3">
                            <Search aria-hidden className="pointer-events-none absolute left-8 top-2.5 size-4 text-muted-foreground" />
                            <Input aria-label="Search apps" placeholder="Search apps…" className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
                        </div>
                        <div className="max-h-80 overflow-y-auto border-t border-border p-1.5">
                            {error && <p role="alert" className="px-3 py-6 text-center text-xs text-destructive">{error}</p>}
                            {!apps && !error && <p role="status" className="px-3 py-6 text-center text-xs text-muted-foreground">Loading apps…</p>}
                            {apps && !available && <p role="status" className="px-3 py-6 text-center text-xs text-muted-foreground">This server connects no apps to spaces.</p>}
                            {apps && available && apps.length === 0 && <p className="px-3 py-6 text-center text-xs text-muted-foreground">{search ? 'No apps match.' : 'No apps can be connected yet.'}</p>}
                            {apps?.map((app) => (
                                <button key={app.slug} type="button" className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-accent" onClick={() => pick(app)}>
                                    <ConnectionLogo app={app} className="size-8" />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-medium">{app.name}</span>
                                        <span className="block truncate text-xs text-muted-foreground">{kinds(app.triggersCount)}{app.description ? ` · ${app.description}` : ''}</span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    </>
                ) : (
                    <form onSubmit={(e) => void connect(e)} className="space-y-4 border-t border-border px-5 py-4">
                        <div className="flex items-center gap-3">
                            <ConnectionLogo app={picked} className="size-8" />
                            <span className="min-w-0"><span className="block truncate text-sm font-medium">{picked.name}</span><span className="block text-xs text-muted-foreground">{kinds(picked.triggersCount)}</span></span>
                        </div>
                        <div>
                            <label htmlFor={`${id}-name`} className="mb-2 block text-sm">Name</label>
                            <Input id={`${id}-name`} value={name} maxLength={CONNECTION_NAME_MAX} placeholder={picked.name} disabled={busy} onChange={(e) => setName(e.target.value)} />
                            <p className="mt-1 text-xs text-muted-foreground">What this space calls it, for example “{picked.name} – Eng”. Its posts carry this name.</p>
                        </div>
                        <p className="text-xs text-muted-foreground">Next, you authorise {picked.name} in your browser. What the connection uses is billed to your Rowboat account.</p>
                        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                        <div className="flex justify-end gap-2">
                            <Button type="button" variant="outline" disabled={busy} onClick={() => { setPicked(null); setError(null) }}>Back</Button>
                            <Button type="submit" disabled={busy}>{busy ? 'Connecting…' : 'Connect'}</Button>
                        </div>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    )
}

function DisconnectDialog({ org, space, connection, onClose, onDisconnected }: {
    org: Org
    space: spaces.Space
    connection: spaces.SpaceConnection
    onClose: () => void
    onDisconnected: () => void
}) {
    const [busy, setBusy] = useState(false)
    const disconnect = async () => {
        setBusy(true)
        try {
            await window.ipc.invoke('spaces:deleteSpaceConnection', { orgId: org.id, spaceId: space.id, connectionId: connection.id })
            toast(`Disconnected ${connection.name}`, 'success')
            onDisconnected()
        } catch (err) {
            toast(refusalText(err, 'Could not disconnect it'), 'error')
            setBusy(false)
        }
    }
    return (
        <AlertDialog open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Disconnect {connection.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                        {connection.app.name} stops posting in {space.name} and its authorisation is removed. What it already posted stays.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" disabled={busy} onClick={(event) => { event.preventDefault(); void disconnect() }}>
                        {busy ? 'Disconnecting…' : 'Disconnect'}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
