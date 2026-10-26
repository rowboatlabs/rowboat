import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface GreptileCall { name: string; args: Record<string, unknown>; key: string }
export interface FakeReply { status?: number; data?: unknown; toolError?: boolean; raw?: string; delay?: number; redirect?: string }
export const REPO = { name: 'owner/repo', remote: 'github', defaultBranch: 'develop', reviewsEnabled: true };
export const REVIEW = { id: 'review-1', status: 'COMPLETED', createdAt: '2026-10-22T10:00:00Z', commitSha: 'abcdef', body: 'Review summary' };
export function defaultGreptileReply(call: GreptileCall): FakeReply {
  switch (call.name) {
    case 'get_me': return { data: { principal: { type: 'API_KEY' }, organizations: [{ id: 'org', handle: 'test' }] } };
    case 'list_repositories': return { data: { repositories: [REPO], total: 1 } };
    case 'list_pull_requests': return { data: { mergeRequests: [{ number: 42, title: 'Fix bug', authorLogin: 'alice' }], total: 1 } };
    case 'trigger_code_review': return { data: { success: true } };
    case 'list_code_reviews': return { data: { codeReviews: [REVIEW] } };
    case 'get_code_review': return { data: { codeReview: REVIEW } };
    case 'list_merge_request_comments': return { data: { comments: [{ body: 'Check null input', isGreptileComment: true, addressed: false, filePath: 'src/main.ts', lineStart: 12 }] } };
    default: return { toolError: true, data: { error: 'unknown tool' } };
  }
}

export async function fakeGreptile() {
  const calls: GreptileCall[] = [];
  let route: (call: GreptileCall) => FakeReply = defaultGreptileReply;
  let sse = false, structured = true, terminated = 0, initialized = 0;
  const server = createServer(async (req, res) => {
    if (req.method === 'GET') { res.writeHead(405).end(); return; }
    if (req.method === 'DELETE') { terminated++; res.writeHead(200).end(); return; }
    if (!['Bearer good', 'Bearer other'].includes(req.headers.authorization ?? '')) {
      res.writeHead(401).end('SECRET_SENTINEL'); return;
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const rpc = JSON.parse(raw);
    if (rpc.method === 'notifications/initialized' || rpc.id === undefined) { res.writeHead(202).end(); return; }
    if (rpc.method === 'initialize') {
      initialized++;
      res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': `fixture-${initialized}` });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { protocolVersion: rpc.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } }));
      return;
    }
    const call = { name: rpc.params.name as string, args: rpc.params.arguments as Record<string, unknown>, key: req.headers.authorization! };
    calls.push(call);
    const reply = route(call);
    if (reply.delay) await new Promise((r) => setTimeout(r, reply.delay));
    if (res.destroyed) return;
    if (reply.redirect) { res.writeHead(302, { location: reply.redirect }).end(); return; }
    const result = { content: [{ type: 'text', text: JSON.stringify(reply.data ?? {}) }], ...(structured ? { structuredContent: reply.data ?? {} } : {}), ...(reply.toolError ? { isError: true } : {}) };
    const message = JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result });
    res.writeHead(reply.status ?? 200, { 'content-type': sse ? 'text/event-stream' : 'application/json' });
    res.end(reply.raw ?? (sse ? `event: message\ndata: ${message}\n\n` : message));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`, calls,
    setRoute: (next: typeof route) => { route = next; },
    useSse: () => { sse = true; }, useText: () => { structured = false; },
    get terminated() { return terminated; }, get initialized() { return initialized; },
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }),
  };
}
