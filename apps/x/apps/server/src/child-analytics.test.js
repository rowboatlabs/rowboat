import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { afterEach, expect, it, vi } from 'vitest';
import { childServerBundleOptions } from '../../main/bundle-config.mjs';

const execFileAsync = promisify(execFile);
const analyticsDir = fileURLToPath(new URL('../../../packages/core/src/analytics/', import.meta.url));
afterEach(() => vi.unstubAllEnvs());

it.each([true, false])('packaged child delivers analytics without runtime credentials (enabled=%s)', async (enabled) => {
  const batches = [];
  const receiver = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (req.url === '/batch/') batches.push(JSON.parse(Buffer.concat(chunks).toString()));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  receiver.listen(0, '127.0.0.1');
  await once(receiver, 'listening');
  const directory = await mkdtemp(path.join(tmpdir(), 'rowboat-child-analytics-'));
  try {
    vi.stubEnv('VITE_PUBLIC_POSTHOG_KEY', enabled ? 'phc_packaging_test' : '');
    vi.stubEnv('VITE_PUBLIC_POSTHOG_HOST', `http://127.0.0.1:${receiver.address().port}`);
    // Production child bundle settings and real PostHog SDK; account/disk
    // dependencies are fixtures so no app data or real API is used.
    const options = childServerBundleOptions('9.8.7');
    delete options.entryPoints;
    const outfile = path.join(directory, 'analytics.cjs');
    await build({
      ...options,
      outfile,
      stdin: {
        resolveDir: analyticsDir,
        contents: `
          import { identifyIfSignedIn } from './identify.ts';
          import { capture, reset, shutdown } from './posthog.ts';
          async function main() {
            await identifyIfSignedIn();
            capture('spaces_rowboat_invoked', { queued: false });
            capture('spaces_rowboat_message_posted');
            reset();
            capture('after_sign_out');
            await shutdown();
            process.exit(0);
          }
          main().catch((err) => { console.error(err); process.exit(1); });
        `,
      },
      plugins: [{
        name: 'isolated-account',
        setup(builder) {
          const fixtures = {
            './installation.js': "export const getInstallationId = () => 'test-installation';",
            '../config/env.js': "export const API_URL = 'https://api.example.test';",
            '../account/account.js': 'export const isSignedIn = async () => true;',
            '../billing/billing.js': "export const getBillingInfo = async () => ({ userId: 'test-user', userEmail: 'test@example.test' });",
          };
          builder.onResolve({ filter: /(?:installation|env|account|billing)\.js$/ }, (args) =>
            fixtures[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: fixtures[args.path] }));
        },
      }],
    });
    const env = { ...process.env };
    for (const key of ['POSTHOG_KEY', 'POSTHOG_HOST', 'VITE_PUBLIC_POSTHOG_KEY', 'VITE_PUBLIC_POSTHOG_HOST', 'ROWBOAT_APP_VERSION', 'npm_package_version']) delete env[key];
    const { stderr } = await execFileAsync(process.execPath, [outfile], { env, timeout: 8000 });
    expect(stderr).toBe('');
    if (!enabled) {
      expect(batches).toEqual([]);
      return;
    }
    expect(batches.length).toBeGreaterThan(0);
    expect(batches.every((batch) => batch.api_key === 'phc_packaging_test')).toBe(true);
    const events = batches.flatMap((batch) => batch.batch);
    for (const event of ['spaces_rowboat_invoked', 'spaces_rowboat_message_posted']) {
      expect(events.filter((entry) => entry.event === event)).toEqual([
        expect.objectContaining({ distinct_id: 'test-user', properties: expect.objectContaining({ app_version: '9.8.7', platform: 'desktop' }) }),
      ]);
    }
    expect(events.find((entry) => entry.event === 'after_sign_out').distinct_id).toBe('test-installation');
    expect(events).toContainEqual(expect.objectContaining({ event: '$identify', distinct_id: 'test-user' }));
  } finally {
    await new Promise((resolve) => receiver.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
