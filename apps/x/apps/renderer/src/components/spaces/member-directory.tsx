import { Tabs } from 'radix-ui'
import { Bot, Plug, Users } from 'lucide-react'
import type { spaces } from '@x/shared'
import { isConnectionMember } from '@x/shared/dist/spaces.js'
import { MemberAvatar, MemberKindBadge, MemberProfilePopover } from './atoms'

export function MemberDirectory({ members, here, selfId }: {
    members: readonly spaces.Member[]
    here: ReadonlySet<string>
    selfId: string
}) {
    const roster = [...members].sort((a, b) =>
        Number(here.has(b.id)) - Number(here.has(a.id)) || a.displayName.localeCompare(b.displayName))
    // Account kind, not acting mode, keeps people represented by an agent in
    // the People tab (2026-10-19, people/integrations separation).
    // A space connection's member (harbor spec §8 Space connections, 2026-11-28) is an agent on the wire but nobody
    // asks it anything, so it is not counted among the agents: connections get a tab of their own, shown only in a
    // space that has one.
    const connections = roster.filter((m) => isConnectionMember(m))
    const groups = [
        { id: 'people', label: 'People', icon: Users, members: roster.filter((m) => m.kind !== 'agent'), empty: 'No people in this space.' },
        { id: 'integrations', label: 'Agents', icon: Bot, members: roster.filter((m) => m.kind === 'agent' && !isConnectionMember(m)), empty: 'No agents in this space.' },
        ...(connections.length > 0 ? [{ id: 'connections', label: 'Connections', icon: Plug, members: connections, empty: '' }] : []),
    ]
    return (
        <Tabs.Root defaultValue="people">
            <Tabs.List aria-label="Member type" className="flex gap-1 border-b border-border p-1">
                {groups.map(({ id, label, icon: Icon, members: group }) => (
                    <Tabs.Trigger key={id} value={id} aria-label={`${label} ${group.length}`} className="flex min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium text-muted-foreground hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-accent data-[state=active]:text-foreground">
                        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                        {label}
                        <span className="tabular-nums text-muted-foreground">{group.length}</span>
                    </Tabs.Trigger>
                ))}
            </Tabs.List>
            {groups.map(({ id, members: group, empty }) => (
                <Tabs.Content key={id} value={id} className="max-h-72 overflow-y-auto py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {group.length === 0 && <p className="px-3 py-6 text-center text-xs text-muted-foreground">{empty}</p>}
                    {group.map((m) => {
                        // A connection is never here or away: it posts when its app does.
                        const isHere = here.has(m.id) && !isConnectionMember(m)
                        return (
                            <MemberProfilePopover key={m.id} id={m.id}>
                                <button type="button" className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent/60">
                                    <MemberAvatar id={m.id} name={m.displayName} size="md" agent={m.kind === 'agent'} agentKind={m.agentKind} online={m.kind === 'human' ? isHere : undefined} />
                                    <span className="min-w-0 flex-1 truncate text-sm">
                                        {m.displayName}
                                        {m.id === selfId && <span className="text-muted-foreground"> (you)</span>}
                                    </span>
                                    <MemberKindBadge member={m} />
                                    {m.role === 'admin' && <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground">admin</span>}
                                    {isHere && <span className="shrink-0 text-[10.5px] text-[var(--rowboat-success)]">here</span>}
                                </button>
                            </MemberProfilePopover>
                        )
                    })}
                </Tabs.Content>
            ))}
        </Tabs.Root>
    )
}
