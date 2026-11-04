import { useState } from 'react'
import { Copy, Eye, EyeOff, KeyRound, Loader2, X as XIcon } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { toast } from '@/lib/toast'

// Secrets in a thread (Harbor spec §8, 2026-11-04, "secrets card" in Main): a
// person shares an API key with the people and agents a message mentions, and
// the rest of the space sees only the card, never the value. Harbor decides
// the readers from the mentions when the message is posted; the composer shows
// the same list first, so a stray mention is seen before it is sent.

/** A secret waiting in the composer, value and all, until the message is sent. */
export interface DraftSecret {
    name: string
    value: string
}

/** The wire's name rule (protocol SecretName): an environment variable's. */
const SECRET_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

/** "Harsh, Gagan and Scout". */
function readersLabel(readers: string[], names: ReadonlyMap<string, string>, selfMemberId?: string): string {
    const labels = readers.map((id) => (id === selfMemberId ? 'you' : names.get(id) ?? 'a member'))
    return labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

export function AddSecretDialog({ open, onOpenChange, readers, names, onAdd }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** Who the draft mentions, who will read it. */
    readers: string[]
    names: ReadonlyMap<string, string>
    onAdd: (secret: DraftSecret) => void
}) {
    return <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
            {/* Mounted per opening, so each one starts empty. */}
            <SecretForm readers={readers} names={names} onAdd={onAdd} onClose={() => onOpenChange(false)} />
        </DialogContent>
    </Dialog>
}

function SecretForm({ readers, names, onAdd, onClose }: {
    readers: string[]
    names: ReadonlyMap<string, string>
    onAdd: (secret: DraftSecret) => void
    onClose: () => void
}) {
    const [name, setName] = useState('')
    const [value, setValue] = useState('')
    const nameOk = SECRET_NAME_RE.test(name)
    const ready = readers.length > 0 && nameOk && value.length > 0
    const add = () => {
        if (!ready) return
        onAdd({ name, value })
        onClose()
    }
    return <>
        <DialogHeader>
            <DialogTitle>Add a secret</DialogTitle>
            <DialogDescription>
                {readers.length === 0
                    ? 'Mention who should read it first: the people and agents your message mentions can read it.'
                    : `Readable by ${readersLabel(readers, names)}. Everyone else sees its name, not its value.`}
            </DialogDescription>
        </DialogHeader>
        {readers.length > 0 && (
            <div className="flex flex-col gap-3">
                <Input autoFocus aria-label="Name" placeholder="OPENAI_API_KEY" value={name} spellCheck={false}
                    onChange={(e) => setName(e.target.value.trim())} />
                {name && !nameOk && <span className="-mt-2 text-xs text-destructive">Letters, digits and underscores, not starting with a digit.</span>}
                <Input aria-label="Value" type="password" autoComplete="off" placeholder="Value" value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && add()} />
            </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={add} disabled={!ready}>Add secret</Button>
        </div>
    </>
}

/** The composer's chips: what this message will share, and with whom, removable before sending. */
export function DraftSecretChips({ secrets, readers, names, onRemove }: {
    secrets: DraftSecret[]
    readers: string[]
    names: ReadonlyMap<string, string>
    onRemove: (secret: DraftSecret) => void
}) {
    if (secrets.length === 0) return null
    return <>
        {secrets.map((s) => (
            <span key={s.name} data-draft-secret={s.name}
                className="inline-flex max-w-56 items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs text-foreground/90">
                <KeyRound className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate font-mono">{s.name}</span>
                <button type="button" onClick={() => onRemove(s)} aria-label={`Remove ${s.name}`}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                    <XIcon className="size-3" />
                </button>
            </span>
        ))}
        <span data-draft-secret-readers className={readers.length === 0 ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
            {readers.length === 0 ? 'Mention who should read it' : `Readable by ${readersLabel(readers, names)}`}
        </span>
    </>
}

/**
 * The card on a posted message: its secrets' names and readers. A reader who
 * is a person reveals a value here, fetched on demand and never kept; the
 * value never reaches anyone else's client.
 */
export function MessageSecretsCard({ orgId, message, memberNames, selfMemberId }: {
    orgId?: string
    message: Pick<spaces.Message, 'id' | 'spaceId' | 'secrets'>
    memberNames: ReadonlyMap<string, string>
    selfMemberId?: string
}) {
    const secrets = message.secrets
    if (!secrets) return null
    const reader = orgId !== undefined && selfMemberId !== undefined && secrets.readers.includes(selfMemberId)
    return (
        <div className="mt-1 flex flex-col gap-1" data-message-secrets>
            {secrets.names.map((name) => (
                <SecretRow key={name} name={name} reveal={reader ? { orgId: orgId!, spaceId: message.spaceId, messageId: message.id } : undefined} />
            ))}
            <span className="text-xs text-muted-foreground">Readable by {readersLabel(secrets.readers, memberNames, selfMemberId)} only</span>
        </div>
    )
}

function SecretRow({ name, reveal }: { name: string; reveal?: { orgId: string; spaceId: string; messageId: string } }) {
    const [value, setValue] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const show = async () => {
        if (!reveal || loading) return
        setLoading(true)
        try {
            setValue((await window.ipc.invoke('spaces:readMessageSecret', { ...reveal, name })).value)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not read the secret', 'error')
        } finally {
            setLoading(false)
        }
    }
    const copy = async () => {
        if (value === null) return
        await navigator.clipboard.writeText(value)
        toast(`${name} copied`, 'success')
    }
    return (
        <span className="inline-flex w-fit max-w-full items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2 py-1 text-xs">
            <KeyRound className="size-3 shrink-0 text-muted-foreground" />
            <span className="font-mono">{name}</span>
            {value !== null && <span data-secret-value className="truncate font-mono text-foreground/90">{value}</span>}
            {reveal && (value === null ? (
                <button type="button" onClick={() => void show()} aria-label={`Reveal ${name}`}
                    className="inline-flex items-center gap-1 rounded px-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                    {loading ? <Loader2 className="size-3 animate-spin" /> : <Eye className="size-3" />}
                    <span>Reveal</span>
                </button>
            ) : (
                <>
                    <button type="button" onClick={() => void copy()} aria-label={`Copy ${name}`}
                        className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                        <Copy className="size-3" />
                    </button>
                    <button type="button" onClick={() => setValue(null)} aria-label={`Hide ${name}`}
                        className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                        <EyeOff className="size-3" />
                    </button>
                </>
            ))}
        </span>
    )
}
