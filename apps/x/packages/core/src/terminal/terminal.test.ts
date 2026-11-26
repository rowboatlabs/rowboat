import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const { spawn, resize, kill, onData } = vi.hoisted(() => ({
  spawn: vi.fn(), resize: vi.fn(), kill: vi.fn(), onData: vi.fn(),
}));
vi.mock('node-pty', () => ({ spawn }));
vi.mock('./kill-tree.js', () => ({ killProcessTree: vi.fn() }));

import { disposeTerminal, ensureTerminal } from './terminal.js';

afterEach(() => {
  disposeTerminal('test');
  vi.clearAllMocks();
});

it('reuses a fallback shell and its scrollback until the worktree returns', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-cwd-'));
  const missing = path.join(root, 'worktree');
  spawn.mockReturnValue({ onData, onExit: vi.fn(), resize, kill });
  try {
    ensureTerminal('test', missing, 80, 24);
    expect(spawn.mock.calls[0][2].cwd).toBe(os.homedir());
    onData.mock.calls[0][0]('kept scrollback');
    expect(ensureTerminal('test', missing, 90, 30)).toEqual({
      backlog: 'kept scrollback', running: true,
    });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(resize).toHaveBeenCalledWith(90, 30);

    fs.mkdirSync(missing);
    ensureTerminal('test', missing, 90, 30);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls[1][2].cwd).toBe(missing);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
