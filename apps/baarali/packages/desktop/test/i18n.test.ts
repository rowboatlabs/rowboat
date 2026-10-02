import { describe, expect, it } from 'vitest';
import { MAIN, extract, missing } from '../scripts/i18n-extract.mjs';
import { FR } from '../src/i18n/fr.js';
import { FR_MAIN, translateMenu } from '../src/i18n/main.js';
import { compile, pickLang, translate } from '../src/i18n/translate.js';

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

  it('never applies a short template to a title a person wrote', () => {
    // « Open questions » could be a note: as plain text it stays as written.
    expect(translate(FR, 'Open questions', 'text')).toBeNull();
    expect(translate(FR, 'Open questions', 'attr')).toBe('Ouvrir questions');
    expect(translate(FR, 'Connect OpenAI', 'control')).toBe('Connecter OpenAI');
    // Even on a button, a phrase someone wrote is not a name.
    expect(translate(FR, 'Add your first to-do — just type below', 'control')).toBeNull();
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
