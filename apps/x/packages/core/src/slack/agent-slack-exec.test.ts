import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exec } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { agentSlackShimEnv, resolveAgentSlackCli, runAgentSlack } from './agent-slack-exec.js';

const execAsync = promisify(exec);

// Fixture CLI scripts spawned via process.execPath (real node under vitest),
// exercising the same spawn path the app uses.
let fixtureDir: string;
let jsonCli: string;
let garbageCli: string;
let sleepCli: string;
let failingCli: string;

function writeFixture(name: string, code: string): string {
    const file = path.join(fixtureDir, name);
    fs.writeFileSync(file, code, 'utf-8');
    return file;
}

beforeAll(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-slack-exec-test-'));
    jsonCli = writeFixture('json.cjs', `process.stdout.write(JSON.stringify({ args: process.argv.slice(2) }));`);
    garbageCli = writeFixture('garbage.cjs', `process.stdout.write('definitely: not json');`);
    sleepCli = writeFixture('sleep.cjs', `setTimeout(() => {}, 60_000);`);
    failingCli = writeFixture('fail.cjs', `process.stderr.write('boom'); process.exit(2);`);
});

afterAll(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
});

const missing = path.join('/nonexistent', 'agent-slack.cjs');

describe('resolveAgentSlackCli', () => {
    it('prefers the bundled bin over global and PATH', () => {
        const resolved = resolveAgentSlackCli({
            bundledCandidates: [jsonCli],
            globalCandidates: [garbageCli],
            pathProbe: () => garbageCli,
        });
        expect(resolved).toEqual({ entry: jsonCli, source: 'bundled' });
    });

    it('falls back to a global install when the bundled bin is missing', () => {
        const resolved = resolveAgentSlackCli({
            bundledCandidates: [missing],
            globalCandidates: [jsonCli],
            pathProbe: () => garbageCli,
        });
        expect(resolved).toEqual({ entry: jsonCli, source: 'global' });
    });

    it('falls back to PATH last', () => {
        const resolved = resolveAgentSlackCli({
            bundledCandidates: [missing],
            globalCandidates: [missing],
            pathProbe: () => jsonCli,
        });
        expect(resolved).toEqual({ entry: jsonCli, source: 'path' });
    });

    it('returns null when nothing is found', () => {
        const resolved = resolveAgentSlackCli({
            bundledCandidates: [missing],
            globalCandidates: [missing],
            pathProbe: () => null,
        });
        expect(resolved).toBeNull();
    });
});

describe('runAgentSlack', () => {
    const via = (entry: string) => ({
        bundledCandidates: [entry],
        globalCandidates: [],
        pathProbe: () => null,
    });

    it('returns parsed JSON stdout and forwards args', async () => {
        const result = await runAgentSlack(['auth', 'whoami'], { resolve: via(jsonCli) });
        expect(result).toMatchObject({ ok: true, data: { args: ['auth', 'whoami'] } });
    });

    it('returns raw stdout when parseJson is false', async () => {
        const result = await runAgentSlack([], { resolve: via(garbageCli), parseJson: false });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.stdout).toBe('definitely: not json');
    });

    it('reports not_installed when no binary resolves', async () => {
        const result = await runAgentSlack(['--version'], {
            resolve: { bundledCandidates: [missing], globalCandidates: [missing], pathProbe: () => null },
        });
        expect(result).toMatchObject({ ok: false, kind: 'not_installed' });
    });

    it('reports parse_error on malformed JSON stdout', async () => {
        const result = await runAgentSlack([], { resolve: via(garbageCli) });
        expect(result).toMatchObject({ ok: false, kind: 'parse_error' });
    });

    it('kills a hung CLI and reports timeout', async () => {
        const result = await runAgentSlack([], { resolve: via(sleepCli), timeoutMs: 300 });
        expect(result).toMatchObject({ ok: false, kind: 'timeout' });
    }, 10_000);

    it('reports exec_error with stderr on non-zero exit', async () => {
        const result = await runAgentSlack([], { resolve: via(failingCli) });
        expect(result).toMatchObject({ ok: false, kind: 'exec_error', stderr: 'boom' });
    });
});

describe('agentSlackShimEnv', () => {
    it('returns the base env unchanged when no CLI resolves', () => {
        const base = { PATH: '/usr/bin' };
        const env = agentSlackShimEnv(path.join(fixtureDir, 'bin'), base, {
            bundledCandidates: [missing], globalCandidates: [missing], pathProbe: () => null,
        });
        expect(env).toBe(base);
    });

    it('makes `agent-slack` runnable by name through a shell', async () => {
        const shimDir = path.join(fixtureDir, 'bin');
        const env = agentSlackShimEnv(shimDir, process.env, {
            bundledCandidates: [jsonCli], globalCandidates: [], pathProbe: () => null,
        });
        const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH';
        expect(env[pathKey]!.startsWith(`${shimDir}${path.delimiter}`)).toBe(true);

        // Same spawn shape as executeCommand: command string through a shell.
        const { stdout } = await execAsync('agent-slack hello world', { env });
        expect(JSON.parse(stdout)).toEqual({ args: ['hello', 'world'] });
    });
});
