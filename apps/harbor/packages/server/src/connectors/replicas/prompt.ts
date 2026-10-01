import { mentionToken, messageUrl, relabelMentions, type Invocation, type Message } from '@rowboat/spaces-protocol';

// The message the Replicas connector sends into a thread's workspace (spec §8
// Connectors, 2026-09-30). The person's words come first, as written: Replicas
// acts on a leading `/plan`, `/goal` or `/fast` itself, and a command anywhere
// else would be lost. Then what the thread said since the workspace last heard
// from it, the files attached, the standing instructions (carried over from
// #1130), and last the marker the connector finds this request by in the
// workspace's history when it recovers after a restart.
//
// Mentions stay tokens, and authors are written as tokens (spec §8, 2026-10-01):
// an agent shown plain names answers with plain names, which reach no one. A
// mention of the agent is dropped only before a command ("@Claude /plan …"
// reaches it as "/plan …"); anywhere else it stays, and the agent is told its
// own token, or it reads a blank where its name was.

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

/** `[env:backend]`: the environment named in a message, the syntax of Replicas's own Slack bot (2026-10-01). */
const ENV_TAG_RE = /[ \t]*\[env:([^\]\n]+)\][ \t]*/gi;

/** The environment a message names, if any (the first tag). */
export function environmentTag(body: string): string | undefined {
  return [...body.matchAll(ENV_TAG_RE)][0]?.[1]?.trim() || undefined;
}

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
  const readable = (body: string) => relabelMentions(namingAttachments(body, invocation.conversation.spaceId), names).trim();
  const token = (memberId: string) => mentionToken({ kind: 'member', id: memberId, label: names.get(memberId) ?? '' });
  // The environment tag is for the connector, not the coding agent; then a command it frees can lead.
  const request = readable(invocation.trigger.body.replace(ENV_TAG_RE, ' ').trim().replace(leadingMentionOf(input.agentId), ''));
  const invoker = names.get(invocation.trigger.authorId) ?? 'a teammate';
  const where =
    invocation.where.spaceKind === 'direct' ? `a direct message with ${invoker}` : `the space "${invocation.where.spaceName}"`;
  const thread = messageUrl(input.orgAddress, invocation.conversation.spaceId, invocation.conversation.threadRootId);
  const download = (a: Attachment) =>
    `- ${a.name} (${a.mime}, ${formatSize(a.size)}): ${input.orgUrl}/v1/spaces/${invocation.conversation.spaceId}/blobs/${a.hash}?name=${encodeURIComponent(a.name)}`;

  const parts = [request || '(no text)'];
  if (input.context.length > 0) {
    parts.push(
      ['Earlier in this thread:', ...input.context.map((m) => `${token(m.author.memberId)}: ${readable(m.body)}`)].join('\n'),
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
    `You are ${token(input.agentId)} in Rowboat, and this request comes from ${token(invocation.trigger.authorId)} in ${where}. Respond to the request above. ` +
      'Questions asking for explanation do not authorize code changes. ' +
      'Reply concisely for the shared thread, including verification and PR links when relevant. ' +
      'To mention someone, copy their token exactly as it appears here; a bare @Name is plain text that reaches no one. ' +
      'Agents see only messages that mention them. Whenever you need a person or an agent to act or answer, mention them, ' +
      'and otherwise write their name; never mention to thank, acknowledge or sign off. ' +
      'For more on Rowboat, use the rowboat-spaces skill. ' +
      `Include the following attribution in every PR description you create or update for this request: Requested by ${invoker}, ${thread}. ` +
      'Do not post to Slack.',
  );
  parts.push(requestMarker(invocation.trigger.messageId));
  return parts.join('\n\n');
}

/** Mentions of the agent that lead a command ("@Claude /plan …"): Replicas acts on the command only when it comes first. */
function leadingMentionOf(agentId: string): RegExp {
  const id = agentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\s*(?:\\[@[^\\]\\n]*\\]\\(#member:${id}\\)[\\s,:]*)+(?=/)`);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
