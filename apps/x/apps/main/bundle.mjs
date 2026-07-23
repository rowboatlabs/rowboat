/**
 * Bundles the compiled main process into a single JavaScript file.
 * 
 * Why we bundle:
 * - pnpm uses symlinks for workspace packages (@x/core, @x/shared)
 * - Electron Forge's dependency walker (flora-colossus) cannot follow these symlinks
 * - Bundling inlines all dependencies into a single file, eliminating node_modules
 * 
 * This script is called by the generateAssets hook in forge.config.js before packaging.
 */

import * as esbuild from 'esbuild';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// In CommonJS, import.meta.url doesn't exist. We need to polyfill it.
// The banner defines __import_meta_url at the top of the bundle,
// and we use define to replace all import.meta.url references with it.
const cjsBanner = `var __import_meta_url = require('url').pathToFileURL(__filename).href;`;
const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));

await esbuild.build({
  entryPoints: ['./dist/main.js'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: './.package/dist/main.cjs',
  // electron is provided by the runtime. node-pty and uiohook-napi are NATIVE
  // modules: they can't be inlined (their loaders require .node binaries
  // relative to their own package dirs), so they stay external and are copied
  // into .package/node_modules below, where require() from dist/main.cjs
  // finds them.
  external: ['electron', 'node-pty', 'uiohook-napi'],
  // Use CommonJS format - many dependencies use require() which doesn't work
  // well with esbuild's ESM shim. CJS handles dynamic requires natively.
  format: 'cjs',
  // Inject the polyfill variable at the top
  banner: { js: cjsBanner },
  // Replace import.meta.url directly with our polyfill variable
  define: {
    'import.meta.url': '__import_meta_url',
    // Inject PostHog credentials at build time. Reuse the renderer's
    // VITE_PUBLIC_* envs so packaging only needs one set of values.
    // Empty strings disable analytics gracefully.
    'process.env.POSTHOG_KEY': JSON.stringify(process.env.VITE_PUBLIC_POSTHOG_KEY ?? ''),
    'process.env.POSTHOG_HOST': JSON.stringify(process.env.VITE_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com'),
    'process.env.ROWBOAT_APP_VERSION': JSON.stringify(pkg.version ?? ''),
  },
});

// Ship node-pty next to the bundle. Resolve through pnpm's symlink to the real
// package dir and copy only what's needed at runtime (compiled JS + prebuilt
// binaries). The macOS spawn-helper must be executable — pnpm extraction drops
// the bit, and a non-executable helper makes every PTY spawn fail.
const here = path.dirname(fileURLToPath(import.meta.url));
const ptySrc = fs.realpathSync(path.join(here, 'node_modules', 'node-pty'));
const ptyDest = path.join(here, '.package', 'node_modules', 'node-pty');
fs.rmSync(ptyDest, { recursive: true, force: true });
fs.mkdirSync(ptyDest, { recursive: true });
for (const item of ['package.json', 'lib']) {
  fs.cpSync(path.join(ptySrc, item), path.join(ptyDest, item), { recursive: true, dereference: true });
}
// Stage only the CURRENT platform's prebuilds. Each OS packages natively in CI,
// so other platforms' binaries are dead weight — and worse: Windows code signing
// walks every .node file in the app and signtool hard-fails on the Mach-O darwin
// pty.node ("file format cannot be signed").
const prebuildsSrc = path.join(ptySrc, 'prebuilds');
const prebuildsDir = path.join(ptyDest, 'prebuilds');
fs.mkdirSync(prebuildsDir, { recursive: true });
for (const dir of fs.readdirSync(prebuildsSrc)) {
  if (!dir.startsWith(`${process.platform}-`)) continue;
  fs.cpSync(path.join(prebuildsSrc, dir), path.join(prebuildsDir, dir), { recursive: true, dereference: true });
}
for (const dir of fs.readdirSync(prebuildsDir)) {
  const helper = path.join(prebuildsDir, dir, 'spawn-helper');
  if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
}

// Self-heal: node-pty ships prebuilt binaries only for darwin/win32, so on any
// host whose prebuild is absent (notably Linux) the staged package has no loadable
// pty.node and the app crashes on launch. Compile the native module for the host
// platform+arch if needed and stage it under prebuilds/<platform>-<arch>/, where
// node-pty's loader looks first. Keeps dev and CI working without a manual node-gyp
// step (the CI workflow's explicit build is the fast path; this is the safety net).
const hostTriple = `${process.platform}-${process.arch}`;
const stagedBinary = path.join(prebuildsDir, hostTriple, 'pty.node');
if (!fs.existsSync(stagedBinary)) {
  const builtBinary = path.join(ptySrc, 'build', 'Release', 'pty.node');
  if (!fs.existsSync(builtBinary)) {
    console.log(`node-pty: no prebuilt binary for ${hostTriple}; compiling with node-gyp…`);
    execSync('npx node-gyp rebuild', { cwd: ptySrc, stdio: 'inherit' });
  }
  if (!fs.existsSync(builtBinary)) {
    throw new Error(`node-pty: failed to produce a native binary for ${hostTriple}`);
  }
  fs.mkdirSync(path.dirname(stagedBinary), { recursive: true });
  fs.copyFileSync(builtBinary, stagedBinary);
  console.log(`✅ node-pty: staged ${hostTriple}/pty.node`);
}
console.log('✅ node-pty staged in .package/node_modules');

// Ship uiohook-napi (global push-to-talk key hook) the same way. Its loader
// is node-gyp-build, which resolves prebuilds/<platform>-<arch>/*.node
// relative to the package dir — stage the package plus the loader. Only the
// current platform's prebuild ships (same code-signing reason as node-pty).
const uiohookSrc = fs.realpathSync(path.join(here, 'node_modules', 'uiohook-napi'));
const uiohookDest = path.join(here, '.package', 'node_modules', 'uiohook-napi');
fs.rmSync(uiohookDest, { recursive: true, force: true });
fs.mkdirSync(uiohookDest, { recursive: true });
for (const item of ['package.json', 'dist']) {
  fs.cpSync(path.join(uiohookSrc, item), path.join(uiohookDest, item), { recursive: true, dereference: true });
}
const uiohookPrebuildsSrc = path.join(uiohookSrc, 'prebuilds');
const uiohookPrebuildsDest = path.join(uiohookDest, 'prebuilds');
fs.mkdirSync(uiohookPrebuildsDest, { recursive: true });
for (const dir of fs.readdirSync(uiohookPrebuildsSrc)) {
  if (!dir.startsWith(`${process.platform}-`)) continue;
  fs.cpSync(path.join(uiohookPrebuildsSrc, dir), path.join(uiohookPrebuildsDest, dir), { recursive: true, dereference: true });
}
// The node-gyp-build loader itself (resolved through pnpm's virtual store —
// it's a sibling of the real uiohook-napi package dir).
const nodeGypBuildSrc = fs.realpathSync(path.join(uiohookSrc, '..', 'node-gyp-build'));
const nodeGypBuildDest = path.join(here, '.package', 'node_modules', 'node-gyp-build');
fs.rmSync(nodeGypBuildDest, { recursive: true, force: true });
fs.cpSync(nodeGypBuildSrc, nodeGypBuildDest, { recursive: true, dereference: true });
console.log('✅ uiohook-napi staged in .package/node_modules');

// electron-chrome-extensions injects a preload script into browser tabs to
// implement the chrome.* extension APIs. It resolves that file at runtime:
// via require.resolve when node_modules is present (dev), falling back to a
// file next to the running bundle (packaged app, where node_modules is
// gone). Stage it next to main.cjs for the packaged case.
const crxPreloadSrc = fs.realpathSync(
  path.join(here, 'node_modules', 'electron-chrome-extensions', 'dist', 'chrome-extension-api.preload.js'),
);
fs.copyFileSync(crxPreloadSrc, path.join(here, '.package', 'dist', 'chrome-extension-api.preload.js'));
console.log('✅ electron-chrome-extensions preload staged');

// Compile the mic-monitor helper (ambient meeting detection) on macOS.
// Best-effort: without swiftc — or on other platforms — the app still works,
// ad-hoc meeting detection just stays off (main checks the binary exists).
if (process.platform === 'darwin') {
  const swiftSrc = path.join(here, 'native', 'mic-monitor.swift');
  const helperOut = path.join(here, '.package', 'dist', 'mic-monitor');
  const upToDate = fs.existsSync(helperOut) &&
    fs.statSync(helperOut).mtimeMs >= fs.statSync(swiftSrc).mtimeMs;
  if (upToDate) {
    console.log('✅ mic-monitor helper up to date');
  } else {
    try {
      execSync(`swiftc -O "${swiftSrc}" -o "${helperOut}"`, { stdio: 'inherit' });
      console.log('✅ mic-monitor helper compiled');
    } catch {
      console.warn('⚠️  mic-monitor helper not built (swiftc unavailable?) — meeting detection disabled');
    }
  }
}

// Bundle the vendored agent-slack CLI into a single self-contained script next
// to main.cjs. It runs as a child process (process.execPath with
// ELECTRON_RUN_AS_NODE=1), so it must exist as a real file on disk — it can't
// be inlined into main.cjs. Bundling here means the packaged app needs neither
// node_modules nor a global npm install.
const agentSlackPkg = JSON.parse(
  await readFile(new URL('./node_modules/agent-slack/package.json', import.meta.url), 'utf8'),
);
await esbuild.build({
  entryPoints: ['./node_modules/agent-slack/dist/index.js'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  outfile: './.package/dist/agent-slack.cjs',
  format: 'cjs',
  banner: { js: cjsBanner },
  define: {
    'import.meta.url': '__import_meta_url',
    // Without this constant the CLI's --version walks up the directory tree
    // for a package.json and would find Rowboat's instead of agent-slack's.
    'AGENT_SLACK_BUILD_VERSION': JSON.stringify(agentSlackPkg.version),
  },
  // The CLI probes bun:sqlite via dynamic import inside a try/catch and falls
  // back to node:sqlite; keep it external so the probe fails at runtime the
  // same way it does under plain node.
  external: ['bun:sqlite'],
});

console.log(`✅ Main process bundled to .package/dist/main.cjs (+ agent-slack ${agentSlackPkg.version} CLI)`);
