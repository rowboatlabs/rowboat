import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createMcpHandler, createMediaTools, serveStdio } from '../src/media-mcp.js';

interface Seen { url: string; init?: RequestInit }

async function setup(respond: (s: Seen) => Response) {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baarali-media-'));
  const seen: Seen[] = [];
  let clock = 0;
  const tools = createMediaTools({
    controlUrl: 'https://c.test', token: 'tok', workDir,
    fetch: (async (url: string, init?: RequestInit) => { const s = { url: String(url), init }; seen.push(s); return respond(s); }) as typeof fetch,
    sleep: async (ms) => { clock += ms; },
    now: () => clock,
  });
  return { tools, seen, workDir };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const textOf = (r: { content: Array<{ text: string }> }) => r.content[0].text;

describe('media tools', () => {
  it('starts a generation with the instance token', async () => {
    const { tools, seen } = await setup(() => json({ id: 'job1', status: 'pending', kind: 'video', credits: 38, balance: 165 }, 202));
    const r = await tools.run('generate', { model: 'seedance-mini', prompt: 'Un marché', aspect_ratio: '9:16' });
    expect(r.isError).toBeUndefined();
    expect(textOf(r)).toContain('Started generation job1 (video), 38 media credits; 165 left.');
    expect(seen[0].url).toBe('https://c.test/v1/media/generations');
    expect((seen[0].init!.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(seen[0].init!.body as string)).toEqual({ model: 'seedance-mini', prompt: 'Un marché', aspect_ratio: '9:16' });
  });

  it('passes a refusal on with the price and the balance', async () => {
    const { tools } = await setup(() => json({ error: { code: 'insufficient_media_credits', message: 'Not enough media credits for this generation', cost: 320, balance: 12 } }, 402));
    const r = await tools.run('generate', { model: 'veo', prompt: 'x' });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toBe(
      'insufficient_media_credits: Not enough media credits for this generation. It costs 320 media credits; the balance is 12. The user can buy a media credit pack, or pick a cheaper model or a shorter duration.',
    );
  });

  it('waits, then saves the file in the workspace', async () => {
    let polls = 0;
    const { tools, workDir } = await setup((s) => {
      if (s.url.startsWith('https://cdn.test/')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'video/mp4' } });
      polls++;
      return json(polls < 3 ? { status: 'processing' } : { status: 'completed', url: 'https://cdn.test/out' });
    });
    const r = await tools.run('check', { id: 'job1', filename: 'Marché à Ouaga' });
    const file = /Saved to (\S+)\./.exec(textOf(r))![1];
    expect(path.dirname(file)).toBe(path.join(workDir, 'generated_media'));
    expect(path.basename(file)).toMatch(/^marche-a-ouaga-\d+\.mp4$/);
    expect([...(await fs.readFile(file))]).toEqual([1, 2, 3]);
  });

  it('returns before the MCP timeout when the job is still running', async () => {
    const { tools, seen } = await setup(() => json({ status: 'processing' }));
    const r = await tools.run('check', { id: 'job1' });
    expect(textOf(r)).toBe('Still processing. Call check again with id job1.');
    expect(seen.length).toBe(10); // at 0, 5 … 45 s
  });

  it('reports a failed generation as refunded', async () => {
    const { tools } = await setup(() => json({ status: 'failed' }));
    const r = await tools.run('check', { id: 'job1' });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('credits were given back');
  });

  it('says so when the plan has no media', async () => {
    const { tools } = await setup(() => json({ data: [] }));
    expect((await tools.run('list_models', {})).isError).toBe(true);
  });
});

describe('MCP over stdio', () => {
  it('answers initialize, tools/list and tools/call, and ignores notifications', async () => {
    const { tools } = await setup(() => json({ data: [{ id: 'lyria', kind: 'music', name: 'Lyria 3' }] }));
    const input = new PassThrough();
    const output = new PassThrough();
    serveStdio(createMcpHandler(tools), input, output);
    const lines: Array<Record<string, any>> = [];
    output.on('data', (c: Buffer) => c.toString().split('\n').filter(Boolean).forEach((l) => lines.push(JSON.parse(l))));
    const send = (m: unknown) => input.write(JSON.stringify(m) + '\n');
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_models', arguments: {} } });
    send({ jsonrpc: '2.0', id: 4, method: 'nope' });
    await new Promise((r) => setTimeout(r, 20));
    const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
    expect(lines).toHaveLength(4);
    expect(byId[1].result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'baarali-media' } });
    expect(byId[2].result.tools.map((t: { name: string }) => t.name)).toEqual(['list_models', 'generate', 'check']);
    expect(byId[3].result.content[0].text).toContain('lyria');
    expect(byId[4].error.code).toBe(-32601);
  });
});
