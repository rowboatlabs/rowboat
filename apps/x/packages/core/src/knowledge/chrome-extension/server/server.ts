import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { WorkDir } from '../../../config/config.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const CAPTURED_PAGES_DIR = path.join(WorkDir, 'chrome_sync');
const CONFIG_DIR = path.join(WorkDir, 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'chrome-plugin.json');

interface Config {
    mode: 'all' | 'ask';
    whitelist: string[];
    blacklist: string[];
    enabled: boolean;
}

const DEFAULT_CONFIG: Config = {
    mode: 'ask',
    whitelist: [],
    blacklist: [],
    enabled: true
};

const contentHashes = new Map<string, string>();

function extractDomain(url: string): string {
    try {
        const parsed = new URL(url);
        return parsed.host || 'unknown';
    } catch {
        return 'unknown';
    }
}

function pathToSlug(url: string): string {
    try {
        const parsed = new URL(url);
        const p = parsed.pathname + (parsed.search || '');
        if (!p || p === '/') return 'index';
        let slug = p.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
        return slug.substring(0, 80) || 'index';
    } catch {
        return 'index';
    }
}

function hashContent(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

function findExistingFile(domainDir: string, pathSlug: string): string | null {
    if (!fs.existsSync(domainDir)) return null;
    const files = fs.readdirSync(domainDir);
    for (const filename of files) {
        if (filename.endsWith(`_${pathSlug}.md`)) {
            return path.join(domainDir, filename);
        }
    }
    return null;
}

// POST /capture
app.post('/capture', (req, res) => {
    const data = req.body;
    if (!data) {
        return res.status(400).json({ error: 'No JSON data provided' });
    }

    const { url, content = '', timestamp, title = 'Untitled' } = data;

    if (!url || !timestamp) {
        return res.status(400).json({ error: 'Missing required fields: url, timestamp' });
    }

    const domain = extractDomain(url);
    const pathSlug = pathToSlug(url);
    const contentHash = hashContent(content);
    const cacheKey = `${domain}/${pathSlug}`;

    const dt = new Date(timestamp);
    const year = dt.getFullYear();
    const month = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    const hours = String(dt.getHours()).padStart(2, '0');
    const minutes = String(dt.getMinutes()).padStart(2, '0');
    const seconds = String(dt.getSeconds()).padStart(2, '0');
    const timeStr = `${hours}-${minutes}`;
    const timeDisplay = `${hours}:${minutes}:${seconds}`;
    const tzOffset = -dt.getTimezoneOffset();
    const tzSign = tzOffset >= 0 ? '+' : '-';
    const tzHours = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, '0');
    const tzMins = String(Math.abs(tzOffset) % 60).padStart(2, '0');
    const isoTimestamp = `${dateStr}T${hours}:${minutes}:${seconds}${tzSign}${tzHours}:${tzMins}`;

    // date/domain directory structure
    const domainDir = path.join(CAPTURED_PAGES_DIR, dateStr, domain);
    fs.mkdirSync(domainDir, { recursive: true });

    const existingFile = findExistingFile(domainDir, pathSlug);
    if (existingFile && contentHashes.get(cacheKey) === contentHash) {
        return res.json({ status: 'skipped', reason: 'duplicate content' });
    }

    contentHashes.set(cacheKey, contentHash);

    // If file exists, append with scroll separator
    if (existingFile) {
        const scrollSeparator = `\n\n---\n📜 Scroll captured at ${timeDisplay}\n---\n\n`;
        fs.appendFileSync(existingFile, scrollSeparator + content, 'utf-8');
        const rel = `${dateStr}/${domain}/${path.basename(existingFile)}`;
        return res.json({ status: 'appended', filename: rel });
    }

    // New file - create with frontmatter
    const filename = `${timeStr}_${pathSlug}.md`;
    const filepath = path.join(domainDir, filename);

    const markdownContent = `---
url: ${url}
title: ${title}
captured_at: ${isoTimestamp}
---

${content}
`;

    fs.writeFileSync(filepath, markdownContent, 'utf-8');
    return res.status(201).json({ status: 'captured', filename: `${dateStr}/${domain}/${filename}` });
});

// GET /status
app.get('/status', (_req, res) => {
    let count = 0;
    const domains: Record<string, number> = {};

    if (!fs.existsSync(CAPTURED_PAGES_DIR)) {
        return res.json({ count: 0, domains: [] });
    }

    for (const dateEntry of fs.readdirSync(CAPTURED_PAGES_DIR)) {
        const datePath = path.join(CAPTURED_PAGES_DIR, dateEntry);
        if (!fs.statSync(datePath).isDirectory()) continue;

        for (const domainEntry of fs.readdirSync(datePath)) {
            const domainPath = path.join(datePath, domainEntry);
            if (!fs.statSync(domainPath).isDirectory()) continue;

            const domainCount = fs.readdirSync(domainPath).filter(f => f.endsWith('.md')).length;
            count += domainCount;
            if (domainCount > 0) {
                domains[domainEntry] = (domains[domainEntry] || 0) + domainCount;
            }
        }
    }

    const domainList = Object.entries(domains)
        .map(([domain, c]) => ({ domain, count: c }))
        .sort((a, b) => b.count - a.count);

    return res.json({ count, domains: domainList });
});

// Config helpers
function loadConfig(): Config {
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
            return JSON.parse(raw);
        } catch {
            // fall through
        }
    }
    return { ...DEFAULT_CONFIG };
}

function saveConfig(config: Config): void {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

function validateConfig(data: any): data is Config {
    if (typeof data !== 'object' || data === null) return false;
    if (data.mode !== 'all' && data.mode !== 'ask') return false;
    if (!Array.isArray(data.whitelist)) return false;
    if (!Array.isArray(data.blacklist)) return false;
    if (typeof data.enabled !== 'boolean') return false;
    return true;
}

// GET /browse/config
app.get('/browse/config', (_req, res) => {
    const config = loadConfig();
    return res.json(config);
});

// POST /browse/config
app.post('/browse/config', (req, res) => {
    const data = req.body;
    if (!data) {
        return res.status(400).json({ error: 'No JSON data provided' });
    }

    if (!validateConfig(data)) {
        return res.status(400).json({ error: 'Invalid config shape' });
    }

    saveConfig(data);
    return res.json({ status: 'saved', config: data });
});

const PORT = 3001;

export async function init(): Promise<void> {
    fs.mkdirSync(CAPTURED_PAGES_DIR, { recursive: true });
    fs.mkdirSync(CONFIG_DIR, { recursive: true });

    app.listen(PORT, 'localhost', () => {
        console.log('[ChromeSync] Server starting.');
        console.log(`  Captured pages: ${CAPTURED_PAGES_DIR}`);
        console.log(`  Config: ${CONFIG_FILE}`);
        console.log(`  Listening on http://localhost:${PORT}`);
    });
}
