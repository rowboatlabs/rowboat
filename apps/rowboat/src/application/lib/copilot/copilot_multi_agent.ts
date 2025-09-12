
import * as fs from 'fs';
import * as path from 'path';
import { COPILOT_INSTRUCTIONS_MULTI_AGENT } from './copilot_multi_agent_build';

function findUsingRowboatDocsDir(): string | null {
  const candidates = [
    path.resolve(process.cwd(), '../docs/docs/using-rowboat'),
    path.resolve(process.cwd(), 'apps/docs/docs/using-rowboat'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
    } catch {}
  }
  return null;
}

function stripFrontmatter(content: string): { title: string | null; body: string } {
  let title: string | null = null;
  if (content.startsWith('---')) {
    const end = content.indexOf('\n---', 3);
    if (end !== -1) {
      const fm = content.slice(3, end).trim();
      const tMatch = fm.match(/\btitle:\s*"([^"]+)"|\btitle:\s*'([^']+)'|\btitle:\s*(.+)/);
      if (tMatch) {
        title = (tMatch[1] || tMatch[2] || tMatch[3] || '').trim();
      }
      content = content.slice(end + 4);
    }
  }
  return { title, body: content };
}

function sanitizeMdxToPlain(md: string): string {
  const lines = md
    .split('\n')
    .filter(l => !/^\s*(import|export)\b/.test(l))
    .map(l => l.replace(/<[^>]+>/g, ''));
  let inFence = false;
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function extractOverview(body: string): string {
  const ovIndex = body.indexOf('\n## Overview');
  if (ovIndex !== -1) {
    const slice = body.slice(ovIndex + 1);
    const nextHeader = slice.search(/\n#{1,6}\s+/);
    const section = nextHeader === -1 ? slice : slice.slice(0, nextHeader);
    return section.trim();
  }
  const first = body.split('\n').slice(0, 20).join('\n');
  return first.length > 1200 ? first.slice(0, 1200) + '…' : first;
}

function collectDocsSummaries(): string {
  const dir = findUsingRowboatDocsDir();
  if (!dir) return '';

  const entries: string[] = [];
  try {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isFile() && name.endsWith('.mdx')) entries.push(full);
      if (stat.isDirectory()) {
        for (const sub of fs.readdirSync(full)) {
          const subFull = path.join(full, sub);
          if (fs.statSync(subFull).isFile() && sub.endsWith('.mdx')) entries.push(subFull);
        }
      }
    }
  } catch {
    return '';
  }

  const items: string[] = [];
  for (const file of entries.sort()) {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const { title, body } = stripFrontmatter(raw);
      const plain = sanitizeMdxToPlain(body);
      const summary = extractOverview(plain);
      const fname = path.basename(file, '.mdx');
      const header = title || fname.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      items.push(`- ${header}:\n${summary}`);
    } catch {}
  }

  if (!items.length) return '';
  return `\n\nAdditional Reference (auto-loaded from docs):\n${items.join('\n\n')}\n`;
}

const USING_ROWBOAT_DOCS = collectDocsSummaries();

// Inject auto-loaded docs, if available
export const COPILOT_INSTRUCTIONS_MULTI_AGENT_WITH_DOCS =
  COPILOT_INSTRUCTIONS_MULTI_AGENT.replace('{USING_ROWBOAT_DOCS}', USING_ROWBOAT_DOCS);
