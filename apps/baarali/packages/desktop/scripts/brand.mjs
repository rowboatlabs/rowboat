#!/usr/bin/env node
// Applies the Baarali brand to a checkout, just before a build (option A,
// decided 01/10/2026). The repository keeps the upstream files as they are,
// so a weekly sync never conflicts on a brand line (UPSTREAM.md §2); the
// brand is written into the build's own copy, in CI or in a Docker stage.
//
//   node brand.mjs --check          says what it would change, writes nothing
//   node brand.mjs --yes            the desktop app: strings, names, icons, link to the instance
//   node brand.mjs --yes --only core   the instance image: what the agent says of itself
//   node brand.mjs --yes --only mobile the mobile app: name, icons, accent, French
//   node brand.mjs --yes --only harbor the Spaces server image: its pages, in the visitor's language
//
// Every exact edit must find its anchor exactly once: when the upstream
// changes one, the build fails here instead of shipping half a brand. The
// brand test (test/brand.test.ts) runs --check on every pull request.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../../../../..');
const PKG = path.resolve(here, '..');

export const BRAND = {
  name: 'Baarali',
  apiUrl: 'https://app.baarali.com',
  site: 'https://baarali.com/',
  repo: 'benewende-dev/warell',
  contact: 'contact@baarali.com',
  bundleId: 'com.baarali.app',
  description: "L'assistant qui agit pour vous",
  publisher: 'OpenBaara',
};

// "Rowboat" alone, as the product's name. Not "Rowboat Labs" (the company,
// in tests and comments), nor the credit line below, nor identifiers like
// RowboatServer (\b stops at the next letter). Internal ids keep their
// lowercase `rowboat` (UPSTREAM.md §2 « Ce qu'on ne renomme jamais »).
const PRODUCT_NAME = /\bRowboat\b(?! Labs)(?! \(Apache)/g;

/** Where the upstream links its own company; ours instead. */
const LINKS = [
  ['https://github.com/rowboatlabs/rowboat', `https://github.com/${BRAND.repo}`],
  ['"rowboatlabs/rowboat"', `"${BRAND.repo}"`],
  ['https://www.rowboatlabs.com/terms-of-service', BRAND.site],
  ['https://www.rowboatlabs.com/privacy-policy', BRAND.site],
  ['https://www.rowboatlabs.com/', BRAND.site],
  ['contact@rowboatlabs.com', BRAND.contact],
  ['https://api.x.rowboatlabs.com', BRAND.apiUrl],
  ["homepage: 'https://rowboatlabs.com'", `homepage: '${BRAND.site}'`],
  ["maintainer: 'rowboatlabs'", `maintainer: '${BRAND.publisher}'`],
  ["'AI coworker with memory'", JSON.stringify(BRAND.description)],
];

// The handle a person types to call the assistant (decided 02/10/2026):
// `@baarali`, everywhere it is written, shown or recognised. Not a package
// (`@rowboat/spaces-protocol`) nor the protocol's anchor (`#rowboat`), which
// never says `@`. Same length as `@rowboat`, for code that counts it.
const HANDLE = /@rowboat(?![\w/-])/g;

/** The visible text of one source file, branded. */
export function brandText(text) {
  let out = text.replace(HANDLE, '@baarali');
  for (const [from, to] of LINKS) out = out.split(from).join(to);
  // Apache-2.0 §4: say where it comes from; the company is not ours to name as the maker.
  out = out.split('Made by Rowboat Labs · Apache 2.0').join(`Made by ${BRAND.publisher} · Built on Rowboat (Apache 2.0)`);
  return out.replace(PRODUCT_NAME, BRAND.name);
}

const SOURCE_EXT = /\.(ts|tsx|html)$/;
const isTest = (file) => /\.test\.|\/__tests__\/|\/test\//.test(file);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist') walk(full, out);
    } else if (SOURCE_EXT.test(entry.name) && !isTest(full)) out.push(full);
  }
  return out;
}

/** The source trees whose strings are branded. */
export function sourceTrees(only) {
  if (only === 'mobile') return ['apps/x/apps/mobile/src'];
  const core = ['apps/x/packages/core/src'];
  if (only === 'core') return core;
  // forge.config.cjs: the installers' names and the macOS permission prompts.
  return [...core, 'apps/x/apps/main/src', 'apps/x/apps/main/forge.config.cjs', 'apps/x/apps/renderer/src', 'apps/x/apps/renderer/index.html'];
}

/** One exact replacement, which must match exactly once. */
function edit(file, from, to) {
  return { file, from, to };
}

// Without an Apple certificate, macOS reports a downloaded app whose
// signature broke at packaging as damaged, with no way past it; signed ad
// hoc, it is only unverified, and the person can allow it in the settings.
const ADHOC_SIGN = `        // Baarali (brand.mjs): ad hoc signature when there is no certificate.
        postPackage: async (_config, result) => {
            if (result.platform !== 'darwin' || !SKIP_CODE_SIGNING) return;
            const { execFileSync } = require('child_process');
            for (const dir of result.outputPaths) {
                for (const name of require('fs').readdirSync(dir).filter((n) => n.endsWith('.app'))) {
                    execFileSync('codesign', ['--force', '--deep', '--sign', '-', path.join(dir, name)], { stdio: 'inherit' });
                }
            }
        },
`;

// The main process in French (src/i18n/main.ts), installed before any menu is built.
const I18N_MAIN_GLUE = `// Generated by apps/baarali/packages/desktop/scripts/brand.mjs: not in the repository.
import { app, Menu, dialog, Notification } from 'electron';
import { installMainTranslation } from './baarali-i18n/main.js';

installMainTranslation({ app, Menu, dialog, Notification } as unknown as Parameters<typeof installMainTranslation>[0]);
`;

// The cloud link (src/cloud-link.ts) and the few lines that start it.
const CLOUD_GLUE = `// Generated by apps/baarali/packages/desktop/scripts/brand.mjs: not in the repository.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { app, dialog } from 'electron';
import { WorkDir } from '@x/core/dist/config/config.js';
import { API_URL } from '@x/core/dist/config/env.js';
import { connectRemoteServer, serverHostMode } from './server-host.js';
import { broadcastReload } from './ipc.js';
import { startCloudLink, type LinkProblem } from './baarali-cloud-link.js';

const MESSAGES: Record<'fr' | 'en', Record<LinkProblem, string>> = {
  fr: {
    instances_full: "L'accès anticipé est complet pour le moment. Vous êtes connecté : votre espace sera ouvert dès qu'une place se libère.",
    unavailable: "Votre espace Baarali ne répond pas pour le moment. Réessayez dans quelques minutes : déconnectez-vous puis reconnectez-vous.",
  },
  en: {
    instances_full: 'Early access is full for now. You are signed in: your space opens as soon as a seat frees up.',
    unavailable: 'Your Baarali space is not answering right now. Try again in a few minutes: sign out, then sign in again.',
  },
};

export function startBaaraliCloud(): void {
  const oauthFile = path.join(WorkDir, 'config', 'oauth.json');
  startCloudLink({
    apiUrl: API_URL,
    oauthFile,
    mode: serverHostMode,
    connect: connectRemoteServer,
    reload: () => setTimeout(() => broadcastReload(), 400),
    notify: (problem) => {
      const lang = app.getLocale().startsWith('fr') ? 'fr' : 'en';
      void dialog.showMessageBox({ type: 'info', message: 'Baarali', detail: MESSAGES[lang][problem] });
    },
    deviceName: () => os.hostname().replace(/\\.local$/, ''),
    readFile: (file) => fsp.readFile(file, 'utf8'),
    watch: (file, onChange) => {
      // Polling: the upstream rewrites the file whole, which fs.watch loses on some systems.
      fs.watchFile(file, { interval: 1000 }, onChange);
      return () => fs.unwatchFile(file, onChange);
    },
    fetch: globalThis.fetch,
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (message) => console.log(message),
  });
}
`;

// What the agent says and seeds, in the core: the desktop app and the
// instance image both run it (decided 02/10/2026).
const LANGUAGE = `# Language
Reply in the language the user writes in, and keep to it until they switch. Write it the way a fluent native speaker would: simple, natural and warm, never a word-for-word translation. Keep names, code, file paths and quoted text as they are. Everything you write for the user follows this rule: notes, to-do items, summaries, titles, drafts; an email reply follows the language of the email it answers. With no message to go by (a background or scheduled task), use the language of the user's recent notes and messages, or French when unclear.

`;

const TODO_SEED_FR = [
  'const SEED = `- [ ] Ajoutez votre première tâche — tapez-la simplement ci-dessous',
  '- [ ] @baarali présente-toi — que peux-tu faire pour moi ?',
  '- [ ] Écartez ce dont vous ne voulez pas — survolez une ligne et touchez ✕ (elle passe dans « Fait et écarté » plus bas, restaurable)',
  '`;',
].join('\n');

export function corePlan() {
  const core = 'apps/x/packages/core/src';
  return {
    edits: [
      edit(`${core}/runtime/assembly/compose-instructions.ts`, 'const USER_CONTEXT_SYSTEM_INSTRUCTIONS = `# Hidden User Context', `const USER_CONTEXT_SYSTEM_INSTRUCTIONS = \`${LANGUAGE.replace(/`/g, '\\`')}# Hidden User Context`),
      // The first to-do list a person sees, written into their todo.md once.
      edit(
        `${core}/todo/fileops.ts`,
        "const SEED = `- [ ] Add your first to-do — just type below\n- [ ] @rowboat introduce yourself — what can you do here?\n- [ ] Dismiss anything you don't want — hover a row and hit ✕ (it lands in Done & dismissed below, restorable)\n`;",
        TODO_SEED_FR,
      ),
      // The planner's name; its doctrine stays the upstream's, which upgrades it.
      edit(`${core}/todo/planner-task.ts`, "const PLANNER_NAME = 'Morning planner';", "const PLANNER_NAME = 'Planificateur du matin';"),
      edit(
        `${core}/todo/planner-task.ts`,
        "items.find(t => t.name.toLowerCase().includes('planner') || t.slug.includes('planner'))",
        "items.find(t => /planner|planificateur/.test(t.name.toLowerCase()) || /planner|planificateur/.test(t.slug))",
      ),
    ],
  };
}

export function desktopPlan() {
  const main = 'apps/x/apps/main';
  const renderer = 'apps/x/apps/renderer/src';
  return {
    edits: [
      edit(`${main}/forge.config.cjs`, "appBundleId: 'com.rowboat.app',", `appBundleId: '${BRAND.bundleId}',`),
      edit(`${main}/forge.config.cjs`, "authors: 'rowboatlabs',", `authors: '${BRAND.publisher}',`),
      edit(
        `${main}/forge.config.cjs`,
        "iconUrl: 'https://raw.githubusercontent.com/rowboatlabs/rowboat/main/apps/x/apps/main/icons/icon.ico',",
        `iconUrl: 'https://raw.githubusercontent.com/${BRAND.repo}/main/apps/baarali/packages/desktop/assets/icon.ico',`,
      ),
      edit(`${main}/forge.config.cjs`, "owner: 'rowboatlabs',\n                    name: 'rowboat'", `owner: '${BRAND.repo.split('/')[0]}',\n                    name: '${BRAND.repo.split('/')[1]}'`),
      edit(`${main}/forge.config.cjs`, '    hooks: {\n', `    hooks: {\n${ADHOC_SIGN}`),
      edit(
        `${main}/src/main.ts`,
        "import { initUpdater } from \"./updater.js\";",
        "import { initUpdater } from \"./updater.js\";\nimport { startBaaraliCloud } from \"./baarali-cloud.js\";",
      ),
      edit(
        `${main}/src/main.ts`,
        "  startServerHost().catch((error) => {\n    console.error('[server-host] failed to start rowboat-server:', error);\n  });",
        "  startServerHost().catch((error) => {\n    console.error('[server-host] failed to start rowboat-server:', error);\n  });\n  startBaaraliCloud();",
      ),
      // The brand's colours, loaded after App.css (src/baarali-theme.css).
      edit('apps/x/apps/renderer/src/main.tsx', "import App from './App.tsx'\n", "import App from './App.tsx'\nimport './baarali-theme.css'\n"),
      // French (src/i18n/), first of all so dates are French from the start.
      edit('apps/x/apps/renderer/src/main.tsx', "import { StrictMode } from 'react'\n", "import './baarali-i18n/index.ts'\nimport { StrictMode } from 'react'\n"),
      edit(`${main}/src/main.ts`, 'import "./node-guard.js";\n', 'import "./node-guard.js";\nimport "./baarali-i18n-glue.js";\n'),
      // The handle where the UI writes it without its @ (see HANDLE).
      edit(`${renderer}/components/markdown-editor.tsx`, "if (query === 'rowboat') {", "if (query === 'baarali' || query === 'rowboat') {"),
      edit(
        `${renderer}/components/spaces/mention-autocomplete.tsx`,
        "if ('rowboat'.startsWith(q)) people.push({ id: 'rowboat', label: 'rowboat',",
        "if ('baarali'.startsWith(q)) people.push({ id: 'rowboat', label: 'baarali',",
      ),
      edit(`${renderer}/components/spaces/composer.tsx`, "attrs: { kind: 'rowboat', id: null, label: 'rowboat' }", "attrs: { kind: 'rowboat', id: null, label: 'baarali' }"),
      edit(`${renderer}/components/spaces/composer-editor.ts`, "getAttrs: () => ({ kind: 'rowboat', id: null, label: 'rowboat' })", "getAttrs: () => ({ kind: 'rowboat', id: null, label: 'baarali' })"),
    ],
    copies: [
      ['assets/icon.icns', `${main}/icons/icon.icns`],
      ['assets/icon.ico', `${main}/icons/icon.ico`],
      ['assets/icon.png', `${main}/icons/icon.png`],
      ['assets/install-loading.gif', `${main}/icons/install-loading.gif`],
      ['assets/logo-only.png', 'apps/x/apps/renderer/public/logo-only.png'],
      ['src/cloud-link.ts', `${main}/src/baarali-cloud-link.ts`],
      ['src/baarali-theme.css', 'apps/x/apps/renderer/src/baarali-theme.css'],
      ...['index.ts', 'translate.ts', 'fr.ts'].map((f) => [`src/i18n/${f}`, `apps/x/apps/renderer/src/baarali-i18n/${f}`]),
      ...['main.ts', 'translate.ts', 'fr.ts'].map((f) => [`src/i18n/${f}`, `${main}/src/baarali-i18n/${f}`]),
    ],
    writes: [
      [`${main}/src/baarali-cloud.ts`, CLOUD_GLUE],
      [`${main}/src/baarali-i18n-glue.ts`, I18N_MAIN_GLUE],
    ],
    packageJson: {
      file: `${main}/package.json`,
      set: { productName: BRAND.name, description: BRAND.description },
    },
  };
}

// The mobile app (decided 02/10/2026): name, icons, the blue accent, its
// screens in the person's language (src/i18n/mobile/), and none of the
// upstream's Expo account, App Store keys or project id.
const MOBILE_BABEL = `// Generated by apps/baarali/packages/desktop/scripts/brand.mjs: not in the repository.
const path = require('path');
const { createRequire } = require('module');
const fromExpo = createRequire(require.resolve('expo/package.json'));

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [fromExpo.resolve('babel-preset-expo')],
    plugins: [[require.resolve('./baarali-i18n/babel-plugin.cjs'), { runtime: path.join(__dirname, 'src/baarali-i18n/mobile/runtime.ts') }]],
  };
};
`;

const MOBILE_PERMISSIONS = {
  en: {
    NSCameraUsageDescription: 'The camera is used to scan the pairing code shown in Baarali on your Mac, and for video calls with your agents.',
    NSMicrophoneUsageDescription: 'The microphone is used to talk to your Baarali agents with voice.',
    NSLocalNetworkUsageDescription: 'Baarali connects to the Baarali app on your Mac over your local network.',
  },
  fr: {
    CFBundleDisplayName: 'Baarali',
    NSCameraUsageDescription: 'L’appareil photo sert à scanner le code d’association affiché par Baarali sur votre Mac, et aux appels vidéo avec vos agents.',
    NSMicrophoneUsageDescription: 'Le micro sert à parler à vos agents Baarali à la voix.',
    NSLocalNetworkUsageDescription: 'Baarali se connecte à l’app Baarali de votre Mac sur votre réseau local.',
  },
};

/** The phone app's identifier, on both stores. */
const MOBILE_ID = `${BRAND.bundleId}.mobile`;

export function mobilePlan() {
  const mobile = 'apps/x/apps/mobile';
  return {
    edits: [
      // The accent: the brand's blue on the system's neutrals, as on the desktop.
      edit(`${mobile}/src/theme/colors.ts`, "  accent: '#000000',\n  onAccent: '#ffffff',", "  accent: '#1a6dff',\n  onAccent: '#ffffff',"),
      edit(`${mobile}/src/theme/colors.ts`, "  accent: '#ffffff',\n  onAccent: '#000000',", "  accent: '#4d8dff',\n  onAccent: '#ffffff',"),
      // The upstream's sailboat, its logo, becomes ours (tinted like a symbol).
      edit(`${mobile}/src/app/onboarding.tsx`, "    icon: 'sf:sailboat',", "    icon: require('../../assets/images/baarali-mark.png'),"),
      edit(`${mobile}/src/app/spaces/index.tsx`, '<Image source="sf:sailboat"', "<Image source={require('../../../assets/images/baarali-mark.png')}"),
      // Never the upstream's Spaces fleet (decided 02/10/2026): Baarali has no
      // Spaces server of its own yet (control /v1/config: spacesApexUrl null),
      // so the app opens on « Connect your Mac » and Spaces says it is coming.
      edit(`${mobile}/src/lib/spaces/account.tsx`, "process.env.EXPO_PUBLIC_SPACES_APEX ?? 'https://spaces.x.rowboatlabs.com';", "process.env.EXPO_PUBLIC_SPACES_APEX ?? '';"),
      edit(
        `${mobile}/src/lib/spaces/account.tsx`,
        '    const issuer = await discoverIssuer(APEX_URL);',
        "    if (!APEX_URL) throw new Error('Team spaces are coming to Baarali soon.');\n    const issuer = await discoverIssuer(APEX_URL);",
      ),
      edit(`${mobile}/src/app/index.tsx`, "import { ONBOARDED_KEY } from './onboarding';", "import { ONBOARDED_KEY } from './onboarding';\nimport { APEX_URL } from '@/lib/spaces/account';"),
      edit(`${mobile}/src/app/index.tsx`, "<Redirect href={onboarded ? '/spaces' : '/onboarding'} />", "<Redirect href={onboarded ? (APEX_URL ? '/spaces' : '/pairing') : '/onboarding'} />"),
      edit(`${mobile}/src/app/onboarding.tsx`, "import { useColors } from '@/theme/colors';", "import { useColors } from '@/theme/colors';\nimport { APEX_URL } from '@/lib/spaces/account';"),
      edit(`${mobile}/src/app/onboarding.tsx`, "    router.replace('/spaces');", "    router.replace(APEX_URL ? '/spaces' : '/pairing');"),
      // Our sign-in server takes a phone app's redirect only in the form of
      // RFC 8252 §7.1, its reverse-domain scheme (control src/auth.ts).
      edit(`${mobile}/src/lib/spaces/oauth.ts`, "export const REDIRECT_URI = 'rowboat://oauth-callback';", `export const REDIRECT_URI = '${MOBILE_ID}:/oauth-callback';`),
    ],
    copies: [
      ...['icon.png', 'splash-icon.png', 'android-icon-foreground.png', 'android-icon-monochrome.png', 'baarali-mark.png'].map((f) => [`assets/mobile/${f}`, `${mobile}/assets/images/${f}`]),
      ['src/i18n/mobile/babel-plugin.cjs', `${mobile}/baarali-i18n/babel-plugin.cjs`],
    ],
    writes: [
      // Metro resolves './fr' but not './fr.js' to fr.ts: the imports lose their extension.
      ...[['mobile/runtime.ts', 'mobile/runtime.ts'], ['translate.ts', 'translate.ts'], ['fr.ts', 'fr.ts']].map(([from, to]) => [
        `${mobile}/src/baarali-i18n/${to}`,
        fs.readFileSync(path.join(PKG, 'src/i18n', from), 'utf8').replace(/(from '\.{1,2}\/[\w./-]+)\.js'/g, "$1'"),
      ]),
      [`${mobile}/babel.config.js`, MOBILE_BABEL],
      [`${mobile}/baarali-locales/fr.json`, JSON.stringify(MOBILE_PERMISSIONS.fr, null, 2) + '\n'],
      [`${mobile}/eas.json`, JSON.stringify({ cli: { version: '>= 16.0.0', appVersionSource: 'remote' }, build: { development: { developmentClient: true, distribution: 'internal', ios: { simulator: true } }, preview: { distribution: 'internal' }, production: { autoIncrement: true } } }, null, 2) + '\n'],
    ],
    json: {
      file: `${mobile}/app.json`,
      update(doc) {
        const expo = { ...doc.expo, name: BRAND.name, slug: 'baarali' };
        delete expo.owner;
        expo.extra = { ...expo.extra };
        delete expo.extra.eas;
        // `baarali://` for links, the bundle id for the sign-in's way back (oauth.ts).
        expo.scheme = ['baarali', MOBILE_ID];
        expo.ios = { ...expo.ios, bundleIdentifier: MOBILE_ID, infoPlist: { ...expo.ios.infoPlist, ...MOBILE_PERMISSIONS.en } };
        expo.locales = { fr: './baarali-locales/fr.json' };
        const android = { ...expo.android, package: MOBILE_ID, adaptiveIcon: { ...expo.android.adaptiveIcon, backgroundColor: '#1A6DFF' } };
        delete android.adaptiveIcon.backgroundImage;
        expo.android = android;
        expo.plugins = expo.plugins.map((p) => (Array.isArray(p) && p[0] === 'expo-splash-screen' ? ['expo-splash-screen', { ...p[1], backgroundColor: '#0A0A0A', imageWidth: 140 }] : p));
        return { ...doc, expo };
      },
    },
  };
}

/**
 * Harbor, the Spaces server we host (decided 02/10/2026). Its few pages and
 * a new team's first file come from packages/spaces/src/pages.ts, in the
 * visitor's language; the deep links keep `rowboat://`, the desktop app's
 * own scheme (UPSTREAM.md §2, internal ids are never renamed).
 */
export function harborPlan() {
  const server = 'apps/harbor/packages/server/src';
  return {
    edits: [
      edit(
        `${server}/http.ts`,
        "import { HarborError } from './errors.js';",
        "import { HarborError } from './errors.js';\nimport { invitePage as baaraliInvitePage, landingPage as baaraliLandingPage, withLanguage } from './baarali-pages.js';",
      ),
      edit(
        `${server}/http.ts`,
        '  const app = new Hono<Env>();',
        "  const app = new Hono<Env>();\n  app.use('*', (c, next) => withLanguage(c.req.header('accept-language'), next));",
      ),
      edit(
        `${server}/http.ts`,
        '    return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Open in Rowboat</title>` +\n' +
          '      `<style>body{font:15px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;color:#222;background:#fafafa}` +\n' +
          '      `main{text-align:center;padding:2rem}a.b{display:inline-block;margin-top:1rem;padding:.6rem 1.1rem;border-radius:8px;background:#111;color:#fff;text-decoration:none}</style>` +\n' +
          '      `<main><p>This link opens in Rowboat.</p><a class="b" href="${deep}">Open in Rowboat</a></main>` +\n' +
          '      `<script>location.replace(${JSON.stringify(deep)})</script>`;',
        '    return baaraliLandingPage(deep);',
      ),
      edit(`${server}/http.ts`, 'c.html(invitePage({ state: resolved.state }), 410)', 'c.html(baaraliInvitePage({ state: resolved.state }), 410)'),
      edit(`${server}/http.ts`, "c.html(invitePage({ state: 'ok',", "c.html(baaraliInvitePage({ state: 'ok',"),
      edit(
        `${server}/apex.ts`,
        "import { HarborError } from './errors.js';",
        "import { HarborError } from './errors.js';\nimport { welcomeReadme as baaraliWelcome, withLanguage } from './baarali-pages.js';",
      ),
      edit(`${server}/apex.ts`, '  const app = new Hono();', "  const app = new Hono();\n  app.use('*', (c, next) => withLanguage(c.req.header('accept-language'), next));"),
      edit(`${server}/apex.ts`, 'newContent: welcomeReadme(org.name),', 'newContent: baaraliWelcome(org.name),'),
    ],
    writes: [[`${server}/baarali-pages.ts`, fs.readFileSync(path.join(PKG, '../spaces/src/pages.ts'), 'utf8')]],
  };
}

/**
 * Computes every change; throws on a missing anchor. Writes only with `write`.
 * @param {{ root?: string, only?: string, write?: boolean }} options
 * @returns {string[]}
 */
export function apply({ root = ROOT, only, write = false }) {
  const changes = [];
  // A Windows checkout ends lines with CRLF (git's autocrlf): the anchors
  // are written with LF, so the build copy is read, and written, in LF.
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
  const pending = new Map();
  const current = (rel) => (pending.has(rel) ? pending.get(rel) : read(rel));

  if (only === 'harbor') {
    const plan = harborPlan();
    for (const e of plan.edits) {
      const text = current(e.file);
      const count = text.split(e.from).length - 1;
      if (count !== 1) throw new Error(`brand: ${e.file}: expected the anchor once, found it ${count} times:\n${e.from}`);
      pending.set(e.file, text.replace(e.from, () => e.to));
    }
    for (const [to, text] of plan.writes) {
      changes.push(`write ${to}`);
      if (write) fs.writeFileSync(path.join(root, to), text);
    }
    for (const [rel, text] of pending) {
      changes.push(`edit ${rel}`);
      if (write) fs.writeFileSync(path.join(root, rel), text);
    }
    return changes;
  }

  if (only === 'mobile') {
    const plan = mobilePlan();
    for (const e of plan.edits) {
      const text = current(e.file);
      const count = text.split(e.from).length - 1;
      if (count !== 1) throw new Error(`brand: ${e.file}: expected the anchor once, found it ${count} times:\n${e.from}`);
      pending.set(e.file, text.replace(e.from, () => e.to));
    }
    pending.set(plan.json.file, JSON.stringify(plan.json.update(JSON.parse(current(plan.json.file))), null, 2) + '\n');
    for (const [from, to] of plan.copies) {
      if (!fs.existsSync(path.join(PKG, from))) throw new Error(`brand: missing ${from}`);
      changes.push(`copy ${from} → ${to}`);
      if (write) {
        fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true });
        fs.copyFileSync(path.join(PKG, from), path.join(root, to));
      }
    }
    for (const [to, text] of plan.writes) {
      changes.push(`write ${to}`);
      if (write) {
        fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true });
        fs.writeFileSync(path.join(root, to), text);
      }
    }
  }

  for (const e of only === 'mobile' ? [] : corePlan().edits) {
    const text = current(e.file);
    const count = text.split(e.from).length - 1;
    if (count !== 1) throw new Error(`brand: ${e.file}: expected the anchor once, found it ${count} times:\n${e.from}`);
    pending.set(e.file, text.replace(e.from, () => e.to));
  }

  if (only !== 'core' && only !== 'mobile') {
    const plan = desktopPlan();
    for (const e of plan.edits) {
      const text = current(e.file);
      const count = text.split(e.from).length - 1;
      if (count !== 1) throw new Error(`brand: ${e.file}: expected the anchor once, found it ${count} times:\n${e.from}`);
      pending.set(e.file, text.replace(e.from, () => e.to));
    }
    const pj = JSON.parse(current(plan.packageJson.file));
    pending.set(plan.packageJson.file, JSON.stringify({ ...pj, ...plan.packageJson.set }, null, 4) + '\n');
    for (const [from, to] of plan.copies) {
      if (!fs.existsSync(path.join(PKG, from))) throw new Error(`brand: missing ${from}`);
      changes.push(`copy ${from} → ${to}`);
      if (write) {
        fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true });
        fs.copyFileSync(path.join(PKG, from), path.join(root, to));
      }
    }
    for (const [to, text] of plan.writes) {
      changes.push(`write ${to}`);
      if (write) fs.writeFileSync(path.join(root, to), text);
    }
  }

  for (const tree of sourceTrees(only)) {
    const abs = path.join(root, tree);
    const files = fs.statSync(abs).isDirectory() ? walk(abs) : [abs];
    for (const file of files) {
      const rel = path.relative(root, file);
      const text = current(rel);
      const branded = brandText(text);
      if (branded !== text) pending.set(rel, branded);
    }
  }

  for (const [rel, text] of pending) {
    if (text === read(rel)) continue;
    changes.push(`edit ${rel}`);
    if (write) fs.writeFileSync(path.join(root, rel), text);
  }
  return changes;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;
  const check = args.includes('--check');
  // It rewrites tracked files: never by accident in a working copy.
  if (!check && !args.includes('--yes')) {
    console.error('brand.mjs rewrites tracked files. Run it in CI or a build stage with --yes, or use --check.');
    process.exit(2);
  }
  const changes = apply({ only, write: !check });
  console.log(`${check ? 'would apply' : 'applied'} ${changes.length} change(s)`);
}
