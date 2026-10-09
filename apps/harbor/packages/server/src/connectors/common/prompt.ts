import { mentionToken, relabelMentions, type Invocation, type Message } from '@rowboat/spaces-protocol';
import { downloadLine, leadingMentionOf, namingAttachments, requestMarker, standingParagraph, type Attachment } from '../thread-prompt.js';

export { attachmentLinks, requestMarker, type Attachment } from '../thread-prompt.js';

// The message a coding-agent connector sends into a thread's workspace (spec
// §8 Connectors, 2026-09-30; shared by Replicas and Conductor since
// 2026-10-06). The person's words come first, as written: the platform acts
// on a leading `/plan`, `/goal` or `/fast` itself, and a command anywhere
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

/** `[env:backend]`: the environment named in a message, the syntax of Replicas's own Slack bot (2026-10-01). */
const ENV_TAG_RE = /[ \t]*\[env:([^\]\n]+)\][ \t]*/gi;

/** The environment a message names, if any (the first tag). */
export function environmentTag(body: string): string | undefined {
  return [...body.matchAll(ENV_TAG_RE)][0]?.[1]?.trim() || undefined;
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
        ...files.map((a) => downloadLine(input.orgUrl, invocation.conversation.spaceId, a)),
      ].join('\n'),
    );
  }
  parts.push(standingParagraph(input));
  parts.push(requestMarker(invocation.trigger.messageId));
  return parts.join('\n\n');
}
