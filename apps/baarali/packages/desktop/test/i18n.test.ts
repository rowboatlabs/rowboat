import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { MAIN, extract, extractMobile, missing, mobileBabel } from '../scripts/i18n-extract.mjs';
import { __baaraliT, setLanguage } from '../src/i18n/mobile/runtime.js';
import { FR } from '../src/i18n/fr.js';
import { FR_MAIN, translateMenu } from '../src/i18n/main.js';
import { aboutPeople, compile, pickLang, translate } from '../src/i18n/translate.js';

describe('the French dictionary', () => {
  // The guarantee asked for on 02/10/2026: no English left in the interface.
  // A string the upstream adds fails this test, and the release with it,
  // until it is translated; the installed app is never stopped by it.
  it('translates every string the interface shows', () => {
    const lacking = missing(extract(), FR);
    expect(lacking, `not translated yet:\n${lacking.join('\n')}`).toEqual([]);
  });

  it('translates the menus, the tray and the dialogs too', () => {
    const lacking = missing(extract(MAIN), FR_MAIN);
    expect(lacking, `not translated yet:\n${lacking.join('\n')}`).toEqual([]);
  });

  it('translates the mobile app too', () => {
    const lacking = missing(extractMobile(), FR);
    expect(lacking, `not translated yet:\n${lacking.join('\n')}`).toEqual([]);
  });

  it('names no product but Baarali', () => {
    for (const fr of [...Object.values(FR.exact), ...Object.values(FR.templates)]) {
      expect(fr).not.toMatch(/Stripe/);
      // The license's attribution line is the one place the upstream is named.
      if (!fr.includes('Apache 2.0')) expect(fr).not.toMatch(/Rowboat/);
    }
  });

  it('leaves no entry empty', () => {
    for (const [en, fr] of Object.entries(FR.exact)) expect(fr.trim(), en).not.toBe('');
  });

  it('keeps the values of every template', () => {
    for (const [en, fr] of Object.entries(FR.templates)) {
      const values = new Set(en.match(/\$\d+/g));
      for (const v of fr.match(/\$\d+/g) ?? []) expect(values.has(v), `${en} → ${fr}`).toBe(true);
    }
  });
});

describe('translate', () => {
  it('translates a whole string and keeps the spaces around it', () => {
    expect(translate(FR, 'Settings')).toBe('Paramètres');
    expect(translate(FR, ' New chat ')).toBe(' Nouvelle discussion ');
  });

  it('finds a text the build did not name Baarali', () => {
    expect(translate(FR, 'Manage your Rowboat account')).toBe('Gérer votre compte Baarali');
  });

  it('finds a to-do line written with the old handle', () => {
    expect(translate(FR, '@rowboat introduce yourself — what can you do here?')).toBe('@baarali présente-toi : que peux-tu faire ici ?');
  });

  it('translates a duration in days inside a sentence', () => {
    expect(translate(FR, 'Week: 79% left · renews in 3 d 9 h', 'control')).toBe('Semaine : 79 % restants · renouvelée dans 3 j 9 h');
  });

  it('writes no long dash in the French', () => {
    const dashed = Object.values({ ...FR.exact, ...FR.templates }).filter((v) => /\S —|— \S/.test(v));
    expect(dashed).toEqual([]);
  });

  it('leaves alone what it does not know', () => {
    expect(translate(FR, 'Réunion avec Awa')).toBeNull();
    expect(translate(FR, '42')).toBeNull();
  });

  it('puts the values back into the French', () => {
    expect(translate(FR, 'Connected to Gmail')).toBe('Connecté à Gmail');
    expect(translate(FR, '5m ago')).toBe('il y a 5 min');
    expect(translate(FR, 'Presentation, slide 2 of 9', 'attr')).toBe('Présentation, diapositive 2 sur 9');
  });

  it('translates a value that is itself English the code wrote', () => {
    expect(translate(FR, '👍, 3 reactions, Awa, including you', 'attr')).toBe('👍, 3 réactions, Awa, y compris vous');
  });

  it('translates the to-do list the app writes on the first run, not the ones people write', () => {
    expect(translate(FR, 'Add your first to-do — just type below')).toBe('Ajoutez votre première chose à faire : écrivez-la juste en dessous');
    expect(translate(FR, 'Call the bank — before noon')).toBeNull();
  });

  it('never applies a short template to a title a person wrote', () => {
    // « Open questions » could be a note: as plain text it stays as written.
    expect(translate(FR, 'Open questions', 'text')).toBeNull();
    expect(translate(FR, 'Open questions', 'attr')).toBe('Ouvrir questions');
    expect(translate(FR, 'Connect OpenAI', 'control')).toBe('Connecter OpenAI');
    // Even on a button, a phrase someone wrote is not a name.
    expect(translate(FR, 'Add your first idea — just type below', 'control')).toBeNull();
    // Numbers are never someone's words.
    expect(translate(FR, '12 files', 'text')).toBe('12 fichiers');
  });

  it('tries the most specific template first', () => {
    const order = compile(FR).map((t) => t.re.source);
    expect(order.indexOf('^Signed into (.*?) as (.*?)$')).toBeLessThan(order.indexOf('^Signed into (.*?)$'));
  });
});

describe('translateMenu', () => {
  it('speaks like a menu bar and names the items Electron names itself', () => {
    const [edit] = translateMenu([{ label: 'Edit', submenu: [{ role: 'copy' }, { label: 'Undo' }] }]);
    expect(edit.label).toBe('Édition');
    expect((edit.submenu as Array<{ label: string }>).map((i) => i.label)).toEqual(['Copier', 'Annuler']);
  });
});

describe('pickLang', () => {
  it('follows the choice made in the app, else the system', () => {
    expect(pickLang('en', 'fr-FR')).toBe('en');
    expect(pickLang('fr', 'en-US')).toBe('fr');
    expect(pickLang(null, 'fr-CI')).toBe('fr');
    expect(pickLang(null, 'en-US')).toBe('en');
  });
});

describe('the mobile app', () => {
  const plugin = createRequire(import.meta.url)('../src/i18n/mobile/babel-plugin.cjs');
  const runtime = path.resolve('/app/src/baarali-i18n/mobile/runtime.ts');
  const compile = (code: string, filename = '/app/src/app/screen.tsx') =>
    mobileBabel().transformSync(code, { filename, babelrc: false, configFile: false, parserOpts: { plugins: ['jsx', 'typescript'] }, plugins: [[plugin, { runtime }]] }).code as string;

  it('looks up what a screen shows, and only that', () => {
    const out = compile(`const s = <View><Text>Pair your phone</Text><TextInput placeholder="Message Baarali" /><Text style={{ color: 'red' }}>{\`\${n} files\`}</Text></View>;`);
    expect(out).toContain('import { __baaraliT } from "../baarali-i18n/mobile/runtime";');
    expect(out).toContain('__baaraliT("Pair your phone")');
    expect(out).toContain('placeholder={__baaraliT("Message Baarali")}');
    expect(out).toContain('__baaraliT("$1 files", [n])');
    expect(out).toContain("color: 'red'");
  });

  it('looks up the words inside a template that has none of its own', () => {
    const out = compile("const s = <Text>{n ? ` · ${n.length} ${n.length === 1 ? 'space' : 'spaces'}` : ''}</Text>;");
    expect(out).toContain('__baaraliT("space")');
    expect(out).toContain('__baaraliT("spaces")');
    expect(out).toContain(' · ${n.length}');
  });

  it('keeps the spaces React renders around the words', () => {
    expect(compile('const s = <Text>Hello <B>you</B></Text>;')).toContain('{__baaraliT("Hello")} <B>');
  });

  it('leaves the other plugins of the build their work in a library', () => {
    // A library's file, compiled with a plugin of its own after this one.
    const seen: string[] = [];
    const after = () => ({ visitor: { Identifier(p: { node: { name: string } }) { seen.push(p.node.name); } } });
    mobileBabel().transformSync('const answer = 42;', { filename: '/app/node_modules/x/index.ts', babelrc: false, configFile: false, plugins: [[plugin, { runtime }], after] });
    expect(seen).toContain('answer');
  });

  it('looks up before the React Compiler moves the words out of the JSX', () => {
    // Like the compiler: on entering the program, `cond ? 'a' : 'b'` leaves the JSX for a variable.
    const compiler = ({ types: t }: { types: any }) => ({
      visitor: {
        Program: {
          enter(p: any) {
            p.traverse({
              JSXExpressionContainer(c: any) {
                if (!c.get('expression').isConditionalExpression()) return;
                const id = c.scope.generateUidIdentifier('t');
                c.getStatementParent().insertBefore(t.variableDeclaration('const', [t.variableDeclarator(id, c.node.expression)]));
                c.get('expression').replaceWith(id);
              },
            });
          },
        },
      },
    });
    const out = mobileBabel().transformSync("const f = (last) => <Text>{last ? 'Get started' : 'Continue'}</Text>;", { filename: '/app/src/app/screen.tsx', babelrc: false, configFile: false, parserOpts: { plugins: ['jsx', 'typescript'] }, plugins: [[plugin, { runtime }], compiler] }).code as string;
    expect(out).toContain('__baaraliT("Continue")');
  });

  it('leaves libraries and this layer alone', () => {
    expect(compile('const s = <Text>Pair your phone</Text>;', '/app/node_modules/x/index.tsx')).not.toContain('__baaraliT');
    expect(compile('const s = <Text>Pair your phone</Text>;', '/app/src/baarali-i18n/x.tsx')).not.toContain('__baaraliT');
  });

  it('answers in the phone’s language, the English when the dictionary has nothing', () => {
    setLanguage('fr');
    expect(__baaraliT('Message Baarali')).toBe('Écrire à Baarali');
    expect(__baaraliT('Message #$1', ['general'])).toBe('Écrire dans #general');
    expect(__baaraliT('Something new upstream')).toBe('Something new upstream');
    setLanguage('en');
    expect(__baaraliT('Message #$1', ['general'])).toBe('Message #general');
  });
});

describe("Activity's reason lines", () => {
  it('read in French, a space name kept as written', () => {
    expect(translate(FR, 'messaged you', 'text')).toBe('vous a écrit');
    expect(translate(FR, 'mentioned you in #ventes', 'text')).toBe('vous a mentionné dans #ventes');
    expect(translate(FR, 'reacted 👍 to your message in a thread in #general', 'text')).toBe('a réagi 👍 à votre message dans un fil de #general');
  });
});

describe('lines about people', () => {
  it('say who came and went, names as written', () => {
    expect(aboutPeople(FR, 'benewende.dev joined')).toBe('benewende.dev a rejoint l’espace');
    expect(aboutPeople(FR, 'Awa Traoré left')).toBe('Awa Traoré a quitté l’espace');
    expect(aboutPeople(FR, 'Awa added Moussa')).toBe('Awa a ajouté Moussa');
    expect(aboutPeople(FR, 'Awa (via Baarali) removed Moussa')).toBe('Awa (via Baarali) a retiré Moussa');
    expect(aboutPeople(FR, 'Moussa was removed')).toBe('Moussa ne fait plus partie de l’espace');
  });

  it('leave the rest of the interface to the other entries', () => {
    expect(aboutPeople(FR, 'Settings')).toBeNull();
    // Outside such a line, « 3 left » is still a count.
    expect(translate(FR, '3 left')).toBe('3 restant(s)');
  });
});
