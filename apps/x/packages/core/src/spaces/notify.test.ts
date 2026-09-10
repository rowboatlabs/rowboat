import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerFrame } from '@rowboat/spaces-protocol';

// The desktop shows what the org decided (a `notify` member frame) and
// nothing else: the org's text verbatim, the deep link to the message's
// space or thread, background-only. Other member frames pass through silent.

const mocks = vi.hoisted(() => ({
    notifyIfEnabled: vi.fn(),
    listeners: new Set<(orgId: string, frame: ServerFrame) => void>(),
}));

vi.mock('../application/notification/notifier.js', () => ({ notifyIfEnabled: mocks.notifyIfEnabled }));
vi.mock('./orgs.js', () => ({
    onMemberFrame: (listener: (orgId: string, frame: ServerFrame) => void) => {
        mocks.listeners.add(listener);
        return () => mocks.listeners.delete(listener);
    },
}));

import { startSpaceNotifications, stopSpaceNotifications } from './notify.js';

const emit = (orgId: string, frame: ServerFrame) => {
    for (const l of mocks.listeners) l(orgId, frame);
};

const notify = (over: Partial<Extract<ServerFrame, { kind: 'notify' }>> = {}): ServerFrame => ({
    kind: 'notify',
    spaceId: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
    messageId: '01HYYYYYYYYYYYYYYYYYYYYYYY',
    reason: 'mention',
    author: { memberId: 'harsh', actingMode: 'direct' },
    title: 'Harsh mentioned you · Main',
    body: 'hey @Ramnique look',
    at: new Date().toISOString(),
    ...over,
});

afterEach(() => {
    stopSpaceNotifications();
    mocks.listeners.clear();
    mocks.notifyIfEnabled.mockReset();
});

describe('startSpaceNotifications', () => {
    it("shows the org's text under the spaces category, background-only, linking to the space", () => {
        startSpaceNotifications();
        emit('org-1', notify());
        expect(mocks.notifyIfEnabled).toHaveBeenCalledTimes(1);
        expect(mocks.notifyIfEnabled).toHaveBeenCalledWith('space_mention', {
            title: 'Harsh mentioned you · Main',
            message: 'hey @Ramnique look',
            link: 'rowboat://open?type=spaces&orgId=org-1&spaceId=01HZZZZZZZZZZZZZZZZZZZZZZZ&messageId=01HYYYYYYYYYYYYYYYYYYYYYYY',
            onlyWhenBackground: true,
        });
    });

    it('a reply links into its thread', () => {
        startSpaceNotifications();
        emit('org-1', notify({ reason: 'reply', threadRootId: '01HXXXXXXXXXXXXXXXXXXXXXXX', title: 'Arjun replied in a thread · Main' }));
        expect(mocks.notifyIfEnabled.mock.calls[0]![1].link).toBe(
            'rowboat://open?type=spaces&orgId=org-1&spaceId=01HZZZZZZZZZZZZZZZZZZZZZZZ&threadRootId=01HXXXXXXXXXXXXXXXXXXXXXXX&messageId=01HYYYYYYYYYYYYYYYYYYYYYYY',
        );
    });

    it('other member frames are silent; registering twice listens once', () => {
        startSpaceNotifications();
        startSpaceNotifications();
        expect(mocks.listeners.size).toBe(1);
        emit('org-1', { kind: 'read_mark', spaceId: '01HZZZZZZZZZZZZZZZZZZZZZZZ', offset: 3, at: new Date().toISOString() });
        emit('org-1', { kind: 'space_added', spaceId: '01HZZZZZZZZZZZZZZZZZZZZZZZ', spaceKind: 'direct', by: 'harsh', at: new Date().toISOString() });
        expect(mocks.notifyIfEnabled).not.toHaveBeenCalled();
        emit('org-2', notify());
        expect(mocks.notifyIfEnabled).toHaveBeenCalledTimes(1);
    });
});
