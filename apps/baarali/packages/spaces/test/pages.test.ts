import { describe, expect, it } from 'vitest';
import { invitePage, landingPage, pickLanguage, welcomeReadme, withLanguage } from '../src/pages.js';

// Harbor's pages, as a person sees them (src/pages.ts, decided 02/10/2026).

describe('the visitor’s language', () => {
  it('takes the first of French or English they ask for', () => {
    expect(pickLanguage('fr-FR,fr;q=0.9,en;q=0.8')).toBe('fr');
    expect(pickLanguage('en-US,en;q=0.9,fr;q=0.8')).toBe('en');
    expect(pickLanguage('de-DE,fr;q=0.5')).toBe('fr');
    expect(pickLanguage('en;q=0.4,fr;q=0.9')).toBe('fr');
  });

  it('answers English to another language, French to an app that says nothing', () => {
    expect(pickLanguage('de-DE')).toBe('en');
    expect(pickLanguage(undefined)).toBe('fr');
    expect(pickLanguage('')).toBe('fr');
  });
});

describe('the pages', () => {
  const deep = 'rowboat://open?type=spaces&org=equipe.spaces.baarali.com&invite=t1';

  it('hands an invite to the app, in French, under our name only', async () => {
    const page = await withLanguage('fr', async () => invitePage({ state: 'ok', space: 'Ventes', org: 'Équipe', invitedBy: 'Awa', deep }));
    expect(page).toContain('Invitation à rejoindre Ventes');
    expect(page).toContain('De la part de Awa');
    expect(page).toContain('Ouvrir dans Baarali');
    expect(page).toContain('https://baarali.com/#telecharger');
    expect(page).not.toMatch(/Rowboat|rowboatlabs/);
  });

  it('never lets a name write into the page', async () => {
    const page = await withLanguage('en', async () => invitePage({ state: 'ok', space: '<img src=x onerror=alert(1)>', org: 'O', deep }));
    expect(page).not.toContain('<img');
    expect(page).toContain('You’re invited to &lt;img');
  });

  it('says why an invite no longer works', async () => {
    expect(await withLanguage('fr', async () => invitePage({ state: 'expired' }))).toContain('Cette invitation a expiré.');
    expect(await withLanguage('en', async () => invitePage({ state: 'revoked' }))).toContain('This invite was revoked.');
  });

  it('opens an org link in the app', async () => {
    const page = await withLanguage('en', async () => landingPage(deep));
    expect(page).toContain('Open in Baarali');
    expect(page).toContain(`location.replace(${JSON.stringify(deep)})`);
  });

  it('welcomes a new team with @baarali, in its founder’s language', async () => {
    const fr = await withLanguage(undefined, async () => welcomeReadme('Équipe'));
    expect(fr.startsWith('# Bienvenue chez Équipe')).toBe(true);
    expect(fr).toContain('@baarali');
    const en = await withLanguage('en-GB', async () => welcomeReadme('Team'));
    expect(en.startsWith('# Welcome to Team')).toBe(true);
    expect(en + fr).not.toMatch(/@rowboat|Rowboat/);
  });
});
