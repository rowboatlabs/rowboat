#!/usr/bin/env node
// Profiles need two identities and two orgs to exercise live updates and scope
// without touching a real account (2026-10-22, Spaces profiles manual testing).
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import { createRequire } from 'node:module';
import os from 'node:os';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const xRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const harborRoot = path.resolve(xRoot, '../harbor');
const flags = new Set(process.argv.slice(2));
const usage = `Usage: node apps/x/scripts/dev-spaces-profiles.mjs [options]

  --web          Also serve a web client signed in as Gagan (second person).
  --skip-build   Reuse installed dependencies and compiled workspace packages.
  --server-only  Start seeded Harbor servers without launching Electron.
  --check        Verify server fixtures, then stop; does not launch Electron.
  --help         Show this help.

Default: install/build Harbor first, install/build desktop dependencies, seed
fresh in-memory orgs, and launch an isolated Rowboat desktop as Harsh.
Ctrl+C stops the servers and child processes. Each run uses fresh test data.
While running, enter readonly / writable to toggle writes in Alpha, or quit.
No existing Rowboat configuration or credentials are copied.`;
if (flags.has('--help')) { console.log(usage); process.exit(0); }
for (const flag of flags) {
    if (!['--web', '--skip-build', '--server-only', '--check'].includes(flag)) {
        console.error(`Unknown option: ${flag}\n${usage}`);
        process.exit(1);
    }
}

// The test runtime must never pick up a deployment database, storage, or
// connector credentials from the invoking shell (2026-10-22).
for (const key of Object.keys(process.env)) {
    if (/^(HARBOR_|BLOBS_|AUTH_|DATABASE_URL$|DATABASE_POOL_MAX$)/.test(key)) delete process.env[key];
}
delete process.env.ELECTRON_RUN_AS_NODE;
const children = new Set();
const servers = [];
const databases = [];
let stopping = false;

function signalTree(child, signal) {
    if (!child.pid) return;
    try {
        if (process.platform === 'win32') child.kill(signal);
        else process.kill(-child.pid, signal);
    } catch (error) { if (error.code !== 'ESRCH') console.error(error.message); }
}
async function shutdown(code = 0) {
    if (stopping) return;
    stopping = true;
    for (const child of children) signalTree(child, 'SIGTERM');
    const timeout = setTimeout(() => {
        for (const child of children) signalTree(child, 'SIGKILL');
        process.exit(code);
    }, 4000);
    await Promise.allSettled(servers.map(server => server.close()));
    await Promise.allSettled(databases.map(db => db.close()));
    // A package-manager parent can exit before Electron/Vite; signal the
    // whole process group again so no test instance survives (2026-10-22).
    for (const child of children) signalTree(child, 'SIGKILL');
    clearTimeout(timeout);
    process.exit(code);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

function launch(command, args, cwd, extraEnv = {}) {
    const child = spawn(command, args, {
        cwd, env: { ...process.env, ...extraEnv }, stdio: 'inherit',
        detached: process.platform !== 'win32',
    });
    children.add(child);
    return child;
}
async function run(command, args, cwd, extraEnv = {}) {
    const child = launch(command, args, cwd, extraEnv);
    const [code] = await once(child, 'exit');
    children.delete(child);
    if (code !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${code}`);
}
function watch(child, name) {
    child.once('error', error => { console.error(`${name}: ${error.message}`); void shutdown(1); });
    child.once('exit', code => {
        if (!stopping) { console.log(`${name} exited (${code}); stopping the test environment.`); void shutdown(code ?? 1); }
    });
}
async function freePort() {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    return port;
}
async function json(url, member = 'harsh') {
    const res = await fetch(url, { headers: { authorization: `Bearer dev-${member}` } });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.json();
}

try {
    if (!flags.has('--skip-build')) {
        await run('pnpm', ['install', '--frozen-lockfile'], harborRoot);
        await run('pnpm', ['-r', 'build'], harborRoot);
        if (!flags.has('--check') && (!flags.has('--server-only') || flags.has('--web'))) {
            await run('pnpm', ['install', '--frozen-lockfile'], xRoot);
            await run('npm', ['run', 'deps'], xRoot);
        }
    }
    if (!flags.has('--check') && !flags.has('--server-only')) {
        // pnpm may retain the JS package without its postinstall binary;
        // Electron's installer is idempotent and verifies its version (2026-10-22).
        const requireMain = createRequire(path.join(xRoot, 'apps/main/package.json'));
        const installer = requireMain.resolve('electron/install.js');
        console.log('[profiles] Checking the Electron binary (downloads it if missing)…');
        await run(process.execPath, [installer], path.dirname(installer), { ELECTRON_SKIP_BINARY_DOWNLOAD: '' });
        const electron = requireMain('electron');
        await fs.access(electron);
        await run(electron, ['-p', '"Electron " + process.versions.electron'], xRoot, { ELECTRON_RUN_AS_NODE: '1' });
    }
    const { PgStore, pgliteDb, startHarbor } = await import(pathToFileURL(path.join(harborRoot, 'packages/server/dist/index.js')).href);
    const webPort = flags.has('--web') ? await freePort() : undefined;
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rowboat-profiles-'));
    const configDir = path.join(workDir, 'config');
    await fs.mkdir(configDir);
    const records = [];
    for (const [id, name, title] of [
        ['profiles-alpha', 'Profiles Alpha', 'Product engineer'],
        ['profiles-beta', 'Profiles Beta', 'Designer'],
    ]) {
        const db = await pgliteDb();
        databases.push(db);
        const store = new PgStore(db);
        await store.init();
        const harbor = await startHarbor({
            store, orgName: name,
            webOrigins: webPort ? [`http://localhost:${webPort}`] : [],
            seedMembers: [{ id: 'harsh', displayName: 'Harsh' }, { id: 'gagan', displayName: 'Gagan' }],
            seedSpaces: [{ name: 'general', creator: 'harsh' }, { name: 'design', creator: 'harsh' }],
        });
        servers.push(harbor);
        // The dev driver trusts bearer names; reject non-loopback connections
        // before requests reach it (2026-10-22, isolated profile fixtures).
        harbor.server.prependListener('connection', socket => {
            if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(socket.remoteAddress)) socket.destroy();
        });
        await harbor.service.updateProfile({ memberId: 'harsh' }, { title });
        await harbor.service.updateProfile({ memberId: 'gagan' }, { title: 'QA engineer' });
        const spaces = await harbor.service.listSpaces({ memberId: 'harsh' });
        const general = spaces.find(space => space.name === 'general');
        await harbor.service.postMessage({ memberId: 'gagan' }, general.id, { body: 'Click my name or avatar to inspect my profile.', actingMode: 'direct' });
        await harbor.service.postMessage({ memberId: 'harsh' }, general.id, { body: 'Use my profile or the account menu to edit my name, title, and photo.', actingMode: 'direct' });
        await harbor.service.openDirect({ memberId: 'harsh' }, 'gagan');
        const agent = await harbor.service.createAgent({ displayName: 'Profile test bot', ownerId: 'harsh' });
        await harbor.service.addMembers({ memberId: 'harsh' }, general.id, { memberIds: [agent.id] });
        records.push({ id, name, address: harbor.address, baseUrl: harbor.url, auth: { kind: 'dev', memberId: 'harsh' } });
        console.log(`[profiles] ${name}: ${harbor.url} (Harsh: admin; Gagan: member)`);
    }
    await fs.writeFile(path.join(configDir, 'spaces_orgs.json'), JSON.stringify({ version: 1, orgs: records }, null, 2));
    await fs.writeFile(path.join(configDir, 'note_creation.json'), JSON.stringify({ strictness: 'medium', configured: true, onboardingComplete: true }));
    console.log(`[profiles] Desktop workdir: ${workDir}`);
    console.log(`[profiles] Harbor process: ${process.pid}; Ctrl+C stops the environment.`);

    for (const record of records) {
        const me = await json(`${record.baseUrl}/v1/me`);
        const listing = await json(`${record.baseUrl}/v1/spaces?includeDirect=true`);
        if (me.member.id !== 'harsh' || listing.spaces.length !== 3) throw new Error(`Invalid fixtures for ${record.name}`);
        const peer = await json(`${record.baseUrl}/v1/me`, 'gagan');
        if (peer.member.role !== 'member') throw new Error('The peer must not be an admin');
    }
    console.log('[profiles] Fixture checks passed: two orgs, two channels + a DM in each, two identities.');
    if (flags.has('--check')) await shutdown();

    if (flags.has('--web')) {
        const web = launch('pnpm', ['dev:web', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], path.join(xRoot, 'apps/renderer'), {
            VITE_SPACES_DEV_HARBOR: records[0].baseUrl, VITE_SPACES_DEV_MEMBER: 'gagan',
        });
        watch(web, 'Web client');
        console.log(`[profiles] Open http://localhost:${webPort} as Gagan in Profiles Alpha.`);
    }
    const commands = readline.createInterface({ input: process.stdin });
    commands.on('line', line => {
        const command = line.trim().toLowerCase();
        if (command === 'quit') { void shutdown(); return; }
        if (command === 'readonly' || command === 'writable') {
            servers[0].service.readOnly = command === 'readonly';
            console.log(`[profiles] Profiles Alpha is now ${command}.`);
        } else if (command) console.log('[profiles] Commands: readonly, writable, quit');
    });
    console.log('[profiles] Enter readonly / writable to test failed saves in Alpha; quit to stop.');
    if (!flags.has('--server-only')) {
        const desktop = launch(process.execPath, [path.join(xRoot, 'scripts/dev-sandbox.mjs'), '--no-deps', '--workdir', workDir, '--name', 'spaces-profiles'], xRoot);
        watch(desktop, 'Desktop');
        console.log('[profiles] Desktop opens as Harsh. Choose Spaces → Profiles Alpha → general.');
    }
} catch (error) {
    console.error(`[profiles] ${error.stack ?? error.message}`);
    await shutdown(1);
}
