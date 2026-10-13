// An invite link, https://<org>/join/<token> (the protocol's inviteUrl), read
// back into the org's base URL and the token: the one reader the desktop's
// core and the web app join through (2026-10-13).
export function parseInviteLink(url: string): { baseUrl: string; token: string } | null {
  try {
    const u = new URL(url.trim());
    const match = u.pathname.match(/^\/join\/([^/]+)$/);
    if (!match?.[1]) return null;
    return { baseUrl: u.origin, token: match[1] };
  } catch {
    return null;
  }
}
