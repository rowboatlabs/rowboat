import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mcpTools, routes } from '@rowboat/spaces-protocol';

// The documents beside the code are load-bearing: CONTRACT.md names every
// route and every agent tool, and SPEC.md, CONTRACT.md and AGENTS.md link
// into each other by heading. Pinning both here means a route without a
// bullet, or a link to a renamed section, fails in CI instead of in a
// reader's head.

const HARBOR = resolve(import.meta.dirname, '../../..');
const DOCS = ['SPEC.md', 'CONTRACT.md', 'AGENTS.md'];
const read = (file: string) => readFileSync(resolve(HARBOR, file), 'utf8');

/** GitHub's heading → anchor rule, for our headings: markdown stripped, lowercased, punctuation dropped, spaces to hyphens. */
function anchorsOf(markdown: string): Set<string> {
  const anchors = new Set<string>();
  for (const line of markdown.split('\n')) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (!heading) continue;
    const text = heading[1]!.replace(/[*_`]/g, '').trim().toLowerCase();
    anchors.add(text.replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-'));
  }
  return anchors;
}

describe('the docs beside the code', () => {
  it('CONTRACT.md mentions every route and every agent tool, by name or by path', () => {
    const contract = read('CONTRACT.md');
    const missing: string[] = [];
    for (const [name, route] of Object.entries(routes)) {
      if (!contract.includes(name) && !contract.includes(route.path)) missing.push(`route ${name} (${route.path})`);
    }
    for (const tool of mcpTools) if (!contract.includes(tool.name)) missing.push(`tool ${tool.name}`);
    expect(missing).toEqual([]);
  });

  it('every relative link in SPEC, CONTRACT and AGENTS reaches a file, and every anchor a heading', () => {
    const broken: string[] = [];
    for (const file of DOCS) {
      for (const link of read(file).matchAll(/\]\((\.\.?\/[^)#\s]+)(#[^)\s]+)?\)/g)) {
        const target = resolve(HARBOR, dirname(file), link[1]!);
        if (!existsSync(target)) {
          broken.push(`${file} → ${link[1]}`);
          continue;
        }
        if (link[2] && !anchorsOf(readFileSync(target, 'utf8')).has(link[2].slice(1))) broken.push(`${file} → ${link[1]}${link[2]}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
