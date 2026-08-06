import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { WorkDir } from '../config/config.js';
import { OutlookClientFactory } from './outlook-client-factory.js';
import { isAutomatedAddress } from './contact_filters.js';

// Outlook mirror of gmail_sent_contacts.ts: a local index of the people the
// user has actually sent mail to, built from the Sent Items folder via Graph.
// Much cheaper than the Gmail version — $select returns recipients directly on
// the list call, no per-message metadata fetches. Incremental refreshes filter
// on sentDateTime past the stored watermark.

const STATE_FILE = path.join(WorkDir, 'outlook_contacts_sent.json');
const RECENCY_HALFLIFE_DAYS = 60;
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;
// Full-sync bound: newest N sent messages. Keeps first-connect cost flat on
// huge mailboxes; older correspondents age out of ranking anyway.
const MAX_FULL_SYNC_MESSAGES = 5000;

export interface Contact {
    name: string;
    email: string;
    count: number;
    lastSeenMs: number;
}

interface StoredEntry {
    name: string;
    email: string;
    count: number;
    lastSeenMs: number;
    nameCounts: Record<string, number>;
}

interface StoredState {
    version: 1;
    /** ISO sentDateTime watermark for incremental refreshes. */
    watermark: string | null;
    selfEmail: string | null;
    lastFullSyncAt: number;
    entries: StoredEntry[];
}

interface IndexEntry {
    name: string;
    email: string;
    count: number;
    lastSeenMs: number;
    nameCounts: Map<string, number>;
}

interface GraphRecipient {
    emailAddress?: { name?: string; address?: string };
}

interface GraphSentMessage {
    id?: string;
    sentDateTime?: string;
    toRecipients?: GraphRecipient[];
    ccRecipients?: GraphRecipient[];
}

interface GraphListResponse<T> {
    value?: T[];
    '@odata.nextLink'?: string;
}

let cachedIndex: Map<string, IndexEntry> | null = null;
let lastRefreshAt = 0;
let pendingSync: Promise<void> | null = null;

function loadState(): StoredState | null {
    try {
        if (!fs.existsSync(STATE_FILE)) return null;
        const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as StoredState;
        if (parsed.version !== 1) return null;
        return parsed;
    } catch {
        return null;
    }
}

async function saveState(state: StoredState): Promise<void> {
    const tmp = STATE_FILE + '.tmp';
    await fsp.mkdir(path.dirname(STATE_FILE), { recursive: true });
    await fsp.writeFile(tmp, JSON.stringify(state), 'utf-8');
    await fsp.rename(tmp, STATE_FILE);
}

function indexFromStored(state: StoredState): Map<string, IndexEntry> {
    const map = new Map<string, IndexEntry>();
    for (const e of state.entries) {
        if (isAutomatedAddress(e.email)) continue;
        map.set(e.email, {
            name: e.name,
            email: e.email,
            count: e.count,
            lastSeenMs: e.lastSeenMs,
            nameCounts: new Map(Object.entries(e.nameCounts || {})),
        });
    }
    return map;
}

function storedFromIndex(map: Map<string, IndexEntry>, watermark: string | null, selfEmail: string | null, lastFullSyncAt: number): StoredState {
    const entries: StoredEntry[] = [];
    for (const e of map.values()) {
        entries.push({
            name: e.name,
            email: e.email,
            count: e.count,
            lastSeenMs: e.lastSeenMs,
            nameCounts: Object.fromEntries(e.nameCounts),
        });
    }
    return { version: 1, watermark, selfEmail, lastFullSyncAt, entries };
}

function promoteCanonicalNames(map: Map<string, IndexEntry>): void {
    for (const entry of map.values()) {
        let best = entry.name;
        let bestN = 0;
        for (const [n, c] of entry.nameCounts) {
            if (c > bestN) { best = n; bestN = c; }
        }
        entry.name = best;
    }
}

function ingestMessage(msg: GraphSentMessage, selfEmail: string, map: Map<string, IndexEntry>): { latestSent: string | null } {
    const parsedDate = msg.sentDateTime ? Date.parse(msg.sentDateTime) : NaN;
    const ts = Number.isFinite(parsedDate) ? parsedDate : Date.now();

    const recipients = [...(msg.toRecipients ?? []), ...(msg.ccRecipients ?? [])];
    for (const r of recipients) {
        const email = r.emailAddress?.address?.trim().toLowerCase();
        const name = r.emailAddress?.name?.trim() ?? '';
        if (!email || email === selfEmail) continue;
        if (isAutomatedAddress(email)) continue;
        let entry = map.get(email);
        if (!entry) {
            entry = { name, email, count: 0, lastSeenMs: 0, nameCounts: new Map() };
            map.set(email, entry);
        }
        entry.count++;
        if (ts > entry.lastSeenMs) entry.lastSeenMs = ts;
        if (name && name !== email) entry.nameCounts.set(name, (entry.nameCounts.get(name) || 0) + 1);
    }
    return { latestSent: msg.sentDateTime ?? null };
}

async function listSentMessages(firstUrl: string, cap: number): Promise<GraphSentMessage[]> {
    const out: GraphSentMessage[] = [];
    let url: string | undefined = firstUrl;
    while (url && out.length < cap) {
        const page: GraphListResponse<GraphSentMessage> = await OutlookClientFactory.graphFetch<GraphListResponse<GraphSentMessage>>(url);
        out.push(...(page.value ?? []));
        url = page['@odata.nextLink'];
    }
    return out.slice(0, cap);
}

async function performSync(): Promise<void> {
    const token = await OutlookClientFactory.getAccessToken();
    if (!token) return;

    const me = await OutlookClientFactory.graphFetch<{ mail?: string; userPrincipalName?: string }>(
        '/me?$select=mail,userPrincipalName',
    ).catch(() => null);
    const selfEmail = (me?.mail || me?.userPrincipalName || '').trim().toLowerCase();
    if (!selfEmail) return;

    const stored = loadState();
    const sameAccount = stored?.selfEmail === selfEmail;
    const select = '$select=id,sentDateTime,toRecipients,ccRecipients';

    if (stored && sameAccount && stored.watermark) {
        // Incremental: sent messages newer than the watermark.
        const filter = encodeURIComponent(`sentDateTime ge ${stored.watermark}`);
        const messages = await listSentMessages(
            `/me/mailFolders/sentitems/messages?$filter=${filter}&$top=100&${select}`,
            MAX_FULL_SYNC_MESSAGES,
        );
        const map = indexFromStored(stored);
        let watermark = stored.watermark;
        for (const msg of messages) {
            const { latestSent } = ingestMessage(msg, selfEmail, map);
            if (latestSent && latestSent > watermark) watermark = latestSent;
        }
        if (messages.length > 0) promoteCanonicalNames(map);
        cachedIndex = map;
        await saveState(storedFromIndex(map, watermark, selfEmail, stored.lastFullSyncAt));
        lastRefreshAt = Date.now();
        return;
    }

    // Full sync: newest MAX_FULL_SYNC_MESSAGES sent messages.
    const messages = await listSentMessages(
        `/me/mailFolders/sentitems/messages?$top=100&${select}&$orderby=sentDateTime desc`,
        MAX_FULL_SYNC_MESSAGES,
    );
    const map = new Map<string, IndexEntry>();
    let watermark: string | null = null;
    for (const msg of messages) {
        const { latestSent } = ingestMessage(msg, selfEmail, map);
        if (latestSent && (!watermark || latestSent > watermark)) watermark = latestSent;
    }
    promoteCanonicalNames(map);
    cachedIndex = map;
    await saveState(storedFromIndex(map, watermark ?? new Date().toISOString(), selfEmail, Date.now()));
    lastRefreshAt = Date.now();
}

function ensureFresh(): void {
    if (pendingSync) return;
    if (Date.now() - lastRefreshAt < REFRESH_INTERVAL_MS) return;
    pendingSync = performSync()
        .catch((err) => {
            console.error('[outlook_sent_contacts] sync failed:', err instanceof Error ? err.message : err);
        })
        .finally(() => {
            pendingSync = null;
        });
}

// Public: kick off a sync on app startup / connect. Calls within the refresh
// window are no-ops.
export function warmSentContacts(): void {
    if (!cachedIndex) {
        const stored = loadState();
        if (stored) cachedIndex = indexFromStored(stored);
    }
    ensureFresh();
}

export function invalidateSentContacts(): void {
    cachedIndex = null;
    lastRefreshAt = 0;
}

function score(entry: IndexEntry, nowMs: number): number {
    const days = Math.max(0, (nowMs - entry.lastSeenMs) / (1000 * 60 * 60 * 24));
    const recency = Math.pow(0.5, days / RECENCY_HALFLIFE_DAYS);
    return entry.count * (0.5 + 0.5 * recency);
}

function matchTier(q: string, entry: IndexEntry): number {
    if (!q) return 3;
    const name = entry.name.toLowerCase();
    const email = entry.email;
    if (name && name.startsWith(q)) return 0;
    if (email.startsWith(q)) return 1;
    if (name && name.includes(' ' + q)) return 1;
    if (name && name.includes(q)) return 2;
    if (email.includes(q)) return 3;
    return -1;
}

export interface SearchOpts {
    limit?: number;
    excludeEmails?: string[];
}

// Public: typeahead search over sent-recipient history. Returns instantly from
// the in-memory cache (or disk on first call) and triggers a background refresh.
export async function searchSentContacts(query: string, opts: SearchOpts = {}): Promise<Contact[]> {
    if (!cachedIndex) {
        const stored = loadState();
        if (stored) cachedIndex = indexFromStored(stored);
    }
    ensureFresh();

    if (!cachedIndex) {
        // First-ever launch: wait for the initial sync so we can return
        // something useful instead of an empty list.
        if (pendingSync) {
            try { await pendingSync; } catch { /* return whatever we have */ }
        }
        if (!cachedIndex) return [];
    }

    const q = query.trim().toLowerCase();
    const limit = Math.max(1, Math.min(50, opts.limit ?? 8));
    const excluded = new Set((opts.excludeEmails ?? []).map((e) => e.trim().toLowerCase()));
    const nowMs = Date.now();

    const matches: Array<{ entry: IndexEntry; tier: number; s: number }> = [];
    for (const entry of cachedIndex.values()) {
        if (excluded.has(entry.email)) continue;
        if (isAutomatedAddress(entry.email)) continue;
        const tier = matchTier(q, entry);
        if (tier < 0) continue;
        matches.push({ entry, tier, s: score(entry, nowMs) });
    }
    matches.sort((a, b) => (a.tier - b.tier) || (b.s - a.s));
    return matches.slice(0, limit).map(({ entry }) => ({
        name: entry.name,
        email: entry.email,
        count: entry.count,
        lastSeenMs: entry.lastSeenMs,
    }));
}
