import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, apply, brandText } from '../scripts/brand.mjs';

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
  });

  it('brands only the core for the instance image', () => {
    const changes = apply({ only: 'core', write: false });
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.every((c) => c.startsWith('edit apps/x/packages/core/src/'))).toBe(true);
  });
});

describe('apply on a Windows checkout', () => {
  it('finds its anchors in CRLF files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-crlf-'));
    const main = 'apps/x/apps/main';
    for (const rel of [`${main}/forge.config.cjs`, `${main}/src/main.ts`, `${main}/package.json`]) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r?\n/g, '\r\n'));
    }
    for (const dir of ['apps/x/packages/core/src', 'apps/x/apps/renderer/src']) fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.writeFileSync(path.join(root, 'apps/x/apps/renderer/index.html'), '<title>Rowboat</title>\r\n');
    const changes = apply({ root, write: false });
    expect(changes).toContain(`edit ${main}/forge.config.cjs`);
    expect(changes).toContain(`edit ${main}/src/main.ts`);
  });
});
