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
//
// Harbor's hand-off page (what a phone browser shows when the universal link
// didn't fire, e.g. inside another app's browser) opens the app with
// rowboat://open?type=spaces&server=…&invite=…|spaceId=…[&messageId=…]|memberId=…
// (2026-11-10). It maps onto the same routes as the https links; the join
// screen gets the invite back as an https link on the server it names.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (/^(rowboat:\/\/|\/)oauth-callback\b/.test(path)) return null;
  const open = /^(?:rowboat:\/\/|\/)?open\?(.*)$/.exec(path);
  if (open) {
    const q = new URLSearchParams(open[1]);
    const server = q.get('server');
    const invite = q.get('invite');
    const spaceId = q.get('spaceId');
    const memberId = q.get('memberId');
    const messageId = q.get('messageId');
    if (invite && server) return `/spaces/join?url=${encodeURIComponent(`https://${server}/join/${invite}`)}`;
    if (spaceId && messageId) return `/s/${encodeURIComponent(spaceId)}/m/${encodeURIComponent(messageId)}`;
    if (spaceId) return `/s/${encodeURIComponent(spaceId)}`;
    if (memberId) return `/u/${encodeURIComponent(memberId)}`;
    return '/spaces';
  }
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
