import fs from 'node:fs/promises';
import path from 'node:path';

// Prepares an instance workdir before rowboat-server boots (roadmap phase 0,
// 30/09/2026). Only files the upstream already reads are written, in their
// upstream shape, so no upstream file changes (UPSTREAM.md §2). What the
// person changes later in the app is kept: only the control-plane session is
// rewritten on every boot, because the control plane owns it.

export interface SeedOptions {
  workDir: string;
  /** Bearer the control plane issued to this instance (core reads it as the Rowboat session). */
  instanceToken: string;
  /** Model used until the person picks one, as an OpenRouter id. */
  assistantModel: string;
}

/** Far future: the control plane rotates the token, core must never try to refresh it. */
export const NEVER_EXPIRES = 4_102_444_800; // 2100-01-01

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}

export async function seedWorkdir(opts: SeedOptions): Promise<void> {
  const config = path.join(opts.workDir, 'config');

  // Loopback only: the gate is the one door (gate.ts).
  const serverFile = path.join(config, 'server.json');
  const server = (await readJson(serverFile)) ?? {};
  await writeJson(serverFile, { ...server, lanEnabled: false });

  // The `rowboat` session is how core authenticates to API_URL
  // (core auth/tokens.ts getAccessToken): here, the control plane.
  const oauthFile = path.join(config, 'oauth.json');
  const oauth = (await readJson(oauthFile)) ?? {};
  const providers = (oauth.providers && typeof oauth.providers === 'object' ? oauth.providers : {}) as Record<string, unknown>;
  await writeJson(oauthFile, {
    ...oauth,
    version: 2,
    providers: {
      ...providers,
      rowboat: {
        mode: 'rowboat',
        tokens: { access_token: opts.instanceToken, refresh_token: null, expires_at: NEVER_EXPIRES, token_type: 'Bearer' },
      },
    },
  });

  // Initial model choice only; a choice already made is never overwritten.
  const modelsFile = path.join(config, 'models.json');
  const models = (await readJson(modelsFile)) ?? { version: 2, providers: {} };
  if (!models.assistantModel) {
    await writeJson(modelsFile, {
      ...models,
      version: 2,
      providers: models.providers ?? {},
      assistantModel: { provider: 'rowboat', model: opts.assistantModel },
    });
  }
}
