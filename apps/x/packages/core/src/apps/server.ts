import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Server } from 'node:http';
import chokidar, { type FSWatcher } from 'chokidar';
import express from 'express';
import { RowboatAppManifestSchema, type RowboatAppManifest } from '@x/shared/dist/rowboat-app.js';
import {
    APPS_DIR,
    APPS_PORT,
    APPS_HOST_SUFFIX,
    CONTROL_HOST,
    FOLDER_SLUG_RE,
    MAX_DATA_FILE_BYTES,
    appOrigin,
} from './constants.js';

// Rowboat Apps server (spec §6–§7). Adapted from the deleted local-sites
// server: one HTTP server on 127.0.0.1:3210, routing by Host header to
// per-app origins (<slug>.apps.localhost). Serves static files from each
// app's dist/ and the same-origin Host API under /_rowboat/*.

const RELOAD_DEBOUNCE_MS = 140;
const EVENTS_RETRY_MS = 1000;
const EVENTS_HEARTBEAT_MS = 15000;

const HOST_RE = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.apps\.localhost$/;

const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.map', '.mjs', '.svg', '.txt', '.xml']);
const MIME_TYPES: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.wasm': 'application/wasm',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.xml': 'application/xml; charset=utf-8',
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let server: Server | null = null;
// IPv6 loopback listener. REQUIRED on macOS: the OS resolver maps
// *.apps.localhost to ::1 (only), so Electron's iframe connects to [::1]:3210 —
// binding just 127.0.0.1 makes in-app requests fail (blank app) while external
// browsers succeed via their own IPv4 fallback.
let server6: Server | null = null;
let startPromise: Promise<void> | null = null;
let watcher: FSWatcher | null = null;
let serverError: string | null = null;
let currentTheme: 'light' | 'dark' = 'light';

// SSE clients per app slug.
const eventClients = new Map<string, Set<express.Response>>();
// Debounce timers keyed `<slug>|<area>`.
const reloadTimers = new Map<string, NodeJS.Timeout>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function sendError(res: express.Response, status: number, code: string, message: string): void {
    res.status(status).json({ error: { code, message } });
}

function appDirFor(slug: string): string {
    return path.join(APPS_DIR, slug);
}

function loadManifest(slug: string): { manifest?: RowboatAppManifest; error?: string } {
    try {
        const raw = fs.readFileSync(path.join(appDirFor(slug), 'rowboat-app.json'), 'utf-8');
        const parsed = RowboatAppManifestSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) {
            return { error: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ') };
        }
        return { manifest: parsed.data };
    } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * Normalize a requested path and confine it to `root`. Returns the absolute
 * path or null when the request escapes. (Carried over from local-sites'
 * resolveRequestedPath; dotfiles are allowed.)
 */
function confinePath(root: string, requestPath: string): string | null {
    const normalized = path.posix.normalize(requestPath);
    const relative = normalized.replace(/^\/+/, '');
    if (!relative || relative === '.' || relative.startsWith('..') || relative.includes('\0') || relative.includes('\\')) {
        return null;
    }
    const absolute = path.resolve(root, relative);
    if (absolute !== root && !absolute.startsWith(root + path.sep)) return null;
    return absolute;
}

function insideRoot(root: string, candidate: string): boolean {
    return candidate === root || candidate.startsWith(root + path.sep);
}

/** Realpath escape check for existing paths (symlink guard). */
function realpathEscapes(root: string, existingPath: string): boolean {
    try {
        const realRoot = fs.realpathSync(root);
        const real = fs.realpathSync(existingPath);
        return !insideRoot(realRoot, real);
    } catch {
        return true;
    }
}

function html503(res: express.Response, title: string, detail: string): void {
    res.status(503).setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:#666}
.card{max-width:520px;padding:24px;text-align:center}</style></head>
<body><div class="card"><h2>${title}</h2><p>${detail}</p></div></body></html>`);
}

// ---------------------------------------------------------------------------
// Bootstrap injection (§6.5)
// ---------------------------------------------------------------------------

const BOOTSTRAP = String.raw`<script>
(() => {
  let reloadRequested = false;
  let source = null;

  const scheduleReload = () => {
    if (reloadRequested) return;
    reloadRequested = true;
    try { source?.close(); } catch {}
    window.setTimeout(() => { window.location.reload(); }, 80);
  };

  const connect = () => {
    if (typeof EventSource === 'undefined') return;
    source = new EventSource(new URL('/_rowboat/events', window.location.origin).toString());
    source.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload?.type !== 'change') return;
        if (payload.area === 'data') {
          // Cancelable: apps that re-fetch data in place call preventDefault().
          const domEvent = new CustomEvent('rowboat:data-change', { cancelable: true, detail: { path: payload.path } });
          const proceed = window.dispatchEvent(domEvent);
          if (proceed) scheduleReload();
          return;
        }
        scheduleReload();
      } catch {}
    });
    window.addEventListener('beforeunload', () => { try { source?.close(); } catch {} }, { once: true });
  };
  connect();

  // Autosize is opt-in for inline embeds only (§6.5): the full-height app view
  // must keep normal page scrolling.
  const params = new URLSearchParams(window.location.search);
  if (params.get('__rowboat_embed') !== '1') return;
  if (window.parent === window || typeof window.parent?.postMessage !== 'function') return;

  const MIN_HEIGHT = 240;
  let animationFrameId = 0;
  let lastHeight = 0;

  const applyEmbeddedStyles = () => {
    if (document.documentElement) document.documentElement.style.overflowY = 'hidden';
    if (document.body) document.body.style.overflowY = 'hidden';
  };
  const measureHeight = () => {
    const root = document.documentElement, body = document.body;
    return Math.max(root?.scrollHeight ?? 0, root?.offsetHeight ?? 0, root?.clientHeight ?? 0,
      body?.scrollHeight ?? 0, body?.offsetHeight ?? 0, body?.clientHeight ?? 0);
  };
  const publishHeight = () => {
    animationFrameId = 0;
    applyEmbeddedStyles();
    const nextHeight = Math.max(MIN_HEIGHT, Math.ceil(measureHeight()));
    if (Math.abs(nextHeight - lastHeight) < 2) return;
    lastHeight = nextHeight;
    window.parent.postMessage({ type: 'rowboat:iframe-height', height: nextHeight, href: window.location.href }, '*');
  };
  const schedulePublish = () => {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    animationFrameId = requestAnimationFrame(publishHeight);
  };
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedulePublish) : null;
  if (resizeObserver && document.documentElement) resizeObserver.observe(document.documentElement);
  if (resizeObserver && document.body) resizeObserver.observe(document.body);
  const mutationObserver = new MutationObserver(schedulePublish);
  if (document.documentElement) {
    mutationObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  }
  window.addEventListener('load', schedulePublish);
  window.addEventListener('resize', schedulePublish);
  if (document.fonts?.addEventListener) document.fonts.addEventListener('loadingdone', schedulePublish);
  for (const delay of [0, 50, 150, 300, 600, 1200]) setTimeout(schedulePublish, delay);
  schedulePublish();
})();
</script>`;

function injectBootstrap(htmlContent: string): string {
    if (/<\/body>/i.test(htmlContent)) return htmlContent.replace(/<\/body>/i, `${BOOTSTRAP}\n</body>`);
    return `${htmlContent}\n${BOOTSTRAP}`;
}

// ---------------------------------------------------------------------------
// SSE (§6.5, §7.2)
// ---------------------------------------------------------------------------

function removeEventClient(slug: string, res: express.Response): void {
    const clients = eventClients.get(slug);
    if (!clients) return;
    clients.delete(res);
    if (clients.size === 0) eventClients.delete(slug);
}

function broadcast(slug: string, payload: Record<string, unknown>): void {
    const clients = eventClients.get(slug);
    if (!clients || clients.size === 0) return;
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of Array.from(clients)) {
        try {
            res.write(data);
        } catch {
            removeEventClient(slug, res);
        }
    }
}

function scheduleChangeBroadcast(slug: string, area: 'dist' | 'data', relPath: string): void {
    const key = `${slug}|${area}`;
    const existing = reloadTimers.get(key);
    if (existing) clearTimeout(existing);
    reloadTimers.set(key, setTimeout(() => {
        reloadTimers.delete(key);
        broadcast(slug, { type: 'change', area, path: relPath });
    }, RELOAD_DEBOUNCE_MS));
}

function handleEventsRequest(slug: string, req: express.Request, res: express.Response): void {
    const clients = eventClients.get(slug) ?? new Set<express.Response>();
    eventClients.set(slug, clients);
    clients.add(res);

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(`retry: ${EVENTS_RETRY_MS}\n`);
    res.write(`event: ready\ndata: {"ok":true}\n\n`);

    const heartbeat = setInterval(() => {
        try {
            res.write(`: keepalive ${Date.now()}\n\n`);
        } catch {
            clearInterval(heartbeat);
            removeEventClient(slug, res);
        }
    }, EVENTS_HEARTBEAT_MS);

    const cleanup = () => {
        clearInterval(heartbeat);
        removeEventClient(slug, res);
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
}

/** Renderer-reported theme (§7.1); broadcast to all connected apps (§7.2). */
export function setAppsTheme(theme: 'light' | 'dark'): void {
    if (theme === currentTheme) return;
    currentTheme = theme;
    for (const slug of eventClients.keys()) {
        broadcast(slug, { type: 'theme', theme });
    }
}

// ---------------------------------------------------------------------------
// Data API (§7.3)
// ---------------------------------------------------------------------------

export async function readBody(req: express.Request, limit: number): Promise<Buffer | null> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > limit) {
                resolve(null); // over limit
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

function contractFor(manifest: RowboatAppManifest, relPath: string) {
    return manifest.dataContracts.find((c) => path.posix.normalize(c.file) === relPath);
}

/**
 * Validate a payload against a data contract. Returns null when valid, else
 * the failure message naming the offending keys.
 */
export function checkDataContract(
    contract: { requiredKeys: string[]; nonEmptyArrayKeys: string[] },
    payload: unknown,
): string | null {
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        // Contracts describe top-level object keys; an array/None payload
        // cannot satisfy requiredKeys.
        if (contract.requiredKeys.length || contract.nonEmptyArrayKeys.length) {
            return 'payload must be a JSON object to satisfy the data contract';
        }
        return null;
    }
    const obj = payload as Record<string, unknown>;
    const missing = contract.requiredKeys.filter((k) => obj[k] === undefined || obj[k] === null);
    if (missing.length) return `missing required key(s): ${missing.join(', ')}`;
    const badArrays = contract.nonEmptyArrayKeys.filter((k) => !Array.isArray(obj[k]) || (obj[k] as unknown[]).length === 0);
    if (badArrays.length) return `key(s) must be non-empty arrays: ${badArrays.join(', ')}`;
    return null;
}

async function handleDataApi(
    slug: string,
    manifest: RowboatAppManifest,
    req: express.Request,
    res: express.Response,
    pathname: string,
): Promise<void> {
    const dataRoot = path.join(appDirFor(slug), 'data');

    // GET /_rowboat/data?list=<dir> — non-recursive listing.
    if (pathname === '/_rowboat/data' && req.method === 'GET') {
        const listParam = typeof req.query.list === 'string' ? req.query.list : '';
        const dirRel = listParam === '' || listParam === '.' ? '.' : listParam;
        const abs = dirRel === '.' ? dataRoot : confinePath(dataRoot, dirRel);
        if (!abs) return sendError(res, 403, 'forbidden_path', 'path escapes data/');
        let entries: Array<{ path: string; kind: 'file' | 'dir'; size: number; mtime: string }> = [];
        try {
            if (realpathEscapes(dataRoot, abs)) return sendError(res, 403, 'forbidden_path', 'path escapes data/');
            const dirents = await fsp.readdir(abs, { withFileTypes: true });
            entries = await Promise.all(dirents.map(async (d) => {
                const p = path.join(abs, d.name);
                const stat = await fsp.stat(p).catch(() => null);
                const rel = path.posix.join(dirRel === '.' ? '' : dirRel, d.name);
                return {
                    path: rel,
                    kind: (d.isDirectory() ? 'dir' : 'file') as 'file' | 'dir',
                    size: stat?.size ?? 0,
                    mtime: stat ? new Date(stat.mtimeMs).toISOString() : '',
                };
            }));
        } catch {
            entries = []; // missing dir → empty, not error (§7.3)
        }
        res.json({ entries });
        return;
    }

    // File operations: /_rowboat/data/<path>
    const relRaw = pathname.slice('/_rowboat/data/'.length);
    let rel: string;
    try {
        rel = decodeURIComponent(relRaw);
    } catch {
        return sendError(res, 400, 'bad_request', 'malformed path encoding');
    }
    const relNorm = path.posix.normalize(rel);
    const abs = confinePath(dataRoot, relNorm);
    if (!abs) return sendError(res, 403, 'forbidden_path', 'path escapes data/');

    if (req.method === 'GET') {
        try {
            const stat = await fsp.stat(abs);
            if (!stat.isFile()) return sendError(res, 404, 'not_found', 'no such file');
            if (realpathEscapes(dataRoot, abs)) return sendError(res, 403, 'forbidden_path', 'symlink escapes data/');
            res.status(200);
            res.setHeader('Content-Type', MIME_TYPES[path.extname(abs).toLowerCase()] ?? 'application/octet-stream');
            res.setHeader('Cache-Control', 'no-store');
            fs.createReadStream(abs).pipe(res);
        } catch {
            sendError(res, 404, 'not_found', 'no such file');
        }
        return;
    }

    if (req.method === 'PUT') {
        const body = await readBody(req, MAX_DATA_FILE_BYTES);
        if (body === null) return sendError(res, 413, 'too_large', `body exceeds ${MAX_DATA_FILE_BYTES} bytes`);

        const contract = contractFor(manifest, relNorm);
        if (contract) {
            let payload: unknown;
            try {
                payload = JSON.parse(body.toString('utf-8'));
            } catch {
                return sendError(res, 422, 'contract_violation', `${relNorm} has a data contract; body must be valid JSON`);
            }
            const violation = checkDataContract(contract, payload);
            if (violation) {
                return sendError(res, 422, 'contract_violation', `${relNorm}: ${violation}. Last-good data is untouched — do not retry with a different shape.`);
            }
        }

        // Guard against writing through a symlinked parent that escapes data/.
        const parent = path.dirname(abs);
        await fsp.mkdir(parent, { recursive: true });
        if (realpathEscapes(dataRoot, parent)) return sendError(res, 403, 'forbidden_path', 'path escapes data/');

        const tmp = `${abs}.tmp-${crypto.randomBytes(4).toString('hex')}`;
        await fsp.writeFile(tmp, body);
        await fsp.rename(tmp, abs);
        res.json({ ok: true, size: body.length });
        return;
    }

    if (req.method === 'DELETE') {
        try {
            const stat = await fsp.stat(abs);
            if (stat.isDirectory()) return sendError(res, 400, 'is_directory', 'V1 deletes files only');
            await fsp.unlink(abs);
            res.json({ ok: true });
        } catch {
            sendError(res, 404, 'not_found', 'no such file');
        }
        return;
    }

    sendError(res, 405, 'method_not_allowed', `${req.method} not supported on data paths`);
}

// ---------------------------------------------------------------------------
// Host API dispatch (§7)
// ---------------------------------------------------------------------------

// M2 endpoints (§7.4–7.7) register here (tools/fetch/llm/copilot).
type HostApiHandler = (
    slug: string,
    manifest: RowboatAppManifest,
    req: express.Request,
    res: express.Response,
) => Promise<void>;
const extraHostApiRoutes = new Map<string, HostApiHandler>();

/** Register an additional POST /_rowboat/<name> endpoint (used by M2 wiring). */
export function registerHostApiRoute(pathname: string, handler: HostApiHandler): void {
    extraHostApiRoutes.set(pathname, handler);
}

async function handleHostApi(
    slug: string,
    manifest: RowboatAppManifest,
    req: express.Request,
    res: express.Response,
    pathname: string,
): Promise<void> {
    // Anti-CSRF (D17): every non-GET request needs the custom header AND a
    // matching Origin. GETs are exempt (side-effect-free; EventSource cannot
    // send custom headers).
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        if (req.headers['x-rowboat-app'] === undefined) {
            return sendError(res, 403, 'missing_app_header', 'non-GET /_rowboat requests must set X-Rowboat-App: 1');
        }
        const origin = req.headers.origin;
        if (typeof origin !== 'string' || origin.toLowerCase() !== appOrigin(slug)) {
            return sendError(res, 403, 'cross_origin_rejected', 'Origin must be present and equal to the app\'s own origin');
        }
    }

    if (pathname === '/_rowboat/app' && req.method === 'GET') {
        res.json({
            name: manifest.name,
            version: manifest.version,
            folder: slug,
            description: manifest.description,
            theme: currentTheme,
        });
        return;
    }

    if (pathname === '/_rowboat/events' && req.method === 'GET') {
        handleEventsRequest(slug, req, res);
        return;
    }

    if (pathname === '/_rowboat/data' || pathname.startsWith('/_rowboat/data/')) {
        await handleDataApi(slug, manifest, req, res, pathname);
        return;
    }

    const extra = extraHostApiRoutes.get(pathname);
    if (extra) {
        // All registered endpoints are POST-only (§7.4–7.7). REQUIRED: GETs are
        // exempt from the D17 anti-CSRF checks, so a GET must never reach them.
        if (req.method !== 'POST') {
            return sendError(res, 405, 'method_not_allowed', `${pathname} accepts POST only`);
        }
        await extra(slug, manifest, req, res);
        return;
    }

    // Reserved paths (§7.8) and anything unknown.
    sendError(res, 404, 'unknown_endpoint', `no such endpoint: ${pathname}`);
}

// ---------------------------------------------------------------------------
// Static serving (§6.3)
// ---------------------------------------------------------------------------

async function respondWithFile(res: express.Response, filePath: string, method: string): Promise<void> {
    const extension = path.extname(filePath).toLowerCase();
    const mimeType = MIME_TYPES[extension] || 'application/octet-stream';
    const stats = await fsp.stat(filePath);

    res.status(200);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', String(stats.size));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');

    if (method === 'HEAD') {
        res.end();
        return;
    }

    if (TEXT_EXTENSIONS.has(extension)) {
        let text = await fsp.readFile(filePath, 'utf8');
        if (extension === '.html') text = injectBootstrap(text);
        res.setHeader('Content-Length', String(Buffer.byteLength(text)));
        res.end(text);
        return;
    }

    res.end(await fsp.readFile(filePath));
}

async function handleStatic(
    slug: string,
    manifest: RowboatAppManifest,
    req: express.Request,
    res: express.Response,
    pathname: string,
): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendError(res, 405, 'method_not_allowed', 'static paths accept GET/HEAD only');
    }

    const distRoot = path.join(appDirFor(slug), 'dist');
    if (!fs.existsSync(distRoot) || !fs.statSync(distRoot).isDirectory()) {
        return html503(res, 'App has no built output', `“${manifest.name}” has no dist/ directory yet. The copilot writes browser-ready files into dist/.`);
    }

    const entryRel = manifest.entry;
    const requestPath = pathname === '/' ? `/${entryRel}` : pathname;
    const resolved = confinePath(distRoot, decodeURIComponent(requestPath));
    if (!resolved) return sendError(res, 400, 'bad_path', 'invalid path');

    const serveChecked = async (p: string) => {
        if (realpathEscapes(distRoot, p)) {
            sendError(res, 403, 'forbidden_path', 'path escapes dist/');
            return;
        }
        await respondWithFile(res, p, req.method);
    };

    if (fs.existsSync(resolved)) {
        const stat = fs.statSync(resolved);
        if (stat.isDirectory()) {
            const indexPath = path.join(resolved, 'index.html');
            if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
                await serveChecked(indexPath);
                return;
            }
        } else if (stat.isFile()) {
            await serveChecked(resolved);
            return;
        }
    }

    // Extensionless miss → SPA fallback to the manifest entry (§6.3).
    if (!path.extname(resolved)) {
        const entryAbs = confinePath(distRoot, `/${entryRel}`);
        if (entryAbs && fs.existsSync(entryAbs) && fs.statSync(entryAbs).isFile()) {
            await serveChecked(entryAbs);
            return;
        }
        return html503(res, 'App entry not found', `dist/${entryRel} does not exist.`);
    }

    sendError(res, 404, 'not_found', 'asset not found');
}

// ---------------------------------------------------------------------------
// Router (§6.2)
// ---------------------------------------------------------------------------

function createApp(): express.Express {
    const appServer = express();
    appServer.disable('x-powered-by');

    appServer.use((req, res) => {
        void (async () => {
            const rawHost = (req.headers.host ?? '').split(':')[0].toLowerCase();
            const pathname = (req.url.split('?')[0] || '/');

            // Control host (§6.4)
            if (rawHost === CONTROL_HOST) {
                if (pathname === '/health' && req.method === 'GET') {
                    res.json({ ok: true, appsDir: APPS_DIR, port: APPS_PORT });
                    return;
                }
                sendError(res, 404, 'not_found', 'control host serves no app content');
                return;
            }

            // App hosts; anything else is the DNS-rebinding guard (§6.2 step 3).
            const match = HOST_RE.exec(rawHost);
            if (!match) {
                res.status(421).json({ error: { code: 'misdirected', message: `unrecognized host: ${rawHost}` } });
                return;
            }
            const slug = match[1];
            if (!FOLDER_SLUG_RE.test(slug) || !fs.existsSync(appDirFor(slug))) {
                sendError(res, 404, 'app_not_found', `no app folder named "${slug}"`);
                return;
            }

            const { manifest, error } = loadManifest(slug);
            if (!manifest) {
                html503(res, 'Invalid app', `“${slug}” has a missing or invalid rowboat-app.json: ${error ?? 'unknown error'}`);
                return;
            }

            if (pathname === '/_rowboat' || pathname.startsWith('/_rowboat/')) {
                await handleHostApi(slug, manifest, req, res, pathname);
                return;
            }
            await handleStatic(slug, manifest, req, res, pathname);
        })().catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            if (!res.headersSent) sendError(res, 500, 'internal_error', message);
        });
    });

    return appServer;
}

// ---------------------------------------------------------------------------
// Watcher (§6.5)
// ---------------------------------------------------------------------------

function slugFromAbsolutePath(absolutePath: string): { slug: string; rel: string } | null {
    const relative = path.relative(APPS_DIR, absolutePath);
    if (!relative || relative === '.' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    const segments = relative.split(path.sep);
    const slug = segments[0];
    if (!slug || !FOLDER_SLUG_RE.test(slug)) return null;
    return { slug, rel: segments.slice(1).join('/') };
}

async function startWatcher(): Promise<void> {
    if (watcher) return;
    const w = chokidar.watch(APPS_DIR, {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 180, pollInterval: 50 },
    });
    w.on('all', (eventName, absolutePath) => {
        if (!['add', 'addDir', 'change', 'unlink', 'unlinkDir'].includes(eventName)) return;
        const hit = slugFromAbsolutePath(absolutePath);
        if (!hit || hit.rel.endsWith('.tmp') || /\.tmp-[0-9a-f]+$/.test(hit.rel)) return;
        const area: 'dist' | 'data' = hit.rel === 'data' || hit.rel.startsWith('data/') ? 'data' : 'dist';
        scheduleChangeBroadcast(hit.slug, area, hit.rel);
    });
    w.on('error', (error: unknown) => {
        console.error('[Apps] watcher error:', error);
    });
    watcher = w;
}

// ---------------------------------------------------------------------------
// Lifecycle (§6.1)
// ---------------------------------------------------------------------------

export function getServerStatus(): { running: boolean; error?: string } {
    return server ? { running: true } : { running: false, ...(serverError ? { error: serverError } : {}) };
}

let lagMonitor: NodeJS.Timeout | null = null;

/**
 * Event-loop lag monitor: the apps server shares the main process with agent
 * runs, sync pipelines, etc. If the loop stalls, every open app hangs with it —
 * log stalls >300ms so "app went blank" reports can be tied to a culprit.
 */
function startLagMonitor(): void {
    if (lagMonitor) return;
    let last = Date.now();
    lagMonitor = setInterval(() => {
        const now = Date.now();
        const lag = now - last - 500;
        if (lag > 300) {
            console.warn(`[Apps] main event-loop stalled ~${lag}ms (apps server shares this loop — open apps hang during stalls)`);
        }
        last = now;
    }, 500);
    lagMonitor.unref?.();
}

export async function init(): Promise<void> {
    if (server) return;
    if (startPromise) return startPromise;

    startPromise = (async () => {
        try {
            await fsp.mkdir(APPS_DIR, { recursive: true });
            startLagMonitor();
            await startWatcher();
            const expressApp = createApp();
            const listenOn = (host: string) => new Promise<Server>((resolve, reject) => {
                const s = expressApp.listen(APPS_PORT, host, () => resolve(s));
                s.on('error', (error: NodeJS.ErrnoException) => reject(error));
            });
            // EADDRINUSE almost always means a previous Rowboat instance is
            // still shutting down and holding the port (quick relaunch). Retry
            // on the SAME port for a while — never scan for alternate ports
            // (§6.1), origins embed the port — instead of disabling apps for
            // the whole session on the first failure.
            for (let attempt = 1; ; attempt++) {
                try {
                    server = await listenOn('127.0.0.1');
                    serverError = null;
                    console.log(`[Apps] server on 127.0.0.1:${APPS_PORT} (host suffix ${APPS_HOST_SUFFIX}), dir ${APPS_DIR}`);
                    break;
                } catch (error) {
                    const code = (error as NodeJS.ErrnoException).code;
                    if (code !== 'EADDRINUSE') throw error;
                    if (attempt >= 15) throw new Error(`Port ${APPS_PORT} is already in use.`);
                    if (attempt === 1) console.warn(`[Apps] port ${APPS_PORT} in use — retrying (old instance still shutting down?)`);
                    await new Promise((r) => setTimeout(r, 1000));
                }
            }
            // Dual-stack loopback: also listen on ::1 (see server6 note above).
            // Best-effort — some machines have IPv6 disabled.
            await new Promise<void>((resolve) => {
                const s6 = expressApp.listen(APPS_PORT, '::1', () => {
                    server6 = s6;
                    resolve();
                });
                s6.on('error', (error: NodeJS.ErrnoException) => {
                    console.warn(`[Apps] IPv6 loopback listen failed (${error.code}); continuing IPv4-only`);
                    resolve();
                });
            });
        } catch (error) {
            serverError = error instanceof Error ? error.message : String(error);
            await shutdown();
            console.error('[Apps] server failed to start:', serverError);
        }
    })().finally(() => {
        startPromise = null;
    });

    return startPromise;
}

export async function shutdown(): Promise<void> {
    const w = watcher;
    watcher = null;
    if (w) await w.close();

    for (const timer of reloadTimers.values()) clearTimeout(timer);
    reloadTimers.clear();

    for (const clients of eventClients.values()) {
        for (const res of clients) {
            try {
                res.end();
            } catch { /* ignore */ }
        }
    }
    eventClients.clear();

    const s6 = server6;
    server6 = null;
    if (s6) {
        await new Promise<void>((resolve) => {
            s6.close(() => resolve());
        });
    }

    const s = server;
    server = null;
    if (!s) return;
    await new Promise<void>((resolve, reject) => {
        s.close((error) => (error ? reject(error) : resolve()));
    });
}
