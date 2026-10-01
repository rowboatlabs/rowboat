import type { SoldPack } from './admin.js';
import type { Money, Offer } from './pricing.js';
import { pickLang } from './sign-in-page.js';

// The home page at baarali.com, with the prices (decided 01/10/2026). Prices
// and credits come from the catalog the quota is computed from (catalog.ts),
// never written here: the page cannot drift from what is billed. Usage is
// shown relative to Essentiel, never in dollars: the margin stays ours.
// Strings live in STRINGS until @baarali/i18n exists (roadmap phase 1).

type Lang = 'fr' | 'en';

const STRINGS = {
  fr: {
    title: 'Baarali — l’assistant qui agit pour vous',
    description: 'Baarali cherche, rédige, organise et crée des vidéos, des voix et de la musique, et vous demande votre accord avant d’agir. En français et en anglais, avec des prix en F CFA.',
    navPrices: 'Tarifs',
    navSignIn: 'Se connecter',
    eyebrow: 'Accès anticipé',
    hero: 'L’assistant qui agit pour vous.',
    lead: 'Baarali cherche, rédige, organise et crée pour vous. Il vous demande votre accord avant chaque geste qui compte. Pensé pour l’Afrique de l’Ouest, en français et en anglais.',
    start: 'Créer mon compte gratuit',
    download: 'Télécharger Baarali',
    seePrices: 'Voir les tarifs',
    downloadTitle: 'Télécharger Baarali',
    downloadLead: 'Installez l’app, connectez-vous avec votre email : votre espace Baarali se crée tout seul, et vous retrouvez tout d’un appareil à l’autre.',
    macArm: 'Mac (Apple M1 et plus récent)',
    macIntel: 'Mac (Intel)',
    windows: 'Windows 10 et 11',
    macNote: 'Au premier lancement sur Mac, si macOS refuse d’ouvrir l’app : Réglages Système › Confidentialité et sécurité › Ouvrir quand même.',
    phoneNote: 'Sur téléphone : bientôt.',
    featuresTitle: 'Ce qu’il fait',
    features: [
      ['Il travaille', 'Recherches, documents, tableaux, emails à rédiger : vous demandez, il fait, et il continue en arrière-plan.'],
      ['Il demande avant d’agir', 'Rien d’engageant ne part sans votre accord. Vous voyez ce qu’il s’apprête à faire, et vous décidez.'],
      ['Il crée', 'Des vidéos, des voix et de la musique, payées avec des crédits médias, à part de votre forfait.'],
      ['Il parle votre langue', 'Français et anglais, et des prix fixes en F CFA comme en euros.'],
    ],
    pricesTitle: 'Tarifs',
    pricesLead: 'Une utilisation qui se renouvelle toutes les 5 heures et chaque semaine. Changez de forfait quand vous voulez.',
    perWeek: 'par semaine',
    perMonth: 'par mois',
    free: 'Gratuit',
    usage: (x: string) => `Utilisation ×${x} par rapport à Essentiel`,
    plans: {
      decouverte: { tag: 'Pour essayer', points: ['Des modèles rapides et économiques', 'Une utilisation limitée, renouvelée toutes les 5 h et chaque semaine', 'Les médias avec des crédits'] },
      semaine: { tag: 'Sans engagement', points: ['Tous les modèles', 'L’utilisation d’Essentiel, payée à la semaine', 'Pratique en Mobile Money'] },
      essentiel: { tag: 'Le quotidien', points: ['Tous les modèles', 'Une utilisation pour tous les jours', 'Les médias avec des crédits'] },
      pro: { tag: 'Pour les gros besoins', points: ['Tous les modèles', 'Cinq ou dix fois l’utilisation d’Essentiel', 'Pour travailler toute la journée avec lui'] },
    } as Record<string, { tag: string; points: string[] }>,
    proChoice: 'Choisissez votre niveau',
    payment: 'Paiement en ligne bientôt : Mobile Money et carte.',
    taxes: 'Prix hors taxes.',
    mediaTitle: 'Crédits médias',
    mediaLead: 'Vidéos, voix et musique se paient avec des crédits, à part du forfait. Ils restent sur votre compte jusqu’à ce que vous les utilisiez. Une génération qui échoue est remboursée.',
    credits: 'crédits',
    examples: 'Exemples : une vidéo de 5 secondes, 38 crédits · une voix d’une minute, 2 crédits · une musique, 5 crédits.',
    faqTitle: 'Questions',
    faq: [
      ['Comment je me connecte ?', 'Dans l’app, sans mot de passe : vous recevez un code par email. Google, Apple et GitHub arrivent bientôt, puis le SMS.'],
      ['Que se passe-t-il quand j’atteins ma limite ?', 'Vous attendez la fin de la fenêtre de 5 heures ou de la semaine, ou vous passez au forfait du dessus. Une réponse commencée n’est jamais coupée.'],
      ['Mes crédits médias expirent-ils ?', 'Non. Ils restent sur votre compte jusqu’à ce que vous les utilisiez.'],
      ['Où sont mes données ?', 'Chaque compte a son propre espace de travail, séparé des autres, hébergé en Europe.'],
    ],
    footer: 'Baarali est un produit d’OpenBaara.',
  },
  en: {
    title: 'Baarali — the assistant that acts for you',
    description: 'Baarali researches, writes, organizes and creates videos, voices and music, and asks for your approval before it acts. In French and English, with prices in CFA francs.',
    navPrices: 'Pricing',
    navSignIn: 'Sign in',
    eyebrow: 'Early access',
    hero: 'The assistant that acts for you.',
    lead: 'Baarali researches, writes, organizes and creates for you. It asks for your approval before every step that matters. Built for West Africa, in French and English.',
    start: 'Create my free account',
    download: 'Download Baarali',
    seePrices: 'See pricing',
    downloadTitle: 'Download Baarali',
    downloadLead: 'Install the app and sign in with your email: your Baarali space is set up for you, and everything follows you from one device to another.',
    macArm: 'Mac (Apple M1 or newer)',
    macIntel: 'Mac (Intel)',
    windows: 'Windows 10 and 11',
    macNote: 'On a Mac, if macOS refuses to open the app the first time: System Settings › Privacy & Security › Open Anyway.',
    phoneNote: 'On your phone: soon.',
    featuresTitle: 'What it does',
    features: [
      ['It works', 'Research, documents, spreadsheets, emails to draft: you ask, it does it, and keeps going in the background.'],
      ['It asks before acting', 'Nothing binding goes out without your approval. You see what it is about to do, and you decide.'],
      ['It creates', 'Videos, voices and music, paid with media credits, separate from your plan.'],
      ['It speaks your language', 'French and English, and fixed prices in CFA francs as in euros.'],
    ],
    pricesTitle: 'Pricing',
    pricesLead: 'Usage that renews every 5 hours and every week. Change plans whenever you want.',
    perWeek: 'per week',
    perMonth: 'per month',
    free: 'Free',
    usage: (x: string) => `×${x} the usage of Essentiel`,
    plans: {
      decouverte: { tag: 'To try it', points: ['Fast, low-cost models', 'Limited usage, renewed every 5 h and every week', 'Media with credits'] },
      semaine: { tag: 'No commitment', points: ['Every model', 'The usage of Essentiel, paid by the week', 'Handy with mobile money'] },
      essentiel: { tag: 'Everyday', points: ['Every model', 'Usage for every day', 'Media with credits'] },
      pro: { tag: 'For heavy use', points: ['Every model', 'Five or ten times the usage of Essentiel', 'To work with it all day'] },
    } as Record<string, { tag: string; points: string[] }>,
    proChoice: 'Choose your level',
    payment: 'Online payment soon: mobile money and card.',
    taxes: 'Prices exclude taxes.',
    mediaTitle: 'Media credits',
    mediaLead: 'Videos, voices and music are paid with credits, separate from the plan. They stay on your account until you use them. A failed generation is refunded.',
    credits: 'credits',
    examples: 'Examples: a 5-second video, 38 credits · a one-minute voice, 2 credits · a song, 5 credits.',
    faqTitle: 'Questions',
    faq: [
      ['How do I sign in?', 'In the app, with no password: you get a code by email. Google, Apple and GitHub are coming soon, then SMS.'],
      ['What happens when I reach my limit?', 'Wait for the 5-hour or weekly window to end, or move up a plan. An answer already started is never cut.'],
      ['Do my media credits expire?', 'No. They stay on your account until you use them.'],
      ['Where is my data?', 'Each account has its own workspace, separate from the others, hosted in Europe.'],
    ],
    footer: 'Baarali is a product of OpenBaara.',
  },
} satisfies Record<Lang, unknown>;

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** "20 €", "13 000 F CFA": whole amounts, the way people write them here. */
export function formatPrice(price: Money, lang: Lang): string {
  const major = price.currency === 'EUR' ? price.amount / 100 : price.amount;
  const n = new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: 2 }).format(major);
  return price.currency === 'EUR' ? (lang === 'fr' ? `${n} €` : `€${n}`) : `${n} F CFA`;
}

const priceOf = (prices: Money[], currency: string) => prices.find((p) => p.currency === currency);

export interface HomeData {
  offers: Offer[];
  /** Week budget per plan id, to show usage relative to Essentiel. */
  weekCredits: Record<string, number>;
  packs: SoldPack[];
  /**
   * Where the installers are (the latest GitHub release, baarali-desktop.yml).
   * Unset until a version is published: the page then offers the account only.
   */
  downloadBase?: string;
}

/** The release's stable file names (baarali-desktop.yml, « Gather the files »). */
export const DOWNLOADS = { macArm: 'Baarali-mac-arm64.dmg', macIntel: 'Baarali-mac-intel.dmg', windows: 'Baarali-windows-setup.exe' } as const;

export function homePage(data: HomeData, opts: { lang: string | null; nonce: string }): string {
  const lang = pickLang(opts.lang);
  const t = STRINGS[lang];
  const base = data.weekCredits.essentiel || 1;
  const ratio = (id: string) => {
    const r = (data.weekCredits[id] ?? 0) / base;
    return r >= 2 ? String(Math.round(r)) : '1';
  };

  const download = data.downloadBase
    ? `
<section id="telecharger" aria-labelledby="download">
  <h2 id="download">${escape(t.downloadTitle)}</h2>
  <p class="sub">${escape(t.downloadLead)}</p>
  <div class="ctas">${(['macArm', 'macIntel', 'windows'] as const)
    .map((k) => `<a class="button${k === 'macArm' ? ' primary' : ''}" href="${escape(`${data.downloadBase}/${DOWNLOADS[k]}`)}">${escape(t[k])}</a>`)
    .join('')}</div>
  <p class="fine">${escape(t.macNote)} ${escape(t.phoneNote)}</p>
</section>`
    : '';

  const priceBlock = (offer: Offer) => {
    if (offer.billing.kind === 'free') return `<p class="price"><strong>${escape(t.free)}</strong></p>`;
    const eur = priceOf(offer.billing.prices, 'EUR');
    const cfa = priceOf(offer.billing.prices, 'XOF');
    const per = offer.billing.period === 'week' ? t.perWeek : t.perMonth;
    return `<p class="price"><strong>${eur ? escape(formatPrice(eur, lang)) : ''}</strong> <span>${escape(per)}</span></p>
      ${cfa ? `<p class="cfa">${escape(formatPrice(cfa, lang))}</p>` : ''}`;
  };

  const card = (offer: Offer, extra = '') => {
    const copy = t.plans[offer.id] ?? t.plans.pro;
    const featured = offer.id === 'essentiel' ? ' featured' : '';
    return `<article class="plan${featured}">
      <p class="tag">${escape(copy.tag)}</p>
      <h3>${escape(offer.displayName)}</h3>
      ${extra || priceBlock(offer)}
      <ul>${copy.points.map((p) => `<li>${escape(p)}</li>`).join('')}</ul>
      ${offer.billing.kind === 'free' ? `<a class="button primary" href="/auth/v1/sign-in">${escape(t.start)}</a>` : `<p class="note">${escape(t.payment)}</p>`}
    </article>`;
  };

  const pros = data.offers.filter((o) => o.category === 'pro');
  const others = data.offers.filter((o) => o.category !== 'pro');
  // Pro is one card with a level choice, like the levels of a single plan.
  const proCard = pros.length
    ? card(pros[0], `<div class="levels" role="radiogroup" aria-label="${escape(t.proChoice)}">
        ${pros.map((o, i) => `<button type="button" role="radio" aria-checked="${i === 0}" data-level="${i}">${escape(o.billing.kind === 'paid' ? formatPrice(priceOf(o.billing.prices, 'EUR')!, lang) : '')}</button>`).join('')}
      </div>
      ${pros.map((o, i) => `<div class="level" data-level="${i}"${i === 0 ? '' : ' hidden'}>${priceBlock(o)}<p class="usage">${escape(t.usage(ratio(o.id)))}</p></div>`).join('')}`)
    : '';

  const packs = data.packs
    .map((p) => {
      const eur = priceOf(p.prices, 'EUR');
      const cfa = priceOf(p.prices, 'XOF');
      return `<li><strong>${p.credits} ${escape(t.credits)}</strong><span>${eur ? escape(formatPrice(eur, lang)) : ''}${cfa ? ` · ${escape(formatPrice(cfa, lang))}` : ''}</span></li>`;
    })
    .join('');

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escape(t.title)}</title>
<meta name="description" content="${escape(t.description)}">
<meta property="og:title" content="${escape(t.title)}">
<meta property="og:description" content="${escape(t.description)}">
<style nonce="${opts.nonce}">
:root { --bg:#f7f7fb; --surface:#ffffff; --ink:#15162a; --muted:#585a73; --line:#e1e2ee; --accent:#3240c8; --on-accent:#ffffff; --mango:#ffb21e; --soft:#eef0ff; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --bg:#0e0f1a; --surface:#171829; --ink:#f1f1f8; --muted:#a7a9c2; --line:#2a2c45; --accent:#8b95ff; --on-accent:#0e0f1a; --mango:#ffc350; --soft:#1d1f38; color-scheme: dark; } }
* { box-sizing:border-box; }
[hidden] { display:none !important; }
html { scroll-behavior:smooth; }
body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
a { color:inherit; }
.wrap { max-width:1080px; margin:0 auto; padding-inline:20px; }
header { display:flex; align-items:center; justify-content:space-between; gap:16px; padding-block:18px; }
.brand { font-weight:800; font-size:20px; letter-spacing:-.02em; text-decoration:none; display:flex; align-items:center; gap:10px; }
.brand i { width:14px; height:14px; border-radius:50%; background:var(--mango); box-shadow:10px 0 0 var(--accent); margin-right:10px; }
nav { display:flex; gap:18px; align-items:center; font-size:15px; }
nav a { text-decoration:none; color:var(--muted); }
nav a.button { color:var(--ink); }
.button { display:inline-flex; align-items:center; justify-content:center; padding:12px 18px; border-radius:12px; border:1px solid var(--line); font-weight:650; text-decoration:none; background:var(--surface); }
.button.primary { background:var(--accent); color:var(--on-accent); border-color:var(--accent); }
.hero { padding-block:72px 56px; max-width:760px; }
.eyebrow { display:inline-block; font-size:13px; font-weight:650; letter-spacing:.04em; text-transform:uppercase; color:var(--accent); background:var(--soft); padding:4px 10px; border-radius:999px; }
h1 { font-size:clamp(36px, 6vw, 60px); line-height:1.05; letter-spacing:-.03em; margin:18px 0; text-wrap:balance; }
.lead { font-size:19px; color:var(--muted); max-width:62ch; margin:0 0 28px; }
.ctas { display:flex; flex-wrap:wrap; gap:12px; }
section { padding-block:56px; border-top:1px solid var(--line); }
h2 { font-size:clamp(26px, 4vw, 36px); letter-spacing:-.02em; margin:0 0 10px; text-wrap:balance; }
.sub { color:var(--muted); margin:0 0 32px; max-width:62ch; }
.features { display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:28px; }
.features h3 { margin:0 0 6px; font-size:17px; }
.features p { margin:0; color:var(--muted); }
.plans { display:grid; grid-template-columns:repeat(auto-fit, minmax(230px, 1fr)); gap:16px; align-items:start; }
.plan { background:var(--surface); border:1px solid var(--line); border-radius:18px; padding:24px; display:grid; gap:12px; }
.plan.featured { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent); }
.plan h3 { margin:0; font-size:22px; }
.tag { margin:0; font-size:13px; font-weight:650; color:var(--accent); }
.price { margin:0; font-variant-numeric:tabular-nums; }
.price strong { font-size:32px; letter-spacing:-.02em; }
.price span, .cfa, .usage, .note { color:var(--muted); font-size:14px; }
.cfa, .usage, .note { margin:0; }
.plan ul { margin:0; padding-left:18px; display:grid; gap:6px; }
.levels { display:flex; gap:6px; background:var(--soft); padding:4px; border-radius:12px; }
.levels button { flex:1; font:inherit; font-weight:650; border:0; border-radius:9px; padding:8px; background:transparent; color:var(--muted); cursor:pointer; }
.levels button[aria-checked="true"] { background:var(--surface); color:var(--ink); box-shadow:0 1px 3px rgb(0 0 0 / .12); }
.fine { color:var(--muted); font-size:14px; margin:20px 0 0; }
.packs { list-style:none; padding:0; margin:0 0 16px; display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px; }
.packs li { background:var(--surface); border:1px solid var(--line); border-radius:14px; padding:18px; display:grid; gap:4px; font-variant-numeric:tabular-nums; }
.packs strong { font-size:20px; }
.packs span { color:var(--muted); font-size:14px; }
details { border-bottom:1px solid var(--line); padding-block:16px; }
summary { cursor:pointer; font-weight:650; }
details p { color:var(--muted); margin:10px 0 0; max-width:70ch; }
footer { padding-block:40px; color:var(--muted); font-size:14px; border-top:1px solid var(--line); }
:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
</style>
</head>
<body>
<div class="wrap">
<header>
  <a class="brand" href="/"><i aria-hidden="true"></i>Baarali</a>
  <nav><a href="#tarifs">${escape(t.navPrices)}</a><a class="button" href="/auth/v1/sign-in">${escape(t.navSignIn)}</a></nav>
</header>
<main>
<div class="hero">
  <span class="eyebrow">${escape(t.eyebrow)}</span>
  <h1>${escape(t.hero)}</h1>
  <p class="lead">${escape(t.lead)}</p>
  <div class="ctas">${
    data.downloadBase
      ? `<a class="button primary" href="#telecharger">${escape(t.download)}</a>`
      : `<a class="button primary" href="/auth/v1/sign-in">${escape(t.start)}</a>`
  }<a class="button" href="#tarifs">${escape(t.seePrices)}</a></div>
</div>${download}
<section aria-labelledby="features">
  <h2 id="features">${escape(t.featuresTitle)}</h2>
  <div class="features">${t.features.map(([h, p]) => `<div><h3>${escape(h)}</h3><p>${escape(p)}</p></div>`).join('')}</div>
</section>
<section id="tarifs" aria-labelledby="prices">
  <h2 id="prices">${escape(t.pricesTitle)}</h2>
  <p class="sub">${escape(t.pricesLead)}</p>
  <div class="plans">${others.map((o) => card(o)).join('')}${proCard}</div>
  <p class="fine">${escape(t.taxes)}</p>
</section>
<section aria-labelledby="media">
  <h2 id="media">${escape(t.mediaTitle)}</h2>
  <p class="sub">${escape(t.mediaLead)}</p>
  <ul class="packs">${packs}</ul>
  <p class="fine">${escape(t.examples)}</p>
</section>
<section aria-labelledby="faq">
  <h2 id="faq">${escape(t.faqTitle)}</h2>
  ${t.faq.map(([q, a]) => `<details><summary>${escape(q)}</summary><p>${escape(a)}</p></details>`).join('')}
</section>
</main>
<footer>© ${new Date().getFullYear()} · ${escape(t.footer)}</footer>
</div>
<script nonce="${opts.nonce}">
"use strict";
for (const b of document.querySelectorAll(".levels button")) {
  b.addEventListener("click", () => {
    for (const o of document.querySelectorAll(".levels button")) o.setAttribute("aria-checked", String(o === b));
    for (const l of document.querySelectorAll(".level")) l.hidden = l.dataset.level !== b.dataset.level;
  });
}
</script>
</body>
</html>`;
}
