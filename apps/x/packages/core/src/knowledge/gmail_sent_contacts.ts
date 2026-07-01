import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { google, gmail_v1 as gmail } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { WorkDir } from '../config/config.js';
import { GoogleClientFactory } from './google-client-factory.js';
import { getUserEmail } from './classify_thread.js';
import { isAutomatedAddress } from './contact_filters.js';

const STATE_FILE = path.join(WorkDir, 'contacts_sent.json');
const RECENCY_HALFLIFE_DAYS = 60;
const HEADER_FETCH_CONCURRENCY = 8;
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

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
    historyId: string | null;
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

let cachedIndex: Map<string, IndexEntry> | null = null;
let lastRefreshAt = 0;
let pendingSync: Promise<void> | null = null;

// Parses an address-list header value, respecting quoted display names and
// angle brackets ("Last, First" <a@b>, …).
function parseAddressList(header: string): Array<{ name: string; email: string }> {
    if (!header) return [];
    const parts: string[] = [];
    let buf = '';
    let inQuotes = false;
    let inBrackets = 0;
    for (const ch of header) {
        if (ch === '"' && inBrackets === 0) inQuotes = !inQuotes;
        else if (ch === '<') inBrackets++;
        else if (ch === '>') inBrackets = Math.max(0, inBrackets - 1);
        if (ch === ',' && !inQuotes && inBrackets === 0) {
            if (buf.trim()) parts.push(buf.trim());
            buf = '';
        } else {
            buf += ch;
        }
    }
    if (buf.trim()) parts.push(buf.trim());

    const out: Array<{ name: string; email: string }> = [];
    for (const part of parts) {
        const angled = part.match(/^(.*?)<\s*([^>]+?)\s*>\s*$/);
        if (angled) {
            const name = angled[1].trim().replace(/^"|"$/g, '').trim();
            const email = angled[2].trim().toLowerCase();
            if (email.includes('@')) out.push({ name, email });
        } else if (part.includes('@')) {
            out.push({ name: '', email: part.trim().toLowerCase() });
        }
    }
    return out;
}

function loadState(): StoredState | null {
    try {
        if (!fs.existsSync(STATE_FILE)) return null;
        const raw = fs.readFileSync(STATE_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as StoredState;
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

function storedFromIndex(map: Map<string, IndexEntry>, historyId: string | null, selfEmail: string | null, lastFullSyncAt: number): StoredState {
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
    return { version: 1, historyId, selfEmail, lastFullSyncAt, entries };
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

// Pulls the To/Cc/Date headers for a single sent message and folds the parsed
// recipients into the index.
async function ingestMessage(
    client: gmail.Gmail,
    messageId: string,
    selfEmail: string,
    map: Map<string, IndexEntry>,
): Promise<void> {
    const res = await client.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'metadata',
        metadataHeaders: ['To', 'Cc', 'Date'],
    });
    const headers = res.data.payload?.headers ?? [];
    const headerValue = (name: string) => headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

    const dateStr = headerValue('Date');
    const parsedDate = dateStr ? Date.parse(dateStr) : NaN;
    const ts = Number.isFinite(parsedDate) ? parsedDate : Date.now();

    const recipients = [
        ...parseAddressList(headerValue('To')),
        ...parseAddressList(headerValue('Cc')),
    ];
    for (const { name, email } of recipients) {
        if (!email || email === selfEmail) continue;
        if (isAutomatedAddress(email)) continue;
        let entry = map.get(email);
        if (!entry) {
            entry = { name, email, count: 0, lastSeenMs: 0, nameCounts: new Map() };
            map.set(email, entry);
        }
        entry.count++;
        if (ts > entry.lastSeenMs) entry.lastSeenMs = ts;
        if (name) entry.nameCounts.set(name, (entry.nameCounts.get(name) || 0) + 1);
    }
}

async function processInBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
    for (let i = 0; i < items.length; i += size) {
        const slice = items.slice(i, i + size);
        await Promise.all(slice.map(async (item) => {
            try { await fn(item); }
            catch { /* skip failed individual messages */ }
        }));
    }
}

async function fullSync(auth: OAuth2Client, selfEmail: string): Promise<{ map: Map<string, IndexEntry>; historyId: string | null }> {
    const client = google.gmail({ version: 'v1', auth });

    // Lock in the current historyId BEFORE we start listing, so any messages
    // sent during the sync get caught by the next incremental run.
    let startingHistoryId: string | null = null;
    try {
        const profile = await client.users.getProfile({ userId: 'me' });
        startingHistoryId = profile.data.historyId ?? null;
    } catch {
        startingHistoryId = null;
    }

    const messageIds: string[] = [];
    let pageToken: string | undefined;
    do {
        const res = await client.users.messages.list({
            userId: 'me',
            labelIds: ['SENT'],
            maxResults: 500,
            pageToken,
        });
        for (const m of res.data.messages ?? []) {
            if (m.id) messageIds.push(m.id);
        }
        pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    const map = new Map<string, IndexEntry>();
    await processInBatches(messageIds, HEADER_FETCH_CONCURRENCY, (id) => ingestMessage(client, id, selfEmail, map));
    promoteCanonicalNames(map);
    return { map, historyId: startingHistoryId };
}

async function incrementalSync(
    auth: OAuth2Client,
    selfEmail: string,
    startHistoryId: string,
    map: Map<string, IndexEntry>,
): Promise<{ historyId: string | null; added: number } | null> {
    const client = google.gmail({ version: 'v1', auth });
    const added: string[] = [];
    let pageToken: string | undefined;
    let latestHistoryId: string | null = null;
    try {
        do {
            const res = await client.users.history.list({
                userId: 'me',
                startHistoryId,
                labelId: 'SENT',
                historyTypes: ['messageAdded'],
                maxResults: 500,
                pageToken,
            });
            for (const h of res.data.history ?? []) {
                for (const m of h.messagesAdded ?? []) {
                    const labels = m.message?.labelIds ?? [];
                    const id = m.message?.id;
                    if (id && labels.includes('SENT')) added.push(id);
                }
            }
            if (res.data.historyId) latestHistoryId = res.data.historyId;
            pageToken = res.data.nextPageToken ?? undefined;
        } while (pageToken);
    } catch (err: unknown) {
        // 404 means startHistoryId is too old — caller should fall back to full sync.
        const status = (err as { code?: number; status?: number })?.code ?? (err as { code?: number; status?: number })?.status;
        if (status === 404) return null;
        throw err;
    }

    // Dedupe in case the same message shows up in multiple history pages.
    const unique = Array.from(new Set(added));
    await processInBatches(unique, HEADER_FETCH_CONCURRENCY, (id) => ingestMessage(client, id, selfEmail, map));
    if (unique.length > 0) promoteCanonicalNames(map);

    // If history.list returned no entries we have no fresh historyId; keep
    // using the watermark we started from so the next call retries the same window.
    return { historyId: latestHistoryId ?? startHistoryId, added: unique.length };
}

async function performSync(): Promise<void> {
    const auth = await GoogleClientFactory.getClient();
    if (!auth) return;
    const selfRaw = await getUserEmail(auth).catch(() => null);
    if (!selfRaw) return;
    const selfEmail = selfRaw.trim().toLowerCase();

    const stored = loadState();
    const sameAccount = stored?.selfEmail === selfEmail;

    if (stored && sameAccount && stored.historyId) {
        const map = indexFromStored(stored);
        const result = await incrementalSync(auth, selfEmail, stored.historyId, map);
        if (result) {
            cachedIndex = map;
            await saveState(storedFromIndex(map, result.historyId, selfEmail, stored.lastFullSyncAt));
            lastRefreshAt = Date.now();
            return;
        }
        // history watermark too old → fall through to full sync.
    }

    const { map, historyId } = await fullSync(auth, selfEmail);
    cachedIndex = map;
    await saveState(storedFromIndex(map, historyId, selfEmail, Date.now()));
    lastRefreshAt = Date.now();
}

function ensureFresh(): void {
    if (pendingSync) return;
    if (Date.now() - lastRefreshAt < REFRESH_INTERVAL_MS) return;
    pendingSync = performSync()
        .catch((err) => {
            console.error('[gmail_sent_contacts] sync failed:', err instanceof Error ? err.message : err);
        })
        .finally(() => {
            pendingSync = null;
        });
}

// Public: kick off a sync on app startup. Subsequent calls within the refresh
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
    // Kick off (or join) a background refresh; never block the user.
    ensureFresh();

    if (!cachedIndex) {
        // First-ever launch: wait for the initial sync so we can return something
        // useful instead of an empty list.
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
