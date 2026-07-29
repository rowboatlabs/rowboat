import { rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The repo guards the only copy of the user's API keys. These tests pin the
// data-loss behaviors: corrupt or invalid files must never be silently
// overwritten by boot or by an unrelated write.

// vi.mock factories are hoisted above module code — the temp path must be
// computable inside vi.hoisted without imports (created in beforeEach).
const workDir = vi.hoisted(() =>
    `${process.env.TMPDIR?.replace(/\/$/, '') ?? '/tmp'}/models-repo-test-${process.pid}-${Math.random().toString(36).slice(2)}`,
);

vi.mock('../config/config.js', () => ({ WorkDir: workDir }));
vi.mock('../account/account.js', () => ({ isSignedIn: async () => false }));
vi.mock('../analytics/posthog.js', () => ({ capture: () => {} }));
vi.mock('../analytics/model-providers.js', () => ({
    captureProviderConnected: () => {},
    captureProviderDisconnected: () => {},
    syncModelProviderPersonProperties: async () => {},
}));

import { FSModelConfigRepo } from './repo.js';

const configDir = path.join(workDir, 'config');
const configPath = path.join(configDir, 'models.json');

beforeEach(async () => {
    await fs.mkdir(configDir, { recursive: true });
});

afterEach(async () => {
    await fs.rm(configDir, { recursive: true, force: true });
});

process.on('exit', () => {
    try { rmSync(workDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
});

describe('FSModelConfigRepo data safety', () => {
    it('creates an empty v2 config when the file is missing', async () => {
        await new FSModelConfigRepo().ensureConfig();
        expect(JSON.parse(await fs.readFile(configPath, 'utf8'))).toEqual({ version: 2, providers: {} });
    });

    it('quarantines corrupt JSON instead of overwriting the only copy of the keys', async () => {
        await fs.writeFile(configPath, '{"version":2,"providers":{"openai":{"flavor":"op'); // truncated
        await new FSModelConfigRepo().ensureConfig();

        const entries = await fs.readdir(configDir);
        const quarantined = entries.find((f) => f.startsWith('models.json.corrupt-'));
        expect(quarantined).toBeDefined();
        expect(await fs.readFile(path.join(configDir, quarantined as string), 'utf8')).toContain('"op');
        expect(JSON.parse(await fs.readFile(configPath, 'utf8'))).toEqual({ version: 2, providers: {} });
    });

    it('migration keeps the v1 original as models.json.v1.bak', async () => {
        const v1 = { provider: { flavor: 'openai', apiKey: 'sk-a' }, model: 'gpt-5.4' };
        await fs.writeFile(configPath, JSON.stringify(v1));
        await new FSModelConfigRepo().ensureConfig();

        expect(JSON.parse(await fs.readFile(`${configPath}.v1.bak`, 'utf8'))).toEqual(v1);
        const migrated = JSON.parse(await fs.readFile(configPath, 'utf8'));
        expect(migrated.version).toBe(2);
        expect(migrated.providers.openai.apiKey).toBe('sk-a');
    });

    it('a schema-invalid file makes writes FAIL instead of clobbering stored credentials', async () => {
        // Parses as JSON, fails zod (bad flavor) — the pre-fix behavior was
        // to fall back to an empty config and overwrite everything on the
        // next unrelated write.
        await fs.writeFile(configPath, JSON.stringify({
            version: 2,
            providers: { weird: { flavor: 'not-a-flavor', apiKey: 'sk-precious' } },
        }));
        const repo = new FSModelConfigRepo();
        await expect(repo.updateConfig({ deferBackgroundTasks: true })).rejects.toThrow();
        // The file is untouched — the key survives.
        expect((await fs.readFile(configPath, 'utf8'))).toContain('sk-precious');
    });

    it('writes land atomically via temp + rename (no lingering temp file)', async () => {
        const repo = new FSModelConfigRepo();
        await repo.ensureConfig();
        await repo.setProvider('openai', { flavor: 'openai', apiKey: 'sk-a' });
        const entries = await fs.readdir(configDir);
        expect(entries).not.toContain('models.json.tmp');
        expect(JSON.parse(await fs.readFile(configPath, 'utf8')).providers.openai.apiKey).toBe('sk-a');
    });
});
