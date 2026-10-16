import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadServerConfig, saveServerConfig, DEFAULT_PORT } from './config.js';

describe('server config (issue #1144)', () => {
  it('loads defaults when server.json is missing', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rowboat-server-cfg-'));
    try {
      const config = await loadServerConfig(tmp);
      expect(config.lanEnabled).toBe(false);
      expect(config.port).toBe(DEFAULT_PORT);
      expect(config.shell).toBeUndefined();
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('preserves shell.allowedRoots across saveServerConfig and loadServerConfig round-trip', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rowboat-server-cfg-'));
    try {
      // Save config with shell.allowedRoots
      await saveServerConfig(tmp, {
        lanEnabled: false,
        port: 3220,
        shell: {
          allowedRoots: ['/allowed/workspace', '/var/data'],
        },
      });

      // Load config
      const loaded = await loadServerConfig(tmp);
      expect(loaded.shell).toBeDefined();
      expect(loaded.shell?.allowedRoots).toEqual(['/allowed/workspace', '/var/data']);

      // Simulate desktop LAN toggle: saveServerConfig with updated lanEnabled
      await saveServerConfig(tmp, { ...loaded, lanEnabled: true });

      // Reload config and verify shell.allowedRoots is still preserved
      const reloaded = await loadServerConfig(tmp);
      expect(reloaded.lanEnabled).toBe(true);
      expect(reloaded.shell?.allowedRoots).toEqual(['/allowed/workspace', '/var/data']);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
