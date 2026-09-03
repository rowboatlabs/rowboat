#!/usr/bin/env node
// Sandboxed dev instance launcher: boots the app with an isolated workdir and
// per-instance ports so several dev instances can run at once — alongside the
// production app, and from inside Rowboat code mode (whose agent shells leak
// ELECTRON_RUN_AS_NODE; stripped here and in apps/main's start script).
//
//   npm run dev:sandbox [-- --seed-config] [--no-deps] [--workdir <path>] [--name <id>]
//
//   --seed-config   copy ~/.rowboat/config into the sandbox workdir on first
//                   boot (minus server.json), so model providers work
//   --no-deps       skip the workspace deps build (shared/core/server/…)
//   --workdir       explicit workdir (default ~/.rowboat-dev/<instance-id>)
//   --name          explicit instance id (default derived from the repo root,
//                   stable across restarts of the same checkout/worktree)
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const appsXRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const monorepoRoot = path.resolve(appsXRoot, '..', '..');

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(name);
const flagValue = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
};

const instanceId = flagValue('--name')
    ?? `${path.basename(monorepoRoot).replace(/[^a-zA-Z0-9._-]+/g, '-')}-${createHash('sha256').update(monorepoRoot).digest('hex').slice(0, 6)}`;
const workDir = path.resolve(flagValue('--workdir') ?? path.join(os.homedir(), '.rowboat-dev', instanceId));

// Hold each probe server open until all ports are picked, so the trio is
// guaranteed distinct.
function openOnFreePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.once('error', reject);
        srv.listen(0, '127.0.0.1', () => resolve(srv));
    });
}
const probes = await Promise.all([openOnFreePort(), openOnFreePort(), openOnFreePort()]);
const [serverPort, appsPort, vitePort] = probes.map((s) => s.address().port);
await Promise.all(probes.map((s) => new Promise((r) => s.close(r))));

fs.mkdirSync(workDir, { recursive: true });

const seededConfigDir = path.join(workDir, 'config');
if (hasFlag('--seed-config')) {
    const sourceConfigDir = path.join(os.homedir(), '.rowboat', 'config');
    if (fs.existsSync(seededConfigDir)) {
        console.log(`[sandbox] config already present in ${seededConfigDir} — not re-seeding`);
    } else if (!fs.existsSync(sourceConfigDir)) {
        console.warn(`[sandbox] --seed-config: ${sourceConfigDir} does not exist — skipping`);
    } else {
        // server.json stays out: it carries the port/LAN choices of the real
        // workdir, and the sandbox's port comes from ROWBOAT_SERVER_PORT.
        fs.cpSync(sourceConfigDir, seededConfigDir, {
            recursive: true,
            filter: (src) => path.basename(src) !== 'server.json',
        });
        console.log(`[sandbox] seeded config from ${sourceConfigDir}`);
    }
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.ROWBOAT_WORKDIR = workDir;
env.ROWBOAT_SERVER_PORT = String(serverPort);
env.ROWBOAT_APPS_PORT = String(appsPort);
env.ROWBOAT_DEV_SERVER_URL = `http://localhost:${vitePort}`;

console.log(`[sandbox] instance  ${instanceId}`);
console.log(`[sandbox] workdir   ${workDir}`);
console.log(`[sandbox] ports     server=${serverPort} apps=${appsPort} vite=${vitePort}`);

function prefixPipe(stream, label) {
    readline.createInterface({ input: stream }).on('line', (line) => console.log(`[${label}] ${line}`));
}

function run(label, args, cwd) {
    const child = spawn('npm', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    prefixPipe(child.stdout, label);
    prefixPipe(child.stderr, label);
    return child;
}

const waitForExit = (child) => new Promise((resolve) => child.once('exit', resolve));

async function runToCompletion(label, args, cwd) {
    const code = await waitForExit(run(label, args, cwd));
    if (code !== 0) {
        console.error(`[sandbox] ${label} failed with code ${code}`);
        process.exit(code ?? 1);
    }
}

const children = new Set();
let shuttingDown = false;
function shutdown(code) {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children) child.kill('SIGTERM');
    process.exitCode = code;
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

if (!hasFlag('--no-deps')) await runToCompletion('deps', ['run', 'deps'], appsXRoot);

const renderer = run('renderer', ['run', 'dev', '--', '--port', String(vitePort), '--strictPort'], path.join(appsXRoot, 'apps', 'renderer'));
children.add(renderer);
renderer.once('exit', (code) => {
    children.delete(renderer);
    if (!shuttingDown) {
        console.error(`[sandbox] renderer exited (code ${code}) — shutting down`);
        shutdown(code ?? 1);
    }
});

// wait-on equivalent for the sandbox's vite port.
const viteUrl = `http://localhost:${vitePort}`;
const deadline = Date.now() + 120_000;
for (;;) {
    if (shuttingDown) process.exit();
    try {
        const res = await fetch(viteUrl);
        if (res.ok) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) {
        console.error(`[sandbox] vite dev server never came up on ${viteUrl}`);
        shutdown(1);
        process.exit();
    }
    await new Promise((r) => setTimeout(r, 500));
}

await runToCompletion('main-build', ['run', 'build'], path.join(appsXRoot, 'apps', 'main'));

const main = run('main', ['run', 'start'], path.join(appsXRoot, 'apps', 'main'));
children.add(main);
main.once('exit', (code) => {
    children.delete(main);
    console.log(`[sandbox] app exited (code ${code})`);
    shutdown(code ?? 0);
});
