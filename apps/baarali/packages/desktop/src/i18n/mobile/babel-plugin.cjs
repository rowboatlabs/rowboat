// The mobile app in French (decided 02/10/2026). React Native has no page to
// watch, so the desktop's layer (../translate.ts) cannot reach it: this Babel
// plugin, added by scripts/brand.mjs to the build's babel.config.js, rewrites
// the text the upstream's screens show into a lookup in the same dictionary
// (fr.ts), at compile time; the repository's files stay as they are.
//
//   <Text>Pair your phone</Text>      → <Text>{__baaraliT("Pair your phone")}</Text>
//   placeholder="Message Baarali"     → placeholder={__baaraliT("Message Baarali")}
//   {`${n} files`}                    → {__baaraliT("$1 files", [n])}
//   {busy ? 'Saving…' : 'Save'}       → each branch looked up
//   Alert.alert('Title', 'Message')   → both looked up
//   new Error('sign-in cancelled')    → its message too (screens show it)
//
// What it rewrites is exactly what `collect` lists, so the check
// (scripts/i18n-extract.mjs) and the app can never disagree.
'use strict';

const path = require('node:path');

/** Props a person reads or hears. */
const VISIBLE_ATTRS = new Set(['placeholder', 'title', 'accessibilityLabel', 'accessibilityHint', 'aria-label', 'label', 'description', 'alt', 'headerTitle', 'subtitle', 'detail', 'text', 'sub', 'hint', 'body', 'message', 'question', 'emptyText']);
/** Keys of an object written inside a JSX prop (`options={{ title: 'Chats' }}`) or a list of rows. */
const VISIBLE_KEYS = new Set(['title', 'headerTitle', 'label', 'sub', 'subtitle', 'detail', 'description', 'placeholder', 'message', 'hint']);

/** Words, as a person writes them. */
const isProse = (s) => /[A-Za-z]{2}/.test(s.replace(/\$\d+/g, '')) && !/^[a-z0-9]+([-_:./][a-z0-9]+)+$/.test(s) && !/^(https?:|mailto:|\/|#|\.\/)/.test(s);

/** JSX text the way React renders it: lines trimmed, joined by one space. */
function cleanJSXText(raw) {
  const lines = raw.split(/\r\n|\n|\r/);
  let last = 0;
  lines.forEach((l, i) => { if (/[^ \t]/.test(l)) last = i; });
  let out = '';
  lines.forEach((line, i) => {
    let s = line.replace(/\t/g, ' ');
    if (i !== 0) s = s.replace(/^[ ]+/, '');
    if (i !== lines.length - 1) s = s.replace(/[ ]+$/, '');
    if (s) {
      if (i !== last) s += ' ';
      out += s;
    }
  });
  return out;
}

module.exports = function baaraliI18n({ types: t }, options = {}) {
  const runtime = options.runtime; // absolute path of runtime.ts in the build
  // Only the app's own screens: never a library, never this layer itself.
  const mine = (filename) => !runtime || (filename && filename.startsWith(path.dirname(path.dirname(path.dirname(runtime)))) && !filename.includes(`${path.sep}baarali-i18n${path.sep}`) && !filename.includes(`${path.sep}node_modules${path.sep}`));
  const collect = options.collect; // a Set: list the strings instead of rewriting

  const call = (key, values) => t.callExpression(t.identifier('__baaraliT'), values && values.length ? [t.stringLiteral(key), t.arrayExpression(values)] : [t.stringLiteral(key)]);

  /** A literal or a template → [key, values] when it is words, else null. */
  function text(node) {
    if (!node) return null;
    if (t.isStringLiteral(node)) return isProse(node.value) ? [node.value, []] : null;
    if (t.isTemplateLiteral(node)) {
      let key = node.quasis[0].value.cooked;
      node.expressions.forEach((e, i) => (key += `$${i + 1}` + node.quasis[i + 1].value.cooked));
      return isProse(key) ? [key.replace(/\s+/g, ' ').trim(), node.expressions] : null;
    }
    return null;
  }

  /** A literal, a template, or each branch of `a ? 'x' : 'y'` / `a || 'x'`. */
  function lookUp(e) {
    if (e.isConditionalExpression()) return void [e.get('consequent'), e.get('alternate')].forEach(lookUp);
    if (e.isLogicalExpression() && e.node.operator !== '&&') return void lookUp(e.get('right'));
    // ` · ${n} ${n === 1 ? 'space' : 'spaces'}`: no words of its own, words in its values (2026-10-02).
    if (e.isTemplateLiteral() && !text(e.node)) return void e.get('expressions').forEach(lookUp);
    if (swap(e, text(e.node))) used = !collect || used;
  }

  /** Replace a node by its lookup, or record it. */
  function swap(p, found) {
    if (!found) return false;
    const [key, values] = found;
    if (collect) collect.add(key);
    else p.replaceWith(call(key, values));
    p.skip();
    return true;
  }

  let used = false;
  let off = false;
  const inner = {
      JSXText(p) {
        const cleaned = cleanJSXText(p.node.value);
        if (!isProse(cleaned)) return;
        const core = cleaned.trim();
        if (collect) return void collect.add(core);
        used = true;
        // Keep the spaces React would render around the words.
        const lead = cleaned.startsWith(' ') ? ' ' : '';
        const trail = cleaned.endsWith(' ') ? ' ' : '';
        const parts = [];
        if (lead) parts.push(t.jsxText(lead));
        parts.push(t.jsxExpressionContainer(call(core)));
        if (trail) parts.push(t.jsxText(trail));
        p.replaceWithMultiple(parts);
        p.skip();
      },
      JSXAttribute(p) {
        const name = t.isJSXIdentifier(p.node.name) ? p.node.name.name : null;
        if (!name || !VISIBLE_ATTRS.has(name)) return;
        const v = p.get('value');
        if (v.isStringLiteral()) {
          const found = text(v.node);
          if (!found) return;
          if (collect) return void collect.add(found[0]);
          used = true;
          v.replaceWith(t.jsxExpressionContainer(call(found[0])));
        } else if (v.isJSXExpressionContainer() && swap(v.get('expression'), text(v.node.expression))) used = !collect;
      },
      // {`${n} files`}, {'Text'}, and the branches of {a ? 'x' : 'y'} / {a || 'x'}
      JSXExpressionContainer(p) {
        if (p.parentPath.isJSXAttribute() && !VISIBLE_ATTRS.has(p.parent.name.name)) return;
        lookUp(p.get('expression'));
      },
      // options={{ title: 'Chats' }}, rows: [{ label: 'Settings', sub: '…' }]
      ObjectProperty(p) {
        const key = t.isIdentifier(p.node.key) ? p.node.key.name : t.isStringLiteral(p.node.key) ? p.node.key.value : null;
        if (!key || !VISIBLE_KEYS.has(key)) return;
        lookUp(p.get('value'));
      },
      // new Error('sign-in cancelled'): the screens show error.message as it is.
      NewExpression(p) {
        if (!t.isIdentifier(p.node.callee, { name: 'Error' })) return;
        const arg = p.get('arguments')[0];
        if (arg) lookUp(arg);
      },
      // Alert.alert('Title', 'Message', …)
      CallExpression(p) {
        const callee = p.get('callee');
        if (!callee.matchesPattern('Alert.alert') && !callee.matchesPattern('Alert.prompt')) return;
        for (const arg of p.get('arguments').slice(0, 2)) lookUp(arg);
      },
  };

  return {
    name: 'baarali-i18n',
    visitor: {
      Program: {
        // Everything happens here, before any other plugin touches the file:
        // the React Compiler moves `cond ? 'a' : 'b'` out of the JSX, where
        // it would no longer be recognised.
        enter(p, state) {
          used = false;
          // A flag, never p.skip(): Babel runs every plugin in one traversal,
          // and skipping the program would starve the preset's plugins too.
          off = !collect && !mine(state.filename);
          if (!off) p.traverse(inner);
        },
        exit(p, state) {
          if (off || !used || collect || !runtime) return;
          const from = path.dirname(state.filename);
          let rel = path.relative(from, runtime).replace(/\\/g, '/').replace(/\.tsx?$/, '');
          if (!rel.startsWith('.')) rel = `./${rel}`;
          p.unshiftContainer('body', t.importDeclaration([t.importSpecifier(t.identifier('__baaraliT'), t.identifier('__baaraliT'))], t.stringLiteral(rel)));
        },
      },
    },
  };
};

module.exports.cleanJSXText = cleanJSXText;
