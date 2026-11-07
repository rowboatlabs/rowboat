import { useState } from 'react'
import { Bot, UserPlus } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import { AgentsDialog } from '@/components/spaces/agents-dialog'
import { AgentLogo } from '@/components/spaces/agent-setup'
import { InviteLinkPanel } from '@/components/spaces/invite-link'
import { canInvite, useOrgSettings } from '@/hooks/use-org-settings'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { KINDS, kindInfo } from '@/lib/agent-kinds'
import { listNames } from '@/lib/spaces-invites'

/** Ro (Jev) joins orgs on its own and takes no work, so it doesn't count as an agent someone added. */
const isAddedAgent = (m: spaces.Member) => m.kind === 'agent' && m.agentKind !== 'jev'

/**
 * A shared space with no messages yet (2026-11-07): agents first, people
 * second. The main reason to start a group chat is to put your agents in one
 * place, so an empty one offers Add agents and keeps Invite people as the
 * quieter choice. Once an agent is in, it says how to give it work and
 * still offers the next one: people bring several.
 */
export function EmptySpacePrompt({ org, space, roster, selfIsAdmin, writable }: {
    org: OrgWithSpaces
    space: spaces.Space
    roster: spaces.Member[]
    selfIsAdmin: boolean
    /** A browsing non-member reads the space but can act on nothing in it. */
    writable: boolean
}) {
    const [adding, setAdding] = useState(false)
    const [inviting, setInviting] = useState(false)
    const mayInvite = canInvite(useOrgSettings(org.id), selfIsAdmin)
    const agents = roster.filter(isAddedAgent)

    if (!writable) return <div className="px-2 py-6 text-sm text-muted-foreground">Nothing here yet.</div>
    const actions = <>
        <div className="mt-5 flex items-center gap-2">
            <Button variant={agents.length > 0 ? 'outline' : 'default'} onClick={() => setAdding(true)}>
                <Bot className="size-4" /> {agents.length > 0 ? 'Add another agent' : 'Add agents'}
            </Button>
            {mayInvite && <Button variant="ghost" onClick={() => setInviting((open) => !open)} aria-expanded={inviting}>
                <UserPlus className="size-4" /> Invite people
            </Button>}
        </div>
        {inviting && <div className="mt-4 w-full text-left"><InviteLinkPanel orgId={org.id} spaceIds={[space.id]} /></div>}
    </>
    const logos = (['hermes', 'claude-code', 'codex', 'cursor'] as const).map((kind) => KINDS[kind]?.logo)
    return <div className="mx-auto flex max-w-md flex-col items-center px-4 py-12 text-center">
        {agents.length > 0 ? <>
            <div className="mb-4 flex -space-x-1.5" aria-hidden="true">
                {agents.slice(0, 4).map((agent) => <span key={agent.id} className="flex size-9 items-center justify-center rounded-xl border bg-background">
                    <AgentLogo logo={kindInfo(agent.agentKind).logo} className="size-5" />
                </span>)}
            </div>
            <h2 className="text-base font-semibold">{listNames(agents.map((agent) => agent.displayName))} {agents.length === 1 ? 'is' : 'are'} here</h2>
            <p className="mt-1 text-sm text-muted-foreground">Mention {agents.length === 1 ? agents[0]!.displayName : 'one'} to give it work.</p>
        </> : <>
            <div className="mb-4 flex -space-x-1.5" aria-hidden="true">
                {logos.map((logo, i) => <span key={i} className="flex size-9 items-center justify-center rounded-xl border bg-background">
                    <AgentLogo logo={logo} className="size-5" />
                </span>)}
            </div>
            <h2 className="text-base font-semibold">Add your agents</h2>
            <p className="mt-1 text-sm text-muted-foreground">
                Bring Hermes, Claude Code, Codex or any agent you run into {space.name}. Mention one to give it work.
            </p>
        </>}
        {actions}
        <AgentsDialog org={org} open={adding} onOpenChange={setAdding} start={{ name: 'choose' }} />
    </div>
}
