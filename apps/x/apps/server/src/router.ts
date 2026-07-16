import { Hono } from 'hono';
import { z } from 'zod';
import { ipc } from '@x/shared';
import { isRpcChannel, type RpcHandlers } from './channels.js';

// POST /rpc/{channel} — body and response are the channel's existing Zod
// req/res schemas from @x/shared ipcSchemas, so the wire contract is the IPC
// contract. The router is generic; only the handler map knows the channels.
export function createRpcRoutes(handlers: RpcHandlers): Hono {
  const app = new Hono();

  app.post('/rpc/:channel', async (c) => {
    const channel = c.req.param('channel');
    // Unexposed channels 404 like unknown ones — don't enumerate the surface.
    if (!isRpcChannel(channel) || !(channel in handlers)) {
      return c.json({ error: { code: 'unknown_channel', message: `unknown channel: ${channel}` } }, 404);
    }

    let body: unknown = null;
    const raw = await c.req.text();
    if (raw.length > 0) {
      try {
        body = JSON.parse(raw);
      } catch {
        return c.json({ error: { code: 'invalid_request', message: 'body is not valid JSON' } }, 400);
      }
    }

    let args;
    try {
      args = ipc.validateRequest(channel, body);
    } catch (err) {
      const issues = err instanceof z.ZodError ? err.issues : undefined;
      return c.json({ error: { code: 'invalid_request', message: 'request failed validation', issues } }, 400);
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (handlers[channel] as (a: unknown) => Promise<unknown>)(args as any);
      return c.json(ipc.validateResponse(channel, result) as object);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[server] rpc ${channel} failed:`, message);
      return c.json({ error: { code: 'internal', message } }, 500);
    }
  });

  return app;
}
