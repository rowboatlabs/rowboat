import type { Invocation, Message } from '@rowboat/spaces-protocol';
import type { ConnectorEnv } from '../platforms.js';
import { attachmentLinks, buildPrompt, type Attachment } from './prompt.js';

// Gathering what a coding agent's workspace hears for one invocation (spec §8
// Connectors): the request, the thread since the workspace last heard it, and
// the files. Shared by the Replicas and Conductor connectors (2026-10-06).

/** The prompt for this invocation: the request, the thread after `deliveredOffset`, the files. */
export async function requestPrompt(env: ConnectorEnv, invocation: Invocation, deliveredOffset: number | undefined): Promise<string> {
  const { spaceId, threadRootId } = invocation.conversation;
  const names = new Map((await quietly(env, () => env.service.listOrgMembers(env.ctx), [])).map((m) => [m.id, m.displayName]));
  const trigger = await quietly(env, () => env.service.getMessage(env.ctx, spaceId, invocation.trigger.messageId), undefined);
  const after = deliveredOffset ?? 0;
  const context: Message[] = [];
  if (trigger && trigger.id !== threadRootId) {
    const page = await quietly(env, () => env.service.listThread(env.ctx, spaceId, threadRootId, { afterOffset: after, limit: 100 }), undefined);
    if (page) {
      const earlier = [page.root, ...page.messages].filter(
        (m) => m.offset > after && m.offset < trigger.offset && m.author.memberId !== env.agent.id && !m.deletedAt,
      );
      context.push(...earlier.slice(-50));
    }
  }
  const attachments = await attachmentsOf(env, spaceId, invocation.trigger.body);
  const earlierAttachments = (await Promise.all(context.map((m) => attachmentsOf(env, spaceId, m.body)))).flat();
  return buildPrompt({
    invocation,
    agentId: env.agent.id,
    context,
    names,
    orgAddress: env.service.org.address,
    orgUrl: env.orgUrl,
    attachments,
    earlierAttachments,
  });
}

async function attachmentsOf(env: ConnectorEnv, spaceId: string, body: string): Promise<Attachment[]> {
  const found: Attachment[] = [];
  for (const { hash, name } of attachmentLinks(body, spaceId)) {
    const blob = await quietly(env, async () => (await env.service.downloadBlob(env.ctx, spaceId, hash, name)).blob, undefined);
    if (blob) found.push({ name, mime: blob.mime, size: blob.size, hash });
  }
  return found;
}

/** A call whose failure is logged and replaced by `fallback`. */
export async function quietly<T>(env: ConnectorEnv, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    env.log('call failed', { error: (err as Error).message });
    return fallback;
  }
}

/** Wait, or stop waiting as soon as `signal` aborts. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
  });
}
