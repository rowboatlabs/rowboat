import { mentionToken, relabelMentions, type Invocation, type Message } from '@rowboat/spaces-protocol';
import { downloadLine, leadingMentionOf, namingAttachments, requestMarker, standingParagraph, type Attachment } from '../thread-prompt.js';

// The input the Agent37 connector sends into a thread's session (spec §8
// Connectors, 2026-10-01). Agent37's `POST /v1/responses` takes one string and
// has no system-prompt field (https://www.agent37.com/docs/agents-api/chat), so
// everything rides in it, in the Replicas connector's order: the person's words
// first, as written; what the thread said since the session last heard from it;
// the files; the standing paragraph; and last the marker the connector finds
// this request by in the session's history after a restart.
//
// The invoking message's files are on the instance's disk already (the
// connector writes them there and lists their paths in `files`, which the
// gateway appends to the input); earlier ones are listed to download.

export function buildPrompt(input: {
  invocation: Invocation;
  agentId: string;
  /** Earlier messages the session has not seen, oldest first (never the trigger itself). */
  context: Message[];
  names: ReadonlyMap<string, string>;
  orgAddress: string;
  /** The org's address with its scheme: attachment downloads. */
  orgUrl: string;
  /** Attachments on earlier messages in the context, listed for the agent to fetch. */
  earlierAttachments: Attachment[];
}): string {
  const { invocation, names } = input;
  const { spaceId } = invocation.conversation;
  const readable = (body: string) => relabelMentions(namingAttachments(body, spaceId), names).trim();
  const token = (memberId: string) => mentionToken({ kind: 'member', id: memberId, label: names.get(memberId) ?? '' });
  const request = readable(invocation.trigger.body.replace(leadingMentionOf(input.agentId), ''));

  const parts = [request || '(no text)'];
  if (input.context.length > 0) {
    parts.push(['Earlier in this thread:', ...input.context.map((m) => `${token(m.author.memberId)}: ${readable(m.body)}`)].join('\n'));
  }
  if (input.earlierAttachments.length > 0) {
    parts.push(
      [
        'Files attached earlier in the thread. Download one when you need it, to disk, with',
        '`curl -fsSL -H "Authorization: Bearer $ROWBOAT_AGENT_KEY" -o <name> <url>` (when ROWBOAT_AGENT_KEY is set):',
        ...input.earlierAttachments.map((a) => downloadLine(input.orgUrl, spaceId, a)),
      ].join('\n'),
    );
  }
  parts.push(standingParagraph(input));
  parts.push(requestMarker(invocation.trigger.messageId));
  return parts.join('\n\n');
}
