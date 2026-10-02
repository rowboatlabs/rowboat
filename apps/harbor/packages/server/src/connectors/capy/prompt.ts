import { mentionToken, relabelMentions, type Invocation, type Message } from '@rowboat/spaces-protocol';
import { downloadLine, leadingMentionOf, namingAttachments, requestMarker, standingParagraph, type Attachment } from '../thread-prompt.js';

// The message the Capy connector sends into a thread (spec §8 Connectors,
// 2026-10-02), in the Replicas connector's order: the person's words first,
// as written; what the thread said since Capy last heard from it; the files;
// the standing paragraph; and last the marker. Capy's public API takes no
// attachments ("no public upload/download capability",
// https://docs.capy.ai/api-reference/migration), so every file is a link the
// agent downloads on the Rowboat agent's key, when its project sets one.

export function buildPrompt(input: {
  invocation: Invocation;
  agentId: string;
  /** Earlier messages Capy has not seen, oldest first (never the trigger itself). */
  context: Message[];
  names: ReadonlyMap<string, string>;
  orgAddress: string;
  /** The org's address with its scheme: attachment downloads. */
  orgUrl: string;
  /** The invoking message's attachments, then earlier ones in the context. */
  attachments: Attachment[];
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
  if (input.attachments.length > 0) {
    parts.push(
      [
        'Attached files. Download one when you need it, to disk, with',
        '`curl -fsSL -H "Authorization: Bearer $ROWBOAT_AGENT_KEY" -o <name> <url>` (when this project sets ROWBOAT_AGENT_KEY):',
        ...input.attachments.map((a) => downloadLine(input.orgUrl, spaceId, a)),
      ].join('\n'),
    );
  }
  parts.push(standingParagraph(input));
  parts.push(requestMarker(invocation.trigger.messageId));
  return parts.join('\n\n');
}
