import fs from 'fs';
import path from 'path';
import { WorkDir } from '@x/core/dist/config/config.js';
import { MiniAppManifest } from '@x/shared/dist/mini-app.js';
import type { z } from 'zod';

type Manifest = z.infer<typeof MiniAppManifest>;

// All Mini Apps live under ~/.rowboat/apps/<id>/.
//   manifest.json   — MiniAppManifest
//   dist/           — static assets served via app://miniapp/<id>/
//   data.json       — latest agent output (read by the host)
const APPS_DIR = path.join(WorkDir, 'apps');

function appDir(id: string): string {
  return path.join(APPS_DIR, id);
}

/**
 * Canonical Mini App bridge shim, served at app://miniapp/__bridge__.js. Apps
 * include it with `<script src="/__bridge__.js"></script>` and code against
 * `window.rowboat`. This is the single source of truth for the bridge protocol
 * (kept in sync with the host in components/mini-app-frame.tsx + types.ts).
 */
export const MINIAPP_BRIDGE_JS = `
(function () {
  var data = null, dataLoaded = false, state = null, theme = 'dark';
  var dataCbs = [], stateCbs = [], themeCbs = [];
  var pending = {}, seq = 0;
  function post(msg) { parent.postMessage(msg, '*'); }
  // Apply the host theme to <html> so app CSS can use html.dark / html.light
  // (and native controls via color-scheme).
  function applyTheme(t) {
    theme = t === 'light' ? 'light' : 'dark';
    var el = document.documentElement;
    el.classList.remove('light', 'dark'); el.classList.add(theme);
    el.setAttribute('data-theme', theme);
    el.style.colorScheme = theme;
    themeCbs.forEach(function (cb) { try { cb(theme); } catch (_) {} });
  }
  function rpc(method, params) {
    var id = 'r' + (++seq);
    return new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      post({ type: 'rowboat:mini-app:rpc', id: id, method: method, params: params });
    });
  }
  // Apps are self-contained: data.json is a served sibling of index.html, loaded
  // via a relative fetch (same origin, no CORS). Rowboat does not inject it.
  function loadData() {
    return fetch('data.json', { cache: 'no-store' })
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (d) { data = d; dataLoaded = true; dataCbs.forEach(function (cb) { try { cb(data); } catch (_) {} }); return data; })
      .catch(function () { dataLoaded = true; dataCbs.forEach(function (cb) { try { cb(null); } catch (_) {} }); return null; });
  }
  window.addEventListener('message', function (e) {
    var m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'rowboat:mini-app:state') {
      state = m.state;
      stateCbs.forEach(function (cb) { try { cb(state); } catch (_) {} });
    } else if (m.type === 'rowboat:mini-app:theme') {
      applyTheme(m.theme);
    } else if (m.type === 'rowboat:mini-app:rpc-result') {
      var p = pending[m.id];
      if (p) { delete pending[m.id]; if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error || 'request failed')); }
    }
  });
  window.rowboat = {
    getData: function () { return data; },
    getTheme: function () { return theme; },
    onTheme: function (cb) { themeCbs.push(cb); try { cb(theme); } catch (_) {} return function () { var i = themeCbs.indexOf(cb); if (i >= 0) themeCbs.splice(i, 1); }; },
    onData: function (cb) { dataCbs.push(cb); if (dataLoaded) { try { cb(data); } catch (_) {} } return function () { var i = dataCbs.indexOf(cb); if (i >= 0) dataCbs.splice(i, 1); }; },
    refreshData: function () { return loadData(); },
    getState: function () { return state; },
    onState: function (cb) { stateCbs.push(cb); if (state !== null) { try { cb(state); } catch (_) {} } return function () { var i = stateCbs.indexOf(cb); if (i >= 0) stateCbs.splice(i, 1); }; },
    setState: function (patch) { state = Object.assign({}, state || {}, patch); post({ type: 'rowboat:mini-app:setState', patch: patch }); stateCbs.forEach(function (cb) { try { cb(state); } catch (_) {} }); },
    callAction: function (scope, tool, args) { return rpc('callAction', { scope: scope, tool: tool, args: args }); },
    searchTools: function (scope, query) { return rpc('searchTools', { scope: scope, query: query }); },
    isConnected: function (scope) { return rpc('isConnected', { scope: scope }); },
    connect: function (scope) { return rpc('connect', { scope: scope }); },
    // CORS-safe HTTP via the main process. Resolves to { ok, status, text, json }
    // (json is the parsed body when it's valid JSON, else null).
    fetch: function (url, opts) {
      return rpc('fetch', { url: url, method: (opts && opts.method), headers: (opts && opts.headers), body: (opts && opts.body) })
        .then(function (r) { var j = null; try { j = JSON.parse(r.text); } catch (_) {} r.json = j; return r; });
    },
    ready: function () { post({ type: 'rowboat:mini-app:ready' }); },
  };
  loadData();
})();
`;

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Seed/refresh built-in apps. Manifest + dist are managed (always overwritten so
 * built-in updates propagate); data.json is written only if missing so a
 * background agent's output is never clobbered.
 */
export function seedApps(apps: Array<{ manifest: Manifest; html: string; data?: unknown }>): { seeded: string[] } {
  const seeded: string[] = [];
  for (const app of apps) {
    const manifest = MiniAppManifest.parse(app.manifest);
    const dir = appDir(manifest.id);
    const distDir = path.join(dir, 'dist');
    ensureDir(distDir);
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(distDir, 'index.html'), app.html);
    const dataPath = path.join(dir, 'data.json');
    if (app.data !== undefined && !fs.existsSync(dataPath)) {
      fs.writeFileSync(dataPath, JSON.stringify(app.data, null, 2));
    }
    seeded.push(manifest.id);
  }
  return { seeded };
}

/** List installed app manifests (skips folders without a valid manifest). */
export function listApps(): { manifests: Manifest[] } {
  const manifests: Manifest[] = [];
  if (!fs.existsSync(APPS_DIR)) return { manifests };
  for (const entry of fs.readdirSync(APPS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(APPS_DIR, entry.name, 'manifest.json');
    try {
      const parsed = MiniAppManifest.parse(JSON.parse(fs.readFileSync(file, 'utf-8')));
      manifests.push(parsed);
    } catch {
      // skip folders without a valid manifest
    }
  }
  return { manifests };
}

/**
 * Proxy an HTTP request through the main process so Mini Apps can call
 * third-party APIs that don't send CORS headers (the sandboxed app:// origin
 * can't fetch them directly). GET/POST over http(s) only.
 */
export async function proxyFetch(input: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{ ok: boolean; status: number; statusText: string; text: string; error?: string }> {
  try {
    const parsed = new URL(input.url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, status: 0, statusText: '', text: '', error: 'Only http(s) URLs are allowed.' };
    }
    const method = (input.method || 'GET').toUpperCase();
    const res = await fetch(input.url, {
      method,
      headers: input.headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : input.body,
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, statusText: res.statusText, text };
  } catch (e) {
    return { ok: false, status: 0, statusText: '', text: '', error: e instanceof Error ? e.message : String(e) };
  }
}

/** Read an app's latest data.json (agent output), or null if absent/invalid. */
export function getAppData(id: string): { data: unknown | null } {
  try {
    const raw = fs.readFileSync(path.join(appDir(id), 'data.json'), 'utf-8');
    return { data: JSON.parse(raw) };
  } catch {
    return { data: null };
  }
}

/**
 * Resolve app://miniapp/<id>/<rel> to an absolute file path under the app's dist
 * dir, guarding against path traversal. Returns null if outside the dist root.
 */
export function resolveMiniAppAsset(id: string, relPath: string): string | null {
  const distRoot = path.resolve(appDir(id), 'dist');
  const clean = relPath.replace(/^\/+/, '') || 'index.html';
  const abs = path.resolve(distRoot, clean);
  if (abs !== distRoot && !abs.startsWith(distRoot + path.sep)) return null;
  return abs;
}
