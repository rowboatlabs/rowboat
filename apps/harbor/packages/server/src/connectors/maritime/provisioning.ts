import type { HostingEnvVar, HostingFileEntry, HostingLogLine, HostingSkill, HostingTrigger } from '@rowboat/spaces-protocol';
import { PlatformRefusal, type HostingOps, type HostingProvider, type ProvisionInput } from '../../core/hosting.js';
import { MARITIME_API, MaritimeError, maritimeApi, type CreateAgentInput, type Execution, type MaritimeApi } from './api.js';

// Managed Maritime agents (spec §8 Maritime, 2026-10-26): Rowboat's own
// account creates and owns the VM, so the app can offer "Create an agent"
// without a key from the person. Each Rowboat agent is one Maritime end user
// (`/docs/sdk/end-users`), named by a key Rowboat mints, so the end user's
// agent is created exactly once however often the call is repeated, the LLM
// cap applies per agent, and deleting the end user takes the agent with it.
// What each kind needs on Maritime is what was measured on 2026-10-26 (the
// plan's section 11): Hermes from a pinned current image with the PATH the
// image's wrapper needs, the coding agents from Maritime's templates, Claude
// Code with the person's Anthropic key as the template requires.

/** The Hermes image Rowboat runs on Maritime: Maritime's own template is v0.14.0, too old for `hermes chat --format stream-json`. */
export const HERMES_IMAGE = 'nousresearch/hermes-agent:v0.22.5';
/** Maritime launches the image's wrapper with a PATH that lacks the hermes binary (measured 2026-10-26). */
const HERMES_PATH = '/opt/hermes/bin:/opt/hermes/.venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

export interface MaritimeProvisionerOptions {
  /** Rowboat's `mk_` key for its Maritime account: deploy, secrets and manage scopes. */
  apiKey: string;
  base?: string;
  /** The monthly AI spend each managed agent may draw from Rowboat's credits, in cents; none = no cap set. */
  llmCapCents?: number;
  /** Seconds a VM stays awake after its last activity before Maritime snapshots it; none = Maritime's default. */
  idleSeconds?: number;
}

/** A Maritime refusal, as the rules want it: its sentence, and whether the thing is gone. */
async function refusing<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof MaritimeError) throw new PlatformRefusal(err.message, err.gone);
    throw err;
  }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Maritime's execution record as the page shows it. */
function shapeExecution(e: Execution) {
  return {
    id: e.executionId,
    status: e.status,
    ...(e.exitCode !== undefined ? { exitCode: e.exitCode } : {}),
    ...(e.stdout !== undefined ? { stdout: e.stdout } : {}),
    ...(e.stderr !== undefined ? { stderr: e.stderr } : {}),
  };
}

/** Maritime's file listing, whose shape its OpenAPI leaves open: a list, or an object holding one, of entries with a name and a type. */
export function shapeFiles(body: unknown, dir: string): HostingFileEntry[] {
  const rows: unknown[] = Array.isArray(body)
    ? body
    : body && typeof body === 'object'
      ? ((['entries', 'files', 'items', 'children'].map((k) => (body as Record<string, unknown>)[k]).find(Array.isArray) as unknown[] | undefined) ?? [])
      : [];
  const base = dir.endsWith('/') ? dir : `${dir}/`;
  return rows.flatMap((r) => {
    if (!r || typeof r !== 'object') return [];
    const o = r as Record<string, unknown>;
    const path = str(o.path) ?? (str(o.name) ? `${base}${o.name}` : undefined);
    if (!path) return [];
    const name = str(o.name) ?? path.split('/').filter(Boolean).at(-1) ?? path;
    const type = str(o.type) ?? str(o.kind) ?? (o.isDirectory === true || o.is_dir === true || o.isDir === true ? 'dir' : o.isDirectory === false || o.is_dir === false || o.isDir === false ? 'file' : undefined);
    const kind: HostingFileEntry['kind'] = type === undefined ? 'other' : /^(dir|directory|folder)$/i.test(type) ? 'dir' : /^(file|regular)$/i.test(type) ? 'file' : 'other';
    const size = num(o.size) ?? num(o.bytes);
    const modified = str(o.modifiedAt) ?? str(o.modified) ?? str(o.mtime) ?? str(o.updatedAt);
    return [{ name, path, kind, ...(size !== undefined ? { size } : {}), ...(modified ? { modifiedAt: modified } : {}) }];
  });
}

/** Maritime's skill rows, installed or from its catalog. */
export function shapeSkills(body: unknown, installed: boolean): HostingSkill[] {
  const rows: unknown[] = Array.isArray(body)
    ? body
    : body && typeof body === 'object'
      ? ((['skills', 'results', 'items', 'installed'].map((k) => (body as Record<string, unknown>)[k]).find(Array.isArray) as unknown[] | undefined) ?? [])
      : [];
  return rows.flatMap((r) => {
    if (typeof r === 'string') return [{ name: r, installed }];
    if (!r || typeof r !== 'object') return [];
    const o = r as Record<string, unknown>;
    const name = str(o.name) ?? str(o.slug) ?? str(o.id);
    if (!name) return [];
    const description = str(o.description) ?? str(o.summary);
    const version = str(o.version);
    return [{ name, installed: typeof o.installed === 'boolean' ? o.installed : installed, ...(description ? { description: description.slice(0, 2000) } : {}), ...(version ? { version } : {}) }];
  });
}

function shapeTrigger(o: Record<string, unknown>): HostingTrigger {
  const config = o.config && typeof o.config === 'object' && !Array.isArray(o.config) ? (o.config as Record<string, unknown>) : {};
  return { id: String(o.id ?? ''), type: String(o.type ?? ''), enabled: o.enabled !== false, config };
}

function shapeLog(o: Record<string, unknown>): HostingLogLine {
  return {
    id: String(o.id ?? ''),
    level: String(o.level ?? 'info'),
    message: String(o.message ?? ''),
    timestamp: String(o.timestamp ?? ''),
    source: String(o.source ?? ''),
  };
}

function shapeEnv(rows: Array<{ key: string; value: string; isSecret: boolean; warning?: string }>): HostingEnvVar[] {
  // A secret's value stays with the platform: the page shows that there is one, never what it is.
  return rows.map((r) => ({ key: r.key, secret: r.isSecret, ...(r.isSecret ? {} : { value: r.value }), ...(r.warning ? { warning: r.warning } : {}) }));
}

/** The management calls on one Maritime agent, in the protocol's shapes. */
export function maritimeOps(api: MaritimeApi, agentId: string): HostingOps {
  const machine = async () => {
    const a = await api.agent(agentId);
    return { status: a.status, ...(a.tier ? { tier: a.tier } : {}) };
  };
  return {
    machine: () => refusing(machine),
    env: () => refusing(async () => shapeEnv(await api.listEnv(agentId))),
    setEnv: (key, value, secret) =>
      refusing(async () => {
        const had = (await api.listEnv(agentId)).some((v) => v.key === key);
        if (had) await api.updateEnv(agentId, key, { value, isSecret: secret });
        else await api.createEnv(agentId, { key, value, isSecret: secret });
      }),
    deleteEnv: (key) => refusing(() => api.deleteEnv(agentId, key)),
    power: (action) =>
      refusing(async () => {
        if (action === 'wake') {
          // An awake VM refuses to start ("already running"): it is what was asked for.
          try {
            await api.start(agentId);
          } catch (err) {
            if (!(err instanceof MaritimeError && err.alreadyRunning)) throw err;
          }
          return machine();
        }
        const a = action === 'restart' ? await api.restart(agentId) : action === 'sleep' ? await api.sleep(agentId) : await api.reloadEnv(agentId);
        return { status: a.status, ...(a.tier ? { tier: a.tier } : {}) };
      }),
    run: (command, timeoutSeconds) => refusing(async () => shapeExecution(await api.exec(agentId, ['sh', '-c', command], { detached: true, timeoutSeconds }))),
    execution: (executionId) => refusing(async () => shapeExecution(await api.execution(agentId, executionId))),
    cancel: (executionId) => refusing(async () => shapeExecution(await api.cancelExecution(agentId, executionId))),
    logs: (opts) =>
      refusing(async () => {
        const rows = await api.logs(agentId, opts);
        const logs = rows.map(shapeLog);
        const last = logs.at(-1);
        return { logs, ...(logs.length >= opts.limit && last ? { nextBefore: last.id || last.timestamp } : {}) };
      }),
    files: (path) => refusing(async () => shapeFiles(await api.listFiles(agentId, path), path)),
    readFile: (path) => refusing(() => api.readFile(agentId, path)),
    writeFile: (path, content) => refusing(() => api.writeFile(agentId, path, content)),
    mkdir: (path) => refusing(() => api.mkdir(agentId, path)),
    move: (from, to) => refusing(() => api.moveFile(agentId, from, to)),
    deleteFile: (path) => refusing(() => api.deleteFile(agentId, path)),
    skills: (q) =>
      refusing(async () => {
        const installed = shapeSkills(await api.listSkills(agentId), true);
        if (!q) return installed;
        const have = new Set(installed.map((s) => s.name));
        return shapeSkills(await api.searchSkills(agentId, q), false).map((s) => ({ ...s, installed: have.has(s.name) }));
      }),
    installSkill: (name) => refusing(async () => void (await api.installSkill(agentId, name))),
    removeSkill: (name) => refusing(() => api.removeSkill(agentId, name)),
    triggers: () => refusing(async () => (await api.listTriggers(agentId)).map(shapeTrigger)),
    createTrigger: (input) => refusing(async () => void (await api.createTrigger(agentId, input))),
    updateTrigger: (triggerId, input) => refusing(async () => void (await api.updateTrigger(agentId, triggerId, input))),
    deleteTrigger: (triggerId) => refusing(() => api.deleteTrigger(agentId, triggerId)),
  };
}

/** What Maritime is asked to create for each kind. */
export function creationFor(kind: string, input: { name: string; anthropicApiKey?: string; env: ProvisionInput['env']; idleSeconds?: number }): CreateAgentInput {
  const env = [...input.env];
  const idle = input.idleSeconds !== undefined ? { idleTtlSeconds: input.idleSeconds } : {};
  if (kind === 'hermes') {
    return { name: input.name, framework: 'hermes', imageName: HERMES_IMAGE, useMaritimeLlm: true, env: [{ key: 'PATH', value: HERMES_PATH, secret: false }, ...env], ...idle };
  }
  if (kind === 'codex') return { name: input.name, templateId: 'codex', env, ...idle };
  if (kind === 'claude-code') {
    return {
      name: input.name,
      templateId: 'claude_code',
      env: [...(input.anthropicApiKey ? [{ key: 'ANTHROPIC_API_KEY', value: input.anthropicApiKey, secret: true }] : []), { key: 'IS_SANDBOX', value: '1', secret: false }, ...env],
      ...idle,
    };
  }
  throw new MaritimeError(0, undefined, `Rowboat does not run ${kind} on Maritime`);
}

/** A Maritime agent name: unique per account, so the display name plus the hosting's own id. */
export function agentNameFor(displayName: string, hostingId: string): string {
  const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'agent';
  return `${slug}-${hostingId.slice(-8).toLowerCase()}`;
}

export function maritimeProvisioner(options: MaritimeProvisionerOptions): HostingProvider {
  const api: MaritimeApi = maritimeApi(options.apiKey, options.base ?? MARITIME_API);
  return {
    async provision(input) {
      await api.upsertEndUser(input.externalUserId, { displayName: input.displayName, tags: ['rowboat'] });
      const created = await api.createEndUserAgent(
        input.externalUserId,
        creationFor(input.kind, {
          name: agentNameFor(input.displayName, input.hostingId),
          ...(input.anthropicApiKey ? { anthropicApiKey: input.anthropicApiKey } : {}),
          env: input.env,
          ...(options.idleSeconds !== undefined && options.idleSeconds > 0 ? { idleSeconds: Math.round(options.idleSeconds) } : {}),
        }),
      );
      if (options.llmCapCents !== undefined && options.llmCapCents > 0) {
        await api.setEndUserPolicy(input.externalUserId, { llm_spend_cap_cents_per_month: Math.round(options.llmCapCents) });
      }
      return { externalId: created.id };
    },
    async status(externalId) {
      let agent;
      try {
        agent = await api.agent(externalId);
      } catch (err) {
        if (err instanceof MaritimeError && err.gone) return 'gone';
        throw err;
      }
      if (agent.status === 'deploying') return 'deploying';
      if (agent.status === 'error') return 'error';
      return 'up';
    },
    async check(externalId) {
      try {
        const run = await api.exec(externalId, ['sh', '-c', 'echo rowboat-ready'], { detached: false, timeoutSeconds: 60 });
        return run.status !== 'running' && (run.exitCode ?? 1) === 0 && (run.stdout ?? '').includes('rowboat-ready');
      } catch (err) {
        if (err instanceof MaritimeError && err.rejectsKey) throw err;
        return false;
      }
    },
    async deprovision(externalUserId) {
      await api.deleteEndUser(externalUserId);
    },
    credential() {
      return options.apiKey;
    },
    manage(externalId) {
      return maritimeOps(api, externalId);
    },
  };
}
