import fs from 'fs';
import path from 'path';
import { WorkDir } from '../../config/config.js';
import { AgentSlackRunError, runAgentSlack as execAgentSlack } from '../../slack/agent-slack-exec.js';
import type { AgentSlackErrorKind } from '../../slack/agent-slack-exec.js';
import { serviceLogger } from '../../services/service_logger.js';
import { limitEventItems } from '../limit_event_items.js';
import { createEvent } from '../../events/producer.js';
import { knowledgeSourcesRepo } from './repo.js';
import type { KnowledgeArtifact, KnowledgeSourceConfig, KnowledgeSourceScope } from './types.js';

const DEFAULT_LIMIT = 100;
const DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_RECENT_BACKFILL_SECONDS = 6 * 60 * 60;
const STATE_FILE = path.join(WorkDir, 'slack_knowledge_sync_state.json');
const ARTIFACT_ROOT = path.join(WorkDir, 'knowledge_sources', 'slack');

export type SlackSourceSyncState = {
    /** Time of the last sync attempt (success or failure). */
    lastSyncAt?: string;
    lastStatus?: 'ok' | 'error';
    lastError?: { kind: AgentSlackErrorKind | 'unknown'; message: string };
    /** Rate-limit backoff: multiplies the source interval; reset on success. */
    backoffMultiplier?: number;
};

type SlackSyncState = {
    lastSyncAt?: string;
    sources?: Record<string, SlackSourceSyncState>;
    channels: Record<string, { lastSeenTs?: string }>;
};

type SlackMessage = {
    ts?: string;
    thread_ts?: string;
    user?: string;
    username?: string;
    text?: string;
    body?: string;
    content?: string;
    channel?: string;
    channel_id?: string;
    channel_name?: string;
    permalink?: string;
    url?: string;
    edited?: { ts?: string; user?: string };
    reply_count?: number;
    replies?: SlackMessage[];
};

function loadState(): SlackSyncState {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as Partial<SlackSyncState>;
            return { channels: {}, ...parsed };
        }
    } catch (error) {
        console.error('[SlackKnowledge] Failed to load state:', error);
    }
    return { channels: {} };
}

function saveState(state: SlackSyncState): void {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

const MAX_SOURCE_SYNC_INTERVAL_MS = 30 * 60 * 1000;

/** Source interval with rate-limit backoff applied, capped at 30 minutes. */
export function effectiveIntervalMs(source: KnowledgeSourceConfig, sourceState?: SlackSourceSyncState): number {
    const base = source.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS;
    const multiplier = Math.max(1, sourceState?.backoffMultiplier ?? 1);
    return Math.min(base * multiplier, MAX_SOURCE_SYNC_INTERVAL_MS);
}

function isSourceDue(source: KnowledgeSourceConfig, state: SlackSyncState): boolean {
    const sourceState = state.sources?.[source.id];
    if (!sourceState?.lastSyncAt) return true;
    const lastSyncMs = Date.parse(sourceState.lastSyncAt);
    return !Number.isFinite(lastSyncMs) || Date.now() - lastSyncMs >= effectiveIntervalMs(source, sourceState);
}

function safeSegment(value: string): string {
    return value
        .replace(/^https?:\/\//, '')
        .replace(/[\\/*?:"<>|#\s]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 120) || 'unknown';
}

function slackTsToDate(ts: string): string {
    const seconds = Number(ts.split('.')[0]);
    if (!Number.isFinite(seconds)) {
        return new Date().toISOString();
    }
    return new Date(seconds * 1000).toISOString();
}

function subtractSlackTs(ts: string | undefined, seconds: number): string | undefined {
    if (!ts) return undefined;
    const value = Number(ts);
    if (!Number.isFinite(value)) return undefined;
    return Math.max(0, value - seconds).toFixed(6);
}

function compareSlackTs(a: string | undefined, b: string | undefined): number {
    const an = Number(a);
    const bn = Number(b);
    if (!Number.isFinite(an) && !Number.isFinite(bn)) return 0;
    if (!Number.isFinite(an)) return -1;
    if (!Number.isFinite(bn)) return 1;
    return an - bn;
}

function extractMessages(raw: unknown): SlackMessage[] {
    if (Array.isArray(raw)) return raw as SlackMessage[];
    if (raw && typeof raw === 'object') {
        const obj = raw as Record<string, unknown>;
        const candidates = [obj.messages, obj.items, obj.results, obj.data];
        for (const candidate of candidates) {
            if (Array.isArray(candidate)) return candidate as SlackMessage[];
        }
    }
    return [];
}

function getMessageText(message: SlackMessage): string {
    return message.text ?? message.body ?? message.content ?? '';
}

function getMessageAuthor(message: SlackMessage): string {
    return message.username ?? message.user ?? 'unknown';
}

async function runAgentSlack(args: string[]): Promise<unknown> {
    const result = await execAgentSlack(args, { timeoutMs: 30_000, maxBuffer: 2 * 1024 * 1024 });
    if (!result.ok) {
        throw new AgentSlackRunError(result.kind, result.message);
    }
    return result.data ?? [];
}

async function listMessages(source: KnowledgeSourceConfig, scope: KnowledgeSourceScope, oldest?: string): Promise<SlackMessage[]> {
    const target = scope.id;
    const args = [
        'message',
        'list',
        target,
        '--limit',
        String(source.filters?.limit ?? DEFAULT_LIMIT),
        '--max-body-chars',
        String(source.filters?.maxBodyChars ?? 4000),
    ];

    if (scope.workspaceUrl) {
        args.push('--workspace', scope.workspaceUrl);
    }

    if (oldest) {
        args.push('--oldest', oldest);
    }

    const raw = await runAgentSlack(args);
    return extractMessages(raw)
        .filter(message => message.ts && getMessageText(message).trim().length > 0)
        .sort((a, b) => compareSlackTs(a.ts, b.ts));
}

function artifactForMessage(source: KnowledgeSourceConfig, scope: KnowledgeSourceScope, message: SlackMessage): KnowledgeArtifact | null {
    if (!message.ts) return null;
    const channelName = scope.name ?? message.channel_name ?? message.channel ?? message.channel_id ?? scope.id;
    const workspaceName = scope.workspaceUrl ?? 'Slack';
    const version = message.edited?.ts ?? message.ts;
    const url = message.permalink ?? message.url;
    const title = `Slack message in ${channelName}`;
    const occurredAt = slackTsToDate(message.ts);
    const author = getMessageAuthor(message);
    const body = getMessageText(message).trim();

    const bodyMarkdown = [
        `# ${title}`,
        ``,
        `**Workspace:** ${workspaceName}`,
        `**Channel:** ${channelName}`,
        `**Author:** ${author}`,
        `**Timestamp:** ${occurredAt}`,
        message.thread_ts ? `**Thread TS:** ${message.thread_ts}` : '',
        url ? `**Link:** ${url}` : '',
        ``,
        `## Message`,
        ``,
        body,
    ].filter(line => line !== '').join('\n');

    return {
        sourceId: source.id,
        provider: 'slack',
        externalId: `${scope.workspaceUrl ?? 'workspace'}:${scope.id}:${message.ts}`,
        version,
        occurredAt,
        title,
        bodyMarkdown,
        url,
        metadata: {
            workspaceUrl: scope.workspaceUrl,
            channelId: scope.id,
            channelName,
            author,
            ts: message.ts,
            threadTs: message.thread_ts,
            editedTs: message.edited?.ts,
        },
    };
}

function writeArtifact(source: KnowledgeSourceConfig, scope: KnowledgeSourceScope, artifact: KnowledgeArtifact): string | null {
    const workspace = safeSegment(scope.workspaceUrl ?? 'workspace');
    const channel = safeSegment(scope.name ?? scope.id);
    const ts = safeSegment(artifact.metadata.ts as string);
    const dir = path.join(WorkDir, source.artifactDir || path.join('knowledge_sources', 'slack'), workspace, channel);
    fs.mkdirSync(dir, { recursive: true });

    const filePath = path.join(dir, `${ts}.md`);
    const frontmatter = [
        '---',
        `source: ${artifact.provider}`,
        `source_id: ${artifact.sourceId}`,
        `external_id: ${JSON.stringify(artifact.externalId)}`,
        `version: ${JSON.stringify(artifact.version)}`,
        `occurred_at: ${JSON.stringify(artifact.occurredAt)}`,
        artifact.url ? `url: ${JSON.stringify(artifact.url)}` : '',
        '---',
        '',
    ].filter(Boolean).join('\n');

    const content = `${frontmatter}${artifact.bodyMarkdown}\n`;
    if (fs.existsSync(filePath)) {
        try {
            if (fs.readFileSync(filePath, 'utf-8') === content) {
                return null;
            }
        } catch {
            // Fall through and rewrite the artifact.
        }
    }

    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
}

async function publishSlackSyncEvent(files: string[]): Promise<void> {
    if (files.length === 0) return;
    const relativeFiles = files.map(file => path.relative(WorkDir, file));
    await createEvent({
        source: 'slack',
        type: 'slack.synced',
        createdAt: new Date().toISOString(),
        payload: [
            '# Slack knowledge sync update',
            '',
            `${files.length} new/updated message artifact${files.length === 1 ? '' : 's'}.`,
            '',
            ...relativeFiles.slice(0, 20).map(file => `- ${file}`),
        ].join('\n'),
    });
}

/**
 * Sync one source's channels into artifact files. Mutates state.channels as
 * it goes; throws AgentSlackRunError on CLI failure (status bookkeeping is
 * the caller's job).
 */
async function syncSource(source: KnowledgeSourceConfig, state: SlackSyncState): Promise<string[]> {
    if (source.scopes.length === 0) {
        console.log(`[SlackKnowledge] Source ${source.id} has no channel scopes; skipping`);
        return [];
    }

    const writtenFiles: string[] = [];

    for (const scope of source.scopes.filter(scope => scope.type === 'channel')) {
        const key = `${source.id}:${scope.workspaceUrl ?? ''}:${scope.id}`;
        const channelState = state.channels[key] ?? {};
        const recentBackfillSeconds = Number(source.filters?.recentBackfillSeconds ?? DEFAULT_RECENT_BACKFILL_SECONDS);
        const oldest = subtractSlackTs(channelState.lastSeenTs, recentBackfillSeconds);
        const messages = await listMessages(source, scope, oldest);
        let newestTs = channelState.lastSeenTs;

        for (const message of messages) {
            if (compareSlackTs(message.ts, channelState.lastSeenTs) <= 0 && !message.edited?.ts) {
                continue;
            }
            const artifact = artifactForMessage(source, scope, message);
            if (!artifact) continue;
            const writtenFile = writeArtifact(source, scope, artifact);
            if (writtenFile) {
                writtenFiles.push(writtenFile);
            }
            if (compareSlackTs(message.ts, newestTs) > 0) {
                newestTs = message.ts;
            }
        }

        state.channels[key] = { lastSeenTs: newestTs };
    }

    return writtenFiles;
}

function recordSourceResult(state: SlackSyncState, sourceId: string, error?: { kind: AgentSlackErrorKind | 'unknown'; message: string }): void {
    const previous = state.sources?.[sourceId];
    const now = new Date().toISOString();
    const next: SlackSourceSyncState = { lastSyncAt: now };
    if (error) {
        next.lastStatus = 'error';
        next.lastError = error;
        if (error.kind === 'rate_limited') {
            // Doubles each consecutive rate limit; effectiveIntervalMs caps
            // the resulting interval at 30 min, the clamp keeps the stored
            // value sane in the state file.
            next.backoffMultiplier = Math.min(Math.max(2, (previous?.backoffMultiplier ?? 1) * 2), 1024);
        }
    } else {
        next.lastStatus = 'ok';
    }
    state.lastSyncAt = now;
    state.sources = { ...(state.sources ?? {}), [sourceId]: next };
}

export async function syncSlackKnowledgeSources(): Promise<string[]> {
    const state = loadState();
    const sources = knowledgeSourcesRepo
        .listEnabledSources()
        .filter(source => source.provider === 'slack' && source.syncMode === 'poll')
        .filter(source => isSourceDue(source, state));

    if (sources.length === 0) return [];

    const run = await serviceLogger.startRun({
        service: 'slack',
        message: 'Syncing Slack knowledge sources',
        trigger: 'timer',
    });

    const writtenFiles: string[] = [];
    let hadError = false;

    for (const source of sources) {
        let rateLimited = false;
        try {
            const files = await syncSource(source, state);
            writtenFiles.push(...files);
            recordSourceResult(state, source.id);
        } catch (error) {
            // One failing source must not abort the others.
            hadError = true;
            const kind = error instanceof AgentSlackRunError ? error.kind : 'unknown';
            const message = error instanceof Error ? error.message : String(error);
            recordSourceResult(state, source.id, { kind, message });
            rateLimited = kind === 'rate_limited';
            console.error(`[SlackKnowledge] Sync failed for source ${source.id} (${kind}):`, message);
            await serviceLogger.log({
                type: 'error',
                service: run.service,
                runId: run.runId,
                level: 'error',
                message: `Slack knowledge sync error for source ${source.id} (${kind})`,
                error: message,
            });
        }
        // Persist after every source so progress and status survive a crash.
        saveState(state);
        // Rate limits are per-token, so the remaining sources would hit the
        // same wall — end this run; they stay due for the next tick.
        if (rateLimited) break;
    }

    if (writtenFiles.length > 0) {
        try {
            const relativeFiles = writtenFiles.map(file => path.relative(WorkDir, file));
            const limitedFiles = limitEventItems(relativeFiles);
            await serviceLogger.log({
                type: 'changes_identified',
                service: run.service,
                runId: run.runId,
                level: 'info',
                message: `Slack updates: ${writtenFiles.length} message artifact${writtenFiles.length === 1 ? '' : 's'}`,
                counts: { messages: writtenFiles.length },
                items: limitedFiles.items,
                truncated: limitedFiles.truncated,
            });
            await publishSlackSyncEvent(writtenFiles);
        } catch (error) {
            hadError = true;
            console.error('[SlackKnowledge] Failed to publish sync results:', error);
        }
    }

    await serviceLogger.log({
        type: 'run_complete',
        service: run.service,
        runId: run.runId,
        level: hadError ? 'error' : 'info',
        message: `Slack sync complete: ${writtenFiles.length} artifact${writtenFiles.length === 1 ? '' : 's'}`,
        durationMs: Date.now() - run.startedAt,
        outcome: hadError ? 'error' : 'ok',
        summary: { artifacts: writtenFiles.length },
    });

    return writtenFiles;
}

export function getSlackKnowledgeArtifactRoot(): string {
    return ARTIFACT_ROOT;
}

export type SlackKnowledgeSourceStatus = {
    id: string;
    enabled: boolean;
    lastSyncAt?: string;
    lastStatus?: 'ok' | 'error';
    lastError?: { kind: string; message: string };
    /** When the source next becomes due, given interval + backoff. */
    nextDueAt?: string;
};

/** Per-source sync status for the slack:knowledgeStatus IPC channel. */
export function getSlackKnowledgeSyncStatus(): SlackKnowledgeSourceStatus[] {
    const state = loadState();
    return knowledgeSourcesRepo
        .getConfig()
        .sources
        .filter(source => source.provider === 'slack')
        .map(source => {
            const sourceState = state.sources?.[source.id];
            const lastMs = sourceState?.lastSyncAt ? Date.parse(sourceState.lastSyncAt) : NaN;
            return {
                id: source.id,
                enabled: source.enabled,
                lastSyncAt: sourceState?.lastSyncAt,
                lastStatus: sourceState?.lastStatus,
                lastError: sourceState?.lastError,
                nextDueAt: Number.isFinite(lastMs)
                    ? new Date(lastMs + effectiveIntervalMs(source, sourceState)).toISOString()
                    : undefined,
            };
        });
}

let wakeResolve: (() => void) | null = null;

export function triggerSync(): void {
    if (wakeResolve) {
        wakeResolve();
        wakeResolve = null;
    }
}

function interruptibleSleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        const timeout = setTimeout(() => {
            wakeResolve = null;
            resolve();
        }, ms);
        wakeResolve = () => {
            clearTimeout(timeout);
            resolve();
        };
    });
}

export async function init(): Promise<void> {
    console.log(`[SlackKnowledge] Starting Slack knowledge sync. Polling every ${DEFAULT_SYNC_INTERVAL_MS / 1000}s`);
    while (true) {
        await syncSlackKnowledgeSources();
        await interruptibleSleep(DEFAULT_SYNC_INTERVAL_MS);
    }
}
