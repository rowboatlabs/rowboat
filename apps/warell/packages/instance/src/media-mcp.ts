import fs from 'node:fs/promises';
import path from 'node:path';

// The agent's media tools (architecture §3.5 "Les médias", 30/09/2026): an
// MCP server the instance registers in config/mcp.json, so no upstream file
// changes (UPSTREAM.md §2). It calls the control plane's /v1/media with the
// instance token; the Pixazo key never reaches the instance.
//
// Two steps, not one blocking call: core's MCP client gives up after 60 s
// (SDK default), and a voice already takes over a minute, a video several.
// `generate` returns at once; `check` waits up to CHECK_WAIT_MS and is called
// again until the file is there.

export const CHECK_WAIT_MS = 45_000;
const POLL_MS = 5_000;

export interface MediaToolsDeps {
  controlUrl: string;
  token: string;
  workDir: string;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const MEDIA_TOOLS: ToolDef[] = [
  {
    name: 'list_models',
    description: 'List the video, speech and music models this account can use, with allowed video durations.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'generate',
    description:
      'Start generating a video, a voice-over or a song. Returns a generation id at once; then call `check` with it until the file is ready. Each generation is charged to the account when started.',
    inputSchema: {
      type: 'object',
      properties: {
        model: { type: 'string', description: 'A model id from list_models (e.g. "seedance-mini", "veo-fast", "gemini-voice", "lyria").' },
        prompt: { type: 'string', description: 'For video and music: a vivid description. For speech: the exact text to read aloud.' },
        duration: { type: 'number', description: 'Video only: seconds, one of the model durations. Omit for the default.' },
        aspect_ratio: { type: 'string', enum: ['16:9', '9:16'], description: 'Video only: 9:16 for a phone/story format.' },
        audio: { type: 'boolean', description: 'Video only: generate native sound (costs more on some models).' },
      },
      required: ['model', 'prompt'],
    },
  },
  {
    name: 'check',
    description:
      'Wait for a generation started with `generate` (up to 45 s per call). When ready, saves the file in the workspace and returns its absolute path; otherwise says it is still running, and you call `check` again.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The id returned by generate.' },
        filename: { type: 'string', description: 'Short kebab-case base name for the saved file, without extension.' },
      },
      required: ['id'],
    },
  },
];

const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError } : {}) });

const EXTENSIONS: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
};

function extensionFor(url: string, contentType: string | null): string {
  const fromType = EXTENSIONS[(contentType ?? '').split(';')[0].trim().toLowerCase()];
  if (fromType) return fromType;
  const fromUrl = /\.([a-z0-9]{2,4})(?:$|\?)/i.exec(new URL(url).pathname)?.[1]?.toLowerCase();
  return fromUrl ?? 'bin';
}

const slug = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

export function createMediaTools(deps: MediaToolsDeps) {
  const call = async (method: string, route: string, body?: unknown) => {
    const res = await deps.fetch(`${deps.controlUrl}/v1/media${route}`, {
      method,
      headers: { authorization: `Bearer ${deps.token}`, 'content-type': 'application/json', 'x-rowboat-use-case': 'media' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, data };
  };

  const errorText = (data: Record<string, unknown>) => {
    const e = (data.error ?? {}) as Record<string, unknown>;
    const resets = typeof e.resets_at === 'string' ? ` It resets at ${e.resets_at}.` : '';
    return `${String(e.code ?? 'error')}: ${String(e.message ?? 'request failed')}.${resets}`;
  };

  async function save(url: string, filename: string | undefined, id: string): Promise<string> {
    const res = await deps.fetch(url);
    if (!res.ok) throw new Error(`download failed (${res.status})`);
    const dir = path.join(deps.workDir, 'generated_media');
    await fs.mkdir(dir, { recursive: true });
    const base = slug(filename ?? '') || slug(id) || 'media';
    const file = path.join(dir, `${base}-${deps.now()}.${extensionFor(url, res.headers.get('content-type'))}`);
    await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
    return file;
  }

  async function run(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (name === 'list_models') {
      const { status, data } = await call('GET', '/models');
      if (status !== 200) return text(errorText(data), true);
      const models = Array.isArray(data.data) ? data.data : [];
      if (models.length === 0) return text('No media models are available on this plan.', true);
      return text(JSON.stringify(models));
    }

    if (name === 'generate') {
      const { status, data } = await call('POST', '/generations', {
        model: args.model,
        prompt: args.prompt,
        ...(args.duration !== undefined ? { duration: args.duration } : {}),
        ...(args.aspect_ratio !== undefined ? { aspect_ratio: args.aspect_ratio } : {}),
        ...(args.audio !== undefined ? { audio: args.audio } : {}),
      });
      if (status !== 202) return text(errorText(data), true);
      return text(`Started generation ${String(data.id)} (${String(data.kind)}). Call check with this id; it usually takes 1 to 5 minutes.`);
    }

    if (name === 'check') {
      if (typeof args.id !== 'string' || !args.id) return text('An id is required.', true);
      const route = `/generations/${encodeURIComponent(args.id)}`;
      const deadline = deps.now() + CHECK_WAIT_MS;
      for (;;) {
        const { status, data } = await call('GET', route);
        if (status !== 200) return text(errorText(data), true);
        if (data.status === 'completed' && typeof data.url === 'string') {
          const file = await save(data.url, typeof args.filename === 'string' ? args.filename : undefined, args.id);
          return text(`Ready. Saved to ${file}. Show this path to the user in a \`\`\`filepath code block.`);
        }
        if (data.status === 'failed') return text('The generation failed; it was not charged. You may try again or another model.', true);
        if (deps.now() + POLL_MS > deadline) {
          return text(`Still ${String(data.status)}. Call check again with id ${args.id}.`);
        }
        await deps.sleep(POLL_MS);
      }
    }

    return text(`Unknown tool ${name}.`, true);
  }

  return { tools: MEDIA_TOOLS, run };
}

// ── MCP over stdio: the few JSON-RPC methods a tools-only server needs. ──

interface RpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export function createMcpHandler(server: ReturnType<typeof createMediaTools>, info = { name: 'warell-media', version: '0.0.1' }) {
  return async (msg: RpcRequest): Promise<Record<string, unknown> | null> => {
    // Notifications (no id) get no answer.
    if (msg.id === undefined) return null;
    const reply = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result });
    switch (msg.method) {
      case 'initialize':
        return reply({
          protocolVersion: typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: info,
        });
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: server.tools });
      case 'tools/call': {
        const name = String(msg.params?.name ?? '');
        const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
        try {
          return reply(await server.run(name, args));
        } catch (err) {
          return reply(text(`Tool failed: ${err instanceof Error ? err.message : String(err)}`, true));
        }
      }
      default:
        return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
    }
  };
}

/** Newline-delimited JSON-RPC on stdin/stdout, as MCP's stdio transport speaks it. */
export function serveStdio(
  handle: ReturnType<typeof createMcpHandler>,
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
) {
  let buffer = '';
  input.setEncoding('utf8');
  input.on('data', (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg: RpcRequest;
      try {
        msg = JSON.parse(line) as RpcRequest;
      } catch {
        output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n');
        continue;
      }
      void handle(msg).then((res) => {
        if (res) output.write(JSON.stringify(res) + '\n');
      });
    }
  });
}
