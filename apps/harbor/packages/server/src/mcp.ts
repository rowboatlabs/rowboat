import type { IncomingMessage, ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { mcpTools, type ActingMode } from '@rowboat/spaces-protocol';
import { z } from 'zod';
import type { AuthDriver } from './auth.js';
import { HarborError } from './errors.js';
import type { HarborService } from './service.js';
import type { Store } from './store.js';

// The agent face (CONTRACT.md decision 5): the protocol tools served over
// MCP streamable HTTP at /mcp. Every call is attributed as the token's member;
// actingMode defaults to 'agent' ('scheduled' via the x-acting-mode header,
// display label via x-agent-name). Rowboat's own agent uses this exact
// endpoint — there is no privileged path.
//
// Stateless transport on purpose: each POST builds a per-request server bound
// to the caller's identity, handles the request, and tears down. Fine for the
// stub; the real Harbor may keep sessions for streaming.

interface Deps {
  service: HarborService;
  store: Store;
  auth: AuthDriver;
}

interface McpActor {
  memberId: string;
  actingMode: ActingMode;
  agentName?: string;
}

export async function handleMcpRequest(req: IncomingMessage, res: ServerResponse, deps: Deps): Promise<void> {
  let actor: McpActor;
  try {
    const identity = await deps.auth.authenticate(req.headers.authorization);
    const member = await deps.auth.resolveMember(deps.store, identity);
    actor = {
      memberId: member.id,
      actingMode: req.headers['x-acting-mode'] === 'scheduled' ? 'scheduled' : 'agent',
      ...(typeof req.headers['x-agent-name'] === 'string' ? { agentName: req.headers['x-agent-name'] } : {}),
    };
  } catch (err) {
    const e = err instanceof HarborError ? err : new HarborError('unauthorized', 'unauthorized');
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    // RFC 9728: MCP clients discover the OAuth dance from this header.
    if (e.code === 'unauthorized' && deps.auth.metadata?.()) {
      const proto = typeof req.headers['x-forwarded-proto'] === 'string' ? req.headers['x-forwarded-proto'] : 'http';
      headers['WWW-Authenticate'] =
        `Bearer resource_metadata="${proto}://${req.headers.host}/.well-known/oauth-protected-resource"`;
    }
    res.writeHead(e.status, headers).end(
      JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: e.message }, id: null }),
    );
    return;
  }

  const server = buildMcpServer(deps.service, actor);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error('[harbor] mcp transport error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json' }).end(
        JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'internal error' }, id: null }),
      );
    }
  }
}

function buildMcpServer(service: HarborService, actor: McpActor): Server {
  const server = new Server({ name: 'harbor-stub', version: '0.0.1' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: mcpTools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: z.toJSONSchema(t.input) as { type: 'object' },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const def = mcpTools.find((t) => t.name === request.params.name);
    if (!def) return errorResult(`unknown tool: ${request.params.name}`);
    const parsed = def.input.safeParse(request.params.arguments ?? {});
    if (!parsed.success) {
      return errorResult(
        `invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      );
    }
    try {
      const result = await dispatch(service, actor, request.params.name, parsed.data);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as Record<string, unknown>,
      };
    } catch (err) {
      if (err instanceof HarborError) {
        return errorResult(JSON.stringify({ code: err.code, message: err.message, retryable: err.retryable }));
      }
      console.error('[harbor] mcp tool error:', err);
      return errorResult(JSON.stringify({ code: 'internal', message: 'unexpected error', retryable: true }));
    }
  });

  return server;
}

function errorResult(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

async function dispatch(service: HarborService, actor: McpActor, name: string, args: unknown): Promise<unknown> {
  const ctx = { memberId: actor.memberId };
  switch (name) {
    case 'list_spaces': {
      const spaces = await service.listSpaces(ctx);
      return {
        spaces: await Promise.all(
          spaces.map(async (space) => ({
            id: space.id,
            name: space.name,
            memberCount: (await service.listMembers(ctx, space.id)).length,
            assets: await service.listAssets(ctx, space.id),
          })),
        ),
      };
    }
    case 'read_stream': {
      const a = args as { spaceId: string; beforeOffset?: number; limit?: number };
      const { messages, topics, hasMore } = await service.listStream(ctx, a.spaceId, {
        ...(a.beforeOffset !== undefined ? { beforeOffset: a.beforeOffset } : {}),
        limit: a.limit ?? 50,
      });
      // Truncation is stated, never silent: the tool description tells the
      // agent to page back with beforeOffset before summarising.
      return { messages, topics, truncated: hasMore };
    }
    case 'read_thread': {
      const a = args as { spaceId: string; rootMessageId: string; beforeOffset?: number; limit?: number };
      const { root, topic, messages, hasMore } = await service.listThread(ctx, a.spaceId, a.rootMessageId, {
        ...(a.beforeOffset !== undefined ? { beforeOffset: a.beforeOffset } : {}),
        limit: a.limit ?? 50,
      });
      return { root, topic, messages, truncated: hasMore };
    }
    case 'read_asset': {
      const a = args as { spaceId: string; path: string };
      return service.readAsset(ctx, a.spaceId, a.path);
    }
    case 'propose_change': {
      const a = args as {
        spaceId: string;
        path: string;
        baseVersion: number;
        newContent?: string;
        blob?: string;
        reason: string;
      };
      // One-of lives here rather than in the JSON schema (kept plain on purpose).
      if ((a.newContent === undefined) === (a.blob === undefined)) {
        throw new HarborError('invalid_request', 'provide exactly one of newContent (text) or blob (an uploaded sha256)');
      }
      return service.proposeChange(ctx, a.spaceId, {
        assetPath: a.path,
        baseVersion: a.baseVersion,
        ...(a.blob !== undefined ? { blob: a.blob } : { newContent: a.newContent! }),
        reason: a.reason, // required on this face (CONTRACT.md decision 5)
        actingMode: actor.actingMode,
        ...(actor.agentName ? { agentName: actor.agentName } : {}),
      });
    }
    case 'move_asset': {
      const a = args as { spaceId: string; fromPath: string; toPath: string; baseVersion: number; reason: string };
      return service.moveAsset(ctx, a.spaceId, {
        fromPath: a.fromPath,
        toPath: a.toPath,
        baseVersion: a.baseVersion,
        reason: a.reason, // required on this face (CONTRACT.md decision 5)
        actingMode: actor.actingMode,
        ...(actor.agentName ? { agentName: actor.agentName } : {}),
      });
    }
    case 'delete_asset': {
      const a = args as { spaceId: string; path: string; baseVersion: number; reason: string };
      return service.deleteAsset(ctx, a.spaceId, {
        path: a.path,
        baseVersion: a.baseVersion,
        reason: a.reason, // required on this face (CONTRACT.md decision 5)
        actingMode: actor.actingMode,
        ...(actor.agentName ? { agentName: actor.agentName } : {}),
      });
    }
    case 'post_message': {
      const a = args as { spaceId: string; threadRoot?: string; body: string };
      const { message } = await service.postMessage(ctx, a.spaceId, {
        ...(a.threadRoot ? { threadRoot: a.threadRoot } : {}),
        body: a.body,
        actingMode: actor.actingMode,
        ...(actor.agentName ? { agentName: actor.agentName } : {}),
      });
      return { messageId: message.id, ...(message.threadRoot !== undefined ? { threadRoot: message.threadRoot } : {}) };
    }
    case 'list_topics': {
      const a = args as { spaceId: string; includeArchived?: boolean };
      return { topics: await service.listTopics(ctx, a.spaceId, a.includeArchived ?? false) };
    }
    case 'create_topic': {
      const a = args as { spaceId: string; rootMessageId?: string; title: string; body?: string };
      // One-of lives here rather than in the JSON schema (kept plain on purpose).
      if ((a.rootMessageId === undefined) === (a.body === undefined)) {
        throw new HarborError('invalid_request', 'provide exactly one of rootMessageId (promote a thread) or body (post + annotate)');
      }
      const { topic, rootMessage } = await service.createTopic(ctx, a.spaceId, {
        ...(a.rootMessageId !== undefined ? { rootMessageId: a.rootMessageId } : {}),
        title: a.title,
        ...(a.body !== undefined ? { body: a.body } : {}),
        actingMode: actor.actingMode,
        ...(actor.agentName ? { agentName: actor.agentName } : {}),
      });
      return { topic, rootMessageId: rootMessage.id };
    }
    case 'manage_topic': {
      const a = args as {
        spaceId: string;
        topicId: string;
        action: 'retitle' | 'archive' | 'unarchive' | 'remove';
        title?: string;
      };
      const attribution = {
        actingMode: actor.actingMode,
        ...(actor.agentName ? { agentName: actor.agentName } : {}),
      };
      let action: Parameters<HarborService['manageTopic']>[3];
      if (a.action === 'retitle') {
        if (!a.title) throw new HarborError('invalid_request', 'retitle needs a title');
        action = { action: 'retitle', title: a.title, ...attribution };
      } else {
        action = { action: a.action, ...attribution };
      }
      return { topic: await service.manageTopic(ctx, a.spaceId, a.topicId, action) };
    }
    case 'search_feed': {
      const a = args as { spaceId: string; query: string; limit?: number };
      return { results: await service.searchFeed(ctx, a.spaceId, a.query, a.limit) };
    }
    default:
      throw new HarborError('invalid_request', `unknown tool ${name}`);
  }
}
