import type { IPCChannels, InvokeChannels } from '@x/shared/dist/ipc.js'
import { canActInSpace, isSpaceArchived } from '@/lib/spaces-access'

const memberActions = new Set<InvokeChannels>([
    'spaces:postMessage', 'spaces:editMessage', 'spaces:deleteMessage', 'spaces:reactToMessage',
    'spaces:votePoll', 'spaces:endPoll', 'spaces:createTopic', 'spaces:manageTopic',
    'spaces:createAsset', 'spaces:proposeChange', 'spaces:moveAsset', 'spaces:deleteAsset',
    'spaces:restoreAsset', 'spaces:uploadBlob', 'spaces:renameSpace', 'spaces:createInvite',
    'spaces:markRead', 'spaces:followThread', 'spaces:presence', 'spaces:whiteboard',
    'spaces:invokeRowboat', 'spaces:stopRowboat', 'spaces:schedule', 'spaces:addMembers',
])

// What an archived space still allows its members (harbor #1186, 2026-10-14):
// read marks, follows and presence are personal, not additions to the space.
const archivedAllowed = new Set<InvokeChannels>(['spaces:markRead', 'spaces:followThread', 'spaces:presence'])

// 2026-09-28, spec §5: a callback retained by a timer or dialog can outlive membership.
// Check at dispatch too; disabled controls alone cannot protect that transition.
export function invokeSpace<K extends InvokeChannels>(channel: K, args: IPCChannels[K]['req']): Promise<IPCChannels[K]['res']> {
    if (memberActions.has(channel) && args && typeof args === 'object' && 'orgId' in args && 'spaceId' in args
        && typeof args.orgId === 'string' && typeof args.spaceId === 'string' && !canActInSpace(args.orgId, args.spaceId)) {
        return Promise.reject(new Error('Join this space to post'))
    }
    if (memberActions.has(channel) && !archivedAllowed.has(channel) && args && typeof args === 'object' && 'orgId' in args && 'spaceId' in args
        && typeof args.orgId === 'string' && typeof args.spaceId === 'string' && isSpaceArchived(args.orgId, args.spaceId)) {
        return Promise.reject(new Error('This space is archived'))
    }
    return window.ipc.invoke(channel, args)
}
