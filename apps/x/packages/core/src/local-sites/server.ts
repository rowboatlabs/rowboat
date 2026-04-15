import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { WorkDir } from '../config/config.js';
import { LOCAL_SITE_SCAFFOLD } from './templates.js';

export const LOCAL_SITES_PORT = 3210;
export const LOCAL_SITES_BASE_URL = `http://localhost:${LOCAL_SITES_PORT}`;

const LOCAL_SITES_DIR = path.join(WorkDir, 'sites');
const SITE_SLUG_RE = /^[a-z0-9][a-z0-9-_]*$/i;
const IFRAME_HEIGHT_MESSAGE = 'rowboat:iframe-height';
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
};
const IFRAME_AUTOSIZE_BOOTSTRAP = String.raw`<script>
(() => {
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
  const bootstrap = IFRAME_AUTOSIZE_BOOTSTRAP.replace('__ROWBOAT_IFRAME_HEIGHT_MESSAGE__', IFRAME_HEIGHT_MESSAGE)
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${bootstrap}\n</body>`)
  }
  return `${html}\n${bootstrap}`
}

async function respondWithFile(res: express.Response, filePath: string, method: string): Promise<void> {
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[extension] || 'application/octet-stream';
  const stats = await fsp.stat(filePath);

  res.status(200);
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Length', String(stats.size));
  res.setHeader('Cache-Control', extension === '.html' ? 'no-cache' : 'public, max-age=60');

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
    await ensureLocalSiteScaffold();
    await startServer();
  })().finally(() => {
    startPromise = null;
  });

  return startPromise;
}
