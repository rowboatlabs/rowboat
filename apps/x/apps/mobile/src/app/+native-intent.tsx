// The sign-in redirect (rowboat://oauth-callback, lib/spaces/oauth.ts) is for
// WebBrowser.openAuthSessionAsync, not a screen (2026-10-28). iOS's auth
// session swallows it; on Android it also arrives as an ordinary deep link,
// which the router opened as "Unmatched Route". Returning null leaves the
// router where it is; the auth session still gets the URL through its own
// listener. The path may come as the full URL or as /oauth-callback.
//
// A universal link (2026-11-09: https://spaces.x.rowboatlabs.com/join/…, /s/…,
// /u/…) arrives as the full URL; the router wants its path. The join screen
// still reads the full URL itself (Linking.useLinkingURL) for the invite's host.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (/^(rowboat:\/\/|\/)oauth-callback\b/.test(path)) return null;
  if (/^https?:\/\//.test(path)) {
    try {
      const url = new URL(path);
      return url.pathname + url.search;
    } catch {
      return path;
    }
  }
  return path;
}
