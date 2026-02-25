import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { WorkDir } from '../config/config.js';
import { serviceLogger, type ServiceRunContext } from '../services/service_logger.js';
import { limitEventItems } from './limit_event_items.js';
import container from '../di/container.js';
import type { ISlackConfigRepo } from '../slack/repo.js';

const execAsync = promisify(exec);

// Configuration
const SYNC_DIR = path.join(WorkDir, 'slack_sync');
const STATE_FILE = path.join(SYNC_DIR, 'sync_state.json');
const SYNC_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const INITIAL_LOOKBACK_MS = 25 * 60 * 60 * 1000; // 25 hours

// --- Wake Signal for Immediate Sync Trigger ---
let wakeResolve: (() => void) | null = null;

export function triggerSync(): void {
    if (wakeResolve) {
        console.log('[Slack] Triggered - waking up immediately');
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

// --- State Management ---

interface SyncState {
    workspaces: Record<string, { lastSyncTs: string }>;
    userCache: Record<string, string>;
}

function loadState(): SyncState {
    if (fs.existsSync(STATE_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
        } catch {
            // Corrupt state, start fresh
        }
    }
    return { workspaces: {}, userCache: {} };
}

function saveState(state: SyncState): void {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// --- Slack CLI Helpers ---

interface SlackMessage {
    ts: string;
    author: { user_id: string };
    content: string;
}

async function fetchMessages(workspaceUrl: string, oldestTs: string): Promise<SlackMessage[]> {
    const cmd = `agent-slack message list "#general" --workspace ${workspaceUrl} --limit 200 --oldest ${oldestTs} --max-body-chars -1`;
    const { stdout } = await execAsync(cmd, { timeout: 30000 });
    const parsed = JSON.parse(stdout);
    // CLI returns { channel_id, messages: [...] }
    return parsed.messages || [];
}

async function resolveUser(userId: string, workspaceUrl: string): Promise<string> {
    const cmd = `agent-slack user get ${userId} --workspace ${workspaceUrl}`;
    const { stdout } = await execAsync(cmd, { timeout: 10000 });
    const parsed = JSON.parse(stdout);
    return parsed.real_name || parsed.name || userId;
}

// --- Markdown Generation ---

function formatTimestamp(ts: string): string {
    // Slack ts is unix epoch with microseconds: "1772018537.252219"
    const epochSec = parseFloat(ts);
    const date = new Date(epochSec * 1000);
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    const h = String(date.getUTCHours()).padStart(2, '0');
    const min = String(date.getUTCMinutes()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}:${min} UTC`;
}

function workspaceNameFromUrl(url: string): string {
    // "https://rowboat-labs.slack.com" -> "rowboat-labs"
    try {
        const hostname = new URL(url).hostname;
        return hostname.replace('.slack.com', '');
    } catch {
        return url.replace(/[^a-zA-Z0-9-]/g, '_');
    }
}

function buildMarkdown(
    workspaceUrl: string,
    workspaceName: string,
    messages: SlackMessage[],
    userCache: Record<string, string>,
): string {
    const displayName = workspaceName || workspaceNameFromUrl(workspaceUrl);
    const now = new Date().toISOString();

    let md = `# #general \u2014 ${displayName}\n\n`;
    md += `**Workspace:** ${workspaceUrl}\n`;
    md += `**Channel:** #general\n`;
    md += `**Synced:** ${now}\n\n---\n`;

    for (const msg of messages) {
        const author = userCache[msg.author.user_id] || msg.author.user_id;
        const time = formatTimestamp(msg.ts);
        md += `\n### ${author} \u2014 ${time}\n${msg.content}\n\n---\n`;
    }

    return md;
}

// --- Main Sync Logic ---

async function performSync(): Promise<void> {
    if (!fs.existsSync(SYNC_DIR)) fs.mkdirSync(SYNC_DIR, { recursive: true });

    const repo = container.resolve<ISlackConfigRepo>('slackConfigRepo');
    const config = await repo.getConfig();

    if (!config.enabled || config.workspaces.length === 0) {
        console.log('[Slack] Sync disabled or no workspaces configured. Skipping.');
        return;
    }

    const state = loadState();

    let run: ServiceRunContext | null = null;
    const ensureRun = async (): Promise<ServiceRunContext> => {
        if (!run) {
            run = await serviceLogger.startRun({
                service: 'slack',
                message: 'Syncing Slack',
                trigger: 'timer',
            });
        }
        return run;
    };

    let totalMessages = 0;

    try {
        for (const workspace of config.workspaces) {
            const wsState = state.workspaces[workspace.url];
            let oldestTs: string;

            if (wsState?.lastSyncTs) {
                oldestTs = wsState.lastSyncTs;
            } else {
                // First run: lookback 25 hours
                const lookbackSec = (Date.now() - INITIAL_LOOKBACK_MS) / 1000;
                oldestTs = lookbackSec.toFixed(6);
            }

            console.log(`[Slack] Fetching #general from ${workspace.url} (oldest=${oldestTs})`);

            let messages: SlackMessage[];
            try {
                messages = await fetchMessages(workspace.url, oldestTs);
            } catch (err) {
                console.error(`[Slack] Error fetching messages from ${workspace.url}:`, err);
                const r = await ensureRun();
                await serviceLogger.log({
                    type: 'error',
                    service: r.service,
                    runId: r.runId,
                    level: 'error',
                    message: `Error fetching messages from ${workspace.url}`,
                    error: err instanceof Error ? err.message : String(err),
                });
                continue;
            }

            if (!messages || messages.length === 0) {
                console.log(`[Slack] No new messages from ${workspace.url}`);
                continue;
            }

            await ensureRun();
            totalMessages += messages.length;

            // Batch-resolve unknown user IDs
            const unknownIds = new Set<string>();
            for (const msg of messages) {
                if (msg.author?.user_id && !state.userCache[msg.author.user_id]) {
                    unknownIds.add(msg.author.user_id);
                }
            }

            for (const userId of unknownIds) {
                try {
                    const name = await resolveUser(userId, workspace.url);
                    state.userCache[userId] = name;
                } catch (err) {
                    console.error(`[Slack] Error resolving user ${userId}:`, err);
                    state.userCache[userId] = userId;
                }
            }

            // Build and write markdown
            const wsName = workspaceNameFromUrl(workspace.url);
            const md = buildMarkdown(workspace.url, workspace.name || wsName, messages, state.userCache);
            const filename = `${wsName}_general.md`;
            fs.writeFileSync(path.join(SYNC_DIR, filename), md);
            console.log(`[Slack] Wrote ${filename} (${messages.length} messages)`);

            // Update lastSyncTs to highest ts seen
            let highestTs = wsState?.lastSyncTs || '0';
            for (const msg of messages) {
                if (msg.ts > highestTs) {
                    highestTs = msg.ts;
                }
            }
            state.workspaces[workspace.url] = { lastSyncTs: highestTs };
        }

        saveState(state);

        if (totalMessages > 0) {
            const r = await ensureRun();
            const limitedItems = limitEventItems(
                config.workspaces.map(w => w.url),
            );
            await serviceLogger.log({
                type: 'changes_identified',
                service: r.service,
                runId: r.runId,
                level: 'info',
                message: `Found ${totalMessages} message${totalMessages === 1 ? '' : 's'} across ${config.workspaces.length} workspace${config.workspaces.length === 1 ? '' : 's'}`,
                counts: { messages: totalMessages, workspaces: config.workspaces.length },
                items: limitedItems.items,
                truncated: limitedItems.truncated,
            });
            await serviceLogger.log({
                type: 'run_complete',
                service: r.service,
                runId: r.runId,
                level: 'info',
                message: `Slack sync complete: ${totalMessages} message${totalMessages === 1 ? '' : 's'}`,
                durationMs: Date.now() - r.startedAt,
                outcome: 'ok',
                summary: { messages: totalMessages, workspaces: config.workspaces.length },
            });
        }
    } catch (error) {
        console.error('[Slack] Error during sync:', error);
        const r = await ensureRun();
        await serviceLogger.log({
            type: 'error',
            service: r.service,
            runId: r.runId,
            level: 'error',
            message: 'Slack sync error',
            error: error instanceof Error ? error.message : String(error),
        });
        await serviceLogger.log({
            type: 'run_complete',
            service: r.service,
            runId: r.runId,
            level: 'error',
            message: 'Slack sync failed',
            durationMs: Date.now() - r.startedAt,
            outcome: 'error',
        });
    }
}

// --- Entry Point ---

export async function init(): Promise<void> {
    console.log('[Slack] Starting Slack Sync...');
    console.log(`[Slack] Will sync every ${SYNC_INTERVAL_MS / 1000} seconds.`);

    while (true) {
        try {
            await performSync();
        } catch (error) {
            console.error('[Slack] Error in main loop:', error);
        }

        console.log(`[Slack] Sleeping for ${SYNC_INTERVAL_MS / 1000} seconds...`);
        await interruptibleSleep(SYNC_INTERVAL_MS);
    }
}
