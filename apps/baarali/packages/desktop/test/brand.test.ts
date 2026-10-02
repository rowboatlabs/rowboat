import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, apply, brandText, corePlan, desktopPlan } from '../scripts/brand.mjs';

describe('brandText', () => {
  it('names the product Baarali and keeps every internal id', () => {
    expect(brandText('Sign in to Rowboat')).toBe('Sign in to Baarali');
    expect(brandText('<h1>Welcome to Rowboat</h1>')).toBe('<h1>Welcome to Baarali</h1>');
    expect(brandText("state.startConnect('rowboat')")).toBe("state.startConnect('rowboat')");
    expect(brandText('createRowboatServer(RowboatServer)')).toBe('createRowboatServer(RowboatServer)');
    expect(brandText("{ name: 'Rowboat', schemes: ['rowboat'] }")).toBe("{ name: 'Baarali', schemes: ['rowboat'] }");
  });

  it('leaves the company alone and credits the upstream', () => {
    expect(brandText("name: 'Rowboat Labs'")).toBe("name: 'Rowboat Labs'");
    expect(brandText('Made by Rowboat Labs · Apache 2.0')).toBe('Made by OpenBaara · Built on Rowboat (Apache 2.0)');
  });

  it('names the handle @baarali, never a package nor the protocol anchor', () => {
    expect(brandText('Ask @rowboat about this')).toBe('Ask @baarali about this');
    expect(brandText('const RE = /(^|\\s)@rowboat\\b/i;')).toBe('const RE = /(^|\\s)@baarali\\b/i;');
    expect(brandText('`[@rowboat](#rowboat) ${args}`')).toBe('`[@baarali](#rowboat) ${args}`');
    expect(brandText("from '@rowboat/spaces-protocol'")).toBe("from '@rowboat/spaces-protocol'");
    expect('@baarali'.length).toBe('@rowboat'.length);
  });

  it('points the links, the updater and the control plane at ours', () => {
    expect(brandText("'https://api.x.rowboatlabs.com'")).toBe("'https://app.baarali.com'");
    expect(brandText('const REPO = "rowboatlabs/rowboat";')).toBe('const REPO = "benewende-dev/warell";');
    expect(brandText('https://github.com/rowboatlabs/rowboat/releases')).toBe('https://github.com/benewende-dev/warell/releases');
    expect(brandText('mailto:contact@rowboatlabs.com')).toBe('mailto:contact@baarali.com');
    expect(brandText('href="https://www.rowboatlabs.com/privacy-policy"')).toBe('href="https://baarali.com/"');
  });
});

// The upstream moves every week: if an anchor of ours disappears, this
// fails on the sync's pull request, not in the middle of a release.
describe('apply on this checkout', () => {
  it('finds every anchor of the desktop brand', () => {
    const changes = apply({ write: false });
    expect(changes).toContain('edit apps/x/apps/main/forge.config.cjs');
    expect(changes).toContain('edit apps/x/apps/main/src/main.ts');
    expect(changes).toContain('edit apps/x/apps/main/package.json');
    expect(changes).toContain('edit apps/x/packages/core/src/config/env.ts');
    expect(changes).toContain('edit apps/x/apps/main/src/updater.ts');
    expect(changes).toContain('write apps/x/apps/main/src/baarali-cloud.ts');
    expect(changes).toContain('copy src/baarali-theme.css → apps/x/apps/renderer/src/baarali-theme.css');
  });

  it('brands only the core for the instance image', () => {
    const changes = apply({ only: 'core', write: false });
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.every((c) => c.startsWith('edit apps/x/packages/core/src/'))).toBe(true);
  });

  // Decided 02/10/2026: the agent answers in the person's language, and what
  // the core writes into a new account (the first to-dos, the planner) is French.
  it('gives the agent its language rule and the first account its French', () => {
    const changes = apply({ only: 'core', write: false });
    for (const file of ['runtime/assembly/compose-instructions.ts', 'todo/fileops.ts', 'todo/planner-task.ts']) {
      expect(changes).toContain(`edit apps/x/packages/core/src/${file}`);
    }
    const [language] = corePlan().edits;
    expect(language.to).toMatch(/^const USER_CONTEXT_SYSTEM_INSTRUCTIONS = `# Language\nReply in the language the user writes in/);
    expect(language.to).not.toMatch(/`[^`]*`[^`]*# Hidden/);
  });
});

describe('apply on a Windows checkout', () => {
  it('finds its anchors in CRLF files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-crlf-'));
    const main = 'apps/x/apps/main';
    const edited = [...corePlan().edits, ...desktopPlan().edits].map((e) => e.file);
    for (const rel of new Set([...edited, `${main}/package.json`])) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r?\n/g, '\r\n'));
    }
    for (const dir of ['apps/x/packages/core/src', 'apps/x/apps/renderer/src']) fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.writeFileSync(path.join(root, 'apps/x/apps/renderer/index.html'), '<title>Rowboat</title>\r\n');
    const changes = apply({ root, write: false });
    expect(changes).toContain(`edit ${main}/forge.config.cjs`);
    expect(changes).toContain(`edit ${main}/src/main.ts`);
    expect(changes).toContain('edit apps/x/apps/renderer/src/main.tsx');
  });
});
