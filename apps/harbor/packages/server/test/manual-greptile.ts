import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { greptilePlatform } from '../src/connectors/greptile/index.js';
import { PLATFORMS } from '../src/connectors/platforms.js';
import { defaultGreptileReply, fakeGreptile } from './fake-greptile.js';

// Manual QA uses the same MCP fixture as the wire tests, without modifying
// the production registry or accepting arbitrary endpoints (2026-10-22, Greptile QA guide).
if (process.env.HARBOR_MODE === 'deployment' || process.env.AUTH_ISSUER) {
  throw new Error('Use this fixture only with a local dev Harbor, without HARBOR_MODE=deployment or AUTH_ISSUER.');
}
const file = process.argv[2] ? resolve(process.argv[2]) : undefined;
const overrides = z.record(z.string(), z.object({
  status: z.number().int().min(200).max(599).optional(),
  data: z.unknown().optional(),
  toolError: z.boolean().optional(),
  raw: z.string().optional(),
  delay: z.number().nonnegative().max(60_000).optional(),
  redirect: z.string().url().optional(),
}));
if (file) overrides.parse(JSON.parse(readFileSync(file, 'utf8')));
const fixture = await fakeGreptile();
if (process.env.GREPTILE_QA_SSE === '1') fixture.useSse();
if (process.env.GREPTILE_QA_TEXT === '1') fixture.useText();
fixture.setRoute((call) => {
  console.log(`[greptile-fixture] ${call.name} ${JSON.stringify(call.args)}`);
  try {
    const plan = file ? overrides.parse(JSON.parse(readFileSync(file, 'utf8'))) : {};
    return plan[call.name] ?? defaultGreptileReply(call);
  } catch {
    console.error('[greptile-fixture] Invalid scenario file. Fix its JSON and retry.');
    return { status: 500, raw: 'Invalid local fixture scenario' };
  }
});
PLATFORMS.greptile = greptilePlatform({ endpoint: fixture.endpoint });
console.log('LOCAL GREPTILE FIXTURE: use the fake key "good" or "other"; no requests go to Greptile.');
console.log(file ? `Scenarios reload on each tool call from ${file}` : 'Default scenarios; pass a JSON file path to inject failures.');
await import('../src/main.js');
