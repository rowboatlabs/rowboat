import { mentionToken, messageUrl, type Invocation } from '@rowboat/spaces-protocol';

// What every connector Harbor runs writes into its agent's message (spec §8
// Connectors): attachments as links the agent can fetch, the marker it finds
// a request by after a restart, and the fixed paragraph on Spaces etiquette
// (2026-10-01). Split out of the Replicas connector when Agent37 became the
// second (2026-10-01), so the two say the same thing.

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
    found.set(hash, attachmentName(label, hash, encodedName));
  }
  return [...found].map(([hash, name]) => ({ hash, name }));
}

/** A body's same-space attachment links as their names: the files themselves are listed (or handed over) separately. */
export function namingAttachments(body: string, spaceId: string): string {
  return body.replace(ATTACHMENT_RE, (raw, label: string, _url, space: string, hash: string, encodedName?: string) =>
    space === spaceId ? `[attached: ${attachmentName(label, hash, encodedName)}]` : raw,
  );
}

function attachmentName(label: string | undefined, hash: string, encodedName: string | undefined): string {
  let name = label || hash.slice(0, 12);
  if (encodedName) {
    try {
      name = decodeURIComponent(encodedName);
    } catch {
      // keep the label
    }
  }
  return name;
}

export const requestMarker = (messageId: string) => `[Spaces request ${messageId}]`;

/** Mentions of the agent that lead a command ("@Claude /plan …"): an agent acts on a command only when it comes first. */
export function leadingMentionOf(agentId: string): RegExp {
  const id = agentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\s*(?:\\[@[^\\]\\n]*\\]\\(#member:${id}\\)[\\s,:]*)+(?=/)`);
}

/** One attachment and where to download it, on the agent's key. */
export function downloadLine(orgUrl: string, spaceId: string, a: Attachment): string {
  return `- ${a.name} (${a.mime}, ${formatSize(a.size)}): ${orgUrl}/v1/spaces/${spaceId}/blobs/${a.hash}?name=${encodeURIComponent(a.name)}`;
}

/**
 * Where any agent can read the rowboat-spaces skill without installing it (spec §8, 2026-10-08): the
 * copy on GitHub, the one place it is published. The standing paragraph points every turn here, so an
 * agent that cannot install skills still learns its setup, the tools and files from one page.
 */
export const SKILL_URL = 'https://raw.githubusercontent.com/rowboatlabs/rowboat/main/skills/rowboat-spaces/SKILL.md';

/** The standing paragraph: who the agent is and who asked, as tokens, and when to mention (spec §8, 2026-10-01). */
export function standingParagraph(input: { invocation: Invocation; agentId: string; names: ReadonlyMap<string, string>; orgAddress: string }): string {
  const { invocation, names } = input;
  const token = (memberId: string) => mentionToken({ kind: 'member', id: memberId, label: names.get(memberId) ?? '' });
  const invoker = names.get(invocation.trigger.authorId) ?? 'a teammate';
  const where =
    invocation.where.spaceKind === 'direct' ? `a direct message with ${invoker}` : `the space "${invocation.where.spaceName}"`;
  const thread = messageUrl(input.orgAddress, invocation.conversation.spaceId, invocation.conversation.threadRootId);
  return (
    `You are ${token(input.agentId)} in Rowboat, and this request comes from ${token(invocation.trigger.authorId)} in ${where}. Respond to the request above. ` +
    'Questions asking for explanation do not authorize code changes. ' +
    'Reply concisely for the shared thread, including verification and PR links when relevant. ' +
    'To mention someone, copy their token exactly as it appears here; a bare @Name is plain text that reaches no one. ' +
    'Agents see only messages that mention them. Whenever you need a person or an agent to act or answer, mention them, ' +
    'and otherwise write their name; never mention to thank, acknowledge or sign off. ' +
    `If you have not loaded the rowboat-spaces skill in this session, load it now, or read it at ${SKILL_URL}: ` +
    'it covers your setup, the tools and files. ' +
    `Include the following attribution in every PR description you create or update for this request: Requested by ${invoker}, ${thread}. ` +
    'Do not post to Slack.'
  );
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
