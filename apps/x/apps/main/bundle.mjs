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

// In CommonJS, import.meta.url doesn't exist. We need to polyfill it.
// The banner defines __import_meta_url at the top of the bundle,
// and we use define to replace all import.meta.url references with it.
const cjsBanner = `var __import_meta_url = require('url').pathToFileURL(__filename).href;`;

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
  },
});

console.log('✅ Main process bundled to .package/dist-bundle/main.js');
