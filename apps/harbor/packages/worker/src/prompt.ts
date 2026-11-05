import { attachmentLinks, buildPrompt, mentionToken, namingAttachments, relabelMentions, type Attachment, type Invocation, type Message } from '@rowboat/spaces-protocol';
import type { HarborClient } from './harbor.js';
import { errorText, type Logger } from './log.js';

// What the harness hears for one invocation (spec §8 Connectors): the request,
// the thread since the session last heard it, the files as download lines on
// the agent's key, the standing paragraph. Built as Harbor's coding connectors
// and the desktop's local agents build theirs (buildPrompt in the protocol
// package), read through the agent's own routes.

export interface PromptInput {
  invocation: Invocation;
  agentId: string;
  orgAddress: string;
  orgUrl: string;
  /** The stream offset the session has heard up to; earlier messages after it are the context. */
  deliveredOffset: number | undefined;
  log: Logger;
}

export interface BuiltPrompt {
  prompt: string;
  /** The trigger's offset: what the session has heard once this turn starts. */
  triggerOffset: number | undefined;
  names: Map<string, string>;
}

export async function requestPrompt(harbor: HarborClient, input: PromptInput): Promise<BuiltPrompt> {
  const { invocation } = input;
  const { spaceId, threadRootId } = invocation.conversation;
  const quietly = async <T>(what: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      input.log(`${what} failed; going on without it`, { error: errorText(err) });
      return fallback;
    }
  };
  const names = new Map((await quietly('roster', () => harbor.roster(), [])).map((m) => [m.id, m.displayName] as const));
  const trigger = await quietly('trigger', () => harbor.getMessage(spaceId, invocation.trigger.messageId), undefined);
  const after = input.deliveredOffset ?? 0;
  const context: Message[] = [];
  if (trigger && trigger.id !== threadRootId) {
    const page = await quietly('thread', () => harbor.listThread(spaceId, threadRootId, { afterOffset: after, limit: 100 }), undefined);
    if (page) {
      const earlier = [page.root, ...page.messages].filter(
        (m) => m.offset > after && m.offset < trigger.offset && m.author.memberId !== input.agentId && !m.deletedAt,
      );
      context.push(...earlier.slice(-50));
    }
  }
  const attachments = await attachmentsOf(harbor, spaceId, invocation.trigger.body);
  const earlierAttachments = (await Promise.all(context.map((m) => attachmentsOf(harbor, spaceId, m.body)))).flat();
  const prompt = buildPrompt({
    invocation,
    agentId: input.agentId,
    context,
    names,
    orgAddress: input.orgAddress,
    orgUrl: input.orgUrl,
    attachments,
    earlierAttachments,
  });
  return { prompt, triggerOffset: trigger?.offset, names };
}

async function attachmentsOf(harbor: HarborClient, spaceId: string, body: string): Promise<Attachment[]> {
  const found: Attachment[] = [];
  for (const { hash, name } of attachmentLinks(body, spaceId)) {
    const info = await harbor.blobInfo(spaceId, hash);
    found.push({ name, hash, mime: info?.mime ?? 'application/octet-stream', size: info?.size ?? 0 });
  }
  return found;
}

/** A message folded into the running turn, as the harness hears it: who said it, and what, with mentions as tokens. */
export function steerText(invocation: Invocation, names: ReadonlyMap<string, string>): string {
  const author = mentionToken({ kind: 'member', id: invocation.trigger.authorId, label: names.get(invocation.trigger.authorId) ?? '' });
  const body = relabelMentions(namingAttachments(invocation.trigger.body, invocation.conversation.spaceId), names).trim();
  return `${author} adds, while you work: ${body || '(no text)'}`;
}

/** The request again after the worker restarted mid-turn (spec §8: a connector carries on with what its agent resumes). */
export function continuation(prompt: string): string {
  return [
    'This request was interrupted by a restart of the worker running you before you finished it. Your session kept what you did so far:',
    'check what is already done before doing it again, then finish the request below and reply as if nothing happened.',
    '',
    prompt,
  ].join('\n');
}
