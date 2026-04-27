import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import chokidar, { type FSWatcher } from 'chokidar';
import express from 'express';
import { WorkDir } from '../config/config.js';
import { LOCAL_SITE_SCAFFOLD } from './templates.js';

export const LOCAL_SITES_PORT = 3210;
export const LOCAL_SITES_BASE_URL = `http://localhost:${LOCAL_SITES_PORT}`;

const LOCAL_SITES_DIR = path.join(WorkDir, 'sites');
const SITE_SLUG_RE = /^[a-z0-9][a-z0-9-_]*$/i;
const IFRAME_HEIGHT_MESSAGE = 'rowboat:iframe-height';
const SITE_RELOAD_MESSAGE = 'rowboat:site-changed';
const SITE_EVENTS_PATH = '__rowboat_events';
const SITE_RELOAD_DEBOUNCE_MS = 140;
const SITE_EVENTS_RETRY_MS = 1000;
const SITE_EVENTS_HEARTBEAT_MS = 15000;
const TEXT_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.map',
  '.mjs',
  '.svg',
  '.txt',
  '.xml',
]);
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
  '.xml': 'application/xml; charset=utf-8',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const IFRAME_AUTOSIZE_BOOTSTRAP = String.raw`<script>
(() => {
  const SITE_CHANGED_MESSAGE = '__ROWBOAT_SITE_CHANGED_MESSAGE__';
  const SITE_EVENTS_PATH = '__ROWBOAT_SITE_EVENTS_PATH__';
  let reloadRequested = false;
  let reloadSource = null;

  const getSiteSlug = () => {
    const match = window.location.pathname.match(/^\/sites\/([^/]+)/i);
    return match ? decodeURIComponent(match[1]) : null;
  };

  const scheduleReload = () => {
    if (reloadRequested) return;
    reloadRequested = true;
    try {
      reloadSource?.close();
    } catch {
      // ignore close failures
    }
    window.setTimeout(() => {
      window.location.reload();
    }, 80);
  };

  const connectLiveReload = () => {
    const siteSlug = getSiteSlug();
    if (!siteSlug || typeof EventSource === 'undefined') return;

    const streamUrl = new URL('/sites/' + encodeURIComponent(siteSlug) + '/' + SITE_EVENTS_PATH, window.location.origin);
    const source = new EventSource(streamUrl.toString());
    reloadSource = source;

    source.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload?.type === SITE_CHANGED_MESSAGE) {
          scheduleReload();
        }
      } catch {
        // ignore malformed payloads
      }
    });

    window.addEventListener('beforeunload', () => {
      try {
        source.close();
      } catch {
        // ignore close failures
      }
    }, { once: true });
  };

  connectLiveReload();

  if (window.parent === window || typeof window.parent?.postMessage !== 'function') return;

  const MESSAGE_TYPE = '__ROWBOAT_IFRAME_HEIGHT_MESSAGE__';
  const MIN_HEIGHT = 240;
  let animationFrameId = 0;
  let lastHeight = 0;

  const applyEmbeddedStyles = () => {
    const root = document.documentElement;
    if (root) root.style.overflowY = 'hidden';
    if (document.body) document.body.style.overflowY = 'hidden';
  };

  const measureHeight = () => {
    const root = document.documentElement;
    const body = document.body;
    return Math.max(
      root?.scrollHeight ?? 0,
      root?.offsetHeight ?? 0,
      root?.clientHeight ?? 0,
      body?.scrollHeight ?? 0,
      body?.offsetHeight ?? 0,
      body?.clientHeight ?? 0,
    );
  };

  const publishHeight = () => {
    animationFrameId = 0;
    applyEmbeddedStyles();
    const nextHeight = Math.max(MIN_HEIGHT, Math.ceil(measureHeight()));
    if (Math.abs(nextHeight - lastHeight) < 2) return;
    lastHeight = nextHeight;
    window.parent.postMessage({
      type: MESSAGE_TYPE,
      height: nextHeight,
      href: window.location.href,
    }, '*');
  };

  const schedulePublish = () => {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    animationFrameId = requestAnimationFrame(publishHeight);
  };

  const resizeObserver = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(schedulePublish)
    : null;
  if (resizeObserver && document.documentElement) resizeObserver.observe(document.documentElement);
  if (resizeObserver && document.body) resizeObserver.observe(document.body);

  const mutationObserver = new MutationObserver(schedulePublish);
  if (document.documentElement) {
    mutationObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  }

  window.addEventListener('load', schedulePublish);
  window.addEventListener('resize', schedulePublish);

  if (document.fonts?.addEventListener) {
    document.fonts.addEventListener('loadingdone', schedulePublish);
  }

  for (const delay of [0, 50, 150, 300, 600, 1200]) {
    setTimeout(schedulePublish, delay);
  }

  schedulePublish();
})();
</script>`;

let localSitesServer: Server | null = null;
let startPromise: Promise<void> | null = null;
let localSitesWatcher: FSWatcher | null = null;
const siteEventClients = new Map<string, Set<express.Response>>();
const siteReloadTimers = new Map<string, NodeJS.Timeout>();

function isSafeSiteSlug(siteSlug: string): boolean {
  return SITE_SLUG_RE.test(siteSlug);
}

function resolveSiteDir(siteSlug: string): string | null {
  if (!isSafeSiteSlug(siteSlug)) return null;
  return path.join(LOCAL_SITES_DIR, siteSlug);
}

function resolveRequestedPath(siteDir: string, requestPath: string): string | null {
  const candidate = requestPath === '/' ? '/index.html' : requestPath;
  const normalized = path.posix.normalize(candidate);
  const relativePath = normalized.replace(/^\/+/, '');

  if (!relativePath || relativePath === '.' || relativePath.startsWith('..') || relativePath.includes('\0')) {
    return null;
  }

  const absolutePath = path.resolve(siteDir, relativePath);
  if (!absolutePath.startsWith(siteDir + path.sep) && absolutePath !== siteDir) {
    return null;
  }

  return absolutePath;
}

function getRequestPath(req: express.Request): string {
  const rawPath = req.url.split('?')[0] || '/';
  return rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
}

function listLocalSites(): Array<{ slug: string; url: string }> {
  if (!fs.existsSync(LOCAL_SITES_DIR)) return [];

  return fs.readdirSync(LOCAL_SITES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isSafeSiteSlug(entry.name))
    .map((entry) => ({
      slug: entry.name,
      url: `${LOCAL_SITES_BASE_URL}/sites/${entry.name}/`,
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

function isPathInsideRoot(rootPath: string, candidatePath: string): boolean {
  return candidatePath === rootPath || candidatePath.startsWith(rootPath + path.sep);
}

async function writeIfMissing(filePath: string, content: string): Promise<void> {
  try {
    await fsp.access(filePath);
  } catch {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, content, 'utf8');
  }
}

async function ensureLocalSiteScaffold(): Promise<void> {
  await fsp.mkdir(LOCAL_SITES_DIR, { recursive: true });

  await Promise.all(
    Object.entries(LOCAL_SITE_SCAFFOLD).map(([relativePath, content]) =>
      writeIfMissing(path.join(LOCAL_SITES_DIR, relativePath), content),
    ),
  );
}

function injectIframeAutosizeBootstrap(html: string): string {
  const bootstrap = IFRAME_AUTOSIZE_BOOTSTRAP
    .replace('__ROWBOAT_IFRAME_HEIGHT_MESSAGE__', IFRAME_HEIGHT_MESSAGE)
    .replace('__ROWBOAT_SITE_CHANGED_MESSAGE__', SITE_RELOAD_MESSAGE)
    .replace('__ROWBOAT_SITE_EVENTS_PATH__', SITE_EVENTS_PATH)
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${bootstrap}\n</body>`)
  }
  return `${html}\n${bootstrap}`
}

function getSiteSlugFromAbsolutePath(absolutePath: string): string | null {
  const relativePath = path.relative(LOCAL_SITES_DIR, absolutePath);
  if (!relativePath || relativePath === '.' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return null;
  }

  const [siteSlug] = relativePath.split(path.sep);
  return siteSlug && isSafeSiteSlug(siteSlug) ? siteSlug : null;
}

function removeSiteEventClient(siteSlug: string, res: express.Response): void {
  const clients = siteEventClients.get(siteSlug);
  if (!clients) return;
  clients.delete(res);
  if (clients.size === 0) {
    siteEventClients.delete(siteSlug);
  }
}

function broadcastSiteReload(siteSlug: string, changedPath: string): void {
  const clients = siteEventClients.get(siteSlug);
  if (!clients || clients.size === 0) return;

  const payload = JSON.stringify({
    type: SITE_RELOAD_MESSAGE,
    siteSlug,
    changedPath,
    at: Date.now(),
  });

  for (const res of Array.from(clients)) {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch {
      removeSiteEventClient(siteSlug, res);
    }
  }
}

function scheduleSiteReload(siteSlug: string, changedPath: string): void {
  const existingTimer = siteReloadTimers.get(siteSlug);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    siteReloadTimers.delete(siteSlug);
    broadcastSiteReload(siteSlug, changedPath);
  }, SITE_RELOAD_DEBOUNCE_MS);

  siteReloadTimers.set(siteSlug, timer);
}

async function startSiteWatcher(): Promise<void> {
  if (localSitesWatcher) return;

  const watcher = chokidar.watch(LOCAL_SITES_DIR, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 180,
      pollInterval: 50,
    },
  });

  watcher
    .on('all', (eventName, absolutePath) => {
      if (!['add', 'addDir', 'change', 'unlink', 'unlinkDir'].includes(eventName)) return;

      const siteSlug = getSiteSlugFromAbsolutePath(absolutePath);
      if (!siteSlug) return;

      const siteRoot = path.join(LOCAL_SITES_DIR, siteSlug);
      const relativePath = path.relative(siteRoot, absolutePath);
      const normalizedPath = !relativePath || relativePath === '.'
        ? '.'
        : relativePath.split(path.sep).join('/');

      scheduleSiteReload(siteSlug, normalizedPath);
    })
    .on('error', (error: unknown) => {
      console.error('[LocalSites] Watcher error:', error);
    });

  localSitesWatcher = watcher;
}

function handleSiteEventsRequest(req: express.Request, res: express.Response): void {
  const siteSlugParam = req.params.siteSlug;
  const siteSlug = Array.isArray(siteSlugParam) ? siteSlugParam[0] : siteSlugParam;
  if (!siteSlug || !isSafeSiteSlug(siteSlug)) {
    res.status(400).json({ error: 'Invalid site slug' });
    return;
  }

  const clients = siteEventClients.get(siteSlug) ?? new Set<express.Response>();
  siteEventClients.set(siteSlug, clients);
  clients.add(res);

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write(`retry: ${SITE_EVENTS_RETRY_MS}\n`);
  res.write(`event: ready\ndata: {"ok":true}\n\n`);

  const heartbeat = setInterval(() => {
    try {
      res.write(`: keepalive ${Date.now()}\n\n`);
    } catch {
      clearInterval(heartbeat);
      removeSiteEventClient(siteSlug, res);
    }
  }, SITE_EVENTS_HEARTBEAT_MS);

  const cleanup = () => {
    clearInterval(heartbeat);
    removeSiteEventClient(siteSlug, res);
  };

  req.on('close', cleanup);
  res.on('close', cleanup);
}

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
    if (extension === '.html') {
      text = injectIframeAutosizeBootstrap(text);
    }
    res.setHeader('Content-Length', String(Buffer.byteLength(text)));
    res.end(text);
    return;
  }

  const data = await fsp.readFile(filePath);
  res.end(data);
}

async function sendSiteResponse(req: express.Request, res: express.Response): Promise<void> {
  const siteSlugParam = req.params.siteSlug;
  const siteSlug = Array.isArray(siteSlugParam) ? siteSlugParam[0] : siteSlugParam;
  const siteDir = siteSlug ? resolveSiteDir(siteSlug) : null;
  if (!siteDir) {
    res.status(400).json({ error: 'Invalid site slug' });
    return;
  }

  if (!fs.existsSync(siteDir) || !fs.statSync(siteDir).isDirectory()) {
    res.status(404).json({ error: 'Site not found' });
    return;
  }

  const realSitesDir = fs.realpathSync(LOCAL_SITES_DIR);
  const realSiteDir = fs.realpathSync(siteDir);
  if (!isPathInsideRoot(realSitesDir, realSiteDir)) {
    res.status(403).json({ error: 'Site path escapes sites directory' });
    return;
  }

  const requestedPath = resolveRequestedPath(siteDir, getRequestPath(req));
  if (!requestedPath) {
    res.status(400).json({ error: 'Invalid site path' });
    return;
  }

  const requestedExt = path.extname(requestedPath);
  if (fs.existsSync(requestedPath)) {
    const stat = fs.statSync(requestedPath);
    if (stat.isDirectory()) {
      const indexPath = path.join(requestedPath, 'index.html');
      if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
        const realIndexPath = fs.realpathSync(indexPath);
        if (!isPathInsideRoot(realSiteDir, realIndexPath)) {
          res.status(403).json({ error: 'Site path escapes root' });
          return;
        }
        await respondWithFile(res, indexPath, req.method);
        return;
      }
    } else if (stat.isFile()) {
      const realRequestedPath = fs.realpathSync(requestedPath);
      if (!isPathInsideRoot(realSiteDir, realRequestedPath)) {
        res.status(403).json({ error: 'Site path escapes root' });
        return;
      }
      await respondWithFile(res, requestedPath, req.method);
      return;
    }
  }

  if (requestedExt) {
    res.status(404).json({ error: 'Asset not found' });
    return;
  }

  const spaFallback = path.join(siteDir, 'index.html');
  if (!fs.existsSync(spaFallback) || !fs.statSync(spaFallback).isFile()) {
    res.status(404).json({ error: 'Site entrypoint not found' });
    return;
  }

  const realFallback = fs.realpathSync(spaFallback);
  if (!isPathInsideRoot(realSiteDir, realFallback)) {
    res.status(403).json({ error: 'Site path escapes root' });
    return;
  }

  await respondWithFile(res, spaFallback, req.method);
}

// --- Lightweight markdown-to-HTML converter for the /md-view/ endpoint ---

function markdownToHtml(md: string, filePath: string): string {
  const fileName = filePath.split('/').pop() || filePath;

  // Extract title from first heading or filename
  const titleMatch = md.match(/^#{1,6}\s+(.+)$/m);
  const pageTitle = titleMatch ? titleMatch[1].replace(/[*_`[\]()!]/g, '').trim() : fileName.replace(/\.md$/i, '');

  let html = escapeHtml(md);

  // Fenced code blocks (```...```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) =>
    `<pre><code class="language-${lang}">${code}</code></pre>`
  );

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headings
  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

  // Horizontal rules
  html = html.replace(/^---+$/gm, '<hr>');

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // Links and images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" />');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Blockquotes
  html = html.replace(/^&gt;\s?(.+)$/gm, '<blockquote>$1</blockquote>');

  // Unordered lists
  html = html.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');

  // Paragraphs — wrap remaining lines
  html = html.replace(/^(?!<[hupblo]|<li|<hr|<code|<pre|<blockquote)(.+)$/gm, '<p>$1</p>');

  // Collapse adjacent blockquotes
  html = html.replace(/<\/blockquote>\s*<blockquote>/g, '<br>');

  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li>[\s\S]*?<\/li>\s*)+)/g, '<ul>$1</ul>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(pageTitle)}</title>
<style>
  :root { --bg: #ffffff; --fg: #1a1a1a; --muted: #6b7280; --accent: #3b82f6; --border: #e5e7eb; --code-bg: #f3f4f6; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0a0a0a; --fg: #e5e5e5; --muted: #9ca3af; --accent: #60a5fa; --border: #374151; --code-bg: #1f2937; } }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 760px; margin: 0 auto; padding: 40px 24px; background: var(--bg); color: var(--fg); line-height: 1.7; }
  h1 { font-size: 2em; margin: 0.8em 0 0.4em; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
  h2 { font-size: 1.5em; margin: 0.8em 0 0.4em; }
  h3 { font-size: 1.25em; margin: 0.6em 0 0.3em; }
  h4, h5, h6 { font-size: 1em; margin: 0.5em 0 0.2em; }
  p { margin: 0.5em 0; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  strong { font-weight: 600; }
  blockquote { border-left: 3px solid var(--accent); padding: 0.5em 1em; margin: 0.5em 0; color: var(--muted); background: var(--code-bg); border-radius: 0 6px 6px 0; }
  code { font-family: 'SF Mono', 'Fira Code', monospace; background: var(--code-bg); padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
  pre { background: var(--code-bg); padding: 16px; border-radius: 8px; overflow-x: auto; margin: 1em 0; }
  pre code { background: none; padding: 0; }
  ul, ol { padding-left: 1.5em; margin: 0.5em 0; }
  li { margin: 0.25em 0; }
  hr { border: none; border-top: 1px solid var(--border); margin: 2em 0; }
  img { max-width: 100%; border-radius: 8px; margin: 0.5em 0; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid var(--border); padding: 8px 12px; text-align: left; }
  th { background: var(--code-bg); font-weight: 600; }
  .edit-bar { position: fixed; top: 12px; right: 12px; z-index: 10; }
  .edit-btn { display: inline-flex; align-items: center; gap: 4px; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--fg); font-size: 13px; cursor: pointer; transition: background 0.15s; }
  .edit-btn:hover { background: var(--code-bg); }
</style>
</head>
<body>
  <div class="edit-bar">
    <button class="edit-btn" onclick="window.location.href='rowboat://md-edit?path='+encodeURIComponent('${escapeHtml(filePath)}')">Edit Source</button>
  </div>
  ${html}
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function createLocalSitesApp(): express.Express {
  const app = express();

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      baseUrl: LOCAL_SITES_BASE_URL,
      sitesDir: LOCAL_SITES_DIR,
    });
  });

  app.get('/sites', (_req, res) => {
    res.json({
      sites: listLocalSites(),
    });
  });

  app.get(`/sites/:siteSlug/${SITE_EVENTS_PATH}`, (req, res) => {
    handleSiteEventsRequest(req, res);
  });

  app.use('/sites/:siteSlug', (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    void sendSiteResponse(req, res).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: message });
    });
  });

  // Workspace file serving — lets the embedded browser render any workspace file
  // via http://localhost:3210/workspace/<relative-path>
  app.use('/workspace/', (req, res) => {
    const relPath = req.path.replace(/^\/+/, '');
    const absPath = path.join(WorkDir, relPath);

    // Prevent path traversal
    if (!absPath.startsWith(WorkDir)) {
      res.status(403).json({ error: 'Path traversal not allowed' });
      return;
    }

    fs.promises.readFile(absPath).then((data) => {
      const ext = path.extname(absPath).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `inline; filename="${path.basename(absPath)}"`);
      res.send(data);
    }).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        res.status(404).json({ error: 'File not found' });
      } else if (err.code === 'EISDIR') {
        res.status(400).json({ error: 'Is a directory' });
      } else {
        res.status(500).json({ error: err.message });
      }
    });
  });

  // Markdown viewer — renders .md files as styled HTML in the embedded browser
  // via http://localhost:3210/md-view/<relative-path>
  app.get('/md-view/*', (req, res) => {
    const relPath = req.path.replace(/^\/+/, '');
    const absPath = path.join(WorkDir, relPath);

    if (!absPath.startsWith(WorkDir)) {
      res.status(403).json({ error: 'Path traversal not allowed' });
      return;
    }

    fs.promises.readFile(absPath, 'utf-8').then((md) => {
      const html = markdownToHtml(md, relPath);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    }).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        res.status(404).json({ error: 'File not found' });
      } else if (err.code === 'EISDIR') {
        res.status(400).json({ error: 'Is a directory' });
      } else {
        res.status(500).json({ error: err.message });
      }
    });
  });

  // Local file serving — lets the embedded browser view any local file
  // via http://localhost:3210/local-file?p=<url-encoded-absolute-path>
  // Resolves ~ to home directory. Only serves files with viewable extensions.
  const LOCAL_FILE_ALLOWED_EXTENSIONS = new Set([
    '.pdf', '.html', '.htm', '.svg',
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico',
    '.csv', '.json', '.xml', '.txt', '.md',
  ]);

  app.get('/local-file', (req, res) => {
    const rawPath = req.query.p as string;
    if (!rawPath) {
      res.status(400).json({ error: 'Missing ?p= parameter' });
      return;
    }

    // Resolve ~ to home directory
    const resolvedPath = rawPath.startsWith('~')
      ? path.join(os.homedir(), rawPath.slice(1).replace(/^\/+/, ''))
      : path.resolve(rawPath);

    // Only serve files with allowed extensions
    const ext = path.extname(resolvedPath).toLowerCase();
    if (!LOCAL_FILE_ALLOWED_EXTENSIONS.has(ext)) {
      res.status(403).json({ error: 'File type not supported' });
      return;
    }

    // Only serve regular files (no directories, symlinks are fine)
    fs.promises.stat(resolvedPath).then((stat) => {
      if (!stat.isFile()) {
        res.status(400).json({ error: 'Not a regular file' });
        return;
      }

      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `inline; filename="${path.basename(resolvedPath)}"`);
      fs.createReadStream(resolvedPath).pipe(res);
    }).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        res.status(404).json({ error: 'File not found' });
      } else {
        res.status(500).json({ error: err.message });
      }
    });
  });

  return app;
}

async function startServer(): Promise<void> {
  if (localSitesServer) return;

  const app = createLocalSitesApp();

  await new Promise<void>((resolve, reject) => {
    const server = app.listen(LOCAL_SITES_PORT, 'localhost', () => {
      localSitesServer = server;
      console.log('[LocalSites] Server starting.');
      console.log(`  Sites directory: ${LOCAL_SITES_DIR}`);
      console.log(`  Base URL: ${LOCAL_SITES_BASE_URL}`);
      resolve();
    });

    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        reject(new Error(`Port ${LOCAL_SITES_PORT} is already in use.`));
        return;
      }
      reject(error);
    });
  });
}

export async function init(): Promise<void> {
  if (localSitesServer) return;
  if (startPromise) return startPromise;

  startPromise = (async () => {
    try {
      await ensureLocalSiteScaffold();
      await startSiteWatcher();
      await startServer();
    } catch (error) {
      await shutdown();
      throw error;
    }
  })().finally(() => {
    startPromise = null;
  });

  return startPromise;
}

export async function shutdown(): Promise<void> {
  const watcher = localSitesWatcher;
  localSitesWatcher = null;
  if (watcher) {
    await watcher.close();
  }

  for (const timer of siteReloadTimers.values()) {
    clearTimeout(timer);
  }
  siteReloadTimers.clear();

  for (const clients of siteEventClients.values()) {
    for (const res of clients) {
      try {
        res.end();
      } catch {
        // ignore close failures
      }
    }
  }
  siteEventClients.clear();

  const server = localSitesServer;
  localSitesServer = null;
  if (!server) return;

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
