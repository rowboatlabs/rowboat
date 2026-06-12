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
  // electron is provided by the runtime. node-pty is a NATIVE module: it can't
  // be inlined (its loader requires .node binaries + a spawn-helper relative to
  // its own package dir), so it stays external and is copied into
  // .package/node_modules below, where require() from dist/main.cjs finds it.
  external: ['electron', 'node-pty'],
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
for (const item of ['package.json', 'lib', 'prebuilds']) {
  fs.cpSync(path.join(ptySrc, item), path.join(ptyDest, item), { recursive: true, dereference: true });
}
const prebuildsDir = path.join(ptyDest, 'prebuilds');
for (const dir of fs.readdirSync(prebuildsDir)) {
  const helper = path.join(prebuildsDir, dir, 'spawn-helper');
  if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
}
console.log('✅ node-pty staged in .package/node_modules');

console.log('✅ Main process bundled to .package/dist-bundle/main.js');
