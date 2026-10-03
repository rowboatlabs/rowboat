import type { ConnectorCapabilities, Invocation, ServerFrame } from '@rowboat/spaces-protocol';
import { HarborError } from '../errors.js';
import type { ConnectorEnv, ConnectorPlatform, RunningConnector } from './platforms.js';

// Integrations (spec §8 Integrations, 2026-10-03): an agent for a service
// people already use from Slack, such as PostHog or Cal.com, run by Harbor
// on the org's key for that service. No model in the loop, as in their Slack
// apps: a mention is a command ("@Cal today"), the connector calls the
// service's API, and its answer is the reply. What differs per service is an
// Integration (its client, its commands, what its alerts say); everything
// else is here, so a new service is one module beside this file.

const LIST_EVERY_MS = 60_000;

/** A service's API said no. 401 and 403 mean the key; anything else is the call. */
export class IntegrationError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
  get rejectsKey(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/** The person asked for something the command can't do as asked: said back to them, not a failure. */
export class UsageError extends Error {}

export interface Command<Api> {
  name: string;
  aliases?: readonly string[];
  /** What follows the command word, for help: `<event> [days]`. */
  args?: string;
  summary: string;
  /** The reply's Markdown. `args` is the rest of the message after the command word. */
  run(api: Api, args: string): Promise<string>;
}

export interface Integration<Api> {
  /** The service's name, as people know it. */
  label: string;
  /** A client on this key. Cheap: no call is made until a command runs. */
  client(secret: string): Api;
  /** Check the key with the service before Harbor saves it; throws IntegrationError on refusal. */
  check(api: Api): Promise<void>;
  commands: readonly Command<Api>[];
  /** What an alert from the service says (spec §8 Alerts); undefined for an event left unsaid. */
  alert?(payload: unknown): string | undefined;
}

export function integrationPlatform<Api>(integration: Integration<Api>): ConnectorPlatform {
  return {
    async verify(secret) {
      try {
        await integration.check(integration.client(secret));
      } catch (err) {
        if (err instanceof IntegrationError && err.rejectsKey) throw new HarborError('invalid_request', `${integration.label} did not accept this key: ${err.message}`);
        throw new HarborError('invalid_request', `${integration.label} could not check this key: ${(err as Error).message}`);
      }
    },
    start(env) {
      return new CommandConnector(env, integration).start();
    },
    ...(integration.alert ? { alert: integration.alert } : {}),
  };
}

/** A JSON call to a service: its body, or an IntegrationError carrying the service's own message. */
export async function requestJson(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 20_000) });
  } catch (err) {
    throw new IntegrationError(`could not reach ${new URL(url).host}: ${(err as Error).message}`);
  }
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!res.ok) throw new IntegrationError(errorMessage(body) ?? `${res.status} ${res.statusText}`.trim(), res.status);
  return body;
}

function errorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  const nested = b.error && typeof b.error === 'object' ? (b.error as Record<string, unknown>).message : undefined;
  const found = [b.detail, b.message, nested, b.error].find((v) => typeof v === 'string' && v.length > 0);
  return typeof found === 'string' ? found.slice(0, 300) : undefined;
}

/** The person's words: the agent's own mention taken out, anyone else's kept as their name. */
export function commandText(body: string, agentId: string): string {
  return body
    .replace(/\[@([^\]]*)\]\(#member:([^)]*)\)/g, (_all, name: string, id: string) => (id === agentId ? ' ' : `@${name}`))
    .replace(/\s+/g, ' ')
    .trim();
}

export class CommandConnector<Api> implements RunningConnector {
  private readonly running = new Map<string, Promise<void>>();
  private readonly timers: NodeJS.Timeout[] = [];
  private unsubscribe: (() => void) | undefined;
  private stopped = false;

  constructor(
    private readonly env: ConnectorEnv,
    private readonly integration: Integration<Api>,
  ) {}

  start(): this {
    this.unsubscribe = this.env.subscribe((frame) => this.onFrame(frame));
    void this.boot();
    this.timers.push(setInterval(() => void this.list(), LIST_EVERY_MS));
    return this;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.unsubscribe?.();
    for (const timer of this.timers) clearInterval(timer);
    await Promise.allSettled([...this.running.values()]);
  }

  private async boot(): Promise<void> {
    // A command takes no options and can't be stopped midway: it is one call.
    const capabilities: ConnectorCapabilities = { stop: false, options: [] };
    await this.safe(() => this.env.service.declareCapabilities(this.env.ctx, capabilities), undefined);
    for (const invocation of await this.safe(() => this.env.service.listAgentInvocations(this.env.ctx), [])) {
      // One a previous run took on may or may not have reached the service; running it again
      // could book a meeting twice, so it ends and the person asks again.
      if (invocation.state === 'working' && !this.running.has(invocation.id)) {
        await this.fail(invocation, 'Harbor restarted while this ran, so it may or may not have happened. Check, then mention me again.');
      } else if (invocation.state === 'pending') this.intake(invocation);
    }
  }

  private onFrame(frame: ServerFrame): void {
    if (frame.kind === 'invocation') this.intake(frame.invocation);
  }

  private async list(): Promise<void> {
    for (const invocation of await this.safe(() => this.env.service.listAgentInvocations(this.env.ctx), [])) {
      if (invocation.state === 'pending') this.intake(invocation);
    }
  }

  private intake(invocation: Invocation): void {
    if (this.stopped || invocation.state !== 'pending' || this.running.has(invocation.id)) return;
    const done = (async () => {
      try {
        await this.env.service.acknowledgeInvocation(this.env.ctx, invocation.id);
      } catch {
        return; // cancelled on its way, or someone else took it
      }
      await this.run(invocation);
    })()
      .catch((err) => this.env.log('invocation failed unexpectedly', { id: invocation.id, error: (err as Error).message }))
      .finally(() => this.running.delete(invocation.id));
    this.running.set(invocation.id, done);
  }

  private async run(invocation: Invocation): Promise<void> {
    const text = commandText(invocation.trigger.body, this.env.agent.id);
    const [word = '', ...rest] = text.split(' ');
    const name = word.toLowerCase();
    if (!name || name === 'help') return this.answer(invocation, this.help());
    const command = this.integration.commands.find((c) => c.name === name || c.aliases?.includes(name));
    if (!command) return this.answer(invocation, `I don't know "${word.slice(0, 40)}".\n\n${this.help()}`);

    await this.safe(() => this.env.service.updateInvocation(this.env.ctx, invocation.id, { state: 'working', activity: `${this.integration.label}: ${command.name}` }), undefined);
    let reply: string;
    try {
      reply = await command.run(this.integration.client(await this.env.credential()), rest.join(' '));
    } catch (err) {
      if (err instanceof UsageError) return this.answer(invocation, `${err.message}\n\nUsage: \`${this.usage(command)}\``);
      if (err instanceof IntegrationError && err.rejectsKey) {
        await this.env.rejectCredential(`${this.integration.label} refused the key: ${err.message}`);
        return this.fail(invocation, `${this.integration.label} did not accept my key (${err.message}). Its owner needs to replace the key in Agents.`);
      }
      if (err instanceof IntegrationError || err instanceof HarborError) return this.fail(invocation, `${this.integration.label}: ${err.message}`);
      throw err;
    }
    await this.answer(invocation, reply);
  }

  private help(): string {
    const lines = this.integration.commands.map((c) => `- \`${this.usage(c)}\`: ${c.summary}`);
    return [`Mention me with one of these:`, ...lines, `- \`@${this.env.agent.displayName} help\`: this list`].join('\n');
  }

  private usage(command: Command<Api>): string {
    return `@${this.env.agent.displayName} ${command.name}${command.args ? ` ${command.args}` : ''}`;
  }

  private async answer(invocation: Invocation, body: string): Promise<void> {
    await this.safe(() => this.env.service.answerInvocation(this.env.ctx, invocation.id, body.slice(0, 60_000)), undefined);
  }

  private async fail(invocation: Invocation, error: string): Promise<void> {
    await this.safe(() => this.env.service.updateInvocation(this.env.ctx, invocation.id, { state: 'failed', error: error.slice(0, 1000) }), undefined);
  }

  private async safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      this.env.log('call failed', { error: (err as Error).message });
      return fallback;
    }
  }
}

// --- formatting shared by integrations ---------------------------------------------------

/** A Markdown table, cells flattened to one line and capped. */
export function markdownTable(columns: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 80);
  };
  return [`| ${columns.map(cell).join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
}

/** "Mon, Oct 5, 3:00 PM PDT" in the given zone (UTC when it is unknown). */
export function formatWhen(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const options: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
  try {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone: timeZone || 'UTC' }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(date);
  }
}

/** A zone's offset from UTC at an instant, in minutes (positive east of Greenwich). */
export function zoneOffsetMinutes(timeZone: string, at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** The instant a wall-clock time in a zone names: `2026-10-05T15:00` in America/New_York → 19:00Z. */
export function zonedToUtc(wall: string, timeZone: string): Date {
  const naive = new Date(`${wall}Z`);
  if (Number.isNaN(naive.getTime())) return naive;
  // Twice: the offset at the guess can differ from the offset at the answer across a DST change.
  let at = new Date(naive.getTime() - zoneOffsetMinutes(timeZone, naive) * 60_000);
  at = new Date(naive.getTime() - zoneOffsetMinutes(timeZone, at) * 60_000);
  return at;
}

/** The calendar date (YYYY-MM-DD) an instant falls on in a zone. */
export function dateInZone(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** The date after this one, both YYYY-MM-DD. */
export function nextDate(date: string, days = 1): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
