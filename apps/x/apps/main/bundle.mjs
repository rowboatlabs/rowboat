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
  external: ['electron'],  // Provided by Electron runtime
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
