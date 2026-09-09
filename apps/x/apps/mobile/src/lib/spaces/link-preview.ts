// OpenGraph unfurling for link cards (port of core/spaces/link-preview.ts —
// RN fetch has no CORS wall, so the phone fetches pages directly). Failures
// are nulls, never errors: a card is decoration.

export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
  favicon?: string;
}

const FETCH_TIMEOUT_MS = 8_000;
/** og tags live in <head> — regex only the front of the page. */
const MAX_HTML_CHARS = 512 * 1024;
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 200;

const cache = new Map<string, { at: number; preview: LinkPreview | null }>();

/** The message's links worth a card, in order — skips code and image embeds. */
export const MAX_UNFURLS = 3;
export function previewUrls(body: string): string[] {
  const stripped = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  const found: string[] = [];
  for (const m of stripped.matchAll(/https:\/\/[^\s<>)"'\]]+/g)) {
    const url = m[0]!.replace(/[.,;:!?]+$/, '');
    if (/\.(png|jpe?g|gif|webp|heic|svg)(\?|$)/i.test(url)) continue;
    if (!found.includes(url)) found.push(url);
    if (found.length >= MAX_UNFURLS) break;
  }
  return found;
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

function metaContent(html: string, key: string): string | null {
  const attr = `(?:property|name)\\s*=\\s*["']${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`;
  const m =
    new RegExp(`<meta\\s[^>]*${attr}[^>]*?content\\s*=\\s*["']([^"']*)["'][^>]*>`, 'i').exec(html) ??
    new RegExp(`<meta\\s[^>]*?content\\s*=\\s*["']([^"']*)["'][^>]*${attr}[^>]*>`, 'i').exec(html);
  const value = m?.[1] ? decodeEntities(m[1]).trim() : '';
  return value.length > 0 ? value : null;
}

function faviconFor(html: string, base: string): string | undefined {
  const rel = `rel\\s*=\\s*["'](?:shortcut icon|icon|apple-touch-icon)["']`;
  const m =
    new RegExp(`<link\\s[^>]*${rel}[^>]*?href\\s*=\\s*["']([^"']+)["'][^>]*>`, 'i').exec(html) ??
    new RegExp(`<link\\s[^>]*?href\\s*=\\s*["']([^"']+)["'][^>]*${rel}[^>]*>`, 'i').exec(html);
  const href = m?.[1] ? decodeEntities(m[1]).trim() : null;
  if (href) {
    try {
      const abs = new URL(href, base);
      if (abs.protocol === 'https:') return abs.href;
    } catch {
      // unusable icon address — fall through
    }
  }
  try {
    return new URL('/favicon.ico', base).href;
  } catch {
    return undefined;
  }
}

function clip(text: string | null, max: number): string | undefined {
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreview | null> {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return null;
  }
  if (target.protocol !== 'https:') return null;
  const hit = cache.get(target.href);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.preview;

  let preview: LinkPreview | null = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(target.href, {
      signal: controller.signal,
      headers: { accept: 'text/html,application/xhtml+xml' },
    });
    const type = res.headers.get('content-type') ?? '';
    if (res.ok && /text\/html|application\/xhtml/i.test(type)) {
      const html = (await res.text()).slice(0, MAX_HTML_CHARS);
      const title =
        metaContent(html, 'og:title') ??
        metaContent(html, 'twitter:title') ??
        (() => {
          const t = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];
          return t ? decodeEntities(t).trim() || null : null;
        })();
      const description =
        metaContent(html, 'og:description') ?? metaContent(html, 'twitter:description') ?? metaContent(html, 'description');
      const image = metaContent(html, 'og:image') ?? metaContent(html, 'twitter:image');
      const base = res.url || target.href;
      let imageUrl: string | undefined;
      if (image) {
        try {
          const abs = new URL(image, base);
          if (abs.protocol === 'https:') imageUrl = abs.href;
        } catch {
          // card renders without an image
        }
      }
      if (title || description) {
        preview = {
          url: target.href,
          title: clip(title, 200),
          description: clip(description, 300),
          imageUrl,
          siteName: clip(metaContent(html, 'og:site_name'), 100),
          favicon: faviconFor(html, base),
        };
      }
    }
  } catch {
    // timeouts, DNS, refused UA — no card
  } finally {
    clearTimeout(timer);
  }
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(target.href, { at: Date.now(), preview });
  return preview;
}
