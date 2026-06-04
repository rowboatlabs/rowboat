import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { execFile } from 'child_process';
import { WorkDir } from '../../config/config.js';
import { serviceLogger } from '../../services/service_logger.js';
import { limitEventItems } from '../limit_event_items.js';
import { createEvent } from '../../events/producer.js';
import { knowledgeSourcesRepo } from './repo.js';
import type { KnowledgeArtifact, KnowledgeSourceConfig, KnowledgeSourceScope } from './types.js';

const execFileAsync = promisify(execFile);
const DEFAULT_LIMIT = 100;
const DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_RECENT_BACKFILL_SECONDS = 6 * 60 * 60;
const STATE_FILE = path.join(WorkDir, 'slack_knowledge_sync_state.json');
const ARTIFACT_ROOT = path.join(WorkDir, 'knowledge_sources', 'slack');

type SlackSyncState = {
    lastSyncAt?: string;
    sources?: Record<string, { lastSyncAt?: string }>;
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

function isSourceDue(source: KnowledgeSourceConfig, state: SlackSyncState): boolean {
    const sourceState = state.sources?.[source.id];
    if (!sourceState?.lastSyncAt) return true;
    const lastSyncMs = Date.parse(sourceState.lastSyncAt);
    const intervalMs = source.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS;
    return !Number.isFinite(lastSyncMs) || Date.now() - lastSyncMs >= intervalMs;
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

function parseJsonOutput(stdout: string): unknown {
    const trimmed = stdout.trim();
    if (!trimmed) return [];
    return JSON.parse(trimmed);
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
    const { stdout } = await execFileAsync('agent-slack', args, {
        timeout: 30_000,
        maxBuffer: 2 * 1024 * 1024,
    });
    return parseJsonOutput(stdout);
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

async function syncSource(source: KnowledgeSourceConfig): Promise<string[]> {
    if (!source.enabled || source.provider !== 'slack') return [];
    if (source.scopes.length === 0) {
        console.log(`[SlackKnowledge] Source ${source.id} has no channel scopes; skipping`);
        return [];
    }

    const state = loadState();
    const sourceState = state.sources?.[source.id];
    const intervalMs = source.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS;
    if (sourceState?.lastSyncAt) {
        const lastSyncMs = Date.parse(sourceState.lastSyncAt);
        if (Number.isFinite(lastSyncMs) && Date.now() - lastSyncMs < intervalMs) {
            return [];
        }
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

    state.lastSyncAt = new Date().toISOString();
    state.sources = {
        ...(state.sources ?? {}),
        [source.id]: { lastSyncAt: state.lastSyncAt },
    };
    saveState(state);
    return writtenFiles;
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

    try {
        for (const source of sources) {
            const files = await syncSource(source);
            writtenFiles.push(...files);
        }

        if (writtenFiles.length > 0) {
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
        }
    } catch (error) {
        hadError = true;
        console.error('[SlackKnowledge] Sync failed:', error);
        await serviceLogger.log({
            type: 'error',
            service: run.service,
            runId: run.runId,
            level: 'error',
            message: 'Slack knowledge sync error',
            error: error instanceof Error ? error.message : String(error),
        });
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
