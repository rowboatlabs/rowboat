import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import electron from 'electron';

const directory = path.dirname(fileURLToPath(import.meta.url));
const strictKnownFailures = process.argv.includes('--strict-known-failures');
const routes = new Map([
  ['/host', ['host.html', 'text/html']],
  ['/form', ['form.html', 'text/html']],
  ['/second', ['second.html', 'text/html']],
  ['/form.js', ['form.js', 'text/javascript']],
]);

// Never launch the normal Rowboat entrypoint: it starts services and opens the
// user's workspace. Bundle only the browser manager and these smoke tests.
const scratch = await mkdtemp(path.join(tmpdir(), 'rowboat-browser-test-'));
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const route = routes.get(url.pathname);
  if (!route) {
    response.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(path.join(directory, 'fixtures', route[0]));
    if (url.searchParams.get('delay') === '250') await delay(250);
    response.writeHead(200, {
      'Content-Type': `${route[1]}; charset=utf-8`,
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'none'",
    }).end(body);
  } catch (error) {
    console.error(error);
    response.writeHead(500).end();
  }
});

let child;
let interrupted = false;
let killTimer;
function stopChild() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  killTimer ??= setTimeout(() => child.kill('SIGKILL'), 5000);
}
const interrupt = () => {
  interrupted = true;
  stopChild();
};
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);

try {
  for (const name of ['profile', 'downloads', 'crashes', 'logs']) {
    await mkdir(path.join(scratch, name));
  }
  const entry = path.join(scratch, 'smoke.cjs');
  await build({
    entryPoints: [path.join(directory, 'smoke.ts')],
    outfile: entry,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    sourcemap: 'inline',
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const resultFile = path.join(scratch, 'result.json');
  const env = {
    ...process.env,
    ROWBOAT_BROWSER_TEST_ROOT: scratch,
    ROWBOAT_BROWSER_TEST_ORIGIN: origin,
    ROWBOAT_BROWSER_TEST_RESULT: resultFile,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  if (interrupted) throw new Error('Browser tests interrupted before launch.');

  console.log('Running native browser tests with a fresh temporary profile and loopback fixtures.');
  const args = [entry, `--user-data-dir=${path.join(scratch, 'profile')}`];
  if (process.platform === 'linux') args.push('--ozone-platform=x11');
  let timedOut = false;
  const exitCode = await new Promise((resolve, reject) => {
    child = spawn(electron, args, { env, stdio: 'inherit' });
    const timeout = setTimeout(() => {
      timedOut = true;
      stopChild();
    }, 60000);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      if (signal) reject(new Error(`Electron terminated with ${signal}.`));
      else resolve(code);
    });
  });
  assert(!interrupted, 'Browser tests interrupted.');
  assert(!timedOut, 'Browser tests exceeded the 60-second timeout.');
  assert.equal(exitCode, 0, `Native browser tests failed (exit ${exitCode}).`);
  // A premature app exit must never look like a passing suite.
  const result = JSON.parse(await readFile(resultFile, 'utf8'));
  assert.equal(result.complete, true);
  assert(result.passed.length > 0);
  console.log(`${result.passed.length} native browser checks passed; ${result.knownFailures.length} known failures (Electron ${result.electron}, Chromium ${result.chromium}, ${result.platform}).`);
  if (strictKnownFailures) {
    assert.deepEqual(result.knownFailures, [], 'Known browser failures remain (strict mode).');
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (killTimer) clearTimeout(killTimer);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', interrupt);
}
