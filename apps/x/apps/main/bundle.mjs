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
  // electron: provided by the Electron runtime.
  // fsevents: native .node binary (can't be bundled); chokidar requires it
  // optionally on macOS. Without it chokidar falls back to kqueue watching —
  // one open fd PER WATCHED FILE — which exhausts the fd table on a large
  // workspace and makes every child_process spawn fail with EBADF.
  external: ['electron', 'fsevents'],
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

console.log('✅ Main process bundled to .package/dist-bundle/main.js');
