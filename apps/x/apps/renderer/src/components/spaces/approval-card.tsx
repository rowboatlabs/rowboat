import { useState } from 'react'
import { Ban, Check, Clock, Loader2, ShieldAlert, X } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { formatFeedTime, formatFullTimestamp } from '@/lib/spaces-presentation'

// An agent's approval card (spec §8 part 4, 2026-10-01): what it asks to do,
// why, and one button per choice it offers. Any person who can see the card
// may decide, and the first decision wins. Once settled, the card says who
// decided, as Hermes's Slack card does. Renders INSTEAD of the message body,
// which carries the text rendering for card-blind clients. Live changes reach
// it through the thread's refetch on every space event.

const LABELS: Record<spaces.ApprovalChoice, string> = {
    allow_once: 'Allow once',
    allow_session: 'Allow in this thread',
    allow_always: 'Always allow',
    deny: 'Deny',
}

const DECIDED: Record<spaces.ApprovalChoice, string> = {
    allow_once: 'Allowed once',
    allow_session: 'Allowed in this thread',
    allow_always: 'Always allowed',
    deny: 'Denied',
}

export function ApprovalCard({ approval, orgId, selfMemberId, memberNames }: {
    approval: spaces.Approval
    orgId?: string
    selfMemberId?: string
    memberNames: Map<string, string>
}) {
    // The decision's own response, until the refetch brings it (or something newer).
    const [local, setLocal] = useState<spaces.Approval | null>(null)
    const shown = local && local.id === approval.id && local.updatedAt >= approval.updatedAt ? local : approval
    const [busy, setBusy] = useState<spaces.ApprovalChoice | null>(null)
    const [denying, setDenying] = useState(false)
    const [note, setNote] = useState('')
    const agentName = memberNames.get(shown.agentId) ?? 'The agent'
    const nameOf = (id?: string) => (!id ? 'someone' : id === selfMemberId ? 'you' : memberNames.get(id) ?? 'someone')

    const decide = async (decision: spaces.ApprovalChoice, noteText?: string) => {
        if (!orgId || busy) return
        setBusy(decision)
        try {
            const res = await window.ipc.invoke('spaces:decideApproval', {
                orgId,
                spaceId: shown.conversation.spaceId,
                approvalId: shown.id,
                decision,
                ...(noteText ? { note: noteText } : {}),
            })
            setLocal(res.approval)
            setDenying(false)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not send the decision', 'error')
        } finally {
            setBusy(null)
        }
    }

    const allows = shown.choices.filter((c) => c !== 'deny')
    const canDeny = shown.choices.includes('deny')

    return (
        <div className="mt-0.5 max-w-xl rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium text-foreground">
                <ShieldAlert className="size-4 shrink-0 text-amber-500" />
                <span className="min-w-0 flex-1">{shown.title}</span>
            </div>
            {shown.detail.trim() && (
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-background px-2.5 py-2 font-mono text-xs leading-relaxed text-foreground">
                    {shown.detail}
                </pre>
            )}
            {shown.reason && <p className="mt-2 text-xs leading-snug text-muted-foreground">Why: {shown.reason}</p>}

            {shown.state === 'open' ? (
                denying ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <input
                            autoFocus
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') void decide('deny', note.trim() || undefined)
                                if (e.key === 'Escape') setDenying(false)
                            }}
                            maxLength={1000}
                            placeholder={`Tell ${agentName} why (optional)`}
                            className="h-8 min-w-48 flex-1 rounded-md border border-border bg-background px-2.5 text-xs outline-none focus:border-foreground/40"
                        />
                        <Button size="sm" variant="outline" className="text-destructive" disabled={busy !== null} onClick={() => void decide('deny', note.trim() || undefined)}>
                            {busy === 'deny' && <Loader2 className="size-3.5 animate-spin" />}
                            Deny
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setDenying(false)}>Cancel</Button>
                    </div>
                ) : (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        {allows.map((choice, i) => (
                            <Button key={choice} size="sm" variant={i === 0 ? 'default' : 'outline'} disabled={busy !== null || !orgId} onClick={() => void decide(choice)}>
                                {busy === choice && <Loader2 className="size-3.5 animate-spin" />}
                                {LABELS[choice]}
                            </Button>
                        ))}
                        {canDeny && (
                            <Button size="sm" variant="outline" className="text-destructive" disabled={busy !== null || !orgId} onClick={() => setDenying(true)}>
                                Deny
                            </Button>
                        )}
                    </div>
                )
            ) : (
                <Outcome approval={shown} agentName={agentName} nameOf={nameOf} />
            )}
        </div>
    )
}

function Outcome({ approval, agentName, nameOf }: { approval: spaces.Approval; agentName: string; nameOf: (id?: string) => string }) {
    const at = approval.decidedAt ?? approval.updatedAt
    const when = (
        <span title={formatFullTimestamp(at)} className="text-muted-foreground/70">
            {' · '}
            {formatFeedTime(at)}
        </span>
    )
    if (approval.state === 'allowed' || approval.state === 'denied') {
        const denied = approval.state === 'denied'
        const Icon = denied ? X : Check
        return (
            <div className={cn('mt-3 flex items-start gap-1.5 text-xs', denied ? 'text-destructive' : 'text-foreground')}>
                <Icon className="mt-px size-3.5 shrink-0" />
                <span>
                    {DECIDED[approval.decision ?? (denied ? 'deny' : 'allow_once')]} by {nameOf(approval.decidedBy)}
                    {approval.note && <span className="text-muted-foreground">: “{approval.note}”</span>}
                    {when}
                </span>
            </div>
        )
    }
    const expired = approval.state === 'expired'
    const Icon = expired ? Clock : Ban
    return (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Icon className="size-3.5 shrink-0" />
            <span>
                {expired ? `Expired: ${agentName} stopped waiting` : 'Cancelled'}
                {when}
            </span>
        </div>
    )
}
