import type { ConnectorPlatform } from '../platforms.js';
import { IntegrationError, integrationPlatform, markdownTable, requestJson, UsageError, type Command, type Integration } from '../commands.js';

// The PostHog integration (spec §8 Integrations, 2026-10-03): an agent on a
// personal API key, answering from the key's current project. The key says
// nothing of its region, so the client asks US Cloud, then EU Cloud; a
// self-hosted PostHog is named in front of the key: `https://ph.example.com phx_…`.
// The key needs these read scopes: user, query, insight, feature_flag.

export const POSTHOG_CLOUDS = ['https://us.posthog.com', 'https://eu.posthog.com'];
const MAX_ROWS = 20;

interface Project {
  host: string;
  id: number;
  name: string;
}

export class PostHogApi {
  private project?: Promise<Project>;

  constructor(
    private readonly key: string,
    private readonly hosts: readonly string[],
  ) {}

  /** From a credential: the key, or a self-hosted address and the key. */
  static fromCredential(secret: string, clouds: readonly string[] = POSTHOG_CLOUDS): PostHogApi {
    const [first, second] = secret.trim().split(/\s+/);
    if (second && /^https?:\/\//.test(first!)) return new PostHogApi(second, [first!.replace(/\/+$/, '')]);
    return new PostHogApi(first ?? '', clouds);
  }

  /** The key's current project, and the PostHog that answered for it. */
  current(): Promise<Project> {
    this.project ??= this.find().catch((err) => {
      this.project = undefined;
      throw err;
    });
    return this.project;
  }

  private async find(): Promise<Project> {
    let refusal: IntegrationError | undefined;
    for (const host of this.hosts) {
      try {
        const me = (await requestJson(`${host}/api/users/@me/`, { headers: this.headers() })) as { team?: { id?: number; name?: string } };
        if (typeof me?.team?.id !== 'number') throw new IntegrationError('this key has no current project');
        return { host, id: me.team.id, name: me.team.name ?? `Project ${me.team.id}` };
      } catch (err) {
        // A key is refused by every region but its own.
        if (err instanceof IntegrationError && err.rejectsKey) refusal = err;
        else throw err;
      }
    }
    throw refusal ?? new IntegrationError('no PostHog to ask');
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' };
  }

  async get(path: string): Promise<unknown> {
    const p = await this.current();
    return requestJson(`${p.host}/api/projects/${p.id}${path}`, { headers: this.headers() });
  }

  /** A HogQL query's columns and rows. */
  async query(hogql: string): Promise<{ columns: string[]; results: unknown[][] }> {
    const p = await this.current();
    const body = (await requestJson(`${p.host}/api/projects/${p.id}/query/`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query: hogql }, name: 'rowboat' }),
      timeoutMs: 30_000,
    })) as { columns?: string[]; results?: unknown[][] };
    return { columns: body?.columns ?? [], results: body?.results ?? [] };
  }

  async link(path: string): Promise<string> {
    const p = await this.current();
    return `${p.host}/project/${p.id}${path}`;
  }
}

/** A string literal in HogQL. */
export function hogqlString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function days(arg: string | undefined, fallback: number): number {
  if (!arg) return fallback;
  const n = Number(arg.replace(/d$/i, ''));
  if (!Number.isInteger(n) || n < 1 || n > 365) throw new UsageError(`"${arg}" isn't a number of days from 1 to 365.`);
  return n;
}

const fmt = (n: unknown) => (typeof n === 'number' ? n.toLocaleString('en-US') : String(n ?? 0));

const commands: Command<PostHogApi>[] = [
  {
    name: 'count',
    args: '<event> [days]',
    summary: 'how many times an event happened, and to how many people (default 7 days)',
    async run(api, args) {
      const parts = args.split(' ').filter(Boolean);
      const last = parts.length > 1 && /^\d+d?$/i.test(parts[parts.length - 1]!) ? parts.pop() : undefined;
      const event = parts.join(' ');
      if (!event) throw new UsageError('Which event?');
      const n = days(last, 7);
      const { results } = await api.query(
        `select count(), count(distinct person_id) from events where event = ${hogqlString(event)} and timestamp > now() - interval ${n} day`,
      );
      const [total, people] = results[0] ?? [0, 0];
      return `**${event}**, last ${n} day${n === 1 ? '' : 's'}: ${fmt(total)} times, ${fmt(people)} people.`;
    },
  },
  {
    name: 'top',
    aliases: ['events'],
    args: '[days]',
    summary: 'the most frequent events (default 7 days)',
    async run(api, args) {
      const n = days(args.trim() || undefined, 7);
      const { results } = await api.query(
        `select event, count() as total from events where timestamp > now() - interval ${n} day group by event order by total desc limit 10`,
      );
      if (results.length === 0) return `No events in the last ${n} days.`;
      return `Top events, last ${n} days:\n\n${markdownTable(['Event', 'Count'], results.map(([e, c]) => [e, fmt(c)]))}`;
    },
  },
  {
    name: 'query',
    aliases: ['sql', 'hogql'],
    args: '<HogQL>',
    summary: 'run a HogQL query and show the first rows',
    async run(api, args) {
      const hogql = args.replace(/^`+|`+$/g, '').trim();
      if (!hogql) throw new UsageError('Which query?');
      const { columns, results } = await api.query(hogql);
      if (results.length === 0) return 'No rows.';
      const more = results.length > MAX_ROWS ? `\n\nFirst ${MAX_ROWS} of ${results.length} rows.` : '';
      return markdownTable(columns.length ? columns : results[0]!.map((_, i) => `col${i + 1}`), results.slice(0, MAX_ROWS)) + more;
    },
  },
  {
    name: 'insights',
    args: '[search]',
    summary: 'saved insights, with links',
    async run(api, args) {
      const q = new URLSearchParams({ saved: 'true', limit: '10', ...(args.trim() ? { search: args.trim() } : {}) });
      const body = (await api.get(`/insights/?${q}`)) as { results?: { short_id?: string; name?: string | null; derived_name?: string | null }[] };
      const insights = body?.results ?? [];
      if (insights.length === 0) return args.trim() ? `No saved insights match "${args.trim()}".` : 'No saved insights yet.';
      const lines = await Promise.all(insights.map(async (i) => `- [${i.name || i.derived_name || i.short_id}](${await api.link(`/insights/${i.short_id}`)})`));
      return lines.join('\n');
    },
  },
  {
    name: 'flags',
    args: '[search]',
    summary: 'feature flags and whether they are on',
    async run(api, args) {
      const q = new URLSearchParams({ limit: '20', ...(args.trim() ? { search: args.trim() } : {}) });
      const body = (await api.get(`/feature_flags/?${q}`)) as { results?: { id: number; key: string; name?: string; active?: boolean }[] };
      const flags = body?.results ?? [];
      if (flags.length === 0) return args.trim() ? `No feature flags match "${args.trim()}".` : 'No feature flags yet.';
      const lines = await Promise.all(flags.map(async (f) => `- ${f.active ? '🟢' : '⚪'} [\`${f.key}\`](${await api.link(`/feature_flags/${f.id}`)})${f.name ? `: ${f.name}` : ''}`));
      return lines.join('\n');
    },
  },
];

/**
 * An alert from a PostHog webhook destination. Its body is whatever the
 * destination's template says, so: a `text` or `message` the template wrote
 * is said as is; an event (the default template's `{ event: {event},
 * person: {person} }`, which carries the insight alert's properties) is said
 * by its name and properties; anything else, briefly, as it came.
 */
export function posthogAlert(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const p = payload as Record<string, unknown>;
  for (const key of ['text', 'message']) if (typeof p[key] === 'string' && p[key]) return (p[key] as string).slice(0, 4000);
  const event = p.event && typeof p.event === 'object' ? (p.event as Record<string, unknown>) : undefined;
  if (event) {
    const props = (event.properties && typeof event.properties === 'object' ? event.properties : {}) as Record<string, unknown>;
    const name = typeof event.event === 'string' ? event.event : 'event';
    const str = (k: string) => (typeof props[k] === 'string' || typeof props[k] === 'number' ? String(props[k]) : undefined);
    const title = str('alert_name') ?? str('name') ?? name;
    const insight = str('insight_name');
    const link = str('insight_url') ?? str('alert_url') ?? (typeof event.url === 'string' ? event.url : undefined);
    const lines = [`🔔 **${title}**${insight ? ` on ${insight}` : ''}${title === name ? '' : ` (${name})`}`];
    const breaches = props.breaches;
    if (Array.isArray(breaches)) lines.push(...breaches.slice(0, 5).map((b) => `- ${String(b).slice(0, 300)}`));
    if (link) lines.push(link);
    return lines.join('\n');
  }
  return `🔔 PostHog sent:\n\`\`\`json\n${JSON.stringify(payload, null, 2).slice(0, 1500)}\n\`\`\``;
}

export function posthogIntegration(clouds: readonly string[] = POSTHOG_CLOUDS): Integration<PostHogApi> {
  return {
    label: 'PostHog',
    client: (secret) => PostHogApi.fromCredential(secret, clouds),
    async check(api) {
      await api.current();
    },
    commands,
    alert: posthogAlert,
  };
}

export function posthogPlatform(clouds: readonly string[] = POSTHOG_CLOUDS): ConnectorPlatform {
  return integrationPlatform(posthogIntegration(clouds));
}
