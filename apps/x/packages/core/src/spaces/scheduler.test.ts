import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The scheduled queue is a promise the user made ("send this at 9"). These
// tests pin: the queue survives a relaunch (atomic writes, reload), due items
// fire exactly once with the right shape, and a flaky org retries then gives
// up loudly instead of vanishing the message.

const workDir = vi.hoisted(() => {
    const tmp = (process.env.TMPDIR ?? process.env.TEMP ?? '/tmp').replace(/[\\/]$/, '');
    return `${tmp}/scheduler-test-${process.pid}-${Math.random().toString(36).slice(2)}`;
});

const mocks = vi.hoisted(() => ({
    postMessage: vi.fn(),
    notifyIfEnabled: vi.fn(),
}));

vi.mock('../config/config.js', () => ({ WorkDir: workDir }));
vi.mock('./orgs.js', () => ({
    getClient: () => ({ postMessage: mocks.postMessage }),
    getLive: () => undefined,
    listOrgs: () => [],
}));
vi.mock('../application/notification/notifier.js', () => ({ notifyIfEnabled: mocks.notifyIfEnabled }));

const FILE = path.join(workDir, 'config', 'spaces_scheduled.json');

type Scheduler = typeof import('./scheduler.js');

async function fresh(): Promise<Scheduler> {
    vi.resetModules();
    return import('./scheduler.js');
}

/** startSpacesScheduler runs one tick immediately; stop before the interval can fire again. */
async function tickOnce(s: Scheduler): Promise<void> {
    s.startSpacesScheduler();
    // tick() is fire-and-forget — let the awaits inside it settle.
    await new Promise((r) => setTimeout(r, 20));
    s.stopSpacesScheduler();
}

const past = new Date(Date.now() - 1_000).toISOString();
const future = new Date(Date.now() + 3_600_000).toISOString();

beforeEach(() => {
    fs.mkdirSync(workDir, { recursive: true });
    mocks.postMessage.mockReset().mockResolvedValue({});
    mocks.notifyIfEnabled.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
    (await import('./scheduler.js')).stopSpacesScheduler();
    fs.rmSync(workDir, { recursive: true, force: true });
});

describe('spaces scheduler', () => {
    it('schedules, lists per space in time order, and cancels', async () => {
        const s = await fresh();
        const later = s.scheduleItem({ kind: 'message', orgId: 'org', spaceId: 'a', body: 'second', at: future });
        const sooner = s.scheduleItem({
            kind: 'reminder',
            orgId: 'org',
            spaceId: 'a',
            body: 'first',
            at: new Date(Date.now() + 60_000).toISOString(),
        });
        s.scheduleItem({ kind: 'message', orgId: 'org', spaceId: 'b', body: 'elsewhere', at: future });

        expect(later.id).toBeTruthy();
        expect(Date.parse(later.createdAt)).not.toBeNaN();
        expect(s.listScheduled('org', 'a').map((i) => i.body)).toEqual(['first', 'second']);
        expect(s.listScheduled('org', 'b').map((i) => i.body)).toEqual(['elsewhere']);

        expect(s.cancelScheduled(sooner.id)).toBe(true);
        expect(s.cancelScheduled('nope')).toBe(false);
        expect(s.listScheduled('org', 'a').map((i) => i.body)).toEqual(['second']);
    });

    it('persists atomically and a fresh launch reloads the queue', async () => {
        const first = await fresh();
        const item = first.scheduleItem({ kind: 'message', orgId: 'org', spaceId: 'a', threadRootId: 'root-1', body: 'hi', at: future });

        expect(fs.existsSync(`${FILE}.tmp`)).toBe(false);
        expect(JSON.parse(fs.readFileSync(FILE, 'utf8'))).toEqual({ version: 1, items: [item] });

        const next = await fresh();
        expect(next.listScheduled('org', 'a')).toEqual([item]);
    });

    it('fires due items once: a message posts into its thread as the member, a reminder notifies; future items wait', async () => {
        const s = await fresh();
        s.scheduleItem({ kind: 'message', orgId: 'org', spaceId: 'a', threadRootId: 'root-1', body: 'send later', at: past });
        s.scheduleItem({ kind: 'reminder', orgId: 'org', spaceId: 'a', body: 'ping me', at: past });
        s.scheduleItem({ kind: 'message', orgId: 'org', spaceId: 'a', body: 'not yet', at: future });

        await tickOnce(s);

        expect(mocks.postMessage).toHaveBeenCalledTimes(1);
        expect(mocks.postMessage).toHaveBeenCalledWith('a', { threadRoot: 'root-1', body: 'send later', actingMode: 'direct' });
        expect(mocks.notifyIfEnabled).toHaveBeenCalledTimes(1);
        expect(mocks.notifyIfEnabled).toHaveBeenCalledWith(
            'space_mention',
            expect.objectContaining({ title: 'Reminder', message: 'ping me' }),
        );
        expect(s.listScheduled('org', 'a').map((i) => i.body)).toEqual(['not yet']);
        // Fired items are gone from disk too — a relaunch must not re-send.
        const onDisk = JSON.parse(fs.readFileSync(FILE, 'utf8')) as { items: { body: string }[] };
        expect(onDisk.items.map((i) => i.body)).toEqual(['not yet']);

        // A second tick sends nothing new.
        await tickOnce(s);
        expect(mocks.postMessage).toHaveBeenCalledTimes(1);
    });

    it('a failing post retries on later ticks, then gives up with a notification instead of vanishing', async () => {
        const s = await fresh();
        mocks.postMessage.mockRejectedValue(new Error('org unreachable'));
        s.scheduleItem({ kind: 'message', orgId: 'org', spaceId: 'a', body: 'flaky', at: past });

        for (let i = 1; i <= 4; i++) {
            await tickOnce(s);
            expect(s.listScheduled('org', 'a')[0]?.attempts).toBe(i);
        }
        expect(mocks.notifyIfEnabled).not.toHaveBeenCalled();

        await tickOnce(s);
        expect(mocks.postMessage).toHaveBeenCalledTimes(5);
        expect(s.listScheduled('org', 'a')).toEqual([]);
        expect(mocks.notifyIfEnabled).toHaveBeenCalledWith(
            'space_mention',
            expect.objectContaining({ title: 'Scheduled message failed', message: 'flaky' }),
        );
    });
});
