import { useState } from 'react'
import { KeyRound, X as XIcon } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

// Secrets for an agent in a thread (Harbor spec §8, 2026-11-04, "secrets card"
// in Main): a person hands an agent the message addresses an API key, and the
// rest of the space sees only the card, never the value. Harbor checks every
// rule; the composer offers only the agents its draft addresses so a send is
// rarely refused.

/** A secret waiting in the composer, value and all, until the message is sent. */
export interface DraftSecret {
    name: string
    for: string
    value: string
}

/** The wire's name rule (protocol SecretName): an environment variable's. */
const SECRET_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

export function AddSecretDialog({ open, onOpenChange, agents, names, onAdd }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** The agents the draft addresses, by member id. */
    agents: string[]
    names: ReadonlyMap<string, string>
    onAdd: (secret: DraftSecret) => void
}) {
    return <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
            {/* Mounted per opening, so each one starts empty. */}
            <SecretForm agents={agents} names={names} onAdd={onAdd} onClose={() => onOpenChange(false)} />
        </DialogContent>
    </Dialog>
}

function SecretForm({ agents, names, onAdd, onClose }: {
    agents: string[]
    names: ReadonlyMap<string, string>
    onAdd: (secret: DraftSecret) => void
    onClose: () => void
}) {
    const [picked, setPicked] = useState<string | undefined>(undefined)
    const [name, setName] = useState('')
    const [value, setValue] = useState('')
    const recipient = picked && agents.includes(picked) ? picked : agents[0] ?? ''
    const nameOk = SECRET_NAME_RE.test(name)
    const ready = recipient !== '' && nameOk && value.length > 0
    const add = () => {
        if (!ready) return
        onAdd({ name, for: recipient, value })
        onClose()
    }
    return <>
        <DialogHeader>
            <DialogTitle>Add a secret</DialogTitle>
            <DialogDescription>
                {agents.length === 0
                    ? 'Mention the agent you want to give it to first.'
                    : 'Only the agent can read it. Everyone else in the thread sees its name, not its value.'}
            </DialogDescription>
        </DialogHeader>
        {agents.length > 0 && (
            <div className="flex flex-col gap-3">
                {agents.length > 1 && (
                    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="For">
                        {agents.map((id) => (
                            <button key={id} type="button" role="radio" aria-checked={recipient === id} onClick={() => setPicked(id)}
                                className={cn('rounded-full border px-2.5 py-1 text-xs', recipient === id ? 'border-foreground bg-muted' : 'border-border text-muted-foreground hover:bg-muted')}>
                                {names.get(id) ?? 'Agent'}
                            </button>
                        ))}
                    </div>
                )}
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
            <Button onClick={add} disabled={!ready}>Add for {names.get(recipient) ?? 'the agent'}</Button>
        </div>
    </>
}

/** The composer's chips: what this message will hand over, by name, removable before sending. */
export function DraftSecretChips({ secrets, names, onRemove }: {
    secrets: DraftSecret[]
    names: ReadonlyMap<string, string>
    onRemove: (secret: DraftSecret) => void
}) {
    return <>
        {secrets.map((s) => (
            <span key={`${s.for}/${s.name}`} data-draft-secret={s.name}
                className="inline-flex max-w-56 items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs text-foreground/90">
                <KeyRound className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate font-mono">{s.name}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">for {names.get(s.for) ?? 'agent'}</span>
                <button type="button" onClick={() => onRemove(s)} aria-label={`Remove ${s.name}`}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                    <XIcon className="size-3" />
                </button>
            </span>
        ))}
    </>
}

/** The card on a posted message: which secret went to which agent. The value never reaches this client. */
export function MessageSecretsCard({ secrets, memberNames }: {
    secrets: spaces.Message['secrets']
    memberNames: ReadonlyMap<string, string>
}) {
    if (!secrets || secrets.length === 0) return null
    return (
        <div className="mt-1 flex flex-wrap gap-1.5" data-message-secrets>
            {secrets.map((s) => {
                const agent = memberNames.get(s.for) ?? 'the agent'
                return (
                    <span key={`${s.for}/${s.name}`} title={`Only ${agent} can read this secret`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2 py-1 text-xs">
                        <KeyRound className="size-3 shrink-0 text-muted-foreground" />
                        <span className="font-mono">{s.name}</span>
                        <span className="text-muted-foreground">for {agent} only</span>
                    </span>
                )
            })}
        </div>
    )
}
