import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Single shared executor for the agent-slack CLI.
 *
 * Every agent-slack invocation in the app must go through runAgentSlack() —
 * never execFile('agent-slack', ...) directly. Spawning the bare command
 * requires it on PATH (we no longer auto-install it) and on Windows hits the
 * .cmd-shim EINVAL bug. Instead we resolve a JS entry file and spawn it with
 * process.execPath, which works without Node/npm on the user's machine.
 */

export type AgentSlackSource = 'bundled' | 'global' | 'path';

export interface ResolvedAgentSlack {
    /** Absolute path to a JS entry file runnable via `node <entry>`. */
    entry: string;
    source: AgentSlackSource;
}

export type AgentSlackErrorKind = 'not_installed' | 'timeout' | 'parse_error' | 'exec_error';

export type AgentSlackResult =
    | { ok: true; stdout: string; data: unknown }
    | { ok: false; kind: AgentSlackErrorKind; message: string; stderr: string };

export interface ResolveOptions {
    /** Re-probe even if a previous resolution succeeded. */
    refresh?: boolean;
    /** Test hooks — override the default probe locations. */
    bundledCandidates?: string[];
    globalCandidates?: string[];
    pathProbe?: () => string | null;
}

export interface RunAgentSlackOptions {
    timeoutMs?: number;
    maxBuffer?: number;
    /** Set false for commands with non-JSON output (e.g. --version). */
    parseJson?: boolean;
    /** Test hook — bypass the default resolver. */
    resolve?: ResolveOptions;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BUFFER = 2 * 1024 * 1024;

// The CLI is bundled by apps/main/bundle.mjs to agent-slack.cjs next to
// main.cjs. At runtime import.meta.url is rewritten by esbuild to point at
// main.cjs, so the sibling lookup works in dev and packaged builds alike.
// (Under vitest/tsc output the sibling doesn't exist and we fall through.)
function defaultBundledCandidates(): string[] {
    return [path.join(path.dirname(fileURLToPath(import.meta.url)), 'agent-slack.cjs')];
}

const GLOBAL_BIN_REL = path.join('node_modules', 'agent-slack', 'bin', 'agent-slack.js');

function defaultGlobalCandidates(): string[] {
    if (process.platform === 'win32') {
        const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
        return [path.join(appData, 'npm', GLOBAL_BIN_REL)];
    }
    return [
        path.join('/usr/local/lib', GLOBAL_BIN_REL),
        path.join('/opt/homebrew/lib', GLOBAL_BIN_REL),
    ];
}

/** Map a PATH hit (symlink, npm .cmd/.ps1/sh shim) to the underlying JS bin. */
function jsEntryFromPathHit(hit: string): string | null {
    try {
        const real = fs.realpathSync(hit);
        if (/\.(c|m)?js$/.test(real)) return real;
        // npm shims live next to the global node_modules tree.
        const sibling = path.join(path.dirname(real), GLOBAL_BIN_REL);
        if (fs.existsSync(sibling)) return sibling;
    } catch {
        // Broken symlink or unreadable shim — treat as no hit.
    }
    return null;
}

function defaultPathProbe(): string | null {
    const lookup = process.platform === 'win32' ? 'where.exe' : 'which';
    let output: string;
    try {
        output = execFileSync(lookup, ['agent-slack'], {
            timeout: 5_000,
            encoding: 'utf-8',
            windowsHide: true,
        });
    } catch {
        return null;
    }
    for (const line of output.split(/\r?\n/)) {
        const hit = line.trim();
        if (!hit) continue;
        const entry = jsEntryFromPathHit(hit);
        if (entry) return entry;
    }
    return null;
}

let cachedResolution: ResolvedAgentSlack | null = null;

export function resolveAgentSlackCli(opts: ResolveOptions = {}): ResolvedAgentSlack | null {
    if (cachedResolution && !opts.refresh
        && !opts.bundledCandidates && !opts.globalCandidates && !opts.pathProbe) {
        return cachedResolution;
    }

    let resolved: ResolvedAgentSlack | null = null;
    for (const candidate of opts.bundledCandidates ?? defaultBundledCandidates()) {
        if (fs.existsSync(candidate)) {
            resolved = { entry: candidate, source: 'bundled' };
            break;
        }
    }
    if (!resolved) {
        for (const candidate of opts.globalCandidates ?? defaultGlobalCandidates()) {
            if (fs.existsSync(candidate)) {
                resolved = { entry: candidate, source: 'global' };
                break;
            }
        }
    }
    if (!resolved) {
        const entry = (opts.pathProbe ?? defaultPathProbe)();
        if (entry) resolved = { entry, source: 'path' };
    }

    // Only cache the default probe — test overrides must not leak, and a
    // failed probe should retry next call (the user may install meanwhile).
    if (resolved && !opts.bundledCandidates && !opts.globalCandidates && !opts.pathProbe) {
        cachedResolution = resolved;
    }
    return resolved;
}

export async function runAgentSlack(args: string[], opts: RunAgentSlackOptions = {}): Promise<AgentSlackResult> {
    const resolved = resolveAgentSlackCli(opts.resolve ?? {});
    if (!resolved) {
        return {
            ok: false,
            kind: 'not_installed',
            message: 'agent-slack CLI not found (bundled copy missing and no global install)',
            stderr: '',
        };
    }

    const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let stdout: string;
    try {
        // process.execPath inside Electron's main process is the Electron
        // binary, not node — ELECTRON_RUN_AS_NODE makes it behave as plain
        // node (and is ignored when we already run under real node).
        const result = await execFileAsync(process.execPath, [resolved.entry, ...args], {
            timeout,
            maxBuffer: opts.maxBuffer ?? DEFAULT_MAX_BUFFER,
            encoding: 'utf-8',
            windowsHide: true,
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        });
        stdout = result.stdout;
    } catch (error) {
        const err = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string; stderr?: string };
        const stderr = typeof err.stderr === 'string' ? err.stderr : '';
        if (err.code === 'ENOENT') {
            return { ok: false, kind: 'not_installed', message: `agent-slack entry vanished: ${resolved.entry}`, stderr };
        }
        if (err.killed || err.signal === 'SIGTERM') {
            return { ok: false, kind: 'timeout', message: `agent-slack timed out after ${timeout}ms`, stderr };
        }
        return { ok: false, kind: 'exec_error', message: err.message ?? 'agent-slack failed', stderr };
    }

    if (opts.parseJson === false) {
        return { ok: true, stdout, data: undefined };
    }
    const trimmed = stdout.trim();
    try {
        return { ok: true, stdout, data: trimmed ? JSON.parse(trimmed) : undefined };
    } catch {
        return {
            ok: false,
            kind: 'parse_error',
            message: `agent-slack returned non-JSON output: ${trimmed.slice(0, 200)}`,
            stderr: '',
        };
    }
}

export type AgentSlackCliStatus =
    | { available: true; version: string; source: AgentSlackSource }
    | { available: false };

/** Availability probe backing the slack:cliStatus IPC channel. */
export async function getAgentSlackCliStatus(): Promise<AgentSlackCliStatus> {
    const resolved = resolveAgentSlackCli({ refresh: true });
    if (!resolved) return { available: false };
    const result = await runAgentSlack(['--version'], { timeoutMs: 10_000, parseJson: false });
    if (!result.ok) return { available: false };
    return { available: true, version: result.stdout.trim(), source: resolved.source };
}

// --- PATH shim for shell consumers (Copilot skill via executeCommand) -------
//
// The Copilot Slack skill runs literal `agent-slack ...` shell commands. Those
// used to rely on the startup `npm install -g` that this module replaced, so
// without help they'd only work on machines with a manual global install.
// We generate a tiny launcher script that forwards to the resolved CLI entry
// and prepend its directory to PATH for executeCommand children.

let shimmedFor: string | null = null;

function ensureAgentSlackShim(shimDir: string, entry: string): void {
    const cacheKey = `${process.execPath} ${entry} ${shimDir}`;
    if (shimmedFor === cacheKey) return;
    fs.mkdirSync(shimDir, { recursive: true });
    if (process.platform === 'win32') {
        const cmd = `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" "${entry}" %*\r\n`;
        const cmdPath = path.join(shimDir, 'agent-slack.cmd');
        if (!fs.existsSync(cmdPath) || fs.readFileSync(cmdPath, 'utf-8') !== cmd) {
            fs.writeFileSync(cmdPath, cmd, 'utf-8');
        }
    } else {
        const sh = `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "${entry}" "$@"\n`;
        const shPath = path.join(shimDir, 'agent-slack');
        if (!fs.existsSync(shPath) || fs.readFileSync(shPath, 'utf-8') !== sh) {
            fs.writeFileSync(shPath, sh, { encoding: 'utf-8', mode: 0o755 });
        }
        fs.chmodSync(shPath, 0o755);
    }
    shimmedFor = cacheKey;
}

/**
 * Environment for shell commands that may invoke `agent-slack` by name.
 * Prepends a shim directory to PATH so the resolved CLI (bundled first) wins
 * over — or substitutes for — a global npm install. Returns the base env
 * unchanged when no CLI can be resolved.
 */
export function agentSlackShimEnv(
    shimDir: string,
    base: NodeJS.ProcessEnv = process.env,
    resolve?: ResolveOptions,
): NodeJS.ProcessEnv {
    const resolved = resolveAgentSlackCli(resolve ?? {});
    if (!resolved) return base;
    try {
        ensureAgentSlackShim(shimDir, resolved.entry);
    } catch (error) {
        console.warn('[Slack] Failed to write agent-slack PATH shim:', error);
        return base;
    }
    // Windows env vars are case-insensitive; reuse the existing key ('Path')
    // rather than introducing a duplicate 'PATH'.
    const pathKey = Object.keys(base).find(key => key.toUpperCase() === 'PATH') ?? 'PATH';
    return { ...base, [pathKey]: `${shimDir}${path.delimiter}${base[pathKey] ?? ''}` };
}
