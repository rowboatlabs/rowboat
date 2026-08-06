import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkDir } from '@x/core/dist/config/config.js';
import {
  SELF_HOSTED_TRANSCRIPTION_PROTOCOL,
  normalizeSelfHostedTranscriptionUrl,
  validateSelfHostedTranscriptionLanguage,
  validateSelfHostedTranscriptionToken,
} from '@x/shared/dist/self-hosted-transcription.js';

const CONFIG_FILENAME = 'meeting-transcription.json';
const ENV_URL = 'ROWBOAT_MEETING_STT_URL';
const ENV_TOKEN = 'ROWBOAT_MEETING_STT_TOKEN';
const MAX_CONNECTIONS = 4;
const MAX_PCM_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

export type SelfHostedTranscriptUpdate = {
  channelIndex: 0 | 1;
  full: string;
  committed: string;
  tentative: string;
  final: boolean;
  revision: number;
  inputMs: number;
  bufferedMs: number;
};

type ProviderConfig = {
  baseUrl: string;
  token: string;
  language: string;
};

type Session = {
  id: string;
  ownerId: number;
  config: ProviderConfig;
  microphoneSession: string;
  systemSession: string;
  tail: Promise<void>;
  closed: boolean;
};

type ConfigFile = {
  provider?: unknown;
  protocol?: unknown;
  baseUrl?: unknown;
  tokenFile?: unknown;
  language?: unknown;
};

export type SelfHostedProviderStatus = {
  configured: boolean;
  valid: boolean;
  protocol?: typeof SELF_HOSTED_TRANSCRIPTION_PROTOCOL;
  endpoint?: string;
  error?: string;
};

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Self-hosted transcription failed';
}

async function readTokenFile(rawPath: unknown): Promise<string> {
  if (typeof rawPath !== 'string' || !path.isAbsolute(rawPath)) {
    throw new Error('Self-hosted transcription tokenFile must be an absolute path');
  }
  const stat = await fs.lstat(rawPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('Self-hosted transcription tokenFile must be a regular non-symlink file');
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new Error('Self-hosted transcription tokenFile must not be accessible by group or other users');
  }
  if (stat.size < 32 || stat.size > 1_024) {
    throw new Error('Self-hosted transcription tokenFile has an invalid size');
  }
  return validateSelfHostedTranscriptionToken(await fs.readFile(rawPath, 'utf8'));
}

async function readConfigFile(): Promise<{ configured: boolean; value?: ConfigFile }> {
  const configPath = path.join(WorkDir, 'config', CONFIG_FILENAME);
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    if (raw.length > 16 * 1024) throw new Error('Self-hosted transcription config is too large');
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Self-hosted transcription config must be a JSON object');
    }
    const config = value as ConfigFile;
    if (config.provider !== 'self-hosted') return { configured: false };
    return { configured: true, value: config };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { configured: false };
    throw error;
  }
}

async function resolveConfig(): Promise<{ configured: boolean; config?: ProviderConfig }> {
  const envUrl = process.env[ENV_URL]?.trim();
  const envToken = process.env[ENV_TOKEN]?.trim();
  const file = await readConfigFile();
  const configured = Boolean(envUrl || envToken || file.configured);
  if (!configured) return { configured: false };

  const value = file.value ?? {};
  if (value.protocol !== undefined && value.protocol !== SELF_HOSTED_TRANSCRIPTION_PROTOCOL) {
    throw new Error(`Unsupported self-hosted transcription protocol; expected ${SELF_HOSTED_TRANSCRIPTION_PROTOCOL}`);
  }
  const rawUrl = envUrl ?? (typeof value.baseUrl === 'string' ? value.baseUrl : '');
  if (!rawUrl) throw new Error(`Set ${ENV_URL} or baseUrl in ${CONFIG_FILENAME}`);

  let token: string;
  if (envToken) {
    token = validateSelfHostedTranscriptionToken(envToken);
  } else {
    token = await readTokenFile(value.tokenFile);
  }

  return {
    configured: true,
    config: {
      baseUrl: normalizeSelfHostedTranscriptionUrl(rawUrl),
      token,
      language: validateSelfHostedTranscriptionLanguage(value.language),
    },
  };
}

function endpoint(baseUrl: string, route: string, session?: string, language?: string): string {
  const url = new URL(`${baseUrl}/${route}`);
  if (session) url.searchParams.set('session', session);
  if (language) url.searchParams.set('language', language);
  return url.toString();
}

async function request(
  config: ProviderConfig,
  route: string,
  options: { method?: 'GET' | 'POST'; session?: string; language?: string; body?: Buffer } = {},
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  timeout.unref();
  try {
    const response = await fetch(endpoint(
      config.baseUrl,
      route,
      options.session,
      options.language,
    ), {
      method: options.method ?? 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        ...(options.body ? { 'Content-Type': 'application/octet-stream' } : {}),
      },
      body: options.body ? Uint8Array.from(options.body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new Error('Self-hosted transcription response exceeded the size limit');
    }
    if (!response.ok) {
      throw new Error(`Self-hosted transcription ${route} failed with HTTP ${response.status}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Self-hosted transcription ${route} returned invalid JSON`);
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error(`Self-hosted transcription ${route} timed out`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function finiteNonNegative(value: unknown, field: string, integer = false): number {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < 0
    || (integer && !Number.isInteger(value))
  ) {
    throw new Error(`Self-hosted transcription response has invalid ${field}`);
  }
  return value;
}

function boundedText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length > 250_000) {
    throw new Error(`Self-hosted transcription response has invalid ${field}`);
  }
  return value;
}

function parseSnapshot(value: unknown, channelIndex: 0 | 1): SelfHostedTranscriptUpdate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Self-hosted transcription returned an invalid snapshot');
  }
  const snapshot = value as Record<string, unknown>;
  if (typeof snapshot.final !== 'boolean') {
    throw new Error('Self-hosted transcription response has invalid final state');
  }
  return {
    channelIndex,
    full: boundedText(snapshot.full, 'full text'),
    committed: boundedText(snapshot.committed, 'committed text'),
    tentative: boundedText(snapshot.tentative, 'tentative text'),
    final: snapshot.final,
    revision: finiteNonNegative(snapshot.revision, 'revision', true),
    inputMs: finiteNonNegative(snapshot.inputMs, 'inputMs'),
    bufferedMs: finiteNonNegative(snapshot.bufferedMs, 'bufferedMs'),
  };
}

function decodeStereoPcm(base64: string): { microphone: Buffer; system: Buffer } {
  if (
    !base64
    || base64.length > Math.ceil(MAX_PCM_BYTES * 4 / 3) + 4
    || base64.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  ) {
    throw new Error('Self-hosted transcription PCM payload is invalid');
  }
  const stereo = Buffer.from(base64, 'base64');
  if (stereo.length === 0 || stereo.length > MAX_PCM_BYTES || stereo.length % 4 !== 0) {
    throw new Error('Self-hosted transcription requires interleaved stereo s16 PCM');
  }
  const frames = stereo.length / 4;
  const microphone = Buffer.allocUnsafe(frames * 2);
  const system = Buffer.allocUnsafe(frames * 2);
  for (let frame = 0; frame < frames; frame += 1) {
    const source = frame * 4;
    const destination = frame * 2;
    microphone[destination] = stereo[source];
    microphone[destination + 1] = stereo[source + 1];
    system[destination] = stereo[source + 2];
    system[destination + 1] = stereo[source + 3];
  }
  return { microphone, system };
}

async function bestEffortReset(session: Session): Promise<void> {
  await Promise.allSettled([
    request(session.config, 'stream/reset', { session: session.microphoneSession }),
    request(session.config, 'stream/reset', { session: session.systemSession }),
  ]);
}

export class SelfHostedMeetingTranscription {
  private sessions = new Map<string, Session>();
  private ownersStarting = new Set<number>();

  async status(): Promise<SelfHostedProviderStatus> {
    try {
      const resolved = await resolveConfig();
      if (!resolved.config) return { configured: false, valid: true };
      return {
        configured: true,
        valid: true,
        protocol: SELF_HOSTED_TRANSCRIPTION_PROTOCOL,
        endpoint: new URL(resolved.config.baseUrl).host,
      };
    } catch (error) {
      return { configured: true, valid: false, error: safeError(error) };
    }
  }

  async begin(ownerId: number): Promise<{ connectionId: string }> {
    if (this.ownersStarting.has(ownerId)) {
      throw new Error('Self-hosted transcription is already starting');
    }
    this.ownersStarting.add(ownerId);
    try {
      const resolved = await resolveConfig();
      if (!resolved.config) throw new Error('Self-hosted transcription is not configured');
      const config = resolved.config;
      await this.resetOwner(ownerId);
      if (this.sessions.size >= MAX_CONNECTIONS) {
        throw new Error('Self-hosted transcription connection capacity reached');
      }

      const health = await request(config, 'health', { method: 'GET' });
      if (!health || typeof health !== 'object' || (health as { ok?: unknown }).ok !== true) {
        throw new Error('Self-hosted transcription health check failed');
      }
      const maxStreams = (health as { maxStreams?: unknown }).maxStreams;
      if (typeof maxStreams !== 'number' || !Number.isInteger(maxStreams) || maxStreams < 2) {
        throw new Error('Self-hosted transcription worker must allow at least two streams');
      }

      const id = randomUUID();
      const suffix = id.replaceAll('-', '').slice(0, 24);
      const session: Session = {
        id,
        ownerId,
        config,
        microphoneSession: `rowboat-${suffix}-mic`,
        systemSession: `rowboat-${suffix}-system`,
        tail: Promise.resolve(),
        closed: false,
      };
      try {
        await Promise.all([
          request(config, 'stream/begin', {
            session: session.microphoneSession,
            language: config.language,
          }),
          request(config, 'stream/begin', {
            session: session.systemSession,
            language: config.language,
          }),
        ]);
      } catch (error) {
        await bestEffortReset(session);
        throw error;
      }
      this.sessions.set(id, session);
      return { connectionId: id };
    } finally {
      this.ownersStarting.delete(ownerId);
    }
  }

  async feed(
    ownerId: number,
    connectionId: string,
    pcmBase64: string,
  ): Promise<{ updates: SelfHostedTranscriptUpdate[] }> {
    const session = this.ownedSession(ownerId, connectionId);
    if (session.closed) throw new Error('Self-hosted transcription session is closed');
    const pcm = decodeStereoPcm(pcmBase64);

    const task = session.tail.then(async () => {
      if (session.closed) throw new Error('Self-hosted transcription session is closed');
      const [microphone, system] = await Promise.all([
        request(session.config, 'stream/feed', {
          session: session.microphoneSession,
          body: pcm.microphone,
        }),
        request(session.config, 'stream/feed', {
          session: session.systemSession,
          body: pcm.system,
        }),
      ]);
      return {
        updates: [
          parseSnapshot(microphone, 0),
          parseSnapshot(system, 1),
        ],
      };
    });
    session.tail = task.then(() => undefined, () => undefined);
    return task;
  }

  async finalize(
    ownerId: number,
    connectionId: string,
  ): Promise<{ updates: SelfHostedTranscriptUpdate[] }> {
    const session = this.ownedSession(ownerId, connectionId);
    session.closed = true;
    await session.tail;
    try {
      const [microphone, system] = await Promise.all([
        request(session.config, 'stream/finalize', { session: session.microphoneSession }),
        request(session.config, 'stream/finalize', { session: session.systemSession }),
      ]);
      return {
        updates: [
          parseSnapshot(microphone, 0),
          parseSnapshot(system, 1),
        ],
      };
    } finally {
      this.sessions.delete(connectionId);
      await bestEffortReset(session);
    }
  }

  async reset(ownerId: number, connectionId: string): Promise<void> {
    const session = this.sessions.get(connectionId);
    if (!session || session.ownerId !== ownerId) return;
    session.closed = true;
    await session.tail;
    this.sessions.delete(connectionId);
    await bestEffortReset(session);
  }

  async resetOwner(ownerId: number): Promise<void> {
    const owned = [...this.sessions.values()].filter((session) => session.ownerId === ownerId);
    await Promise.all(owned.map((session) => this.reset(ownerId, session.id)));
  }

  private ownedSession(ownerId: number, connectionId: string): Session {
    const session = this.sessions.get(connectionId);
    if (!session || session.ownerId !== ownerId) {
      throw new Error('Self-hosted transcription session is unavailable');
    }
    return session;
  }
}

export const selfHostedMeetingTranscription = new SelfHostedMeetingTranscription();
