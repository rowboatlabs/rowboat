import { mapMentionTokens, mentionsAsText, messageUrl, type Invocation, type Message } from '@rowboat/spaces-protocol';

// The message the Replicas connector sends into a thread's workspace (spec §8
// Connectors, 2026-09-30). The person's words come first, as written: Replicas
// acts on a leading `/plan`, `/goal` or `/fast` itself, and a command anywhere
// else would be lost. Then what the thread said since the workspace last heard
// from it, the files attached, the standing instructions (carried over from
// #1130), and last the marker the connector finds this request by in the
// workspace's history when it recovers after a restart.

export interface Attachment {
  name: string;
  mime: string;
  size: number;
  hash: string;
}

/** An attachment link in a body: `[name](…/s/<space>/b/<hash>[?name=…])`, or an image `![alt](…)`. */
const ATTACHMENT_RE = /!?\[([^\]\n]*)\]\((\S+?\/s\/([0-9A-HJKMNP-TV-Z]{26})\/b\/([a-f0-9]{64})(?:\?name=([^)\s]+))?)\)/g;

/** The same-space attachments a body links to, in order, once each. */
export function attachmentLinks(body: string, spaceId: string): Array<{ hash: string; name: string }> {
  const found = new Map<string, string>();
  for (const match of body.matchAll(ATTACHMENT_RE)) {
    const [, label, , space, hash, encodedName] = match;
    if (space !== spaceId || !hash || found.has(hash)) continue;
    let name = label || hash.slice(0, 12);
    if (encodedName) {
      try {
        name = decodeURIComponent(encodedName);
      } catch {
        // keep the label
      }
    }
    found.set(hash, name);
  }
  return [...found].map(([hash, name]) => ({ hash, name }));
}

export const requestMarker = (messageId: string) => `[Spaces request ${messageId}]`;

/** A body's same-space attachment links as their names: the files themselves are listed (and images sent) separately. */
function namingAttachments(body: string, spaceId: string): string {
  return body.replace(ATTACHMENT_RE, (raw, label: string, _url, space: string, hash: string, encodedName?: string) => {
    if (space !== spaceId) return raw;
    let name = label || hash.slice(0, 12);
    try {
      if (encodedName) name = decodeURIComponent(encodedName);
    } catch {
      // keep the label
    }
    return `[attached: ${name}]`;
  });
}

export function buildPrompt(input: {
  invocation: Invocation;
  agentId: string;
  /** Earlier messages the workspace has not seen, oldest first (never the trigger itself). */
  context: Message[];
  names: ReadonlyMap<string, string>;
  orgAddress: string;
  /** The org's address with its scheme: attachment downloads. */
  orgUrl: string;
  attachments: Attachment[];
  /** Attachments on earlier messages in the context, listed for the agent to fetch. */
  earlierAttachments: Attachment[];
}): string {
  const { invocation, names } = input;
  const plain = (body: string) => mentionsAsText(namingAttachments(body, invocation.conversation.spaceId), names).trim();
  // The agent's own mention addresses it; it is not part of the request.
  const request = plain(mapMentionTokens(invocation.trigger.body, (ref, raw) => (ref.kind === 'member' && ref.id === input.agentId ? '' : raw)));
  const invoker = names.get(invocation.trigger.authorId) ?? 'a teammate';
  const where =
    invocation.where.spaceKind === 'direct' ? `a direct message with ${invoker}` : `the space "${invocation.where.spaceName}"`;
  const thread = messageUrl(input.orgAddress, invocation.conversation.spaceId, invocation.conversation.threadRootId);
  const download = (a: Attachment) =>
    `- ${a.name} (${a.mime}, ${formatSize(a.size)}): ${input.orgUrl}/v1/spaces/${invocation.conversation.spaceId}/blobs/${a.hash}?name=${encodeURIComponent(a.name)}`;

  const parts = [request || '(no text)'];
  if (input.context.length > 0) {
    parts.push(
      ['Earlier in this thread:', ...input.context.map((m) => `${names.get(m.author.memberId) ?? 'Someone'}: ${plain(m.body)}`)].join('\n'),
    );
  }
  const files = [...input.attachments, ...input.earlierAttachments];
  if (files.length > 0) {
    parts.push(
      [
        'Attached files. Download one when you need it, to disk, with',
        '`curl -fsSL -H "Authorization: Bearer $ROWBOAT_AGENT_KEY" -o <name> <url>` (when this environment sets ROWBOAT_AGENT_KEY):',
        ...files.map(download),
      ].join('\n'),
    );
  }
  parts.push(
    `This request comes from ${invoker} in ${where} in Rowboat. Respond to the request above. ` +
      'Questions asking for explanation do not authorize code changes. ' +
      'Reply concisely for the shared thread, including verification and PR links when relevant. ' +
      `Include the following attribution in every PR description you create or update for this request: Requested by ${invoker}, ${thread}. ` +
      'Do not post to Slack.',
  );
  parts.push(requestMarker(invocation.trigger.messageId));
  return parts.join('\n\n');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
