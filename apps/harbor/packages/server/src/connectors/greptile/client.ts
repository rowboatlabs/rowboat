import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { IntegrationError } from '../commands.js';

export const GREPTILE_MCP = 'https://api.greptile.com/mcp';
export const repositorySchema = z.object({
  name: z.string().min(1), remote: z.string(), defaultBranch: z.string().min(1),
  remoteUrl: z.string().optional(), reviewsEnabled: z.boolean(),
});
export type Repository = z.infer<typeof repositorySchema>;
export const catalogSchema = z.object({ repositories: z.array(repositorySchema), total: z.number().nonnegative() });
export const prsSchema = z.object({ mergeRequests: z.array(z.object({
  number: z.number().int().positive(), title: z.string(), authorLogin: z.string().nullish(),
})), total: z.number().nonnegative() });
const reviewSchema = z.object({
  id: z.string(), status: z.string(), createdAt: z.iso.datetime({ offset: true }),
  commitSha: z.string().nullish(), body: z.string().nullish(),
});
export const reviewsSchema = z.object({ codeReviews: z.array(reviewSchema), truncated: z.boolean().optional() });
export const reviewDetailSchema = z.object({ codeReview: reviewSchema });
export const commentsSchema = z.object({ comments: z.array(z.object({
  body: z.string(), isGreptileComment: z.boolean(), addressed: z.boolean(),
  filePath: z.string().nullish(), lineStart: z.number().int().nullish(),
})) });
const identitySchema = z.object({
  principal: z.object({ type: z.literal('API_KEY') }),
  organizations: z.array(z.object({ id: z.string(), handle: z.string() })).length(1),
});
export type Tool = 'get_me' | 'list_repositories' | 'list_pull_requests' | 'list_code_reviews'
  | 'get_code_review' | 'list_merge_request_comments' | 'trigger_code_review';

export class GreptileError extends IntegrationError {
  // Resource denial must not disable other repositories (spec §8 Greptile, 2026-10-22).
  override get rejectsKey(): boolean { return this.status === 401; }
}

export interface GreptileOptions {
  endpoint?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

export class GreptileSession {
  constructor(private readonly client: Client, private readonly signal: AbortSignal) {}

  async call<T>(name: Tool, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
    try {
      const result = await this.client.callTool({ name, arguments: args }, undefined, { signal: this.signal, timeout: 20_000 });
      if (result.isError) throw new GreptileError('Greptile could not perform this operation. Check repository access and your Greptile plan.');
      let body: unknown = result.structuredContent;
      if (body === undefined) {
        const parts = z.array(z.object({ type: z.string(), text: z.string().optional() })).parse(result.content).filter((part) => part.type === 'text');
        if (parts.length !== 1) throw new GreptileError('Greptile returned an unexpected tool response.');
        body = JSON.parse(parts[0]!.text as string);
      }
      const parsed = schema.safeParse(body);
      if (!parsed.success) throw new GreptileError('Greptile returned an unexpected tool response.');
      return parsed.data;
    } catch (error) {
      // A lost acknowledgement may still have queued work; never replay it (spec §8, 2026-10-22).
      if (name === 'trigger_code_review' && !(error instanceof GreptileError && error.status && error.status >= 400 && error.status < 500)) {
        throw new GreptileError('The review request could not be confirmed and may have been accepted. Use status before requesting another review.');
      }
      if (error instanceof GreptileError) throw error;
      throw new GreptileError('Greptile did not return a valid response in time. Try again.');
    }
  }
}

export class GreptileApi {
  constructor(private readonly secret: string, private readonly options: GreptileOptions = {}) {}

  async check(): Promise<void> {
    await this.withSession(async (session) => {
      await session.call('get_me', {}, identitySchema);
      await session.call('list_repositories', { limit: 1, page: 0 }, catalogSchema);
    });
  }

  async withSession<T>(run: (session: GreptileSession) => Promise<T>): Promise<T> {
    const key = this.secret.trim();
    if (!key || /[\r\n]/.test(key)) throw new GreptileError('Enter a Greptile organization API key.');
    const endpoint = new URL(this.options.endpoint ?? GREPTILE_MCP);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 45_000);
    const client = new Client({ name: 'rowboat-greptile', version: '1.0.0' });
    let transportFailure: GreptileError | undefined;
    const maxBytes = this.options.maxBytes ?? 2 * 1024 * 1024;
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { authorization: `Bearer ${key}` } },
      reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
      fetch: async (input, init) => {
        try {
          const url = new URL(input instanceof Request ? input.url : String(input));
          if (url.href !== endpoint.href) throw new GreptileError('Greptile requested an unexpected endpoint.');
          const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(init?.method === 'DELETE' ? 2000 : 20_000), ...(init?.signal ? [init.signal] : [])]);
          const response = await fetch(input, { ...init, signal, redirect: 'error' });
          if (!response.ok && !(init?.method === 'GET' && response.status === 405) && !(init?.method === 'DELETE' && [404, 405].includes(response.status))) {
            await response.body?.cancel();
            const messages: Record<number, string> = {
              401: 'This Greptile key is invalid or revoked.',
              403: 'Greptile denied access to this operation. Check repository access and your plan.',
              429: 'Greptile is rate limiting requests. Try again shortly.',
            };
            throw new GreptileError(messages[response.status] ?? `Greptile could not complete the request (HTTP ${response.status}).`, response.status);
          }
          if (!response.body) return response;
          let bytes = 0;
          const bounded = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, stream) {
              bytes += chunk.byteLength;
              if (bytes > maxBytes) {
                transportFailure = new GreptileError('Greptile returned too much data. Narrow the request in Greptile.');
                throw transportFailure;
              }
              stream.enqueue(chunk);
            },
          }));
          return new Response(bounded, { status: response.status, statusText: response.statusText, headers: response.headers });
        } catch (error) {
          transportFailure = error instanceof GreptileError ? error : new GreptileError('Could not reach Greptile. Try again.');
          throw transportFailure;
        }
      },
    });
    try {
      await client.connect(transport, { signal: controller.signal, timeout: 20_000 });
      return await run(new GreptileSession(client, controller.signal));
    } catch (error) {
      if (error instanceof GreptileError && error.message.includes('may have been accepted')) throw error;
      throw transportFailure ?? (error instanceof GreptileError ? error : new GreptileError('Could not communicate with Greptile. Try again.'));
    } finally {
      await transport.terminateSession().catch(() => undefined);
      await client.close().catch(() => undefined);
      controller.abort();
      clearTimeout(timer);
    }
  }
}
