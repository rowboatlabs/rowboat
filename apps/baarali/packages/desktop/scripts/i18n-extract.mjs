#!/usr/bin/env node
// The English strings the app shows, read from the upstream renderer's
// sources (decided 01/10/2026: the app is translated by a layer of our own,
// src/i18n/, never inside the upstream's files, which change about sixty
// times a week; docs/baarali/UPSTREAM.md §2). This lists what the layer can
// translate: text between JSX tags, the visible attributes, the labels of
// option lists, the messages of toasts and confirmations, the text helpers
// return (`5m ago`), and in the main process the menus, the tray and the
// dialogs. Text with a value in it is listed as a template (`$1 files`).
// Strings are branded first, as the build brands them (scripts/brand.mjs).
//
//   node scripts/i18n-extract.mjs            how many strings are translated
//   node scripts/i18n-extract.mjs --missing  and which are not yet
//   node scripts/i18n-extract.mjs --check    the same, failing when one is
//                                            missing (the release workflow)
//   node scripts/i18n-extract.mjs --json     every string, with its files

import fs from 'node:fs';
import path from 'node:path';
import { createRequire, registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ROOT, brandText } from './brand.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');

export const RENDERER = path.join(ROOT, 'apps/x/apps/renderer/src');
/** The main process: menus, tray, notifications, the system's dialogs. */
export const MAIN = path.join(ROOT, 'apps/x/apps/main/src');

/** Attributes a person reads or hears. */
const VISIBLE_ATTRS = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label', 'description', 'tooltip', 'emptyMessage', 'heading', 'subtitle', 'confirmText', 'cancelText']);
/** Keys of option objects whose value is shown ({ label: 'Settings' }). */
const VISIBLE_KEYS = new Set(['detail', 'body', 'label', 'title', 'description', 'placeholder', 'sub', 'subtitle', 'tooltip', 'hint', 'helper', 'heading', 'message', 'emptyMessage', 'cta', 'buttonLabel', 'confirmLabel', 'cancelLabel']);
/** Calls whose first argument is shown (toast('Saved'), confirm('Delete?')). */
const VISIBLE_CALLS = /^(toast(\.\w+)?|window\.confirm|confirm|alert|setError|setStatus|setMessage)$/;

/** A string worth translating: some letters, not a class list, a path or an id. */
export function isProse(s) {
  if (!/[A-Za-z]{2}/.test(s)) return false;
  if (/^[a-z0-9]+([-_:./][a-z0-9]+)+$/.test(s)) return false; // ids, paths, keys
  if (/^(https?:|mailto:|\/|#|\.\/)/.test(s)) return false;
  if (/\b(flex|grid|px-|py-|text-|bg-|rounded|border|items-|justify-|gap-|w-|h-)\S*/.test(s) && !/[.!?]$/.test(s)) return false; // Tailwind
  if (/^[A-Z_]+$/.test(s)) return false; // CONSTANTS
  if (/^@keyframes |\{[^}]*:[^}]*\}/.test(s)) return false; // CSS in a <style>, never translated
  if (/^(rgba?|hsla?|url|translate3d|calc)\(|^</.test(s)) return false; // CSS values, HTML built in code
  if (/!/.test(s) && s.split(' ').every((w) => /^[a-z0-9:.-]+!$/.test(w))) return false; // Tailwind with ! modifiers
  return true;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', hellip: '…', mdash: '—', ndash: '–', middot: '·', rarr: '→', larr: '←', times: '×', copy: '©' };

/** JSX text as the DOM holds it: entities decoded, whitespace collapsed. */
const squash = (s) =>
  s
    .replace(/&(#\d+|[a-z]+);/g, (m, e) => (e[0] === '#' ? String.fromCodePoint(Number(e.slice(1))) : ENTITIES[e] ?? m))
    .replace(/[ \t\n\r]+/g, ' ')
    .trim();

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', 'test', '__tests__', 'baarali-i18n'].includes(entry.name)) walkFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.|\.d\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Words, as a person writes them: a capital or a bracket, then a space somewhere. */
const looksWritten = (s) => !!s && /^[(\[“"']?[A-Z][a-z]/.test(s) && /[a-z] [A-Za-z]/.test(s.replace(/\$\d+/g, ''));

/** A string only the program reads: an import, a log line, an error it throws, a key. */
function inCode(n) {
  const p = n.parent;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p)) return true;
  if (ts.isPropertyAssignment(p) && p.name === n) return true;
  if (ts.isElementAccessExpression(p)) return true;
  if (ts.isCallExpression(p) && /^console\.|^(require|import)$|\.(debug|log|warn|info|trace)$/.test(p.expression.getText())) return true;
  if (ts.isCaseClause(p) || (ts.isBinaryExpression(p) && /===|!==|==|!=/.test(p.operatorToken.getText()))) return true;
  return false;
}

/** Every visible string of the renderer → the files it appears in. */
export function extract(root = RENDERER) {
  const found = new Map();
  const add = (raw, file, kind = 'text') => {
    if (raw === null) return;
    const s = brandText(squash(raw));
    if (!isProse(s.replace(/\$\d+/g, ''))) return;
    if (!found.has(s)) found.set(s, { files: new Set(), kinds: new Set() });
    found.get(s).files.add(path.relative(ROOT, file));
    found.get(s).kinds.add(kind);
  };
  const text = (n) => literal(n) ?? template(n);
  const literal = (n) => (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? n.text : null);
  // `${n} days left`: the words around the values, with $1, $2… in their place,
  // which the dictionary's patterns must cover.
  const template = (n) => {
    if (!n || !ts.isTemplateExpression(n)) return null;
    let out = n.head.text;
    n.templateSpans.forEach((span, i) => (out += `$${i + 1}` + span.literal.text));
    return out;
  };
  for (const file of walkFiles(root)) {
    const src = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (n) => {
      if (ts.isJsxText(n)) add(n.text, file);
      else if (ts.isJsxAttribute(n) && VISIBLE_ATTRS.has(n.name.getText(src)) && n.initializer) {
        const init = n.initializer;
        add(literal(init) ?? (ts.isJsxExpression(init) && init.expression ? text(init.expression) : null), file, 'attr');
      } else if (ts.isJsxExpression(n) && n.expression && text(n.expression) && ts.isJsxElement(n.parent)) {
        add(text(n.expression), file); // <p>{'Text'}</p>, <p>{`${n} left`}</p>
      } else if (ts.isPropertyAssignment(n) && VISIBLE_KEYS.has(n.name.getText(src).replace(/['"]/g, ''))) {
        add(text(n.initializer), file, 'prop');
      } else if (ts.isCallExpression(n) && VISIBLE_CALLS.test(n.expression.getText(src)) && n.arguments[0]) {
        add(text(n.arguments[0]), file, 'call');
      } else if (ts.isReturnStatement(n) && n.expression && /^[A-Z]/.test(text(n.expression) ?? '')) {
        add(text(n.expression), file, 'return'); // return 'Yesterday', return `${n}m ago`
      } else if (ts.isReturnStatement(n) && n.expression && /\s/.test(text(n.expression) ?? '')) {
        add(text(n.expression), file, 'return');
      } else if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) && looksWritten(text(n)) && !inCode(n)) {
        // Anywhere else, a sentence a person would read: `title || '(Untitled chat)'`,
        // `const label = busy ? 'All caught up' : …`, a default placeholder.
        add(text(n), file, 'literal');
      } else if (ts.isConditionalExpression(n) || (ts.isBinaryExpression(n) && /^(\|\||\?\?)$/.test(n.operatorToken.getText()))) {
        // A word chosen or put in by default: `x ? 'Upgrade' : 'Manage'`, `title || 'Untitled'`.
        const branches = ts.isConditionalExpression(n) ? [n.whenTrue, n.whenFalse] : [n.right];
        for (const b of branches) if (/^[A-Z][a-z]/.test(text(b) ?? '')) add(text(b), file, 'branch');
        if (ts.isJsxExpression(n.parent)) for (const b of branches) add(text(b), file);
      } else if (ts.isConditionalExpression(n) && ts.isJsxExpression(n.parent)) {
        for (const branch of [n.whenTrue, n.whenFalse]) {
          add(text(branch), file); // {busy ? 'Saving…' : 'Save'}
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(src);
  }
  return found;
}

/** The strings the French dictionary lacks: a template for text with values, an exact entry otherwise. */
export function missing(found, dict) {
  return [...found.keys()].filter((s) => !(/\$\d/.test(s) ? s in dict.templates : s in dict.exact));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const found = extract();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(Object.fromEntries([...found].map(([s, f]) => [s, { files: [...f.files], kinds: [...f.kinds] }])), null, 2));
  } else {
    // The dictionary is TypeScript importing './x.js' as the bundlers do;
    // Node strips the types but looks for the .js, so it is pointed at the .ts.
    registerHooks({
      resolve(specifier, context, next) {
        try {
          return next(specifier, context);
        } catch (err) {
          if (!specifier.endsWith('.js')) throw err;
          return next(specifier.replace(/\.js$/, '.ts'), context);
        }
      },
    });
    const { FR } = await import('../src/i18n/fr.ts');
    const { FR_MAIN } = await import('../src/i18n/main.ts');
    let lacking = [];
    for (const [where, root, dict] of [['the renderer', RENDERER, FR], ['the main process', MAIN, FR_MAIN]]) {
      const strings = extract(root);
      const gaps = missing(strings, dict);
      console.log(`${strings.size} strings in ${where}, ${strings.size - gaps.length} translated, ${gaps.length} not yet.`);
      if (process.argv.includes('--missing') || process.argv.includes('--check')) {
        for (const s of gaps.sort()) console.log(`  ${JSON.stringify(s)}  ${[...strings.get(s).files][0]}`);
      }
      lacking = lacking.concat(gaps);
    }
    // --check: the build stops here, never the app (decided 02/10/2026).
    if (process.argv.includes('--check') && lacking.length) process.exit(1);
  }
}
