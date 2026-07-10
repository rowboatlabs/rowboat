import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import readline from 'readline';
import { execFile } from 'child_process';
import { WorkDir } from '../config/config.js';

interface SearchResult {
  type: 'knowledge' | 'chat';
  title: string;
  preview: string;
  path: string;
}

const KNOWLEDGE_DIR = path.join(WorkDir, 'knowledge');
// Chats live in the turn-runtime session store: session event logs carry the
// titles, turn logs carry the message content. (The legacy `runs/` dir holds
// pre-migration chats the app can no longer open, so search skips it.)
const TURNS_DIR = path.join(WorkDir, 'storage', 'turns');

type SearchType = 'knowledge' | 'chat';

/** Minimal session metadata the caller passes in (from the sessions index). */
export type ChatSessionMeta = {
  sessionId: string;
  title?: string;
};

/**
 * Search across knowledge files and chat history.
 * @param types - optional filter to search only specific types (default: both)
 * @param chatSessions - session index entries used for chat title search and
 *   for mapping content matches back to a titled, openable session.
 */
export async function search(
  query: string,
  limit = 20,
  types?: SearchType[],
  chatSessions: ChatSessionMeta[] = [],
): Promise<{ results: SearchResult[] }> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { results: [] };
  }

  const searchKnowledgeEnabled = !types || types.includes('knowledge');
  const searchChatsEnabled = !types || types.includes('chat');

  const [knowledgeResults, chatResults] = await Promise.all([
    searchKnowledgeEnabled ? searchKnowledge(trimmed, limit) : Promise.resolve([]),
    searchChatsEnabled ? searchChats(trimmed, limit, chatSessions) : Promise.resolve([]),
  ]);

  const results = [...knowledgeResults, ...chatResults].slice(0, limit);
  return { results };
}

/**
 * Search knowledge markdown files by content and filename.
 */
async function searchKnowledge(query: string, limit: number): Promise<SearchResult[]> {
  if (!fs.existsSync(KNOWLEDGE_DIR)) {
    return [];
  }

  const results: SearchResult[] = [];
  const seenPaths = new Set<string>();
  const lowerQuery = query.toLowerCase();

  // Content search via grep
  try {
    const grepMatches = await grepFiles(query, KNOWLEDGE_DIR, '*.md');
    for (const match of grepMatches) {
      if (results.length >= limit) break;
      const relPath = path.relative(WorkDir, match.file);
      if (seenPaths.has(relPath)) continue;
      seenPaths.add(relPath);

      const title = path.basename(match.file, '.md');
      results.push({
        type: 'knowledge',
        title,
        preview: match.line.trim().substring(0, 150),
        path: relPath,
      });
    }
  } catch {
    // grep failed (no matches or dir issue) — continue
  }

  // Filename search — check files whose name matches the query
  try {
    const allFiles = await listMarkdownFiles(KNOWLEDGE_DIR);
    for (const file of allFiles) {
      if (results.length >= limit) break;
      const relPath = path.relative(WorkDir, file);
      if (seenPaths.has(relPath)) continue;

      const basename = path.basename(file, '.md');
      if (basename.toLowerCase().includes(lowerQuery)) {
        seenPaths.add(relPath);
        const preview = await readFirstLines(file, 2);
        results.push({
          type: 'knowledge',
          title: basename,
          preview,
          path: relPath,
        });
      }
    }
  } catch {
    // ignore errors
  }

  return results;
}

/**
 * Search chat history: titles come from the sessions index the caller passes
 * in; message content is grepped from the turn logs, with each matching turn
 * file mapped back to its session via the turn_created event's sessionId.
 */
async function searchChats(query: string, limit: number, sessions: ChatSessionMeta[]): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const seenIds = new Set<string>();
  const lowerQuery = query.toLowerCase();
  const titleBySession = new Map(sessions.map((s) => [s.sessionId, s.title]));

  // Title search — the index is already newest-first.
  for (const session of sessions) {
    if (results.length >= limit) break;
    if (!session.title || !session.title.toLowerCase().includes(lowerQuery)) continue;
    seenIds.add(session.sessionId);
    results.push({
      type: 'chat',
      title: session.title,
      preview: session.title,
      path: session.sessionId,
    });
  }

  // Content search via grep on the turn logs.
  if (fs.existsSync(TURNS_DIR)) {
    try {
      const grepMatches = await grepFiles(query, TURNS_DIR, '*.jsonl');
      for (const match of grepMatches) {
        if (results.length >= limit) break;
        const sessionId = await readTurnSessionId(match.file);
        // Sessionless turns (background tasks etc.) aren't openable chats.
        if (!sessionId || seenIds.has(sessionId)) continue;
        // Only surface sessions the app can actually open.
        if (!titleBySession.has(sessionId)) continue;
        seenIds.add(sessionId);
        results.push({
          type: 'chat',
          title: titleBySession.get(sessionId) || sessionId,
          preview: extractPreview(match.line, lowerQuery),
          path: sessionId,
        });
      }
    } catch {
      // grep failed — continue with title matches only
    }
  }

  return results;
}

/**
 * Use grep to find files matching a query.
 */
function grepFiles(query: string, dir: string, includeGlob: string): Promise<Array<{ file: string; line: string }>> {
  return new Promise((resolve, reject) => {
    execFile(
      'grep',
      ['-ril', '--include=' + includeGlob, query, dir],
      { maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          // Exit code 1 = no matches
          if (error.code === 1) {
            resolve([]);
            return;
          }
          reject(error);
          return;
        }

        const files = stdout.trim().split('\n').filter(Boolean);
        // For each matching file, get the first matching line
        const promises = files.map(file =>
          getFirstMatchingLine(file, query).then(line => ({ file, line }))
        );
        Promise.all(promises).then(resolve).catch(reject);
      }
    );
  });
}

/**
 * Get the first line in a file that matches the query (case-insensitive).
 */
function getFirstMatchingLine(filePath: string, query: string): Promise<string> {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (value: string) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    const lowerQuery = query.toLowerCase();
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      if (line.toLowerCase().includes(lowerQuery)) {
        done(line);
        rl.close();
        stream.destroy();
      }
    });

    rl.on('close', () => done(''));
    stream.on('error', () => done(''));
  });
}

/**
 * Read the sessionId from a turn log's first line (the turn_created event).
 * Returns null for sessionless turns (background tasks, live notes, etc.).
 */
function readTurnSessionId(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (value: string | null) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      try {
        const parsed = JSON.parse(line);
        done(typeof parsed.sessionId === 'string' && parsed.sessionId ? parsed.sessionId : null);
      } catch {
        done(null);
      }
      rl.close();
      stream.destroy();
    });

    rl.on('close', () => done(null));
    stream.on('error', () => done(null));
  });
}

/**
 * Pull a human-readable preview out of a matched JSONL line: the first string
 * value anywhere in the event that contains the query. Falls back to the raw
 * line so a match is never silently dropped.
 */
function extractPreview(line: string, lowerQuery: string): string {
  const clean = (s: string) =>
    s.replace(/<attached-files>[\s\S]*?<\/attached-files>/g, '').replace(/\s+/g, ' ').trim().substring(0, 150);
  try {
    const parsed: unknown = JSON.parse(line);
    let found = '';
    const visit = (value: unknown): void => {
      if (found) return;
      if (typeof value === 'string') {
        if (value.toLowerCase().includes(lowerQuery)) found = value;
      } else if (value && typeof value === 'object') {
        for (const v of Object.values(value)) visit(v);
      }
    };
    visit(parsed);
    if (found) return clean(found);
  } catch {
    // fall through to the raw line
  }
  return clean(line);
}

/**
 * Recursively list all .md files in a directory.
 */
async function listMarkdownFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await listMarkdownFiles(fullPath);
        results.push(...nested);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(fullPath);
      }
    }
  } catch {
    // ignore
  }
  return results;
}

/**
 * Read the first N non-empty lines of a file for preview.
 */
async function readFirstLines(filePath: string, n: number): Promise<string> {
  return new Promise((resolve) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    const lines: string[] = [];

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        lines.push(trimmed);
      }
      if (lines.length >= n) {
        rl.close();
        stream.destroy();
      }
    });

    rl.on('close', () => {
      resolve(lines.join(' ').substring(0, 150));
    });

    stream.on('error', () => {
      resolve('');
    });
  });
}
