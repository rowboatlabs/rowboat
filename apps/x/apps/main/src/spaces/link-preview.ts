// OpenGraph unfurling for link cards in Spaces chat. Main fetches because
// the renderer can't cross-origin; the renderer decides WHICH links to
// unfurl (trusted domains only — this module never phones anywhere on its
// own). Failures are nulls, never errors: a card is decoration.

export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
}

const FETCH_TIMEOUT_MS = 8_000;
/** Read at most this much of the page — og tags live in <head>. */
const MAX_HTML_BYTES = 512 * 1024;
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 200;

const cache = new Map<string, { at: number; preview: LinkPreview | null }>();

function cacheGet(url: string): { preview: LinkPreview | null } | null {
  const hit = cache.get(url);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(url);
    return null;
  }
  return hit;
}

function cachePut(url: string, preview: LinkPreview | null) {
  // Insertion-ordered Map: evict the oldest entry once full.
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(url, { at: Date.now(), preview });
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** content of the first matching <meta property|name=... content=...> — attribute order varies in the wild. */
function metaContent(html: string, key: string): string | null {
  const attr = `(?:property|name)\\s*=\\s*["']${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`;
  const m =
    new RegExp(`<meta\\s[^>]*${attr}[^>]*?content\\s*=\\s*["']([^"']*)["'][^>]*>`, 'i').exec(html) ??
    new RegExp(`<meta\\s[^>]*?content\\s*=\\s*["']([^"']*)["'][^>]*${attr}[^>]*>`, 'i').exec(html);
  const value = m?.[1] ? decodeEntities(m[1]).trim() : '';
  return value.length > 0 ? value : null;
}

function clip(text: string | null, max: number): string | undefined {
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_HTML_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  void reader.cancel().catch(() => {});
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks));
}

export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreview | null> {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return null;
  }
  if (target.protocol !== 'https:') return null;
  const cached = cacheGet(target.href);
  if (cached) return cached.preview;

  let preview: LinkPreview | null = null;
  try {
    const res = await fetch(target.href, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        accept: 'text/html,application/xhtml+xml',
        // Some sites refuse UA-less requests outright.
        'user-agent': 'Mozilla/5.0 (compatible; Rowboat/1.0; link-preview)',
      },
    });
    const type = res.headers.get('content-type') ?? '';
    if (res.ok && /text\/html|application\/xhtml/i.test(type)) {
      const html = await readCapped(res);
      const title =
        metaContent(html, 'og:title') ??
        metaContent(html, 'twitter:title') ??
        (() => {
          const t = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];
          return t ? decodeEntities(t).trim() || null : null;
        })();
      const description = metaContent(html, 'og:description') ?? metaContent(html, 'twitter:description') ?? metaContent(html, 'description');
      const image = metaContent(html, 'og:image') ?? metaContent(html, 'twitter:image');
      // Redirects may have landed elsewhere; resolve relative images there.
      const base = res.url || target.href;
      let imageUrl: string | undefined;
      if (image) {
        try {
          const abs = new URL(image, base);
          if (abs.protocol === 'https:') imageUrl = abs.href;
        } catch {
          // unusable image address — card renders without one
        }
      }
      if (title || description) {
        preview = {
          url: target.href,
          title: clip(title, 200),
          description: clip(description, 300),
          imageUrl,
          siteName: clip(metaContent(html, 'og:site_name'), 100),
        };
      }
    }
  } catch {
    preview = null;
  }
  cachePut(target.href, preview);
  return preview;
}
