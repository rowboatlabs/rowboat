/**
 * The deep link a notification click opens: the space, or one thread in it.
 * Handled by the host's `rowboat://open` router; shared by the scheduler's
 * reminders and the org's `notify` frames so every toast lands the same way.
 */
export function spaceLink(orgId: string, spaceId: string, threadRootId?: string, messageId?: string): string {
  const thread = threadRootId ? `&threadRootId=${encodeURIComponent(threadRootId)}` : '';
  const message = messageId ? `&messageId=${encodeURIComponent(messageId)}` : '';
  return `rowboat://open?type=spaces&orgId=${encodeURIComponent(orgId)}&spaceId=${encodeURIComponent(spaceId)}${thread}${message}`;
}
