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
  repo: 'benewende-dev/baarali',
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
import { dialog } from 'electron';
import { WorkDir } from '@x/core/dist/config/config.js';
import { API_URL } from '@x/core/dist/config/env.js';
import { connectRemoteServer, disconnectRemoteServer, serverHostMode } from './server-host.js';
import { broadcastReload } from './ipc.js';
import { startCloudLink, type LinkProblem } from './baarali-cloud-link.js';
import { startAppsRelay } from './baarali-apps-relay.js';

// In English, like every dialog of the app: the main process's French layer
// (src/i18n/main.ts, FR_MAIN) translates them, and the release check reads them.
const MESSAGES: Record<LinkProblem, string> = {
  instances_full: 'Early access is full for now. You are signed in: your space opens as soon as a seat frees up.',
  unavailable: 'Your Baarali space is not answering right now. Try again in a few minutes: sign out, then sign in again.',
};

// The instance the app is joined to, as server-host.ts saved it (config/client.json).
function savedRemote(): { url: string; key: string } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(WorkDir, 'config', 'client.json'), 'utf8'));
    const r = raw.remoteServer;
    return r && r.url && r.token ? { url: r.url, key: r.token } : null;
  } catch {
    return null;
  }
}

// The apps of the account open on this computer through the gateway
// (src/apps-relay.ts), from the moment the app is joined to its instance.
let appsRelay: { close: () => void } | null = null;
function ensureAppsRelay(): void {
  if (appsRelay || serverHostMode() !== 'remote') return;
  appsRelay = startAppsRelay({
    target: () => (serverHostMode() === 'remote' ? savedRemote() : null),
    log: (message) => console.log(message),
  });
}

export function startBaaraliCloud(): void {
  const oauthFile = path.join(WorkDir, 'config', 'oauth.json');
  ensureAppsRelay();
  startCloudLink({
    apiUrl: API_URL,
    oauthFile,
    linkFile: path.join(WorkDir, 'config', 'baarali-link.json'),
    mode: serverHostMode,
    connect: async (url, key) => {
      const result = await connectRemoteServer(url, key);
      if (result.success) ensureAppsRelay();
      return result;
    },
    disconnect: disconnectRemoteServer,
    reload: () => setTimeout(() => broadcastReload(), 400),
    notify: (problem) => {
      void dialog.showMessageBox({ type: 'info', message: 'Baarali', detail: MESSAGES[problem] });
    },
    deviceName: () => os.hostname().replace(/\\.local$/, ''),
    readFile: (file) => fsp.readFile(file, 'utf8'),
    writeFile: (file, data) => fsp.writeFile(file, data, { mode: 0o600 }),
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

// The morning planner's doctrine in French (03/10/2026): the upstream's
// rules, kept one for one, worded for a small business here (a quote, an
// invoice, the bank). The English text joins the prior seeds, so a planner
// nobody edited is brought to it at the next start.
const PLANNER_FR = "// Baarali: the doctrine in French (scripts/brand.mjs).\nconst PLANNER_INSTRUCTIONS = `Chaque matin, propose QUELQUES choses à faire vraiment utiles pour la journée de l’utilisateur, ou aucune. Tu es en mode ACTION : ton seul effet est l’outil todo-propose ; note dans le journal une ligne sur ce que tu as proposé (ou que rien n’était nécessaire). Écris dans la langue de l’utilisateur (le français si tu as un doute), avec des mots simples.\n\nÉtapes, dans l’ordre :\n\n1. Lis ${PREFS_REL_PATH}. « Vos règles » passent avant « Appris » ; les deux passent avant les règles ci-dessous.\n2. Lis ${FEEDBACK_REL_PATH} : les résultats récents montrent ce que l’utilisateur aime. Les lignes « dismissed » ou « taught » n’étaient pas voulues (ne propose jamais rien de semblable) ; les lignes « ran » ou « kept » ont plu (propose-en d’autres du même genre).\n3. Lis todo.md et le fichier du mois dans todo/archive. Ne propose jamais le doublon d’une ligne existante ou archivée récemment. Si une ligne couvre déjà un sujet, ne fais rien à son propos.\n4. Cherche des idées UNIQUEMENT dans ces sources, par ordre d’importance, sur les 3 derniers jours de données synchronisées (gmail_sync/, calendar_sync/, granola_sync/, fireflies_sync/ : lis des fichiers récents précis, garde tes recherches grep étroites) :\n   1) Les engagements pris par l’utilisateur (« je vous envoie le devis vendredi » dans un e-mail envoyé ou une transcription de réunion) : c’est la meilleure source.\n   2) Les actions confiées à l’utilisateur dans les notes de réunion récentes (granola_sync/, fireflies_sync/ : transcriptions et listes d’actions).\n   3) Les échéances précises qui approchent : un paiement, un dossier à déposer, une livraison, un rendez-vous administratif.\n   4) Les e-mails importants restés sans réponse de l’utilisateur depuis 2 jours ou plus : un client, un fournisseur, un partenaire, la banque, l’administration.\n   5) Ce que l’utilisateur attend des autres et qui ne bouge plus depuis 3 jours ou plus : propose une relance (un devis pas encore signé, une facture pas encore payée, une réponse promise).\n   6) La préparation qu’une réunion importante d’aujourd’hui ou de demain demande vraiment (dans calendar_sync/ : un ordre du jour à écrire, des participants à connaître, un document à relire). Seulement quand la réunion le justifie ; ne propose jamais simplement d’y assister.\n5. LE FILTRE DES E-MAILS : chaque fichier gmail_sync/*.md porte une ligne \\`importance:\\` dans son en-tête, posée par le classement de l’app (qui apprend des corrections de l’utilisateur). Seuls les fils marqués \\`importance: important\\` peuvent donner des idées : trouve-les avec une recherche grep étroite sur \"importance: important\". Les fils marqués \\`importance: other\\` et les fichiers sans marque sont des lettres d’information, des notifications ou du bruit : ne les lis jamais pour chercher des idées, même si l’objet a l’air urgent.\n6. LE FILTRE DU DÉJÀ FAIT : un fichier de fil liste ses messages du plus ancien au plus récent, en blocs « ### From: ». Avant de proposer quoi que ce soit à partir d’un e-mail, regarde le DERNIER bloc. Si le message le plus récent vient de l’utilisateur, il a déjà répondu : ne propose jamais de répondre, de relancer ni de suivre ce fil. Le même test vaut partout : un engagement que des e-mails ou des notes plus récents montrent tenu, ou une action de réunion déjà faite, c’est terminé.\n7. Ne propose JAMAIS : la réponse à un e-mail courant (la page E-mail prépare déjà ces brouillons), d’assister à une réunion (le calendrier les montre ; la préparer peut se justifier, voir 4.6), ce qu’une routine fait déjà, une lettre d’information ou une notification automatique, ni une information sans action derrière.\n8. Limite : 3 propositions au plus. Une ou deux excellentes valent mieux que trois moyennes. ZÉRO est un bon résultat : si rien ne passe la barre, termine sobrement par « rien de nécessaire aujourd’hui ». La question à poser pour chaque idée : est-ce que l’ajouter à la liste change ce que l’utilisateur fait aujourd’hui ?\n9. Écris chaque ligne comme l’utilisateur l’écrirait : courte, concrète, qui commence par un verbe, avec le nom de la personne et l’échéance quand il y en a une (« Relancer M. Ouédraogo pour le devis promis jeudi »). Ajoute @baarali dans le texte SEULEMENT pour proposer un travail de préparation que tu peux faire toi-même (chercher, faire un plan, rassembler, résumer ; jamais rien qui part vers l’extérieur) ; il attend de toute façon l’accord de l’utilisateur.\n10. Envoie tes propositions avec todo-propose, ton seul stylo. Elles arrivent dans un bac de suggestions sur la page Tâches, où l’utilisateur accepte ou refuse chacune ; rien ne touche la liste et rien ne se lance sans son accord. N’utilise jamais todo-add, ne modifie jamais todo.md directement, ne lance jamais d’exécution.`;\n\n";

// The Chat codes by itself (03/10/2026): no subscription to an outside coding
// agent is needed. Its instructions when none is connected, and « connected »
// now means an engine is really installed, not only a switch turned on.
const CODE_SELF_FROM = "    : `**Code with Agents (disabled):** Code mode is currently OFF in the user's settings. Do NOT load \\`code-with-agents\\` and do NOT call acpx. Handle coding requests yourself with your normal tools if you can. After answering, add a final line letting the user know they can delegate coding to Claude Code or Codex by enabling Code Mode in Settings → Code Mode.`}";
const CODE_SELF_TO = "    : `**Coding (you do it yourself):** No coding agent is connected, and none is needed: you write the code yourself. Do NOT load \\`code-with-agents\\`, do NOT call acpx, and never tell the user to install, subscribe to or enable Claude Code, Codex or Code Mode. This machine is the account's own, isolated: you have the file tools (read, write, edit, glob, grep) and \\`executeCommand\\` with git, Node (node, npm, npx) and Python (python3, pip, venv); building and checking run without asking. Work like a careful developer:\n1. Unless the user names a folder, give each project its own folder under \\`projects/<short-name>/\\` in the workspace, and \\`git init\\` it.\n2. Say the plan in two or three short lines, then build it file by file. Prefer few, well-known dependencies.\n3. Run it, or its tests, with \\`executeCommand\\`, read the errors and fix them before you answer; do not hand over code you have not run. Commit each working step with a short message.\n4. When the user wants something to see and use (a tool, a dashboard, a calculator, a small site), build it as an app with the \\`apps\\` skill instead: an app opens right inside Baarali.\n5. Answer with what you built, where it is, and how to use it, in the user's words, without jargon. Ask before anything that leaves this machine (publishing, sending, paying) or deletes work.`}";

const TODO_SEED_FR = [
  'const SEED = `- [ ] Ajoutez votre première chose à faire : écrivez-la juste en dessous',
  '- [ ] @baarali présente-toi : que peux-tu faire pour moi ?',
  '- [ ] Retirez ce dont vous ne voulez pas : survolez la ligne et cliquez ✕ (elle va dans « Fait et écarté », plus bas, et peut revenir)',
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
      edit(`${core}/todo/planner-task.ts`, 'const PLANNER_INSTRUCTIONS = `Each morning,', 'const PLANNER_INSTRUCTIONS_EN = `Each morning,'),
      edit(`${core}/runtime/assembly/copilot/instructions.ts`, CODE_SELF_FROM, CODE_SELF_TO),
      edit(
        `${core}/runtime/assembly/connections.ts`,
        '        return (await repo.getConfig()).enabled;',
        "        if (!(await repo.getConfig()).enabled) return false;\n        // Baarali: on only with an engine really installed (brand.mjs).\n        const { isEngineProvisioned } = await import('../../code-mode/acp/engine-provisioner.js');\n        return isEngineProvisioned('claude') || isEngineProvisioned('codex');",
      ),
      edit(`${core}/todo/planner-task.ts`, 'const PLANNER_INSTRUCTIONS_PRIOR: string[] = [\n', `${PLANNER_FR}const PLANNER_INSTRUCTIONS_PRIOR: string[] = [\n    PLANNER_INSTRUCTIONS_EN,\n`),
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
      // Baarali's sign-in stays on the device, never the instance (src/cloud-link.ts staysOnDevice).
      edit(
        `${main}/src/ipc.ts`,
        "import { forwardRpc, shouldForwardChannel } from './rpc-forwarder.js';\n",
        "import { forwardRpc, shouldForwardChannel } from './rpc-forwarder.js';\nimport { staysOnDevice } from './baarali-cloud-link.js';\nimport { serverHostMode } from './server-host.js';\n",
      ),
      edit(
        `${main}/src/ipc.ts`,
        '      const result = forwarded ? await forwardRpc(channel, args) : await handler(event, args);',
        '      const result = forwarded && !staysOnDevice(channel, args, serverHostMode()) ? await forwardRpc(channel, args) : await handler(event, args);',
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
      // A line about people (« Awa joined »), translated with its names kept (i18n PEOPLE).
      edit(`${renderer}/components/spaces/membership-line.tsx`, '<span className="min-w-0 truncate">{membershipLineText(', '<span className="min-w-0 truncate" data-baarali-people>{membershipLineText('),
      edit(`${renderer}/components/spaces/composer.tsx`, "attrs: { kind: 'rowboat', id: null, label: 'rowboat' }", "attrs: { kind: 'rowboat', id: null, label: 'baarali' }"),
      // The assistant's mark is Baarali's B, eyes cut out so they take the
      // colour behind (the blue tile of « Discuter avec Baarali »).
      edit(`${renderer}/components/talking-head.tsx`, '      <g transform="translate(12 12) scale(0.0245) translate(-497 -489)" strokeWidth="61">\n        <path d="M 158 487 C 330 330, 620 180, 837 148 C 820 480, 640 720, 498 830 Q 550 720, 569 623 C 560 540, 450 440, 352 413 Q 250 440, 158 487 Z" />\n      </g>', '      <g transform="translate(12 12) scale(0.064) translate(-505 -422)" fill="currentColor" stroke="none">\n        <path fillRule="evenodd" d="M450 250H502C574 250 612 280 612 322C612 345 602 360 590 368Q584 373 590 378C612 388 626 408 626 436C626 476 590 502 512 502H450C413 502 384 473 384 436V316C384 279 413 250 450 250ZM478 330a22 22 0 1 0 44 0a22 22 0 1 0 -44 0ZM534 330a22 22 0 1 0 44 0a22 22 0 1 0 -44 0Z" />\n        <path d="M422 556a38 38 0 1 0 76 0a38 38 0 1 0 -76 0ZM514 556a38 38 0 1 0 76 0a38 38 0 1 0 -76 0Z" />\n      </g>'),
      // The handle on a to-do handed to the assistant.
      edit(`${renderer}/components/todo-view.tsx`, '<Bot className="size-3" />\n              rowboat\n', '<Bot className="size-3" />\n              baarali\n'),
      edit(`${renderer}/components/spaces/composer-editor.ts`, "getAttrs: () => ({ kind: 'rowboat', id: null, label: 'rowboat' })", "getAttrs: () => ({ kind: 'rowboat', id: null, label: 'baarali' })"),
    ],
    copies: [
      ['assets/icon.icns', `${main}/icons/icon.icns`],
      ['assets/icon.ico', `${main}/icons/icon.ico`],
      ['assets/icon.png', `${main}/icons/icon.png`],
      ['assets/install-loading.gif', `${main}/icons/install-loading.gif`],
      ['assets/logo-only.png', 'apps/x/apps/renderer/public/logo-only.png'],
      ['src/cloud-link.ts', `${main}/src/baarali-cloud-link.ts`],
      ['src/apps-relay.ts', `${main}/src/baarali-apps-relay.ts`],
      ['src/baarali-theme.css', 'apps/x/apps/renderer/src/baarali-theme.css'],
      // The site's fonts, read by baarali-theme.css (03/10/2026).
      ...['inter.woff2', 'source-serif-4.woff2'].map((f) => [`assets/fonts/${f}`, `apps/x/apps/renderer/src/baarali-fonts/${f}`]),
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

/** Our Spaces server (apps/baarali/packages/spaces). */
const SPACES_URL = 'https://spaces.baarali.com';

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
      // The mark as it is, the blue tile (02/10/2026): drawn in one tint, it
      // read black by day and white by night.
      edit(`${mobile}/src/app/onboarding.tsx`, "    icon: 'sf:sailboat',", "    icon: require('../../assets/images/baarali-tile.png'),"),
      edit(`${mobile}/src/app/onboarding.tsx`, '<Image source={slide.icon} style={{ width: 64, height: 64, marginBottom: 8 }} tintColor={colors.label} />', "<Image source={slide.icon} style={{ width: 64, height: 64, marginBottom: 8 }} tintColor={typeof slide.icon === 'string' ? colors.label : undefined} />"),
      edit(`${mobile}/src/app/spaces/index.tsx`, '<Image source="sf:sailboat" style={{ width: 48, height: 48 }} tintColor={colors.label} />', "<Image source={require('../../../assets/images/baarali-tile.png')} style={{ width: 48, height: 48 }} />"),
      // Never the upstream's Spaces fleet: ours (decided 02/10/2026,
      // packages/spaces). A build with EXPO_PUBLIC_SPACES_APEX empty opens on
      // « Connect your Mac » and Spaces says it is coming.
      edit(`${mobile}/src/lib/spaces/account.tsx`, "process.env.EXPO_PUBLIC_SPACES_APEX ?? 'https://spaces.x.rowboatlabs.com';", `process.env.EXPO_PUBLIC_SPACES_APEX ?? '${SPACES_URL}';`),
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
      // A sign-in of its own, not Safari's: after « Se déconnecter », the next
      // sign-in asks who you are instead of reopening the last account.
      edit(`${mobile}/src/lib/spaces/oauth.ts`, 'WebBrowser.openAuthSessionAsync(authorize.toString(), REDIRECT_URI);', 'WebBrowser.openAuthSessionAsync(authorize.toString(), REDIRECT_URI, { preferEphemeralSession: true });'),
    ],
    copies: [
      ...['icon.png', 'splash-icon.png', 'android-icon-foreground.png', 'android-icon-monochrome.png', 'baarali-mark.png', 'baarali-tile.png'].map((f) => [`assets/mobile/${f}`, `${mobile}/assets/images/${f}`]),
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
