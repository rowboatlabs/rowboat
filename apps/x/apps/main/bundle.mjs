/**
 * Bundles the compiled main process into a single JavaScript file.
 * 
 * Why we bundle:
 * - pnpm uses symlinks for workspace packages (@x/core, @x/shared)
 * - Electron Forge's dependency walker (flora-colossus) cannot follow these symlinks
 * - Bundling inlines all dependencies into a single file, eliminating node_modules
 * 
 * This script is called by the generateAssets hook in forge.config.js before packaging.
 * 
 * Why pdf-parse, xlsx, papaparse, mammoth are marked external:
 * - builtin-tools.ts loads these via _importDynamic (new Function pattern) to prevent
 *   esbuild from statically bundling pdfjs-dist's DOM polyfills into the main process.
 * - Because esbuild cannot see through the dynamic import, these packages must be
 *   available as real node_modules at runtime instead.
 * - forge.config.cjs copies them into .package/node_modules after bundling.
 */

import * as esbuild from 'esbuild';

// In CommonJS, import.meta.url doesn't exist. We need to polyfill it.
// The banner defines __import_meta_url at the top of the bundle,
// and we use define to replace all import.meta.url references with it.
const cjsBanner = `var __import_meta_url = require('url').pathToFileURL(__filename).href;`;

// These packages are loaded at runtime via _importDynamic and cannot be bundled.
// They must be present in node_modules alongside the app bundle.
const RUNTIME_EXTERNAL = ['pdf-parse', 'xlsx', 'papaparse', 'mammoth'];

await esbuild.build({
  entryPoints: ['./dist/main.js'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: './.package/dist/main.cjs',
  external: ['electron', ...RUNTIME_EXTERNAL],
  // Use CommonJS format - many dependencies use require() which doesn't work
  // well with esbuild's ESM shim. CJS handles dynamic requires natively.
  format: 'cjs',
  // Inject the polyfill variable at the top
  banner: { js: cjsBanner },
  // Replace import.meta.url directly with our polyfill variable
  define: {
    'import.meta.url': '__import_meta_url',
  },
});

console.log('✅ Main process bundled to .package/dist/main.cjs');
