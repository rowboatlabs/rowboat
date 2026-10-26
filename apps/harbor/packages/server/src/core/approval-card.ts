import { APPROVAL_CHOICE_LABELS, mentionsAsText, type ApprovalRequest } from '@rowboat/spaces-protocol';

// The text an approval card's message carries (spec §8 part 4, 2026-10-01):
// what clients that cannot show the card render, and what an agent reading
// the thread sees. The exact action goes in a code block, so a mention token
// in it is a cite, not an address; the title and reason are flattened for
// the same reason.

export function approvalCardBody(agentName: string, request: ApprovalRequest): string {
  const plain = (text: string) => mentionsAsText(text, new Map()).replace(/\s+/g, ' ').trim();
  const longestTicks = Math.max(0, ...[...request.detail.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(Math.max(3, longestTicks + 1));
  const parts = [`**${plain(request.title)}**`];
  if (request.detail.trim()) parts.push(`${fence}\n${request.detail}\n${fence}`);
  if (request.reason) parts.push(`Why: ${plain(request.reason)}`);
  const choices = request.choices.map((c) => APPROVAL_CHOICE_LABELS[c]).join(', ');
  parts.push(`_${plain(agentName)} is waiting for approval in Rowboat: ${choices}._`);
  return parts.join('\n\n');
}
