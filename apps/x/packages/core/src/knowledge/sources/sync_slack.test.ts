import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { KnowledgeSourceConfig } from './types.js';

// WorkDir is resolved when config.js loads, so the env override must be in
// place before sync_slack.js (which imports it) is loaded — hence the
// dynamic imports in beforeAll.
const tmpWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slack-sync-test-'));
process.env.ROWBOAT_WORKDIR = tmpWorkDir;

const sourceA: KnowledgeSourceConfig = {
    id: 'slack-a',
    provider: 'slack',
    enabled: true,
    artifactDir: 'knowledge_sources/slack',
    syncMode: 'poll',
    intervalMs: 5 * 60 * 1000,
    scopes: [{ type: 'channel', id: 'C-AAA', name: '#alpha' }],
};
const sourceB: KnowledgeSourceConfig = {
    ...sourceA,
    id: 'slack-b',
    scopes: [{ type: 'channel', id: 'C-BBB', name: '#beta' }],
};

vi.mock('./repo.js', () => ({
    knowledgeSourcesRepo: {
        listEnabledSources: vi.fn(() => [sourceA, sourceB]),
        getConfig: vi.fn(() => ({ sources: [sourceA, sourceB] })),
    },
}));

vi.mock('../../services/service_logger.js', () => ({
    serviceLogger: {
        startRun: vi.fn(async () => ({ service: 'slack', runId: 'test-run', startedAt: Date.now() })),
        log: vi.fn(async () => { }),
    },
}));

vi.mock('../../events/producer.js', () => ({
    createEvent: vi.fn(async () => { }),
}));

vi.mock('../../slack/agent-slack-exec.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../slack/agent-slack-exec.js')>();
    return { ...actual, runAgentSlack: vi.fn() };
});

type SyncModule = typeof import('./sync_slack.js');
type ExecModule = typeof import('../../slack/agent-slack-exec.js');

let sync: SyncModule;
let execMock: ReturnType<typeof vi.mocked<ExecModule['runAgentSlack']>>;

const stateFile = path.join(tmpWorkDir, 'slack_knowledge_sync_state.json');

function readState() {
    return JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
}

/** Rewind a source's lastSyncAt so it counts as due again. */
function rewindSource(sourceId: string, ms: number) {
    const state = readState();
    state.sources[sourceId].lastSyncAt = new Date(Date.now() - ms).toISOString();
    fs.writeFileSync(stateFile, JSON.stringify(state), 'utf-8');
}

const okEmpty = { ok: true as const, stdout: '[]', data: [] };
const rateLimited = {
    ok: false as const, kind: 'rate_limited' as const, stderr: 'ratelimited',
    message: 'A rate-limit has been reached, you may retry this request in 30 seconds',
};
const badChannel = {
    ok: false as const, kind: 'bad_channel' as const, stderr: '',
    message: 'Could not resolve channel name: #alpha',
};

beforeAll(async () => {
    sync = await import('./sync_slack.js');
    const exec = await import('../../slack/agent-slack-exec.js');
    execMock = vi.mocked(exec.runAgentSlack);
});

beforeEach(() => {
    execMock.mockReset();
    fs.rmSync(stateFile, { force: true });
});

afterAll(() => {
    fs.rmSync(tmpWorkDir, { recursive: true, force: true });
});

describe('syncSlackKnowledgeSources status persistence', () => {
    it('records ok status and lastSyncAt per source', async () => {
        execMock.mockResolvedValue(okEmpty);
        await sync.syncSlackKnowledgeSources();
        const state = readState();
        for (const id of ['slack-a', 'slack-b']) {
            expect(state.sources[id].lastStatus).toBe('ok');
            expect(Date.parse(state.sources[id].lastSyncAt)).toBeGreaterThan(Date.now() - 60_000);
            expect(state.sources[id].lastError).toBeUndefined();
        }
    });

    it('persists lastError and lets other sources continue past a bad one', async () => {
        execMock.mockImplementation(async (args: string[]) =>
            args.includes('C-AAA') ? badChannel : okEmpty);
        await sync.syncSlackKnowledgeSources();
        const state = readState();
        expect(state.sources['slack-a']).toMatchObject({
            lastStatus: 'error',
            lastError: { kind: 'bad_channel', message: 'Could not resolve channel name: #alpha' },
        });
        // slack-b synced despite slack-a failing
        expect(state.sources['slack-b'].lastStatus).toBe('ok');
        expect(execMock.mock.calls.some(call => call[0].includes('C-BBB'))).toBe(true);
    });

    it('stops the run on rate limit without touching later sources', async () => {
        execMock.mockResolvedValue(rateLimited);
        await sync.syncSlackKnowledgeSources();
        const state = readState();
        expect(state.sources['slack-a'].lastError.kind).toBe('rate_limited');
        expect(state.sources['slack-b']).toBeUndefined();
        expect(execMock.mock.calls.every(call => !call[0].includes('C-BBB'))).toBe(true);
    });

    it('grows backoff on consecutive rate limits and resets it on success', async () => {
        execMock.mockResolvedValue(rateLimited);
        await sync.syncSlackKnowledgeSources();
        expect(readState().sources['slack-a'].backoffMultiplier).toBe(2);

        rewindSource('slack-a', 60 * 60 * 1000);
        await sync.syncSlackKnowledgeSources();
        expect(readState().sources['slack-a'].backoffMultiplier).toBe(4);

        rewindSource('slack-a', 60 * 60 * 1000);
        execMock.mockResolvedValue(okEmpty);
        await sync.syncSlackKnowledgeSources();
        expect(readState().sources['slack-a'].backoffMultiplier).toBeUndefined();
        expect(readState().sources['slack-a'].lastStatus).toBe('ok');
    });

    it('does not re-sync a rate-limited source before its backed-off interval elapses', async () => {
        execMock.mockResolvedValue(rateLimited);
        // First run rate-limits slack-a and breaks before slack-b.
        await sync.syncSlackKnowledgeSources();
        execMock.mockClear();
        // Second run: slack-a is backed off (not due) but slack-b never ran, so
        // it's still due. slack-a must not be retried; slack-b may be.
        await sync.syncSlackKnowledgeSources();
        expect(execMock.mock.calls.every(call => !call[0].includes('C-AAA'))).toBe(true);
    });
});

describe('effectiveIntervalMs', () => {
    it('multiplies the base interval by the backoff and caps at 30 minutes', () => {
        expect(sync.effectiveIntervalMs(sourceA, undefined)).toBe(5 * 60 * 1000);
        expect(sync.effectiveIntervalMs(sourceA, { backoffMultiplier: 2 })).toBe(10 * 60 * 1000);
        expect(sync.effectiveIntervalMs(sourceA, { backoffMultiplier: 4 })).toBe(20 * 60 * 1000);
        expect(sync.effectiveIntervalMs(sourceA, { backoffMultiplier: 8 })).toBe(30 * 60 * 1000);
        expect(sync.effectiveIntervalMs(sourceA, { backoffMultiplier: 1024 })).toBe(30 * 60 * 1000);
    });
});

describe('getSlackKnowledgeSyncStatus', () => {
    it('reports per-source status with nextDueAt from interval + backoff', async () => {
        execMock.mockImplementation(async (args: string[]) =>
            args.includes('C-AAA') ? badChannel : okEmpty);
        await sync.syncSlackKnowledgeSources();

        const statuses = sync.getSlackKnowledgeSyncStatus();
        const a = statuses.find(s => s.id === 'slack-a');
        const b = statuses.find(s => s.id === 'slack-b');
        expect(a).toMatchObject({ enabled: true, lastStatus: 'error', lastError: { kind: 'bad_channel' } });
        expect(b).toMatchObject({ enabled: true, lastStatus: 'ok' });
        // nextDueAt ≈ lastSyncAt + 5 min
        expect(Date.parse(b!.nextDueAt!)).toBeCloseTo(Date.parse(b!.lastSyncAt!) + 5 * 60 * 1000, -3);
    });
});
