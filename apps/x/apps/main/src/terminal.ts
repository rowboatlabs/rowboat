import { BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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

function broadcast(channel: 'terminal:data' | 'terminal:exit', payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.webContents) {
      win.webContents.send(channel, payload);
    }
  }
}

// pnpm extracts node-pty's prebuilt macOS spawn-helper without its executable
// bit, which makes every spawn fail with "posix_spawnp failed". Repair it once.
let helperFixed = false;
function ensureSpawnHelperExecutable(): void {
  if (helperFixed || process.platform === 'win32') return;
  helperFixed = true;
  try {
    const pkgDir = path.dirname(require.resolve('node-pty/package.json'));
    const helper = path.join(pkgDir, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper');
    if (fs.existsSync(helper)) {
      fs.chmodSync(helper, 0o755);
    }
  } catch {
    // best effort — spawn() will surface a real error if this mattered
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
  const proc = pty.spawn(file, args, {
    name: 'xterm-256color',
    cwd,
    cols,
    rows,
    env: { ...process.env, TERM_PROGRAM: 'rowboat' } as Record<string, string>,
  });
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
