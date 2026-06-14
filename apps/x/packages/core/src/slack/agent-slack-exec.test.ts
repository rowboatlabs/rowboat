import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exec } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { agentSlackShimEnv, classifyAgentSlackStderr, resolveAgentSlackCli, runAgentSlack } from './agent-slack-exec.js';

const execAsync = promisify(exec);

// Fixture CLI scripts spawned via process.execPath (real node under vitest),
// exercising the same spawn path the app uses.
let fixtureDir: string;
let jsonCli: string;
let garbageCli: string;
let sleepCli: string;
let failingCli: string;
let stdinCli: string;

function writeFixture(name: string, code: string): string {
    const file = path.join(fixtureDir, name);
    fs.writeFileSync(file, code, 'utf-8');
    return file;
}

beforeAll(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-slack-exec-test-'));
    jsonCli = writeFixture('json.cjs', `process.stdout.write(JSON.stringify({ args: process.argv.slice(2) }));`);
    stdinCli = writeFixture('stdin.cjs', `let s = ''; process.stdin.on('data', c => s += c); process.stdin.on('end', () => process.stdout.write(s.trim()));`);
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

    it('writes opts.input to the child stdin (parse-curl path)', async () => {
        const result = await runAgentSlack([], { resolve: via(stdinCli), parseJson: false, input: "curl 'https://team.slack.com'" });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.stdout).toBe("curl 'https://team.slack.com'");
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

    it('classifies stderr on non-zero exit (unrecognized → unknown)', async () => {
        const result = await runAgentSlack([], { resolve: via(failingCli) });
        expect(result).toMatchObject({ ok: false, kind: 'unknown', stderr: 'boom', message: 'boom' });
    });
});

describe('classifyAgentSlackStderr', () => {
    // Fixture corpus: strings marked (captured) are real stderr induced on a
    // machine with no Slack auth; the rest are taken verbatim from the
    // agent-slack 0.9.3 / @slack/web-api 7.17 sources.
    const cases: Array<[string, ReturnType<typeof classifyAgentSlackStderr>]> = [
        // not_authed — empty credential store (auth auto-import cascade)
        ['Firefox extraction is not supported on win32.', 'not_authed'],                       // (captured)
        ['Slack Desktop data not found. Checked:\n  - C:\\Users\\X\\AppData\\Roaming\\Slack\\Local Storage\\leveldb', 'not_authed'], // (captured)
        // not_authed — Slack API codes, both client flavors
        ['invalid_auth', 'not_authed'],
        ['token_expired', 'not_authed'],
        ['An API error occurred: invalid_auth', 'not_authed'],
        ['account_inactive', 'not_authed'],
        // rate_limited
        ['ratelimited', 'rate_limited'],
        ['A rate-limit has been reached, you may retry this request in 30 seconds', 'rate_limited'],
        ['Slack HTTP 429 calling conversations.history', 'rate_limited'],
        // network
        ['A request error occurred: getaddrinfo ENOTFOUND slack.com', 'network'],
        ['fetch failed', 'network'],
        ['connect ECONNREFUSED 127.0.0.1:443', 'network'],
        ['Slack HTTP 503 calling conversations.list', 'network'],
        // bad_channel
        ['channel_not_found', 'bad_channel'],
        ['An API error occurred: channel_not_found', 'bad_channel'],
        ['Could not resolve channel name: #nonexistent-channel', 'bad_channel'],
        ['not_in_channel', 'bad_channel'],
        // unknown
        ['Ambiguous channel name across multiple workspaces. Pass --workspace "<url>"', 'unknown'],
        ['', 'unknown'],
    ];

    it.each(cases)('%j → %s', (stderr, expected) => {
        expect(classifyAgentSlackStderr(stderr)).toBe(expected);
    });

    it('does not misread substrings of longer identifiers', () => {
        // "speedratelimitedness" style false positives guarded by boundaries
        expect(classifyAgentSlackStderr('field xratelimitedx in payload')).toBe('unknown');
        expect(classifyAgentSlackStderr('saved to channel_not_found_archive.txt')).toBe('unknown');
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
