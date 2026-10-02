// What Harbor, our Spaces server, says to a person, in Baarali's words and
// in their language (decided 02/10/2026: we host Spaces ourselves). Harbor
// stays the upstream's code: scripts/brand.mjs (`--only harbor`) copies this
// file into the build as src/baarali-pages.ts and points its pages here.
//
// Harbor's pages are drawn deep inside its handlers, where the request is
// out of reach: a middleware keeps the language for the time of the request.
import { AsyncLocalStorage } from 'node:async_hooks';

export type Language = 'fr' | 'en';

/** Where someone without the app gets it: the site's download section. */
export const DOWNLOAD_URL = 'https://baarali.com/#telecharger';

/**
 * The person's language from their Accept-Language: the first of French or
 * English they ask for; another language alone gets English; no header
 * (an app's own request) gets French, Baarali's first language.
 */
export function pickLanguage(header: string | null | undefined): Language {
  if (!header) return 'fr';
  const asked = header
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().toLowerCase().split(';');
      const q = params.map((p) => /^\s*q=([\d.]+)/.exec(p)?.[1]).find(Boolean);
      return { tag, q: q === undefined ? 1 : Number(q), i };
    })
    .filter((a) => a.tag && a.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const { tag } of asked) {
    if (tag === 'fr' || tag.startsWith('fr-')) return 'fr';
    if (tag === 'en' || tag.startsWith('en-')) return 'en';
  }
  return 'en';
}

const current = new AsyncLocalStorage<Language>();

/** Harbor's middleware: the rest of the request speaks the person's language. */
export function withLanguage<T>(header: string | null | undefined, next: () => Promise<T>): Promise<T> {
  return current.run(pickLanguage(header), next);
}

export function language(): Language {
  return current.getStore() ?? 'fr';
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

const TEXT = {
  fr: {
    open: 'Ouvrir dans Baarali',
    opensIn: 'Ce lien s’ouvre dans Baarali.',
    expired: 'Cette invitation a expiré.',
    revoked: 'Cette invitation a été retirée.',
    expiredTitle: 'Invitation expirée',
    revokedTitle: 'Invitation retirée',
    askAgain: 'Demandez un nouveau lien à la personne qui vous l’a envoyé.',
    joinTitle: (space: string, org: string) => `Rejoindre ${space} sur ${org}`,
    invited: (space: string) => `Invitation à rejoindre ${space}`,
    on: (org: string) => `sur ${org}`,
    by: (who: string) => `De la part de ${who}`,
    noApp: (link: string) => `Pas encore Baarali ? ${link}, puis rouvrez ce lien.`,
    download: 'Téléchargez l’app',
    welcome: (org: string) => `# Bienvenue chez ${org}

Voici le coin partagé de votre équipe. **general** est son premier espace : la discussion et les fichiers au même endroit, pour vous, vos collègues et les agents de chacun.

## Ce qui se passe ici

- **On échange dans Messages.** Le fil ouvert est l’endroit où l’équipe réfléchit à voix haute. Un message qui reçoit des réponses devient un sujet à part.
- **Les fichiers font foi.** Ce que l’équipe décide — plans, notes, décisions — vit ici, dans des fichiers que tout le monde (et l’agent de chacun) peut lire et proposer de modifier. Ce README en est un : modifiez-le, remplacez-le, faites-le vôtre.
- **Demandez à @baarali.** Mentionnez @baarali dans un message et *votre* agent s’en charge : résumer une discussion, rédiger un document, reporter une décision dans un fichier.
- **Invitez votre équipe.** Partagez un lien d’invitation depuis le menu de l’espace. Chacun se connecte avec son propre compte, et l’agent de chacun agit en son nom — jamais comme un robot aux pouvoirs à part.

## Quand créer d’autres espaces

Commencez ici, dans general. Quand un projet ou un pan de l’équipe a son propre flot de discussions et de fichiers, donnez-lui son espace : les espaces ne coûtent rien, l’attention si.
`,
  },
  en: {
    open: 'Open in Baarali',
    opensIn: 'This link opens in Baarali.',
    expired: 'This invite has expired.',
    revoked: 'This invite was revoked.',
    expiredTitle: 'Invite expired',
    revokedTitle: 'Invite revoked',
    askAgain: 'Ask whoever sent it for a new link.',
    joinTitle: (space: string, org: string) => `Join ${space} on ${org}`,
    invited: (space: string) => `You’re invited to ${space}`,
    on: (org: string) => `on ${org}`,
    by: (who: string) => `Invited by ${who}`,
    noApp: (link: string) => `Don’t have Baarali? ${link}, then open this link again.`,
    download: 'Download it',
    welcome: (org: string) => `# Welcome to ${org}

This is your team's shared corner. **general** is its first space — talk and files in one place, for you, your teammates, and everyone's agents.

## What happens here

- **Talk in Messages.** The open stream is where the team thinks out loud. A message that gets replies becomes its own topic.
- **Files are the record.** Anything the team agrees on — plans, notes, decisions — lives here as files everyone (and everyone's agent) can read and propose changes to. This README is one: edit it, replace it, make it yours.
- **Ask @baarali.** Mention @baarali in any message and *your* agent picks it up — summarize a thread, draft a doc, fold a decision into a file.
- **Invite your team.** Share an invite link from the space menu. Each person signs in with their own account, and each person's agent acts as them — never as a bot with special powers.

## When to make more spaces

Start here in general. When one project or team-area grows its own steady stream of talk and files, give it a space of its own — spaces are cheap, attention isn't.
`,
  },
} as const;

const STYLE =
  `<style>body{font:15px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;color:#1a1a1a;background:#f7f8fa}` +
  `main{text-align:center;padding:2rem;max-width:26rem}h1{font-size:1.25rem;margin:0 0 .25rem}p{margin:.25rem 0}.m{color:#5f6672}` +
  `a.b{display:inline-block;margin-top:1rem;padding:.6rem 1.1rem;border-radius:10px;background:#1a6dff;color:#fff;text-decoration:none}` +
  `.s{margin-top:1.25rem;font-size:13px;color:#5f6672}.s a{color:inherit}` +
  `@media (prefers-color-scheme:dark){body{background:#0a0a0a;color:#ececec}.m,.s{color:#9aa1ad}a.b{background:#4d8dff}}</style>`;

const head = (title: string) =>
  `<!doctype html><html lang="${language()}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title>${STYLE}`;
const launch = (deep: string) => `<script>location.replace(${JSON.stringify(deep)})</script>`;

/** An org link opened in a browser: handed to the app (http.ts « link landings »). */
export function landingPage(deep: string): string {
  const t = TEXT[language()];
  return `${head(t.open)}<main><p>${t.opensIn}</p><a class="b" href="${deep}">${t.open}</a></main>${launch(deep)}`;
}

export type InvitePage =
  | { state: 'expired' | 'revoked' }
  | { state: 'ok'; space: string; org: string; invitedBy?: string | null; deep: string };

/** /join/<token> opened in a browser (http.ts invitePage). */
export function invitePage(page: InvitePage): string {
  const t = TEXT[language()];
  if (page.state !== 'ok') {
    const expired = page.state === 'expired';
    return `${head(expired ? t.expiredTitle : t.revokedTitle)}<main><h1>${expired ? t.expired : t.revoked}</h1><p class="m">${t.askAgain}</p></main>`;
  }
  const by = page.invitedBy ? `<p class="m">${escapeHtml(t.by(page.invitedBy))}</p>` : '';
  const download = `<a href="${DOWNLOAD_URL}">${t.download}</a>`;
  return (
    `${head(t.joinTitle(page.space, page.org))}<main>` +
    `<h1>${escapeHtml(t.invited(page.space))}</h1><p class="m">${escapeHtml(t.on(page.org))}</p>${by}` +
    `<a class="b" href="${page.deep}">${t.open}</a>` +
    `<p class="s">${t.noApp(download)}</p></main>${launch(page.deep)}`
  );
}

/** A new team's first file (apex.ts welcomeReadme), in its founder's language. */
export function welcomeReadme(orgName: string): string {
  return TEXT[language()].welcome(orgName);
}
