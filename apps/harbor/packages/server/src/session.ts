// The web app's session (2026-10-12): the same bearer every client sends,
// held in a cookie so a browser can call every face with credentials, open
// the live socket without a token in its URL, and load a blob with a plain
// <img>. The desktop, the phone and agents keep the Authorization header,
// which always wins over the cookie.
//
// A cookie is sent by the browser whoever asked, so it counts only when the
// request came from the web app: its Origin must be one HARBOR_WEB_ORIGINS
// lists. A browser leaves Origin off only for a plain GET (an <img>, a link
// opened in a tab), and the two blob routes are the only ones that accept
// that. SameSite=Lax keeps the cookie off other sites' requests altogether.

export const SESSION_COOKIE = 'harbor_session';

export interface SessionCookieConfig {
  /** Origins whose requests may carry the session (the CORS list, cors.ts). */
  webOrigins: ReadonlySet<string>;
  /** The apex domain on a deployment, so one cookie covers every org; absent = host-only. */
  domain?: string;
}

/**
 * The session's token, when this request may use it. `originless` is for the
 * routes a browser loads with no Origin header (blobs and images by GET).
 */
export function sessionToken(
  request: { cookie: string | undefined; origin: string | undefined },
  webOrigins: ReadonlySet<string>,
  opts: { originless?: boolean } = {},
): string | undefined {
  const token = readCookie(request.cookie, SESSION_COOKIE);
  if (!token) return undefined;
  if (request.origin !== undefined) return webOrigins.has(request.origin) ? token : undefined;
  return opts.originless ? token : undefined;
}

/** The Set-Cookie for a session that expires with its token (a JWT's `exp`; else the browser session). */
export function sessionCookie(token: string, config: SessionCookieConfig, now = Date.now()): { header: string; expiresAt?: string } {
  const exp = jwtExpiry(token);
  const maxAge = exp !== undefined ? Math.max(0, Math.floor((exp * 1000 - now) / 1000)) : undefined;
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    ...(config.domain ? [`Domain=${config.domain}`] : []),
    ...(maxAge !== undefined ? [`Max-Age=${maxAge}`] : []),
  ];
  return { header: parts.join('; '), ...(exp !== undefined ? { expiresAt: new Date(exp * 1000).toISOString() } : {}) };
}

export function clearedSessionCookie(config: SessionCookieConfig): string {
  return [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax', ...(config.domain ? [`Domain=${config.domain}`] : []), 'Max-Age=0'].join('; ');
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim() || undefined;
  }
  return undefined;
}

/** A JWT's `exp`, read without verifying: the bearer was verified before the cookie is set. */
function jwtExpiry(token: string): number | undefined {
  const payload = token.split('.')[1];
  if (!payload) return undefined;
  try {
    const exp = (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp : undefined;
  } catch {
    return undefined;
  }
}
