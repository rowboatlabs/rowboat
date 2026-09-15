import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectReadiness } from './readiness.js';
import type { RowboatAppManifest } from '@x/shared/dist/rowboat-app.js';

let dir: string;
const manifest: RowboatAppManifest = {
    schemaVersion: 1,
    name: 'test-app',
    version: '1.0.0',
    entry: 'index.html',
    description: '',
    agents: [],
    capabilities: [],
    dataContracts: [],
};
beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'app-readiness-'));
    await fs.mkdir(path.join(dir, 'dist'));
});
afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
});

describe('app readiness', () => {
    it('does not mistake a valid manifest or an empty entry for a working app', async () => {
        expect((await inspectReadiness(dir, manifest)).readiness).toBe(
            'building',
        );
        await fs.writeFile(path.join(dir, 'dist/index.html'), '');
        expect((await inspectReadiness(dir, manifest)).readiness).toBe(
            'building',
        );
        await fs.writeFile(path.join(dir, 'dist/index.html'), '<h1>Hello</h1>');
        expect((await inspectReadiness(dir, manifest)).readiness).toBe('ready');
    });
    it('keeps scaffolded and failed builds distinct from completed ones', async () => {
        await fs.writeFile(
            path.join(dir, 'dist/index.html'),
            '<h1>Placeholder</h1>',
        );
        expect(
            (
                await inspectReadiness(dir, {
                    ...manifest,
                    buildStatus: 'building',
                })
            ).readiness,
        ).toBe('building');
        expect(
            (
                await inspectReadiness(dir, {
                    ...manifest,
                    buildStatus: 'failed',
                })
            ).readiness,
        ).toBe('error');
        expect((await inspectReadiness(dir)).readiness).toBe('error');
    });
    it('waits for valid first data and preserves a valid empty result when permitted', async () => {
        await fs.writeFile(
            path.join(dir, 'dist/index.html'),
            '<h1>Dashboard</h1>',
        );
        const withData = {
            ...manifest,
            dataContracts: [
                {
                    file: 'data.json',
                    requiredKeys: ['items'],
                    nonEmptyArrayKeys: [],
                },
            ],
        };
        expect((await inspectReadiness(dir, withData)).readiness).toBe('setup');
        await fs.mkdir(path.join(dir, 'data'));
        await fs.writeFile(path.join(dir, 'data/data.json'), '{}');
        expect((await inspectReadiness(dir, withData)).readiness).toBe('setup');
        await fs.writeFile(path.join(dir, 'data/data.json'), '{"items":[]}');
        expect(await inspectReadiness(dir, withData)).toMatchObject({
            readiness: 'ready',
            dataUpdatedAt: expect.any(String),
        });
        expect(
            (
                await inspectReadiness(dir, {
                    ...withData,
                    dataContracts: [
                        {
                            ...withData.dataContracts[0],
                            nonEmptyArrayKeys: ['items'],
                        },
                    ],
                })
            ).readiness,
        ).toBe('setup');
    });
    it('rejects data paths that escape the app', async () => {
        await fs.writeFile(path.join(dir, 'dist/index.html'), '<h1>App</h1>');
        expect(
            (
                await inspectReadiness(dir, {
                    ...manifest,
                    dataContracts: [
                        {
                            file: '../outside.json',
                            requiredKeys: [],
                            nonEmptyArrayKeys: [],
                        },
                    ],
                })
            ).readiness,
        ).toBe('setup');
    });
});
