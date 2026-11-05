// One file for the machine the worker runs on (a Maritime box, a laptop, a
// service): Node 20 or later, nothing to install beside it. `ws` is bundled;
// its optional native helpers are left out, so it runs on its pure-JS path.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

await build({
  entryPoints: [resolve(root, 'src/main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: resolve(root, 'dist/rowboat-worker.cjs'),
  external: ['bufferutil', 'utf-8-validate'],
  define: { 'process.env.ROWBOAT_WORKER_VERSION': JSON.stringify(version) },
  // main.ts's own shebang line is kept by esbuild; the version goes right under it.
  banner: { js: `// @rowboat/worker ${version}` },
  logLevel: 'warning',
});
