import type { spaces } from '@x/shared'
import type { RailSelection } from '@/lib/spaces-selection'
import { resolveMentions } from '@/lib/spaces-presentation'

type Item = spaces.SpacesActivityItem

/** Where a row leads: the space (or its thread), landing on the message. */
export interface ActivityTarget {
    orgId: string
    spaceId: string
    rail: RailSelection
    messageId: string
}

export function targetOf(orgId: string, item: Item): ActivityTarget {
    return {
        orgId,
        spaceId: item.spaceId,
        rail: item.threadRootId ? { kind: 'thread', rootMessageId: item.threadRootId } : { kind: 'general' },
        messageId: item.message.id,
    }
}

/** "Harsh", "Harsh's Rowboat", "Arjun and Harsh", "Arjun, Harsh and 2 others". */
export function actorLabel(actors: Item['actors'], names: ReadonlyMap<string, string>): string {
    const one = (a: Item['actors'][number]) => {
        const name = names.get(a.memberId) ?? a.memberId
        return a.actingMode === 'agent' ? `${name}'s ${a.agentName ?? 'Rowboat'}` : name
    }
    const labels = actors.map(one)
    if (labels.length <= 1) return labels[0] ?? 'Someone'
    if (labels.length === 2) return `${labels[0]} and ${labels[1]}`
    if (labels.length === 3) return `${labels[0]}, ${labels[1]} and ${labels[2]}`
    return `${labels[0]}, ${labels[1]} and ${labels.length - 2} others`
}

/** The reason line after the actor: what they did, and where. */
export function reasonLabel(item: Item): string {
    const where = item.spaceKind === 'direct' ? '' : item.threadRootId ? ` in a thread in #${item.spaceName}` : ` in #${item.spaceName}`
    switch (item.kind) {
        case 'mention': return `mentioned you${where}`
        case 'here': return `notified everyone${where}`
        case 'dm': return item.threadRootId ? 'replied in a thread' : 'messaged you'
        case 'reply': return `replied${where}`
        case 'reaction': return `reacted ${item.emoji ?? ''} to your message${where}`
    }
}

/** One line of the message, mention tokens as names (people and spaces), markdown scaffolding dropped. */
export function excerptOf(body: string, names: ReadonlyMap<string, string>, spaceNames?: ReadonlyMap<string, string>, max = 160): string {
    const flat = resolveMentions(body, names, spaceNames)
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[`*_#>]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}
