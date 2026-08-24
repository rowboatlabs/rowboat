import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHarbor, type RunningHarbor } from '../src/server.js';

// Agent-face tests through a real MCP client: the exact path any agent
// (Rowboat's included — no privileged path) uses.

let harbor: RunningHarbor;
let spaceId: string;

beforeAll(async () => {
  harbor = await startHarbor({
    seedMembers: [
      { id: 'harsh', displayName: 'Harsh' },
      { id: 'ramnique', displayName: 'Ramnique' },
    ],
    seedSpaces: [
      { name: 'Agent Space', creator: 'harsh', assets: [{ path: 'roadmap.md', content: '# Roadmap\n- [ ] SSO\n' }] },
    ],
  });
  const spaces = await harbor.service.listSpaces({ memberId: 'harsh' });
  spaceId = spaces[0]!.id;
});

afterAll(async () => {
  await harbor.close();
});

async function mcpClient(token: string, headers: Record<string, string> = {}): Promise<Client> {
  const client = new Client({ name: 'test-agent', version: '0.0.1' });
  const transport = new StreamableHTTPClientTransport(new URL(harbor.mcpUrl), {
    requestInit: { headers: { authorization: `Bearer ${token}`, ...headers } },
  });
  await client.connect(transport);
  return client;
}

describe('agent face (MCP)', () => {
  it('lists exactly the seven protocol tools, with JSON schemas', async () => {
    const client = await mcpClient('dev-harsh');
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'list_spaces',
      'manage_topic',
      'post_to_topic',
      'propose_change',
      'read_asset',
      'read_topic',
      'search_feed',
    ]);
    const propose = tools.find((t) => t.name === 'propose_change')!;
    expect(propose.inputSchema.required).toContain('reason'); // required on this face only
    await client.close();
  });

  it('list_spaces makes discovery mechanical: name → spaceId → asset path → content', async () => {
    const client = await mcpClient('dev-harsh');
    // The full resolution chain an agent runs for "read the Agent Space roadmap"
    // with zero prior knowledge — no guessed ids, no guessed paths.
    const listed = (await client.callTool({ name: 'list_spaces', arguments: {} }))
      .structuredContent as {
      spaces: Array<{ id: string; name: string; memberCount: number; assets: Array<{ path: string; version: number }> }>;
    };
    const space = listed.spaces.find((s) => s.name.toLowerCase() === 'agent space');
    expect(space).toBeDefined();
    expect(space!.memberCount).toBe(2); // harsh + ramnique seeded
    const roadmap = space!.assets.find((a) => a.path === 'roadmap.md');
    expect(roadmap).toBeDefined();

    const read = (await client.callTool({
      name: 'read_asset',
      arguments: { spaceId: space!.id, path: roadmap!.path },
    })).structuredContent as { content: string; version: number };
    expect(read.content).toContain('# Roadmap');
    expect(read.version).toBe(roadmap!.version);

    // Membership scoping holds on this face too: a member of nothing sees nothing.
    const outsider = await mcpClient('dev-nobody');
    const empty = (await outsider.callTool({ name: 'list_spaces', arguments: {} }))
      .structuredContent as { spaces: unknown[] };
    expect(empty.spaces).toEqual([]);
    await outsider.close();
    await client.close();
  });

  it('read → propose(applied) round-trip, attributed as agent with the declared name', async () => {
    const client = await mcpClient('dev-harsh', { 'x-agent-name': 'Claude Code' });
    const read = (await client.callTool({ name: 'read_asset', arguments: { spaceId, path: 'roadmap.md' } }))
      .structuredContent as { content: string; version: number };
    const propose = (
      await client.callTool({
        name: 'propose_change',
        arguments: {
          spaceId,
          path: 'roadmap.md',
          baseVersion: read.version,
          newContent: read.content.replace('- [ ] SSO', '- [x] SSO'),
          reason: 'standup: SSO shipped',
        },
      })
    ).structuredContent as { outcome: string; changeSet: { attribution: unknown; reason: string } };
    expect(propose.outcome).toBe('applied');
    expect(propose.changeSet.attribution).toEqual({ memberId: 'harsh', actingMode: 'agent', agentName: 'Claude Code' });
    expect(propose.changeSet.reason).toBe('standup: SSO shipped');
    await client.close();
  });

  it('a conflict returns the retry bundle; re-proposing against current succeeds', async () => {
    const harshAgent = await mcpClient('dev-harsh');
    const ramniqueAgent = await mcpClient('dev-ramnique');

    const read = (await harshAgent.callTool({ name: 'read_asset', arguments: { spaceId, path: 'roadmap.md' } }))
      .structuredContent as { content: string; version: number };

    // Ramnique's agent lands first.
    await ramniqueAgent.callTool({
      name: 'propose_change',
      arguments: {
        spaceId,
        path: 'roadmap.md',
        baseVersion: read.version,
        newContent: read.content.replace('# Roadmap', '# Roadmap (Q3)'),
        reason: 'retitle for the quarter',
      },
    });

    // Harsh's agent proposes the same line from the stale base → conflict.
    const conflict = (
      await harshAgent.callTool({
        name: 'propose_change',
        arguments: {
          spaceId,
          path: 'roadmap.md',
          baseVersion: read.version,
          newContent: read.content.replace('# Roadmap', '# Roadmap — August'),
          reason: 'retitle by month',
        },
      })
    ).structuredContent as {
      outcome: string;
      currentVersion: number;
      currentContent: string;
      regions: unknown[];
      recentHistory: unknown[];
    };
    expect(conflict.outcome).toBe('conflict');
    expect(conflict.regions.length).toBeGreaterThan(0);
    expect(conflict.recentHistory.length).toBeGreaterThan(0);

    // Well-behaved retry: adjust against currentContent, propose on currentVersion.
    const retry = (
      await harshAgent.callTool({
        name: 'propose_change',
        arguments: {
          spaceId,
          path: 'roadmap.md',
          baseVersion: conflict.currentVersion,
          newContent: conflict.currentContent.replace('(Q3)', '(Q3 — August)'),
          reason: 'fold both retitles together',
        },
      })
    ).structuredContent as { outcome: string };
    expect(retry.outcome).toBe('applied');
    await harshAgent.close();
    await ramniqueAgent.close();
  });

  it('propose_change blob variant files an already-uploaded attachment — no byte movement', async () => {
    // A member attached bytes in chat (render-face upload, phase 1)…
    const bytes = new TextEncoder().encode('quarterly,signups\nQ1,40\nQ2,55\n');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const uploaded = await fetch(`${harbor.url}/v1/spaces/${spaceId}/blobs`, {
      method: 'PUT',
      headers: { authorization: 'Bearer dev-harsh', 'x-blob-sha256': hash, 'content-type': 'text/csv' },
      body: bytes,
    });
    expect(uploaded.status).toBe(200);

    // …and the agent files it into the tree by hash alone (phase 2 over MCP).
    const client = await mcpClient('dev-harsh', { 'x-agent-name': 'Rowboat' });
    const filed = (await client.callTool({
      name: 'propose_change',
      arguments: { spaceId, path: 'data/signups.csv', baseVersion: 0, blob: hash, reason: 'file the chat attachment' },
    })) as { isError?: boolean; structuredContent?: unknown };
    expect(filed.isError).toBeFalsy();
    const applied = filed.structuredContent as { outcome: string; changeSet: { blob?: { hash: string; mime: string } } };
    expect(applied.outcome).toBe('applied');
    expect(applied.changeSet.blob).toMatchObject({ hash, mime: 'text/csv' });

    // Exactly one of newContent/blob — both and neither are refused.
    const both = await client.callTool({
      name: 'propose_change',
      arguments: { spaceId, path: 'data/x.csv', baseVersion: 0, newContent: 'a', blob: hash, reason: 'nope' },
    });
    expect(both.isError).toBe(true);
    const neither = await client.callTool({
      name: 'propose_change',
      arguments: { spaceId, path: 'data/x.csv', baseVersion: 0, reason: 'nope' },
    });
    expect(neither.isError).toBe(true);

    // A hash never uploaded to this space is refused, not invented.
    const phantom = await client.callTool({
      name: 'propose_change',
      arguments: { spaceId, path: 'data/ghost.csv', baseVersion: 0, blob: 'e'.repeat(64), reason: 'nope' },
    });
    expect(phantom.isError).toBe(true);
    await client.close();
  });

  it('reason is required on this face', async () => {
    const client = await mcpClient('dev-harsh');
    const result = await client.callTool({
      name: 'propose_change',
      arguments: { spaceId, path: 'roadmap.md', baseVersion: 1, newContent: 'x\n' },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('reason');
    await client.close();
  });

  it('read_topic returns the thread with attribution, windowed from the tail', async () => {
    const client = await mcpClient('dev-harsh');
    const started = (
      await client.callTool({ name: 'post_to_topic', arguments: { spaceId, body: 'Thread to read' } })
    ).structuredContent as { topicId: string };
    for (const body of ['first reply', 'second reply', 'third reply']) {
      await client.callTool({ name: 'post_to_topic', arguments: { spaceId, topicId: started.topicId, body } });
    }

    const full = (
      await client.callTool({ name: 'read_topic', arguments: { spaceId, topicId: started.topicId } })
    ).structuredContent as { topic: { title: string }; messages: Array<{ body: string; author: { actingMode: string } }>; truncated: boolean };
    expect(full.topic.title).toBe('Thread to read');
    expect(full.messages.map((m) => m.body)).toEqual(['Thread to read', 'first reply', 'second reply', 'third reply']);
    expect(full.messages[0]!.author.actingMode).toBe('agent');
    expect(full.truncated).toBe(false);

    const tail = (
      await client.callTool({ name: 'read_topic', arguments: { spaceId, topicId: started.topicId, limit: 2 } })
    ).structuredContent as { messages: Array<{ body: string }>; truncated: boolean };
    expect(tail.messages.map((m) => m.body)).toEqual(['second reply', 'third reply']);
    expect(tail.truncated).toBe(true);
    await client.close();
  });

  it('post_to_topic starts topics and threads; search_feed finds them; manage_topic tidies', async () => {
    const client = await mcpClient('dev-harsh');
    const started = (
      await client.callTool({
        name: 'post_to_topic',
        arguments: { spaceId, body: 'Webhook retries: exponential backoff or fixed?' },
      })
    ).structuredContent as { topicId: string; messageId: string };
    expect(started.topicId).toBeTruthy();

    const reply = (
      await client.callTool({
        name: 'post_to_topic',
        arguments: { spaceId, topicId: started.topicId, body: 'Exponential, capped at 10m.' },
      })
    ).structuredContent as { topicId: string };
    expect(reply.topicId).toBe(started.topicId);

    const search = (
      await client.callTool({ name: 'search_feed', arguments: { spaceId, query: 'webhook retries' } })
    ).structuredContent as { results: Array<{ topicId: string }> };
    expect(search.results.map((r) => r.topicId)).toContain(started.topicId);

    const managed = (
      await client.callTool({
        name: 'manage_topic',
        arguments: { spaceId, topicId: started.topicId, action: 'retitle', title: 'Webhook retry policy' },
      })
    ).structuredContent as { topic: { title: string } };
    expect(managed.topic.title).toBe('Webhook retry policy');
    await client.close();
  });

  it('x-acting-mode: scheduled attributes automations honestly', async () => {
    const client = await mcpClient('dev-harsh', { 'x-acting-mode': 'scheduled', 'x-agent-name': 'Rowboat' });
    const read = (await client.callTool({ name: 'read_asset', arguments: { spaceId, path: 'roadmap.md' } }))
      .structuredContent as { content: string; version: number };
    const propose = (
      await client.callTool({
        name: 'propose_change',
        arguments: {
          spaceId,
          path: 'roadmap.md',
          baseVersion: read.version,
          newContent: `${read.content}- [ ] (cron) weekly tidy ran\n`,
          reason: 'weekly housekeeping cron',
        },
      })
    ).structuredContent as { changeSet: { attribution: { actingMode: string; agentName: string } } };
    expect(propose.changeSet.attribution.actingMode).toBe('scheduled');
    expect(propose.changeSet.attribution.agentName).toBe('Rowboat');
    await client.close();
  });

  it('domain errors surface as tool errors with the ApiError shape', async () => {
    const client = await mcpClient('dev-harsh');
    const result = await client.callTool({
      name: 'read_asset',
      arguments: { spaceId, path: 'nope.md' },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(JSON.parse(text)).toMatchObject({ code: 'not_found', retryable: false });
    await client.close();
  });

  it('rejects bad tokens at the HTTP layer', async () => {
    await expect(mcpClient('nope')).rejects.toThrow();
  });
});
