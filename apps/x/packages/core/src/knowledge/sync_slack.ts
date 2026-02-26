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
    thread_ts?: string;
    author: { user_id: string };
    content: string;
    replies?: SlackMessage[];
}

async function fetchMessages(workspaceUrl: string, oldestTs: string): Promise<SlackMessage[]> {
    const cmd = `agent-slack message list "#general" --workspace ${workspaceUrl} --limit 200 --oldest ${oldestTs} --max-body-chars -1`;
    const { stdout } = await execAsync(cmd, { timeout: 30000 });
    const parsed = JSON.parse(stdout);
    // CLI returns { channel_id, messages: [...] }
    return parsed.messages || [];
}

async function fetchThreadReplies(workspaceUrl: string, threadTs: string): Promise<SlackMessage[]> {
    const cmd = `agent-slack message list "#general" --workspace ${workspaceUrl} --thread-ts ${threadTs} --max-body-chars -1`;
    const { stdout } = await execAsync(cmd, { timeout: 30000 });
    const parsed = JSON.parse(stdout);
    const messages: SlackMessage[] = parsed.messages || [];
    // First message is the parent — return only replies
    return messages.slice(1);
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

interface RenderedMessage {
    ts: string;
    author: string;
    time: string;
    content: string;
    replies?: RenderedMessage[];
}

function parseExistingMessages(filePath: string): RenderedMessage[] {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf-8');
    const messages: RenderedMessage[] = [];
    // Split on --- separators, then parse each block
    const sections = raw.split('\n---\n');
    for (const section of sections) {
        // Match top-level: ### Author — time\ncontent
        const topMatch = section.match(/^[\s]*### (.+?) \u2014 (\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC)\n([\s\S]*)$/);
        if (!topMatch) continue;
        const msg: RenderedMessage = {
            ts: '',
            author: topMatch[1],
            time: topMatch[2],
            content: '',
            replies: [],
        };
        // Check if body contains replies (> **Author** — time)
        const bodyLines = topMatch[3];
        const replyPattern = /^> \*\*(.+?)\*\* \u2014 (\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC)$/;
        let currentContent: string[] = [];
        let currentReply: RenderedMessage | null = null;

        for (const line of bodyLines.split('\n')) {
            const rm = line.match(replyPattern);
            if (rm) {
                // Save previous reply
                if (currentReply) {
                    currentReply.content = currentContent.join('\n').replace(/^> /gm, '').trimEnd();
                    msg.replies!.push(currentReply);
                } else {
                    // Lines before first reply are the parent content
                    msg.content = currentContent.join('\n').trimEnd();
                }
                currentReply = { ts: '', author: rm[1], time: rm[2], content: '' };
                currentContent = [];
            } else {
                currentContent.push(line);
            }
        }
        // Save last reply or parent content
        if (currentReply) {
            currentReply.content = currentContent.join('\n').replace(/^> /gm, '').trimEnd();
            msg.replies!.push(currentReply);
        } else {
            msg.content = currentContent.join('\n').trimEnd();
        }
        if (msg.replies!.length === 0) delete msg.replies;
        messages.push(msg);
    }
    return messages;
}

function renderMessage(msg: SlackMessage, userCache: Record<string, string>): RenderedMessage {
    const rendered: RenderedMessage = {
        ts: msg.ts,
        author: userCache[msg.author.user_id] || msg.author.user_id,
        time: formatTimestamp(msg.ts),
        content: msg.content,
    };
    if (msg.replies && msg.replies.length > 0) {
        rendered.replies = msg.replies.map(r => ({
            ts: r.ts,
            author: userCache[r.author.user_id] || r.author.user_id,
            time: formatTimestamp(r.ts),
            content: r.content,
        }));
    }
    return rendered;
}

function messageKey(msg: RenderedMessage): string {
    return `${msg.time}|${msg.author}|${msg.content}`;
}

function buildMarkdown(
    workspaceUrl: string,
    workspaceName: string,
    existingMessages: RenderedMessage[],
    newMessages: SlackMessage[],
    userCache: Record<string, string>,
): string {
    const displayName = workspaceName || workspaceNameFromUrl(workspaceUrl);
    const now = new Date().toISOString();

    const newRendered = newMessages.map(m => renderMessage(m, userCache));

    // Deduplicate and merge: new messages replace existing (to pick up new replies)
    const seen = new Map<string, RenderedMessage>();

    for (const msg of existingMessages) {
        seen.set(messageKey(msg), msg);
    }
    for (const msg of newRendered) {
        const key = messageKey(msg);
        const existing = seen.get(key);
        if (existing) {
            // Merge replies: keep existing + add new
            if (msg.replies) {
                const existingReplies = existing.replies || [];
                const replyKeys = new Set(existingReplies.map(r => messageKey(r)));
                for (const r of msg.replies) {
                    if (!replyKeys.has(messageKey(r))) {
                        existingReplies.push(r);
                    }
                }
                existing.replies = existingReplies;
            }
        } else {
            seen.set(key, msg);
        }
    }

    const allMessages = Array.from(seen.values());

    let md = `# #general \u2014 ${displayName}\n\n`;
    md += `**Workspace:** ${workspaceUrl}\n`;
    md += `**Channel:** #general\n`;
    md += `**Synced:** ${now}\n\n---\n`;

    for (const msg of allMessages) {
        md += `\n### ${msg.author} \u2014 ${msg.time}\n${msg.content}\n`;
        if (msg.replies && msg.replies.length > 0) {
            md += '\n';
            for (const reply of msg.replies) {
                md += `> **${reply.author}** \u2014 ${reply.time}\n`;
                // Indent reply content with >
                for (const line of reply.content.split('\n')) {
                    md += `> ${line}\n`;
                }
                md += '>\n';
            }
        }
        md += '\n---\n';
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

            // Fetch thread replies for messages that are thread parents
            for (const msg of messages) {
                if (msg.thread_ts && msg.thread_ts === msg.ts) {
                    try {
                        const replies = await fetchThreadReplies(workspace.url, msg.ts);
                        if (replies.length > 0) {
                            msg.replies = replies;
                            console.log(`[Slack] Fetched ${replies.length} thread replies for ${msg.ts}`);
                        }
                    } catch (err) {
                        console.error(`[Slack] Error fetching thread ${msg.ts}:`, err);
                    }
                }
            }

            // Collect all messages + replies for user resolution
            const allMsgs: SlackMessage[] = [];
            for (const msg of messages) {
                allMsgs.push(msg);
                if (msg.replies) allMsgs.push(...msg.replies);
            }

            // Batch-resolve unknown user IDs (from authors + @mentions in content)
            const unknownIds = new Set<string>();
            const mentionPattern = /<@(U[A-Z0-9]+)>/g;
            for (const msg of allMsgs) {
                if (msg.author?.user_id && !state.userCache[msg.author.user_id]) {
                    unknownIds.add(msg.author.user_id);
                }
                let match;
                while ((match = mentionPattern.exec(msg.content)) !== null) {
                    if (!state.userCache[match[1]]) {
                        unknownIds.add(match[1]);
                    }
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

            // Replace @mentions in all message content with resolved names
            for (const msg of allMsgs) {
                msg.content = msg.content.replace(/<@(U[A-Z0-9]+)>/g, (_: string, id: string) => {
                    return `@${state.userCache[id] || id}`;
                });
            }

            // Build and write markdown (append to existing)
            const wsName = workspaceNameFromUrl(workspace.url);
            const filename = `${wsName}_general.md`;
            const filePath = path.join(SYNC_DIR, filename);
            const existingMessages = parseExistingMessages(filePath);
            const md = buildMarkdown(workspace.url, workspace.name || wsName, existingMessages, messages, state.userCache);
            fs.writeFileSync(filePath, md);
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
