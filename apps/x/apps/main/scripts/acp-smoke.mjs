#!/usr/bin/env node
// Code-mode smoke test, run by .github/workflows/x-code-mode-smoke.yml on
// mac/linux/windows after `npm run package`. Catches the cross-platform failure
// modes that previously only surfaced on a colleague's machine:
//
//   1. staging   — ACP adapters present in the packaged app, native engines stripped
//   2. handshake — each staged adapter boots from the packaged app via the packaged
//                  Electron binary (ELECTRON_RUN_AS_NODE) and answers ACP initialize
//   3. timeout   — an engine that launches but never responds (the silent-hang class,
//                  e.g. an outdated local CLI) is converted into a clear error by
//                  AcpClient's startup deadline instead of pending forever
//
// Usage: node scripts/acp-smoke.mjs   (cwd: apps/x/apps/main, after npm run package)

import { spawn } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const mainDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(mainDir, 'out');

let failures = 0;
const ok = (msg) => console.log(`  PASS  ${msg}`);
const fail = (msg) => { failures++; console.error(`  FAIL  ${msg}`); };

// ---------------------------------------------------------------------------
// Locate the packaged app for this platform.
// ---------------------------------------------------------------------------
function findPackagedApp() {
    const dirs = existsSync(outDir)
        ? readdirSync(outDir).filter((d) => d.startsWith('Rowboat-') && statSync(path.join(outDir, d)).isDirectory())
        : [];
    if (dirs.length === 0) throw new Error(`no packaged app under ${outDir} — run npm run package first`);
    const root = path.join(outDir, dirs[0]);

    if (process.platform === 'darwin') {
        const app = readdirSync(root).find((d) => d.endsWith('.app'));
        if (!app) throw new Error(`no .app bundle in ${root}`);
        const macOS = path.join(root, app, 'Contents', 'MacOS');
        const bin = path.join(macOS, readdirSync(macOS)[0]);
        return { appRoot: path.join(root, app, 'Contents', 'Resources', 'app'), electronBin: bin };
    }
    const binName = readdirSync(root).find((f) =>
        process.platform === 'win32' ? /^rowboat\.exe$/i.test(f) : /^rowboat$/i.test(f));
    if (!binName) throw new Error(`no rowboat binary in ${root}`);
    return { appRoot: path.join(root, 'resources', 'app'), electronBin: path.join(root, binName) };
}

// ---------------------------------------------------------------------------
// 1. Staging assertions
// ---------------------------------------------------------------------------
const ADAPTERS = ['@agentclientprotocol/claude-agent-acp', '@agentclientprotocol/codex-acp'];
const ENGINE_DIR_RE = /@anthropic-ai[\\/]claude-agent-sdk-(win32|darwin|linux)|@openai[\\/]codex-(win32|darwin|linux)/;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // engines are ~230MB; nothing legit comes close

function checkStaging(appRoot) {
    console.log('\n[1/3] staging');
    const acpRoot = path.join(appRoot, '.package', 'acp', 'node_modules');
    if (!existsSync(acpRoot)) return fail(`staged adapters missing: ${acpRoot}`);

    for (const pkg of ADAPTERS) {
        const pkgJson = path.join(acpRoot, ...pkg.split('/'), 'package.json');
        if (existsSync(pkgJson)) ok(`${pkg} staged`);
        else fail(`${pkg} NOT staged (${pkgJson})`);
    }

    let engineHits = 0, oversize = 0, totalBytes = 0;
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (ENGINE_DIR_RE.test(p)) { engineHits++; fail(`native engine leaked into package: ${p}`); continue; }
                walk(p);
            } else {
                const size = statSync(p).size;
                totalBytes += size;
                if (size > MAX_FILE_BYTES) { oversize++; fail(`oversized file (${(size / 1e6).toFixed(0)}MB): ${p}`); }
            }
        }
    };
    walk(acpRoot);
    if (engineHits === 0) ok('native engines stripped');
    if (oversize === 0) ok(`no file over ${Math.round(MAX_FILE_BYTES / 1e6)}MB (acp total: ${(totalBytes / 1e6).toFixed(0)}MB)`);
}

// ---------------------------------------------------------------------------
// 2. Packaged-adapter ACP initialize round-trip
// ---------------------------------------------------------------------------
function adapterEntry(appRoot, pkg) {
    const pkgDir = path.join(appRoot, '.package', 'acp', 'node_modules', ...pkg.split('/'));
    const pj = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    const rel = typeof pj.bin === 'string' ? pj.bin : Object.values(pj.bin)[0];
    return path.join(pkgDir, rel);
}

// allowEngineError: codex-acp spawns its engine DURING initialize (claude-acp only
// at session creation). With the fake engine it answers a structured engine error —
// which still proves what this check is for: the adapter is staged, its dependency
// closure loads, it boots and speaks JSON-RPC. Only a non-response (crash, missing
// module, early exit) is a staging failure.
function initializeRoundTrip(electronBin, entry, label, fakeEngine, allowEngineError) {
    return new Promise((resolve) => {
        const child = spawn(electronBin, [entry], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                ELECTRON_RUN_AS_NODE: '1',
                // Adapters must boot without a real engine installed (CI has none);
                // engines are only spawned at session creation, not at initialize.
                CLAUDE_CODE_EXECUTABLE: fakeEngine,
                CODEX_PATH: fakeEngine,
            },
        });
        let stdout = '', stderr = '', done = false;
        const finish = (err) => {
            if (done) return;
            done = true;
            clearTimeout(deadline);
            child.kill();
            if (err) fail(`${label}: ${err}${stderr.trim() ? `\n        stderr: ${stderr.trim().slice(-600)}` : ''}`);
            else ok(`${label}: ACP initialize answered`);
            resolve();
        };
        const deadline = setTimeout(() => finish('no initialize response within 30s'), 30_000);
        child.on('error', (e) => finish(`spawn failed: ${e.message}`));
        child.on('exit', (code) => finish(`adapter exited early (code ${code})`));
        child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
        child.stdout.on('data', (d) => {
            stdout += d;
            for (const line of stdout.split('\n')) {
                try {
                    const msg = JSON.parse(line);
                    if (msg.id === 1 && ('result' in msg || 'error' in msg)) {
                        if (msg.error && allowEngineError) {
                            console.log(`        (engine error expected with fake engine: ${msg.error.message})`);
                            return finish(undefined);
                        }
                        return finish(msg.error ? `initialize error: ${JSON.stringify(msg.error)}` : undefined);
                    }
                } catch { /* partial line */ }
            }
        });
        child.stdin.write(JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'initialize',
            params: { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } } },
        }) + '\n');
    });
}

// ---------------------------------------------------------------------------
// 3. Silent-hang → startup-timeout test (the Arjun scenario, end to end)
//    Real workspace adapter + a fake engine that launches and then never speaks.
//    AcpClient.newSession() must reject with the startup-timeout error.
// ---------------------------------------------------------------------------
async function checkStartupTimeout(fakeEngine) {
    console.log('\n[3/3] startup timeout (fake hanging engine)');
    const coreDist = path.join(mainDir, '..', '..', 'packages', 'core', 'dist', 'code-mode', 'acp');
    process.env.CLAUDE_CODE_EXECUTABLE = fakeEngine;
    process.env.ROWBOAT_ACP_STARTUP_TIMEOUT_MS = '10000';

    const { AcpClient } = await import(pathToFileURL(path.join(coreDist, 'client.js')).href);
    const { PermissionBroker } = await import(pathToFileURL(path.join(coreDist, 'permission-broker.js')).href);

    const broker = new PermissionBroker({ policy: 'yolo', ask: async () => 'allow_once' });
    const cwd = mkdtempSync(path.join(tmpdir(), 'acp-smoke-'));
    const client = new AcpClient({ agent: 'claude', cwd, broker, onEvent: () => {} });
    try {
        await client.start(); // real adapter boots fine — the ENGINE is what hangs
        const started = Date.now();
        try {
            await client.newSession();
            fail('newSession resolved against a hanging engine — timeout never fired');
        } catch (e) {
            const secs = ((Date.now() - started) / 1000).toFixed(1);
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.includes('timed out')) ok(`newSession failed fast (${secs}s): ${msg.split('\n')[0].slice(0, 160)}`);
            else fail(`newSession rejected but not with the startup timeout: ${msg.slice(0, 300)}`);
        }
    } finally {
        client.dispose();
    }
}

// ---------------------------------------------------------------------------
async function main() {
    // A fake engine: launches, swallows stdin, never answers — models an
    // outdated/incompatible local CLI, the silent-hang failure mode.
    const fakeEngine = path.join(mkdtempSync(path.join(tmpdir(), 'fake-engine-')), 'fake-claude.js');
    writeFileSync(fakeEngine, 'process.stdin.resume(); /* never respond */\n');

    const { appRoot, electronBin } = findPackagedApp();
    console.log(`packaged app: ${appRoot}`);

    checkStaging(appRoot);

    console.log('\n[2/3] packaged adapter handshake');
    for (const pkg of ADAPTERS) {
        const allowEngineError = pkg.includes('codex');
        await initializeRoundTrip(electronBin, adapterEntry(appRoot, pkg), pkg, fakeEngine, allowEngineError);
    }

    await checkStartupTimeout(fakeEngine);

    console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
