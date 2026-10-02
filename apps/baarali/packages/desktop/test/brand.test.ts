import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, apply, brandText, corePlan, desktopPlan, mobilePlan } from '../scripts/brand.mjs';

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
    expect(brandText('const REPO = "rowboatlabs/rowboat";')).toBe('const REPO = "benewende-dev/baarali";');
    expect(brandText('https://github.com/rowboatlabs/rowboat/releases')).toBe('https://github.com/benewende-dev/baarali/releases');
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

describe('the mobile app', () => {
  it('brands it without the upstream Expo account or store keys', () => {
    const changes = apply({ only: 'mobile', write: false });
    expect(changes).toContain('edit apps/x/apps/mobile/app.json');
    expect(changes).toContain('write apps/x/apps/mobile/babel.config.js');
    const doc = mobilePlan().json.update(JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/x/apps/mobile/app.json'), 'utf8')));
    expect(doc.expo.name).toBe('Baarali');
    expect(doc.expo.ios.bundleIdentifier).toBe('com.baarali.app.mobile');
    expect(doc.expo.owner).toBeUndefined();
    expect(doc.expo.extra.eas).toBeUndefined();
    expect(JSON.stringify(doc)).not.toMatch(/Rowboat/);
    // The sign-in comes back by the bundle id's scheme (oauth.ts below).
    expect(doc.expo.scheme).toEqual(['baarali', 'com.baarali.app.mobile']);
    const eas = mobilePlan().writes.find(([to]) => to.endsWith('eas.json'))![1];
    expect(eas).not.toMatch(/asc|submit/i);
  });

  // Harbor, the Spaces server we host (02/10/2026): its pages come from
  // packages/spaces/src/pages.ts. An upstream change to an anchor breaks here.
  it('brands the Spaces server image', () => {
    const changes = apply({ only: 'harbor', write: false });
    expect(changes).toEqual([
      'write apps/harbor/packages/server/src/baarali-pages.ts',
      'edit apps/harbor/packages/server/src/http.ts',
      'edit apps/harbor/packages/server/src/apex.ts',
    ]);
  });

  // Control's sign-in server takes a phone's redirect only as RFC 8252 §7.1
  // describes it (control src/auth.ts, asAppRequest): reverse-domain, no `//`.
  it('finds Spaces on our own server', () => {
    const e = mobilePlan().edits.find((x) => x.file.endsWith('spaces/account.tsx') && x.from.includes('SPACES_APEX'))!;
    expect(e.to).toBe("process.env.EXPO_PUBLIC_SPACES_APEX ?? 'https://spaces.baarali.com';");
  });

  it('comes back from the sign-in by a redirect our server accepts', () => {
    const e = mobilePlan().edits.find((x) => x.file.endsWith('spaces/oauth.ts'))!;
    expect(e.to).toBe("export const REDIRECT_URI = 'com.baarali.app.mobile:/oauth-callback';");
  });

  it('asks who you are after a sign-out, rather than reusing Safari\'s session', () => {
    const tos = mobilePlan().edits.filter((x) => x.file.endsWith('spaces/oauth.ts')).map((x) => x.to);
    expect(tos.some((t) => t.includes('{ preferEphemeralSession: true }'))).toBe(true);
  });

  // Decided 02/10/2026: no screen of the app may send a person to the upstream's servers.
  it('never reaches the upstream once branded', () => {
    const edits = mobilePlan().edits;
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [path.join(dir, e.name)] : []));
    for (const file of walk(path.join(ROOT, 'apps/x/apps/mobile/src'))) {
      let code = fs.readFileSync(file, 'utf8');
      for (const e of edits) if (path.join(ROOT, e.file) === file) code = code.replace(e.from, e.to);
      // Comments may still describe the upstream; code may not call it.
      const live = brandText(code).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(live, path.relative(ROOT, file)).not.toMatch(/rowboatlabs\.com/);
    }
  });

  it('imports the dictionary the way Metro resolves it', () => {
    const runtime = mobilePlan().writes.find(([to]) => to.endsWith('mobile/runtime.ts'))![1];
    expect(runtime).toContain("from '../fr';");
    expect(runtime).not.toMatch(/from '[^']+\.js'/);
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
