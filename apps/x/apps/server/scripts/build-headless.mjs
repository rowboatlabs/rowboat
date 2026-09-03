/**
 * Builds a self-contained headless distribution of rowboat-server for running
 * on a plain Node box (Phase 8 — remote validation): no Electron, no pnpm
 * workspace, no node_modules except node-pty (native, installed on the target
 * so its binary matches that machine).
 *
 * Usage:  npm run build (workspace deps first) → node scripts/build-headless.mjs
 * Output: dist-headless/  → tar it, scp it, `npm install --omit=dev && node rowboat-server.cjs`
 */

import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const out = path.join(root, 'dist-headless');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// Same shape as apps/main/bundle.mjs's rowboat-server artifact, plus the
// import.meta.url polyfill (core resolves asset paths through it).
const cjsBanner = `var __import_meta_url = require('url').pathToFileURL(__filename).href;`;
await esbuild.build({
  entryPoints: [path.join(root, 'dist', 'standalone.js')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: path.join(out, 'rowboat-server.cjs'),
  banner: { js: cjsBanner },
  define: { 'import.meta.url': '__import_meta_url' },
  external: ['electron', 'node-pty', 'uiohook-napi', 'bun:sqlite'],
});

// node-pty is the one runtime dependency that must be installed on the target
// machine (native module — the binary has to be compiled for that host).
const mainPkg = JSON.parse(fs.readFileSync(path.join(root, '..', 'main', 'package.json'), 'utf8'));
const ptyVersion = mainPkg.dependencies['node-pty'];
fs.writeFileSync(
  path.join(out, 'package.json'),
  JSON.stringify(
    {
      name: 'rowboat-server',
      version: mainPkg.version ?? '0.0.0',
      private: true,
      dependencies: { 'node-pty': ptyVersion },
    },
    null,
    2,
  ),
);

fs.writeFileSync(
  path.join(out, 'README.md'),
  `# rowboat-server (headless)

Requires Node 22+ and build tools for node-pty (\`build-essential python3\` on Debian/Ubuntu).

\`\`\`sh
npm install --omit=dev
node rowboat-server.cjs
\`\`\`

Data lives in ~/.rowboat (override with ROWBOAT_WORKDIR). The pairing token is
~/.rowboat/server-key; enable non-localhost access by setting
{"lanEnabled": true} in ~/.rowboat/config/server.json.
`,
);

console.log(`✅ headless rowboat-server built in ${out}`);
