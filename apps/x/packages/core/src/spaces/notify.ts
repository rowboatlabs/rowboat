import { notifyIfEnabled } from '../application/notification/notifier.js';
import { spaceLink } from './links.js';
import { onMemberFrame } from './orgs.js';

// Desktop delivery of the org's notifications (unread arc, 2026-09-10).
// The org decides — a `notify` frame on the member channel says a message
// named you, was @here, landed in your DM, or replied in a thread you follow
// (CONTRACT.md, the notifications bullet) — and this module only shows it:
// the org's title and excerpt, verbatim, through the app's notification
// service, suppressed while any window is focused. No policy lives here; the
// client-side level module that once did was deleted on 2026-09-09 and
// policy returns on the org. One registration covers every org, present and
// future, because the member-frame relay fans out per org socket.

let stop: (() => void) | null = null;

/** Show the org's `notify` frames as OS notifications. Idempotent; hosts call it at boot. */
export function startSpaceNotifications(): void {
  if (stop) return;
  stop = onMemberFrame((orgId, frame) => {
    if (frame.kind !== 'notify') return;
    void notifyIfEnabled('space_mention', {
      title: frame.title,
      message: frame.body,
      link: spaceLink(orgId, frame.spaceId, frame.threadRootId),
      onlyWhenBackground: true,
    });
  });
}

/** Test seam. */
export function stopSpaceNotifications(): void {
  stop?.();
  stop = null;
}
