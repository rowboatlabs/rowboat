// The sign-in redirect (rowboat://oauth-callback, lib/spaces/oauth.ts) is for
// WebBrowser.openAuthSessionAsync, not a screen (2026-10-28). iOS's auth
// session swallows it; on Android it also arrives as an ordinary deep link,
// which the router opened as "Unmatched Route". Returning null leaves the
// router where it is; the auth session still gets the URL through its own
// listener. The path may come as the full URL or as /oauth-callback.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (/^(rowboat:\/\/|\/)oauth-callback\b/.test(path)) return null;
  return path;
}
