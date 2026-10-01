import { randomBytes } from 'node:crypto';

/**
 * A server-rendered page (home, sign-in, consent). Each request gets its own
 * nonce: the page runs only its own script and style, talks only to this
 * origin, and cannot be framed (no clickjacking of a sign-in or consent).
 */
export function html(render: (nonce: string) => string): Response {
  const nonce = randomBytes(16).toString('base64');
  return new Response(render(nonce), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    },
  });
}
