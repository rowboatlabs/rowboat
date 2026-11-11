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
// plan's section 11): Hermes from Rowboat's own image as a Maritime "custom"
// container (2026-11-11, see runtimes.ts), the coding agents from Maritime's
// templates, Claude Code with the person's Anthropic key as the template requires.

import { HERMES_IMAGE } from './runtimes.js';

export { HERMES_IMAGE };

/** Where each provider's key goes and where its API is, for a runtime the platform had pointed at its own proxy. */
export const LLM_SETUP: Record<'openai' | 'anthropic' | 'openrouter', { keyVar: string; baseUrl: string }> = {
  openai: { keyVar: 'OPENAI_API_KEY', baseUrl: 'https://api.openai.com/v1' },
  anthropic: { keyVar: 'ANTHROPIC_API_KEY', baseUrl: 'https://api.anthropic.com' },
  openrouter: { keyVar: 'OPENROUTER_API_KEY', baseUrl: 'https://openrouter.ai/api/v1' },
};

// Machine sizes (2026-11-04): the range and the rate are Maritime's, read live (account limits,
// machine types). Two facts are only in its billing docs (maritime.sh/docs/billing, read
// 2026-11-04), not its API: an agent box's memory is billed in 2 GB blocks, rounded up, and its
// rate is per block; a month is 730 hours. They shape the options and the estimate only. What
// an owner pays is the platform's own per-agent cost (core/hosting.ts settle).
const MEM_BLOCK_MB = 2048;
const HOURS_PER_MONTH = 730;
const AGENT_BOX = 'persistent_sandbox';

/** What takes the platform's proxy token's place when the owner's key is for another provider, or the owner signed in to a plan: a value the proxy refuses. */
export const PROXY_TOKEN_DUD = 'disabled-by-rowboat-owner-key';

// Codex's sign-in (2026-10-30), kept by the template under /data/.codex: Codex's own word on whether one is there, and
// the two lines in the template's config that would send a signed-in Codex to the platform's proxy anyway, or ask the
// ChatGPT backend for a model it does not serve (seen 2026-10-30: "The 'gpt-5.5' model is not supported when using
// Codex with a ChatGPT account"). The template writes the provider line when no sign-in was there at boot and leaves
// it out when one was (its server.js, read 2026-10-30), so dropping it is what the template's next boot would do; the
// model line goes with it, so Codex falls to its own default for the account. The marker on the first line stays.
const CODEX_SIGN_IN_STATUS = 'CODEX_HOME=/data/.codex codex login status 2>&1';
const CODEX_SIGNED_IN = /Logged in using ChatGPT/;
const CODEX_CONFIG_OWN_PROVIDER = `f=/data/.codex/config.toml; if [ -f "$f" ] && head -n 1 "$f" | grep -q 'managed-by: maritime'; then sed -i '/^model_provider = /d; /^model = /d' "$f"; fi; true`;
const CODEX_SIGN_OUT = 'CODEX_HOME=/data/.codex codex logout 2>&1; true';
/** A sign-in command is a process on the VM, not a model call: seconds, more when the VM has to wake first. */
const SIGN_IN_TIMEOUT_S = 60;

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
export function maritimeOps(api: MaritimeApi, agentId: string, externalUserId: string): HostingOps {
  const machine = async () => {
    const a = await api.agent(agentId);
    return { status: a.status, ...(a.tier ? { tier: a.tier } : {}) };
  };
  /** Environment variables set or replaced, after one listing. */
  const putter = async () => {
    const have = new Set((await api.listEnv(agentId)).map((v) => v.key));
    return async (key: string, value: string, isSecret: boolean) => {
      if (have.has(key)) await api.updateEnv(agentId, key, { value, isSecret });
      else {
        await api.createEnv(agentId, { key, value, isSecret });
        have.add(key);
      }
    };
  };
  /** The gateway and the templates read the new environment without waiting for a restart; asleep, the next start reads it anyway. */
  const reload = async () => {
    try {
      await api.reloadEnv(agentId);
    } catch (err) {
      if (!(err instanceof MaritimeError)) throw err;
    }
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
    console: (ttlSeconds) =>
      refusing(async () => {
        // The dashboard's own terminal is this socket with a session token; an end-user token
        // scoped `console` opens it the same way (`/docs/sdk/end-users`), for this one agent.
        const minted = await api.mintEndUserToken(externalUserId, { agentId, scopes: ['console'], ttlSeconds });
        return { url: `${api.base.replace(/^http/, 'ws')}/api/agents/${encodeURIComponent(agentId)}/terminal`, token: minted.token, expiresAt: minted.expiresAt };
      }),
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
    spend: () =>
      refusing(async () => {
        const s = await api.spendLimit(agentId);
        return { spentCents: s.spentThisMonthCents, ...(s.monthlyLimitCents !== undefined ? { limitCents: s.monthlyLimitCents } : {}), limitReached: s.limitReached, ...(s.periodEnd ? { periodEnd: s.periodEnd } : {}) };
      }),
    // The owner's key, the way each runtime finds it: the provider's own variable, the provider's address where the
    // platform had pointed the runtime at its proxy, and two of Rowboat's for the turn script (runtimes.ts) to put the
    // provider and model back into Hermes's config after the platform's boot rewrite. The platform's proxy token in
    // OPENAI_API_KEY goes too, replaced by the owner's key or by a dud, so the proxy refuses rather than bills; and the
    // agent's own cap is lifted, since the platform puts a capped agent to sleep and gates its wakes (its docs), which
    // would hold an agent on its owner's key down for the rest of the month. Then a reload, so the gateway and the
    // templates read the new environment without waiting for a restart.
    setLlm: ({ provider, apiKey, model }) =>
      refusing(async () => {
        if (provider === 'chatgpt') throw new MaritimeError(0, undefined, 'a ChatGPT plan takes no key');
        const put = await putter();
        const { keyVar, baseUrl } = LLM_SETUP[provider];
        await put(keyVar, apiKey, true);
        if (provider === 'openai') await put('OPENAI_BASE_URL', baseUrl, false);
        else await put('OPENAI_API_KEY', PROXY_TOKEN_DUD, true);
        await put('ROWBOAT_LLM_PROVIDER', provider, false);
        await put('ROWBOAT_LLM_MODEL', model ?? '', false);
        await api.setSpendLimit(agentId, null);
        await reload();
      }),
    // Rowboat's LLM gateway on the owner's Rowboat credits (2026-11-04): the gateway speaks OpenRouter's API, so
    // Hermes takes it as its OpenRouter provider at the gateway's address (the turn script, runtimes.ts), with the
    // key the gateway bills to the owner. The platform's proxy token goes as for an owner's key, so nothing is
    // billed to Rowboat's platform account, and the cap is lifted for the same reason as there.
    useGateway: ({ baseUrl, apiKey, model }) =>
      refusing(async () => {
        const put = await putter();
        await put('OPENROUTER_API_KEY', apiKey, true);
        await put('OPENAI_API_KEY', PROXY_TOKEN_DUD, true);
        await put('ROWBOAT_LLM_PROVIDER', 'rowboat', false);
        await put('ROWBOAT_LLM_BASE_URL', baseUrl, false);
        await put('ROWBOAT_LLM_MODEL', model ?? '', false);
        await api.setSpendLimit(agentId, null);
        await reload();
      }),
    // An agent its owner funds (2026-11-04, Codex on a deployment that bills): no trial, so the platform's proxy
    // token is a dud from the start and the agent runs once its owner signs in or adds a key.
    withoutPlatformLlm: () =>
      refusing(async () => {
        const put = await putter();
        await put('OPENAI_API_KEY', PROXY_TOKEN_DUD, true);
        await api.setSpendLimit(agentId, null);
        await reload();
      }),
    size: () =>
      refusing(async () => {
        const [agent, limits, types] = await Promise.all([api.agent(agentId), api.accountLimits(), api.machineTypes().catch(() => [])]);
        const rate = types.find((t) => t.type === AGENT_BOX)?.centsPerHour;
        const blocks = (memMb: number) => Math.max(1, Math.ceil(memMb / MEM_BLOCK_MB));
        // A wallet account is never billed for a resize (Maritime's resize docs), so every size costs the base.
        const estimate = (memMb: number) => (rate === undefined ? undefined : rate * HOURS_PER_MONTH * (limits.billingModel === 'wallet' ? 1 : blocks(memMb)));
        const lo = blocks(limits.minMemMb ?? MEM_BLOCK_MB) * MEM_BLOCK_MB;
        const hi = Math.floor((limits.maxMemMb ?? agent.memMb ?? MEM_BLOCK_MB) / MEM_BLOCK_MB) * MEM_BLOCK_MB;
        const sizes = new Set<number>();
        for (let m = lo; m <= hi; m += MEM_BLOCK_MB) sizes.add(m);
        if (agent.memMb) sizes.add(agent.memMb);
        const memOptions = [...sizes].sort((a, b) => a - b).map((memMb) => {
          const cents = estimate(memMb);
          return { memMb, ...(cents !== undefined ? { centsPerMonth: Math.round(cents * 100) / 100 } : {}) };
        });
        return {
          ...(agent.memMb ? { memMb: agent.memMb } : {}),
          ...(agent.diskMb ? { diskGb: Math.round(agent.diskMb / 1024) } : {}),
          ...(agent.vcpus ? { vcpus: agent.vcpus } : {}),
          memOptions,
          ...(limits.maxDiskGb ? { maxDiskGb: limits.maxDiskGb } : {}),
        };
      }),
    resize: (input) =>
      refusing(async () => {
        await api.resize(agentId, input);
        await api.restart(agentId);
      }),
    stopFunding: () => refusing(() => api.setSpendLimit(agentId, 0)),
    liftCap: () => refusing(() => api.setSpendLimit(agentId, null)),
    // The owner's sign-in (2026-10-30): Codex says whether one is there; on it, the same setup as a key of another
    // provider's (the proxy token a dud, so nothing bills the trial, and the cap lifted), the provider for the turn
    // script, and the template's config pointed at Codex's own provider so the Terminal's Codex uses the sign-in too.
    signIn: (kind) =>
      refusing(async () => {
        if (kind !== 'codex') return undefined;
        const run = await api.exec(agentId, ['sh', '-c', CODEX_SIGN_IN_STATUS], { detached: false, timeoutSeconds: SIGN_IN_TIMEOUT_S });
        return CODEX_SIGNED_IN.test(`${run.stdout ?? ''}\n${run.stderr ?? ''}`) ? 'chatgpt' : undefined;
      }),
    useSignIn: ({ kind }) =>
      refusing(async () => {
        const put = await putter();
        await put('OPENAI_API_KEY', PROXY_TOKEN_DUD, true);
        await put('ROWBOAT_LLM_PROVIDER', 'chatgpt', false);
        await put('ROWBOAT_LLM_MODEL', '', false);
        if (kind === 'codex') await api.exec(agentId, ['sh', '-c', CODEX_CONFIG_OWN_PROVIDER], { detached: false, timeoutSeconds: SIGN_IN_TIMEOUT_S });
        await api.setSpendLimit(agentId, null);
        await reload();
      }),
    signOut: (kind) =>
      refusing(async () => {
        if (kind === 'codex') await api.exec(agentId, ['sh', '-c', CODEX_SIGN_OUT], { detached: false, timeoutSeconds: SIGN_IN_TIMEOUT_S });
        const put = await putter();
        await put('ROWBOAT_LLM_PROVIDER', '', false);
        await reload();
      }),
  };
}

/** What Maritime is asked to create for each kind. */
export function creationFor(kind: string, input: { name: string; anthropicApiKey?: string; env: ProvisionInput['env']; idleSeconds?: number }): CreateAgentInput {
  const env = [...input.env];
  const idle = input.idleSeconds !== undefined ? { idleTtlSeconds: input.idleSeconds } : {};
  if (kind === 'hermes') {
    // Rowboat's own Hermes image as a Maritime "custom" container (2026-11-11): no web UI for Maritime to wait for,
    // and no PATH variable, since the image names its program by its full path. Maritime's proxy funds the trial as before.
    return { name: input.name, framework: 'custom', imageName: HERMES_IMAGE, useMaritimeLlm: true, hasWebUi: false, env, ...idle };
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
      // The cap is the trial's (2026-10-27); an agent billed to its owner has none (2026-11-04).
      if (input.trial && options.llmCapCents !== undefined && options.llmCapCents > 0) {
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
    async usage(externalUserId, from, to) {
      const u = await api.usage({ externalUserId, from, to });
      return { machineCents: u.hostingCostCents, llmCents: u.llmCostCents };
    },
    async deprovision(externalUserId) {
      await api.deleteEndUser(externalUserId);
    },
    credential() {
      return options.apiKey;
    },
    manage(externalId, externalUserId) {
      return maritimeOps(api, externalId, externalUserId);
    },
  };
}
