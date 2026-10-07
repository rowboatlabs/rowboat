import { useSpaceAccess, canActInSpace } from '@/lib/spaces-access'
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { AlertCircle, Ban, Clock, ExternalLink, Hand, Loader2, XCircle } from 'lucide-react'
import type { spaces } from '@x/shared'
import { useMemberNames } from '@/components/spaces/member-text'
import { noteInvocations, useAgentCapabilities } from '@/hooks/use-space-invocations'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

// The line under a message that invoked an agent (Harbor spec §8, 2026-09-30):
// what the agent is doing about it right now — queued, working with its
// activity, waiting on a person, refused and why, failed. Done shows nothing:
// the agent's reply in the thread is the answer. The invoker can cancel a
// queued one; the invoker or an admin can stop a running one when the agent's
// connector declared it can stop.

interface InvocationsContextValue {
    byMessage: ReadonlyMap<string, spaces.Invocation[]>
    orgId: string
    selfId: string | null
    isAdmin: boolean
}

const InvocationsContext = createContext<InvocationsContextValue>({ byMessage: new Map(), orgId: '', selfId: null, isAdmin: false })

export function SpaceInvocationsProvider({ children, ...value }: InvocationsContextValue & { children: ReactNode }) {
    const memo = useMemo(() => value, [value.byMessage, value.orgId, value.selfId, value.isAdmin]) // eslint-disable-line react-hooks/exhaustive-deps
    return <InvocationsContext.Provider value={memo}>{children}</InvocationsContext.Provider>
}

const RUNNING: readonly spaces.InvocationState[] = ['working', 'waiting']

export function InvocationLines({ messageId }: { messageId: string }) {
    const { byMessage, orgId, selfId, isAdmin } = useContext(InvocationsContext)
    const { member } = useSpaceAccess()
    const names = useMemberNames()
    const list = (byMessage.get(messageId) ?? []).filter((i) => i.state !== 'done')
    const running = list.filter((i) => RUNNING.includes(i.state)).map((i) => i.agentId)
    const caps = useAgentCapabilities(orgId || undefined, running)
    const [busy, setBusy] = useState<string | null>(null)
    if (list.length === 0) return null

    const cancel = async (invocation: spaces.Invocation) => {
        if (!canActInSpace(orgId, invocation.conversation.spaceId)) return
        setBusy(invocation.id)
        try {
            const { invocation: updated } = await window.ipc.invoke('spaces:cancelInvocation', { orgId, invocationId: invocation.id })
            noteInvocations(orgId, invocation.conversation.spaceId, [updated])
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not stop it', 'error')
        } finally {
            setBusy(null)
        }
    }

    return (
        <div className="mt-1 flex flex-col gap-0.5">
            {list.map((invocation) => {
                const name = names.get(invocation.agentId) ?? 'The agent'
                const mine = invocation.trigger.authorId === selfId
                const canCancel = member && mine && (invocation.state === 'queued' || invocation.state === 'pending')
                const canStop = member && RUNNING.includes(invocation.state) && (mine || isAdmin) && caps.get(invocation.agentId)?.stop === true
                const { Icon, text, spin, tone } = describe(invocation, name)
                return (
                    <div key={invocation.id} data-invocation={invocation.state} className={cn('flex items-center gap-1.5 text-[12.5px]', tone)}>
                        <Icon className={cn('size-3.5 shrink-0', spin && 'animate-spin')} />
                        <span className="min-w-0 truncate">{text}</span>
                        {invocation.link && (
                            <button type="button" onClick={() => window.open(invocation.link)} className="inline-flex shrink-0 items-center gap-0.5 underline-offset-2 hover:underline">
                                Open <ExternalLink className="size-3" />
                            </button>
                        )}
                        {canCancel && (
                            <button type="button" disabled={busy === invocation.id} onClick={() => void cancel(invocation)} className="shrink-0 font-medium underline-offset-2 hover:underline">
                                Cancel
                            </button>
                        )}
                        {canStop && (
                            <button
                                type="button"
                                disabled={busy === invocation.id || invocation.stopRequested}
                                onClick={() => void cancel(invocation)}
                                className="shrink-0 font-medium text-destructive underline-offset-2 hover:underline disabled:text-muted-foreground disabled:no-underline"
                            >
                                {invocation.stopRequested ? 'Stopping…' : 'Stop'}
                            </button>
                        )}
                    </div>
                )
            })}
        </div>
    )
}

function describe(invocation: spaces.Invocation, name: string): { Icon: typeof Clock; text: string; spin?: boolean; tone: string } {
    const muted = 'text-muted-foreground'
    switch (invocation.state) {
        case 'queued':
            return { Icon: Clock, text: `${name} will get to this next`, tone: muted }
        case 'pending':
            return { Icon: Clock, text: `Waiting for ${name} to pick this up`, tone: muted }
        case 'working':
            return { Icon: Loader2, spin: true, text: invocation.activity ? `${name} is working · ${invocation.activity}` : `${name} is working`, tone: muted }
        case 'waiting':
            return { Icon: Hand, text: `${name} is waiting: ${invocation.activity ?? 'needs you to reply'}`, tone: 'text-foreground' }
        case 'refused':
            return { Icon: Ban, text: `${name} didn’t take this: ${invocation.refusal?.message ?? 'not allowed'}`, tone: muted }
        case 'failed':
            return { Icon: AlertCircle, text: invocation.error ? `${name} couldn’t finish: ${invocation.error}` : `${name} couldn’t finish`, tone: 'text-destructive' }
        case 'cancelled':
            return { Icon: XCircle, text: `${name}: cancelled`, tone: muted }
        default:
            return { Icon: Clock, text: name, tone: muted }
    }
}
