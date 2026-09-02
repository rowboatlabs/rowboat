import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
// node-pty is a NATIVE module: it stays external to the esbuild bundle and is
// shipped alongside it in .package/node_modules (see bundle.mjs).
import * as pty from 'node-pty';

// One PTY per coding session, kept alive while the app runs so the terminal
// survives pane collapses and session switches. The renderer view re-attaches
// via `terminal:ensure`, which replays the recent backlog.

const BACKLOG_LIMIT = 400_000; // chars (~400KB) of scrollback replay

interface TerminalEntry {
  proc: pty.IPty;
  cwd: string;
  backlog: string;
  running: boolean;
}

const terminals = new Map<string, TerminalEntry>();

// PTY output fan-out is host-agnostic: Electron main relays to its windows,
// rowboat-server relays to WS clients (broadcast-to-all, per RFC Q12/Q13).
export type TerminalEvent =
  | { channel: 'terminal:data'; payload: { id: string; data: string } }
  | { channel: 'terminal:exit'; payload: { id: string; exitCode: number } };

const terminalListeners = new Set<(e: TerminalEvent) => void>();
export function subscribeTerminalEvents(listener: (e: TerminalEvent) => void): () => void {
  terminalListeners.add(listener);
  return () => terminalListeners.delete(listener);
}

function broadcast(channel: 'terminal:data' | 'terminal:exit', payload: unknown): void {
  const event = { channel, payload } as TerminalEvent;
  for (const l of terminalListeners) l(event);
}

// node-pty's macOS prebuild starts shells through a small `spawn-helper`
// binary. pnpm extracts it without the executable bit, which makes every
// spawn fail with "posix_spawnp failed". Repair it once, locating the helper
// from the SAME node-pty this module imported. This module is ESM, so a bare
// `require` is undefined here — an earlier version used one inside this
// try/catch, which made the repair a silent no-op wherever core runs as ESM
// (the rowboat-server child that now serves terminal calls) while the CJS
// main bundle happened to work.
let helperFixed = false;
let helperPath: string | null = null;
function ensureSpawnHelperExecutable(): void {
  if (helperFixed || process.platform === 'win32') return;
  helperFixed = true;
  try {
    const require = createRequire(import.meta.url);
    // …/node-pty/lib/index.js → the package dir. Resolved through pnpm's
    // symlink so the chmod lands on the real file.
    const entry = fs.realpathSync(require.resolve('node-pty'));
    const pkgDir = path.resolve(path.dirname(entry), '..');
    const helper = path.join(pkgDir, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper');
    helperPath = helper;
    if (!fs.existsSync(helper)) return;
    if ((fs.statSync(helper).mode & 0o111) === 0) {
      fs.chmodSync(helper, 0o755);
    }
  } catch (err) {
    // Not fatal by itself — spawn() reports the real failure, with this
    // path in its message so the cause is visible instead of a blank pane.
    console.warn('[terminal] could not check node-pty spawn-helper:', err);
  }
}

function defaultShell(): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    return { file: 'powershell.exe', args: [] };
  }
  // Login shell so the user's PATH/aliases match their normal terminal.
  return { file: process.env.SHELL || '/bin/zsh', args: ['-l'] };
}

function spawnEntry(id: string, cwd: string, cols: number, rows: number): TerminalEntry {
  ensureSpawnHelperExecutable();
  const { file, args } = defaultShell();
  let proc: pty.IPty;
  try {
    proc = pty.spawn(file, args, {
      name: 'xterm-256color',
      cwd,
      cols,
      rows,
      env: { ...process.env, TERM_PROGRAM: 'rowboat' } as Record<string, string>,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const where = helperPath ? `; spawn-helper: ${helperPath}` : '';
    throw new Error(`Could not start a terminal (${reason}) — shell: ${file}, cwd: ${cwd}${where}`);
  }
  const entry: TerminalEntry = { proc, cwd, backlog: '', running: true };
  proc.onData((data) => {
    entry.backlog = (entry.backlog + data).slice(-BACKLOG_LIMIT);
    broadcast('terminal:data', { id, data });
  });
  proc.onExit(({ exitCode }) => {
    entry.running = false;
    broadcast('terminal:exit', { id, exitCode });
  });
  terminals.set(id, entry);
  return entry;
}

// Create-or-attach. A cwd change (e.g. the session's worktree was removed) or
// an exited shell gets a fresh PTY; otherwise the live one is reused and the
// caller repaints from the backlog.
export function ensureTerminal(id: string, cwd: string, cols: number, rows: number): { backlog: string; running: boolean } {
  const existing = terminals.get(id);
  if (existing && existing.running && existing.cwd === cwd) {
    existing.proc.resize(cols, rows);
    return { backlog: existing.backlog, running: true };
  }
  if (existing) {
    disposeTerminal(id);
  }
  const fallbackCwd = fs.existsSync(cwd) ? cwd : os.homedir();
  const entry = spawnEntry(id, fallbackCwd, cols, rows);
  return { backlog: entry.backlog, running: entry.running };
}

export function writeTerminal(id: string, data: string): void {
  const entry = terminals.get(id);
  if (entry?.running) entry.proc.write(data);
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  const entry = terminals.get(id);
  if (entry?.running) {
    try {
      entry.proc.resize(cols, rows);
    } catch {
      // resizing a dying pty throws — harmless
    }
  }
}

export function disposeTerminal(id: string): void {
  const entry = terminals.get(id);
  if (!entry) return;
  terminals.delete(id);
  try {
    entry.proc.kill();
  } catch {
    // already gone
  }
}

export function disposeAllTerminals(): void {
  for (const id of [...terminals.keys()]) disposeTerminal(id);
}
