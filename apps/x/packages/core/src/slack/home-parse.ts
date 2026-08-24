import { runAgentSlack } from './agent-slack-exec.js';

// Parsing and enrichment for Slack-home surfaces on top of agent-slack CLI
// output. Extracted from apps/main/src/ipc.ts so the rowboat-server handlers
// share the exact implementation (client-server separation, Phase 3a).

export type SlackHomeChannel = {
  id: string;
  name: string;
  workspaceUrl?: string;
  workspaceName?: string;
};

export type SlackHomeMessage = {
  id: string;
  workspaceName?: string;
  workspaceUrl?: string;
  channelId?: string;
  channelName?: string;
  author?: string;
  text: string;
  ts: string;
  url?: string;
};

export function parseWhoamiWorkspaces(data: unknown): Array<{ url: string; name: string }> {
  const parsed = (data ?? {}) as { workspaces?: Array<{ workspace_url?: string; workspace_name?: string }> };
  return (parsed.workspaces || []).map((w) => ({
    url: w.workspace_url || '',
    name: w.workspace_name || '',
  }));
}

export function extractArrayPayload(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    for (const key of ['messages', 'channels', 'items', 'results', 'data']) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
  }
  return [];
}

export function slackMessageText(message: Record<string, unknown>): string {
  const value = message.text ?? message.body ?? message.content;
  return typeof value === 'string' ? value.trim() : '';
}

export function slackMessageAuthor(message: Record<string, unknown>): string | undefined {
  const value = message.username ?? message.user ?? message.author;
  return typeof value === 'string' ? value : undefined;
}

function extractSlackUserName(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const profile = obj.profile && typeof obj.profile === 'object' ? obj.profile as Record<string, unknown> : undefined;
  const user = obj.user && typeof obj.user === 'object' ? obj.user as Record<string, unknown> : undefined;
  const userProfile = user?.profile && typeof user.profile === 'object' ? user.profile as Record<string, unknown> : undefined;

  const candidates = [
    profile?.display_name,
    profile?.real_name,
    userProfile?.display_name,
    userProfile?.real_name,
    obj.display_name,
    obj.displayName,
    obj.real_name,
    obj.realName,
    user?.display_name,
    user?.displayName,
    user?.real_name,
    user?.realName,
    obj.name,
    user?.name,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

async function resolveSlackUserName(
  userId: string,
  workspaceUrl: string | undefined,
  cache: Map<string, string>,
): Promise<string | null> {
  const key = `${workspaceUrl ?? ''}:${userId}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  const args = ['user', 'get', userId];
  if (workspaceUrl) {
    args.push('--workspace', workspaceUrl);
  }

  const result = await runAgentSlack(args, { timeoutMs: 10000, maxBuffer: 512 * 1024 });
  if (result.ok) {
    const name = extractSlackUserName(result.data ?? {});
    if (name) {
      cache.set(key, name);
      return name;
    }
  } else {
    console.warn(`[Slack] Failed to resolve user ${userId}: ${result.message}`);
  }

  cache.set(key, userId);
  return null;
}

export async function resolveSlackMessageText(
  text: string,
  workspaceUrl: string | undefined,
  cache: Map<string, string>,
): Promise<string> {
  const matches = Array.from(text.matchAll(/<@([UW][A-Z0-9]+)(?:\|([^>]+))?>|@([UW][A-Z0-9]{6,})\b/g));
  if (matches.length === 0) return text;

  let resolved = text;
  for (const match of matches) {
    const userId = match[1] ?? match[3];
    if (!userId) continue;
    const fallback = match[2] ?? match[0];
    const name = await resolveSlackUserName(userId, workspaceUrl, cache);
    resolved = resolved.replaceAll(match[0], name ?? fallback);
  }
  return resolved;
}

export async function resolveSlackAuthor(
  author: string | undefined,
  workspaceUrl: string | undefined,
  cache: Map<string, string>,
): Promise<string | undefined> {
  if (!author) return undefined;
  if (!/^[UW][A-Z0-9]{6,}$/.test(author)) return author;
  return await resolveSlackUserName(author, workspaceUrl, cache) ?? author;
}

export function slackMessageUrl(message: Record<string, unknown>, workspaceUrl: string | undefined, channelId: string | undefined, ts: string): string | undefined {
  const direct = message.permalink ?? message.url;
  if (typeof direct === 'string' && direct) return direct;
  if (!workspaceUrl || !channelId) return undefined;
  return `${workspaceUrl.replace(/\/$/, '')}/archives/${channelId}/p${ts.replace('.', '')}`;
}
