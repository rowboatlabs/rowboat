import { execFile, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import type { CodingAgent } from '@x/shared/dist/code-mode.js';
import { getAgentDescriptor } from '../agent-registry.js';

const execFileAsync = promisify(execFile);

export interface ResolvedExternalAgent {
    path: string;
    version?: string;
}

// Well-known install locations for PATH-native coding CLIs. The login-shell
// probe below is primary; this is the fallback for GUI launches whose inherited
// PATH is stripped (macOS launchd) or whose profile scripts were not sourced.
function installCandidates(bin: string): string[] {
    const home = os.homedir();
    return [
        path.join(home, '.opencode', 'bin', bin),
        path.join(home, '.local', 'bin', bin),
        path.join(home, 'bin', bin),
        '/usr/local/bin/' + bin,
        '/opt/homebrew/bin/' + bin,
        '/usr/bin/' + bin,
    ];
}

export function parseVersion(output: string): string | undefined {
    const match = output.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
    return match?.[0];
}

// `command -v` output is not guaranteed to be a bare path: a login profile can
// echo its own lines, and the answer may be a shell alias or function. Take the
// last non-empty line, which is `command -v`'s own output.
function lastLine(output: string): string | undefined {
    const lines = output.split('\n').map((l) => l.trim()).filter(Boolean);
    return lines[lines.length - 1] || undefined;
}

export function compareSemver(a: string, b: string): number {
    const pa = a.split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
    const pb = b.split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

async function whichInLoginShell(bin: string): Promise<string | undefined> {
    try {
        const { stdout } = await execFileAsync('/bin/sh', ['-lc', `command -v ${bin}`], { timeout: 5000 });
        return lastLine(String(stdout));
    } catch {
        return undefined;
    }
}

function whichInLoginShellSync(bin: string): string | undefined {
    try {
        const out = execFileSync('/bin/sh', ['-lc', `command -v ${bin}`], { timeout: 5000, encoding: 'utf-8' });
        return lastLine(out);
    } catch {
        return undefined;
    }
}

export function probeExternalVersionSync(binPath: string): string | undefined {
    try {
        return parseVersion(execFileSync(binPath, ['--version'], { timeout: 5000, encoding: 'utf-8' }));
    } catch {
        return undefined;
    }
}

async function versionOf(binPath: string): Promise<string | undefined> {
    try {
        const { stdout } = await execFileAsync(binPath, ['--version'], { timeout: 5000 });
        return parseVersion(String(stdout));
    } catch {
        return undefined;
    }
}

// The acceptance rule is shared by the async and sync resolvers: a candidate is
// valid when it resolves on the login shell (the shell already confirmed it is
// executable) or when it runs and prints a version.
async function firstExistingAsync(bin: string): Promise<string | undefined> {
    const fromShell = await whichInLoginShell(bin);
    if (fromShell) return fromShell;
    for (const candidate of installCandidates(bin)) {
        if ((await versionOf(candidate)) !== undefined) return candidate;
    }
    return undefined;
}

// Sync path is used by the launch path (AcpClient spawns synchronously), so it
// must NOT spawn `<bin> --version` for every candidate — that would block the
// host event loop on each session start. An executable file at a known install
// path is accepted directly; the async probe owns version discovery.
function firstExistingSync(bin: string): string | undefined {
    const fromShell = whichInLoginShellSync(bin);
    if (fromShell) return fromShell;
    for (const candidate of installCandidates(bin)) {
        try {
            fs.accessSync(candidate, fs.constants.X_OK);
            return candidate;
        } catch {
            // not here — try the next well-known location
        }
    }
    return undefined;
}

// Resolve an external agent's binary path once, so detection (status) and launch
// (spawn) never disagree. Returns null when the binary is not found.
export async function resolveExternalAgent(agent: CodingAgent): Promise<ResolvedExternalAgent | null> {
    const descriptor = getAgentDescriptor(agent);
    if (descriptor.strategy !== 'external') return null;
    for (const bin of descriptor.binNames) {
        const found = await firstExistingAsync(bin);
        if (found) return { path: found, version: await versionOf(found) };
    }
    return null;
}

// Path-only sync resolver for the launch path: AcpClient spawns synchronously,
// and the launch only needs the executable — probing `--version` there would
// spawn a second process per session for a value nobody reads.
export function resolveExternalAgentPathSync(agent: CodingAgent): string | null {
    const descriptor = getAgentDescriptor(agent);
    if (descriptor.strategy !== 'external') return null;
    for (const bin of descriptor.binNames) {
        const found = firstExistingSync(bin);
        if (found) return found;
    }
    return null;
}

export function resolveExternalAgentSync(agent: CodingAgent): ResolvedExternalAgent | null {
    const found = resolveExternalAgentPathSync(agent);
    return found ? { path: found, version: probeExternalVersionSync(found) } : null;
}

// True when the resolved version satisfies the descriptor's minimum. An
// unparsable version is not treated as a failure; the ACP handshake remains the
// real compatibility gate.
export function meetsMinimumVersion(agent: CodingAgent, version: string | undefined): boolean {
    const descriptor = getAgentDescriptor(agent);
    if (descriptor.strategy !== 'external' || !descriptor.minVersion || !version) return true;
    return compareSemver(version, descriptor.minVersion) >= 0;
}
