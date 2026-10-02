import { ANNUAL_DISCOUNT } from './catalog.js';
import { formatPrice, type HomeData } from './home-page.js';
import { CONTACT, legalLinks } from './legal-page.js';
import { FAVICON, logoTile, logoWord, LOGO_ALIVE_CSS, LOGO_ALIVE_JS, logoTileLive } from './logo.js';
import type { Money, Offer } from './pricing.js';
import { pickLang } from './sign-in-page.js';

// The pricing page of baarali.com (decided 01/10/2026): every plan side by
// side, in CFA francs or euros at a click, how the usage renews, what media
// credits buy, and how one pays. The figures come from the catalog
// (catalog.ts, the same data as the home page), never from this file. What
// we keep on a plan is never shown here.

type Lang = 'fr' | 'en';

export const PRICING_PATH = '/tarifs';

/** "10", from the catalog: every mention of the yearly discount follows it. */
const OFF = String(Math.round(ANNUAL_DISCOUNT * 100));

const STRINGS = {
  fr: {
    title: 'Tarifs — Baarali',
    description: 'Les forfaits de Baarali, en F CFA comme en euros : gratuit pour essayer, à la semaine, au mois, ou Pro.',
    home: 'Accueil',
    prices: 'Tarifs',
    questions: 'Questions',
    signIn: 'Se connecter',
    theme: 'Changer de thème : clair ou sombre',
    kicker: 'Tarifs',
    heading: ['Un prix clair, ', 'en F CFA', ' comme en euros.'],
    lead: 'Commencez gratuitement, sans carte. Passez à un forfait quand Baarali travaille assez pour vous.',
    currency: 'Afficher les prix en',
    pills: ['Gratuit pour commencer', 'Sans engagement', 'Prix fixes, hors taxes'],
    perWeek: 'par semaine',
    perMonth: 'par mois',
    free: 'Gratuit',
    forever: 'pour toujours',
    popular: 'Le plus choisi',
    proChoice: 'Choisissez votre niveau',
    usage: (x: string) => `Utilisation ×${x} par rapport à Essentiel`,
    start: 'Créer mon compte gratuit',
    soon: 'Paiement bientôt disponible',
    // What each plan changes; what Baarali does is the same on every plan
    // (only the models and the usage differ, catalog.ts).
    plans: {
      decouverte: { tag: 'Pour essayer', for: 'Pour découvrir Baarali sur de vraies tâches.', plus: 'Inclus', points: ['Des recherches sur le web, résumées avec leurs sources', 'Emails, devis et comptes rendus rédigés dans votre ton', 'Documents, tableaux et présentations prêts à envoyer', 'Votre accord avant chaque envoi ou publication', 'Les tâches longues en arrière-plan, et les routines', 'Une mémoire : vos clients, vos prix, vos habitudes', 'Vidéos, voix et musique avec des crédits médias', 'Les apps Mac et Windows', 'Des modèles rapides et économiques', 'Une utilisation limitée, renouvelée toutes les 5 h et chaque semaine'] },
      semaine: { tag: 'Sans engagement', for: 'Pour une semaine chargée, payée en Mobile Money.', plus: 'Tout Découverte, et :', points: ['Tous les modèles, dont les plus puissants', 'L’utilisation d’Essentiel pendant 7 jours', '25 fois l’utilisation de Découverte', 'Payé en Mobile Money, quand vous en avez besoin', 'Rien ne se renouvelle tout seul'] },
      essentiel: { tag: 'Le quotidien', for: 'Pour s’en servir chaque jour, au travail ou chez soi.', plus: 'Tout Découverte, et :', points: ['Tous les modèles, dont les plus puissants', '25 fois l’utilisation de Découverte', 'Assez pour s’en servir tous les jours', 'De la marge pour les tâches longues', `Au mois, ou à l’année avec ${OFF} % de remise`] },
      pro: { tag: 'Pour les gros besoins', for: 'Pour travailler toute la journée avec lui.', plus: 'Tout Essentiel, et :', points: ['Cinq ou dix fois l’utilisation d’Essentiel', 'Pour les tâches longues et les routines de chaque jour', 'Pour une personne qui délègue beaucoup', 'Les médias toujours avec des crédits', `Au mois, ou à l’année avec ${OFF} % de remise`] },
    } as Record<string, { tag: string; for: string; plus: string; points: string[] }>,
    period: 'Paiement',
    monthly: 'Au mois',
    yearly: 'À l’année',
    save: `−${OFF} %`,
    perMonthYear: 'par mois, à l’année',
    billedYear: (total: string, saved: string) => `${total} par an · ${saved} économisés`,
    weekOnly: 'À la semaine seulement',
    proYear: 'Pro à l’année',
    bizKicker: 'Entreprises et institutions',
    bizTitle: ['Votre Baarali, ', 'chez vous', '.'],
    bizLead: 'Pour les banques, les institutions financières, les administrations et les grandes organisations : Baarali installé sur vos serveurs ou dans votre cloud, sous votre contrôle.',
    bizFor: ['Banques et institutions financières', 'Administrations et ministères', 'Grandes entreprises', 'ONG et organisations internationales'],
    bizPoints: [
      ['Votre propre instance', 'Sur vos serveurs, dans votre centre de données ou chez l’hébergeur de votre choix, dans votre pays.'],
      ['Vos données restent chez vous', 'Documents, mémoire et échanges ne quittent pas votre infrastructure.'],
      ['Vos modèles', 'Des modèles ouverts installés chez vous, ou ceux que votre politique autorise.'],
      ['Vos règles d’accord', 'Ce que les agents font seuls et ce qui attend une validation, fixé par vos équipes.'],
      ['Toute votre équipe', 'Des comptes pour chaque collaborateur, des agents partagés par service.'],
      ['Accompagnement', 'Installation, formation des équipes et contrat sur mesure.'],
    ] as Array<[string, string]>,
    bizPrice: 'Sur devis',
    bizCta: 'Parler à l’équipe',
    bizNote: 'Nous étudions chaque demande avec vos équipes techniques et juridiques.',
    usageKicker: 'L’utilisation',
    usageTitle: ['Deux jauges, ', 'pas de compteur', ' à surveiller.'],
    usageLead: 'Chaque forfait donne une part d’utilisation qui se renouvelle d’elle-même. Vous la voyez dans l’app, à tout moment.',
    gaugeFive: 'Ces 5 heures',
    gaugeWeek: 'Cette semaine',
    gaugeFiveNote: 'Se renouvelle dans 2 h 14',
    gaugeWeekNote: 'Se renouvelle lundi',
    gaugeExample: 'Démonstration',
    demoTasks: [['Devis pour Awa Traoré', 9], ['Veille sur le cajou', 16], ['Présentation pour la banque', 22], ['Relance de 12 factures', 12], ['Compte rendu de réunion', 8], ['Analyse des ventes du mois', 18], ['Publication de lancement', 15]] as Array<[string, number]>,
    demoLimit: 'Limite atteinte : la réponse en cours se termine.',
    demoLater: '5 heures plus tard, la jauge repart de zéro.',
    renewIn: 'Se renouvelle dans',
    steps: [
      ['Toutes les 5 heures', 'Une première jauge se remplit pendant que vous travaillez, et repart de zéro 5 heures après.'],
      ['Chaque semaine', 'Une seconde jauge couvre la semaine entière, pour que l’utilisation reste régulière.'],
      ['À la limite', 'Attendez la fin de la fenêtre ou passez au forfait du dessus. Une réponse commencée n’est jamais coupée.'],
    ],
    compareKicker: 'Comparer',
    compareTitle: ['Tout, ', 'en un coup d’œil', '.'],
    rows: {
      price: 'Prix',
      billing: 'Paiement',
      models: 'Modèles',
      usage: 'Utilisation',
      windows: 'Jauges 5 h et semaine',
      media: 'Vidéos, voix, musique',
      approval: 'Votre accord avant chaque envoi',
      apps: 'Apps Mac et Windows',
      space: 'Espace personnel, hébergé en Europe',
    },
    billingNone: 'Aucun',
    billingWeek: 'Chaque semaine, à la main',
    billingMonth: `Au mois ou à l’année (−${OFF} %)`,
    modelsFast: 'Rapides et économiques',
    modelsAll: 'Tous',
    usageLimited: 'Limitée',
    usageBase: 'Référence',
    usageX: (x: string) => `×${x}`,
    mediaCredits: 'Avec des crédits',
    yes: 'Inclus',
    mediaKicker: 'Crédits médias',
    mediaTitle: ['Les médias, ', 'à la demande', '.'],
    mediaLead: 'Vidéos, voix et musique se paient avec des crédits, à part du forfait. Ils restent sur votre compte jusqu’à ce que vous les utilisiez.',
    credits: 'crédits',
    costTitle: 'Ce que coûte une création',
    costs: [
      ['Une vidéo de 5 secondes', 38],
      ['Une musique', 5],
      ['Une voix d’une minute', 2],
    ] as Array<[string, number]>,
    refund: 'Une création qui échoue est remboursée, automatiquement.',
    payKicker: 'Payer',
    payTitle: ['Payez comme ', 'vous payez déjà', '.'],
    pay: [
      ['Mobile Money', 'Le moyen le plus simple ici. Le forfait Semaine est fait pour lui : vous payez, il dure sept jours.'],
      ['Carte bancaire', 'Pour les forfaits au mois, depuis n’importe quel pays.'],
      ['F CFA ou euros', 'Des prix fixes dans les deux monnaies, jamais recalculés au taux du jour.'],
    ],
    paySoon: 'Le paiement en ligne arrive bientôt. D’ici là, le forfait Découverte est ouvert à tous.',
    faqKicker: 'Questions',
    faqTitle: ['Ce qu’on ', 'nous demande', '.'],
    faq: [
      ['Faut-il une carte pour commencer ?', 'Non. Le forfait Découverte est gratuit : votre email suffit.'],
      ['Puis-je changer de forfait ?', 'Oui, quand vous voulez, vers le haut comme vers le bas.'],
      ['Pourquoi un forfait à la semaine ?', 'Parce que le Mobile Money ne se prélève pas tout seul chaque mois. Vous payez une semaine, quand vous en avez besoin.'],
      ['Que se passe-t-il quand j’atteins ma limite ?', 'Attendez la fin des 5 heures ou de la semaine, ou passez au forfait du dessus. Une réponse commencée n’est jamais coupée.'],
      ['Mes crédits médias expirent-ils ?', 'Non. Ils restent sur votre compte jusqu’à ce que vous les utilisiez, même si vous changez de forfait.'],
      ['Les prix incluent-ils les taxes ?', 'Non, les prix sont affichés hors taxes. Les taxes applicables s’ajoutent au paiement.'],
    ],
    finalTitle: ['Commencez ', 'gratuitement', ' aujourd’hui.'],
    finalLead: 'Créez votre compte et confiez-lui une première tâche. Vous changerez de forfait plus tard, si besoin.',
    write: 'Une question sur les prix ?',
  },
  en: {
    title: 'Pricing — Baarali',
    description: 'Baarali’s plans, in CFA francs or euros: free to try, weekly, monthly, or Pro.',
    home: 'Home',
    prices: 'Pricing',
    questions: 'Questions',
    signIn: 'Sign in',
    theme: 'Switch theme: light or dark',
    kicker: 'Pricing',
    heading: ['Clear prices, ', 'in CFA francs', ' or euros.'],
    lead: 'Start free, with no card. Move to a plan once Baarali does enough work for you.',
    currency: 'Show prices in',
    pills: ['Free to start', 'No commitment', 'Fixed prices, excluding taxes'],
    perWeek: 'per week',
    perMonth: 'per month',
    free: 'Free',
    forever: 'forever',
    popular: 'Most chosen',
    proChoice: 'Choose your level',
    usage: (x: string) => `×${x} the usage of Essentiel`,
    start: 'Create my free account',
    soon: 'Payment coming soon',
    plans: {
      decouverte: { tag: 'To try it', for: 'To try Baarali on real tasks.', plus: 'Included', points: ['Web research, summed up with its sources', 'Emails, quotes and minutes written in your tone', 'Documents, spreadsheets and slides ready to send', 'Your approval before anything is sent or published', 'Long tasks in the background, and routines', 'A memory: your clients, your prices, your habits', 'Videos, voices and music with media credits', 'The Mac and Windows apps', 'Fast, low-cost models', 'Limited usage, renewed every 5 h and every week'] },
      semaine: { tag: 'No commitment', for: 'For a busy week, paid with mobile money.', plus: 'Everything in Découverte, and:', points: ['Every model, the most powerful included', 'The usage of Essentiel for 7 days', '25 times the usage of Découverte', 'Paid with mobile money, when you need it', 'Nothing renews on its own'] },
      essentiel: { tag: 'Everyday', for: 'To use it every day, at work or at home.', plus: 'Everything in Découverte, and:', points: ['Every model, the most powerful included', '25 times the usage of Découverte', 'Enough to use it every day', 'Room for long tasks', `Monthly, or yearly with ${OFF}% off`] },
      pro: { tag: 'For heavy use', for: 'To work with it all day long.', plus: 'Everything in Essentiel, and:', points: ['Five or ten times the usage of Essentiel', 'For long tasks and daily routines', 'For someone who delegates a lot', 'Media still with credits', `Monthly, or yearly with ${OFF}% off`] },
    } as Record<string, { tag: string; for: string; plus: string; points: string[] }>,
    period: 'Billing',
    monthly: 'Monthly',
    yearly: 'Yearly',
    save: `−${OFF}%`,
    perMonthYear: 'per month, billed yearly',
    billedYear: (total: string, saved: string) => `${total} a year · ${saved} saved`,
    weekOnly: 'Weekly only',
    proYear: 'Pro yearly',
    bizKicker: 'Companies and institutions',
    bizTitle: ['Your Baarali, ', 'on your premises', '.'],
    bizLead: 'For banks, financial institutions, public administrations and large organisations: Baarali installed on your servers or in your cloud, under your control.',
    bizFor: ['Banks and financial institutions', 'Public administrations and ministries', 'Large companies', 'NGOs and international organisations'],
    bizPoints: [
      ['Your own instance', 'On your servers, in your data centre or with the host of your choice, in your country.'],
      ['Your data stays with you', 'Documents, memory and conversations never leave your infrastructure.'],
      ['Your models', 'Open models installed on your side, or those your policy allows.'],
      ['Your approval rules', 'What agents do alone and what waits for sign-off, set by your teams.'],
      ['Your whole team', 'Accounts for every colleague, agents shared by department.'],
      ['Support', 'Installation, team training and a tailored contract.'],
    ] as Array<[string, string]>,
    bizPrice: 'On quote',
    bizCta: 'Talk to the team',
    bizNote: 'We study each request with your technical and legal teams.',
    usageKicker: 'Usage',
    usageTitle: ['Two gauges, ', 'no meter', ' to watch.'],
    usageLead: 'Each plan gives a share of usage that renews by itself. You see it in the app, at any time.',
    gaugeFive: 'These 5 hours',
    gaugeWeek: 'This week',
    gaugeFiveNote: 'Renews in 2 h 14',
    gaugeWeekNote: 'Renews on Monday',
    gaugeExample: 'Demonstration',
    demoTasks: [['Quote for Awa Traoré', 9], ['Cashew price watch', 16], ['Deck for the bank', 22], ['Chasing 12 invoices', 12], ['Meeting minutes', 8], ['This month’s sales analysis', 18], ['Launch post', 15]] as Array<[string, number]>,
    demoLimit: 'Limit reached: the answer under way still finishes.',
    demoLater: '5 hours later, the gauge starts again from zero.',
    renewIn: 'Renews in',
    steps: [
      ['Every 5 hours', 'A first gauge fills while you work, and starts again from zero 5 hours later.'],
      ['Every week', 'A second gauge covers the whole week, so usage stays steady.'],
      ['At the limit', 'Wait for the window to end or move up a plan. An answer already started is never cut.'],
    ],
    compareKicker: 'Compare',
    compareTitle: ['Everything, ', 'at a glance', '.'],
    rows: {
      price: 'Price',
      billing: 'Payment',
      models: 'Models',
      usage: 'Usage',
      windows: '5-hour and weekly gauges',
      media: 'Videos, voices, music',
      approval: 'Your approval before anything is sent',
      apps: 'Mac and Windows apps',
      space: 'Personal workspace, hosted in Europe',
    },
    billingNone: 'None',
    billingWeek: 'Each week, by hand',
    billingMonth: `Monthly or yearly (−${OFF}%)`,
    modelsFast: 'Fast and low-cost',
    modelsAll: 'All',
    usageLimited: 'Limited',
    usageBase: 'Reference',
    usageX: (x: string) => `×${x}`,
    mediaCredits: 'With credits',
    yes: 'Included',
    mediaKicker: 'Media credits',
    mediaTitle: ['Media, ', 'on demand', '.'],
    mediaLead: 'Videos, voices and music are paid with credits, separate from the plan. They stay on your account until you use them.',
    credits: 'credits',
    costTitle: 'What one creation costs',
    costs: [
      ['A 5-second video', 38],
      ['A song', 5],
      ['A one-minute voice', 2],
    ] as Array<[string, number]>,
    refund: 'A creation that fails is refunded, automatically.',
    payKicker: 'Paying',
    payTitle: ['Pay the way ', 'you already pay', '.'],
    pay: [
      ['Mobile money', 'The simplest way here. The Semaine plan is made for it: you pay, it lasts seven days.'],
      ['Bank card', 'For the monthly plans, from any country.'],
      ['CFA francs or euros', 'Fixed prices in both currencies, never recomputed at the day’s rate.'],
    ],
    paySoon: 'Online payment is coming soon. Until then, the Découverte plan is open to everyone.',
    faqKicker: 'Questions',
    faqTitle: ['What people ', 'ask us', '.'],
    faq: [
      ['Do I need a card to start?', 'No. The Découverte plan is free: your email is enough.'],
      ['Can I change plans?', 'Yes, whenever you want, up or down.'],
      ['Why a weekly plan?', 'Because mobile money cannot be debited automatically every month. You pay for a week, when you need it.'],
      ['What happens when I reach my limit?', 'Wait for the 5 hours or the week to end, or move up a plan. An answer already started is never cut.'],
      ['Do my media credits expire?', 'No. They stay on your account until you use them, even if you change plans.'],
      ['Do prices include taxes?', 'No, prices are shown excluding taxes. Applicable taxes are added at payment.'],
    ],
    finalTitle: ['Start ', 'for free', ' today.'],
    finalLead: 'Create your account and hand it a first task. You can change plans later, if you need to.',
    write: 'A question about pricing?',
  },
} satisfies Record<Lang, unknown>;

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const titled = ([a, em, b]: string[]) => `${escape(a)}<em>${escape(em)}</em>${escape(b)}`;

const priceOf = (prices: Money[], currency: string) => prices.find((p) => p.currency === currency);

/** "13 000" big, "F CFA" small: a long CFA price must still fit a card. */
function amount(price: Money, lang: Lang): string {
  const full = formatPrice(price, lang);
  const unit = price.currency === 'EUR' ? '€' : 'F CFA';
  // Digits and the group separators only: the units carry no-break spaces.
  const number = full.replace(/[^\d\s\u00a0\u202f.,]/g, '').trim();
  return price.currency === 'EUR' && lang === 'en'
    ? `<small>€</small>${escape(number)}`
    : `${escape(number)}<small>${escape(unit)}</small>`;
}

/** The same price in both currencies; the page shows the one chosen. */
function both(prices: Money[], lang: Lang, render: (p: Money) => string): string {
  const cfa = priceOf(prices, 'XOF');
  const eur = priceOf(prices, 'EUR');
  return `${cfa ? `<span class="c-xof">${render(cfa)}</span>` : ''}${eur ? `<span class="c-eur">${render(eur)}</span>` : ''}`;
}

const SUN = '<svg class="i sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>';
const MOON = '<svg class="i moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
const CHECK = '<svg class="i ok" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const PAY_ICONS = [
  '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>',
  '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 10h19M6.5 15h4"/></svg>',
  '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M15 9.2c-.6-1-1.7-1.6-3-1.6-1.7 0-3 1-3 2.3 0 3 6 1.5 6 4.3 0 1.3-1.3 2.3-3 2.3-1.3 0-2.5-.6-3-1.6M12 6v1.6M12 16.4V18"/></svg>',
];

export function pricingPage(data: HomeData, opts: { lang: string | null; nonce: string }): string {
  const lang: Lang = pickLang(opts.lang);
  const t = STRINGS[lang];

  const base = data.weekCredits.essentiel || 1;
  const ratio = (id: string) => {
    const r = (data.weekCredits[id] ?? 0) / base;
    return r >= 2 ? String(Math.round(r)) : '1';
  };

  const other = (prices: Money[], p: Money) => (p.currency === 'EUR' ? priceOf(prices, 'XOF') : priceOf(prices, 'EUR')) ?? p;
  const shown = (prices: Money[], per: string) =>
    `<p class="price"><strong>${both(prices, lang, (p) => amount(p, lang))}</strong><span>${escape(per)}</span></p>
      <p class="alt">${both(prices, lang, (p) => escape(formatPrice(other(prices, p), lang)))}</p>`;
  // A year of a monthly plan: the month's price less the discount, to the
  // cent or the franc, twelve times.
  const yearly = (prices: Money[]) => prices.map((p) => ({ ...p, amount: Math.round(p.amount * (1 - ANNUAL_DISCOUNT)) }));
  const times = (prices: Money[], n: number) => prices.map((p) => ({ ...p, amount: p.amount * n }));
  const minus = (a: Money[], b: Money[]) => a.map((p, i) => ({ ...p, amount: p.amount - b[i].amount }));
  const priceBlock = (offer: Offer) => {
    if (offer.billing.kind === 'free') return `<p class="price"><strong>${escape(t.free)}</strong><span>${escape(t.forever)}</span></p><p class="alt">&nbsp;</p>`;
    const prices = offer.billing.prices;
    if (offer.billing.period === 'week') return `${shown(prices, t.perWeek)}<p class="note-y">${escape(t.weekOnly)}</p>`;
    const year = yearly(prices);
    const total = times(year, 12);
    const saved = minus(times(prices, 12), total);
    return `<div class="p-month">${shown(prices, t.perMonth)}</div>
      <div class="p-year">${shown(year, t.perMonthYear)}<p class="note-y">${both(total, lang, (p) => escape(t.billedYear(formatPrice(p, lang), formatPrice(saved[total.indexOf(p)], lang))))}</p></div>`;
  };

  const card = (offer: Offer, extra = '') => {
    const copy = t.plans[offer.id] ?? t.plans.pro;
    const featured = offer.id === 'essentiel';
    return `<article class="plan${featured ? ' featured' : ''}">
      ${featured ? `<p class="badge">${escape(t.popular)}</p>` : ''}
      <p class="tag">${escape(copy.tag)}</p>
      <h3>${escape(offer.displayName)}</h3>
      <p class="for">${escape(copy.for)}</p>
      ${extra || priceBlock(offer)}
      ${offer.billing.kind === 'free' ? `<a class="cta cta-blue" href="/auth/v1/sign-in">${escape(t.start)}</a>` : `<p class="cta cta-off" aria-disabled="true">${escape(t.soon)}</p>`}
      <p class="plus">${escape(copy.plus)}</p>
      <ul>${copy.points.map((p) => `<li>${CHECK}${escape(p)}</li>`).join('')}</ul>
    </article>`;
  };

  const pros = data.offers.filter((o) => o.category === 'pro');
  const others = data.offers.filter((o) => o.category !== 'pro');
  const proCard = pros.length
    ? card(pros[0], `<div class="levels" role="radiogroup" aria-label="${escape(t.proChoice)}">
        ${pros.map((o, i) => `<button type="button" role="radio" aria-checked="${i === 0}" data-level="${i}">${o.billing.kind === 'paid' ? both(o.billing.prices, lang, (p) => escape(formatPrice(p, lang))) : ''}</button>`).join('')}
      </div>
      ${pros.map((o, i) => `<div class="level" data-level="${i}"${i === 0 ? '' : ' hidden'}>${priceBlock(o)}<p class="usage">${escape(t.usage(ratio(o.id)))}</p></div>`).join('')}`)
    : '';

  // The comparison: one column per plan, Pro shown with both levels.
  const columns = [...others, ...pros.slice(0, 1)];
  const cell = (o: Offer, row: keyof typeof t.rows): string => {
    switch (row) {
      case 'price':
        if (o.billing.kind === 'free') return escape(t.free);
        if (o.category === 'pro') return pros.map((p) => (p.billing.kind === 'paid' ? both(p.billing.prices, lang, (m) => escape(formatPrice(m, lang))) : '')).join(' · ');
        return both(o.billing.prices, lang, (m) => escape(formatPrice(m, lang)));
      case 'billing':
        return escape(o.billing.kind === 'free' ? t.billingNone : o.billing.period === 'week' ? t.billingWeek : t.billingMonth);
      case 'models':
        return escape(o.category === 'free' ? t.modelsFast : t.modelsAll);
      case 'usage':
        if (o.category === 'free') return escape(t.usageLimited);
        if (o.category === 'pro') return escape(pros.map((p) => t.usageX(ratio(p.id))).join(' · '));
        return escape(t.usageBase);
      case 'media':
        return escape(t.mediaCredits);
      default:
        return `${CHECK}<span class="sr">${escape(t.yes)}</span>`;
    }
  };
  const table = `<table>
    <thead><tr><td></td>${columns.map((o) => `<th scope="col"${o.id === 'essentiel' ? ' class="hl"' : ''}>${escape(o.displayName)}</th>`).join('')}</tr></thead>
    <tbody>${(Object.keys(t.rows) as Array<keyof typeof t.rows>)
      .map((r) => `<tr><th scope="row">${escape(t.rows[r])}</th>${columns.map((o) => `<td${o.id === 'essentiel' ? ' class="hl"' : ''}>${cell(o, r)}</td>`).join('')}</tr>`)
      .join('')}</tbody>
  </table>`;

  const packs = data.packs
    .map((p, i) => `<li${i === 1 ? ' class="mid"' : ''}><strong>${p.credits}</strong><span class="u">${escape(t.credits)}</span><span class="pp">${both(p.prices, lang, (m) => escape(formatPrice(m, lang)))}</span></li>`)
    .join('');

  const legal = legalLinks(opts.lang);

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escape(t.title)}</title>
<meta name="description" content="${escape(t.description)}">
<meta property="og:title" content="${escape(t.title)}">
<meta property="og:description" content="${escape(t.description)}">
<link rel="icon" href="${FAVICON}">
<script nonce="${opts.nonce}">
try { const v = localStorage.getItem("baarali-theme"); if (v === "light" || v === "dark") document.documentElement.dataset.theme = v; } catch {}
try { if (localStorage.getItem("baarali-currency") === "eur") document.documentElement.dataset.currency = "eur"; } catch {}
</script>
<style nonce="${opts.nonce}">
@font-face { font-family:"Inter"; src:url(/assets/inter.woff2) format("woff2"); font-weight:400 800; font-display:swap; }
@font-face { font-family:"Source Serif 4"; src:url(/assets/source-serif-4.woff2) format("woff2"); font-weight:400 700; font-style:normal; font-display:swap; }
/* The home page's palette and type (home-page.ts), in both themes. */
:root { --paper:#ffffff; --mist:#f5f5f5; --surface:#ffffff; --line:#e7e7e7; --ink:#0d0d0d; --on-ink:#ffffff; --text:#2b2b2b; --muted:#5d5d5d; --blue:#1a6dff; --blue-deep:#155eef; --blue-soft:#eef3ff; --blue-line:#d3e0ff; --top-bg:rgb(255 255 255 / .85); --night:#f5f5f5; --night-line:#e7e7e7; --night-muted:#5d5d5d; --featured:#ffffff; --featured-line:#155eef; --track:#e5e5e5; --night-2:#ffffff; --surface-2:#fafafa; --dot:#e3e3e3; --skeleton:#e0e0e0; --hover-line:#cfcfcf; --glass:rgb(255 255 255 / .7); color-scheme:light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --paper:#212121; --mist:#1a1a1a; --surface:#2a2a2a; --line:#333333; --ink:#ececec; --on-ink:#0d0d0d; --text:#d4d4d4; --muted:#a6a6a6; --blue:#4d8dff; --blue-deep:#1a6dff; --blue-soft:#1d2738; --blue-line:#2f4670; --top-bg:rgb(33 33 33 / .85); --night:#1a1a1a; --featured:#2a2a2a; --featured-line:#4d8dff; --track:#3a3a3a; --night-2:#2a2a2a; --night-line:#333333; --night-muted:#a6a6a6; --surface-2:#262626; --dot:#3a3a3a; --skeleton:#3a3a3a; --hover-line:#474747; --glass:rgb(42 42 42 / .7); color-scheme:dark; } }
:root[data-theme="dark"] { --paper:#212121; --mist:#1a1a1a; --surface:#2a2a2a; --line:#333333; --ink:#ececec; --on-ink:#0d0d0d; --text:#d4d4d4; --muted:#a6a6a6; --blue:#4d8dff; --blue-deep:#1a6dff; --blue-soft:#1d2738; --blue-line:#2f4670; --top-bg:rgb(33 33 33 / .85); --night:#1a1a1a; --featured:#2a2a2a; --featured-line:#4d8dff; --track:#3a3a3a; --night-2:#2a2a2a; --night-line:#333333; --night-muted:#a6a6a6; --surface-2:#262626; --dot:#3a3a3a; --skeleton:#3a3a3a; --hover-line:#474747; --glass:rgb(42 42 42 / .7); color-scheme:dark; }
* { box-sizing:border-box; }
html { scroll-behavior:smooth; scroll-padding-top:88px; }
body { margin:0; background:var(--paper); color:var(--text); font:16px/1.6 "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing:antialiased; }
a { color:inherit; }
.wrap { max-width:1180px; margin:0 auto; padding-inline:20px; }
.sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
.i { width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; flex:none; }
/* One currency at a time: CFA francs unless the reader chose euros. */
.c-eur, :root[data-currency="eur"] .c-xof { display:none; }
:root[data-currency="eur"] .c-eur { display:inline; }
.top { position:sticky; top:env(safe-area-inset-top, 0px); z-index:20; background:var(--top-bg); backdrop-filter:saturate(1.6) blur(14px); -webkit-backdrop-filter:saturate(1.6) blur(14px); border-bottom:1px solid var(--line); }
.top .wrap { display:flex; align-items:center; justify-content:space-between; gap:16px; min-height:68px; }
.brand { display:flex; align-items:center; gap:10px; color:var(--ink); text-decoration:none; }
.menu { display:flex; align-items:center; gap:10px; font-size:14.5px; }
.menu a { text-decoration:none; color:var(--muted); padding:8px 10px; }
.menu a:hover, .menu a[aria-current] { color:var(--ink); }
.menu .btn { color:var(--on-ink); background:var(--ink); border-radius:999px; padding:9px 16px; font-weight:650; }
.theme { display:inline-flex; align-items:center; justify-content:center; width:40px; height:40px; border-radius:50%; border:1px solid var(--line); background:var(--surface); color:var(--ink); cursor:pointer; padding:0; }
.theme .moon, :root[data-theme="dark"] .theme .sun { display:none; }
:root[data-theme="dark"] .theme .moon { display:block; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .theme .sun { display:none; } :root:not([data-theme="light"]) .theme .moon { display:block; } }
.kicker { display:inline-flex; align-items:center; gap:8px; margin:0 0 14px; font-size:13px; font-weight:650; letter-spacing:.08em; text-transform:uppercase; color:var(--blue-deep); }
.kicker::before { content:""; width:6px; height:6px; border-radius:50%; background:var(--blue); }
h1, h2 { font-family:"Source Serif 4", Georgia, serif; margin:0; color:var(--ink); letter-spacing:-.022em; font-weight:500; text-wrap:balance; }
h1 { font-size:clamp(38px, 6vw, 66px); line-height:1.02; }
h2 { font-size:clamp(30px, 4vw, 44px); line-height:1.08; }
h1 em, h2 em { font-family:inherit; font-style:normal; font-weight:inherit; letter-spacing:inherit; color:var(--blue); }
.lead { margin:16px 0 0; max-width:58ch; color:var(--muted); font-size:18px; }
.section { padding-block:96px 0; }
.head { max-width:720px; }
.head.center { margin-inline:auto; text-align:center; }
.head.center .lead { margin-inline:auto; }
/* Hero */
.hero { position:relative; overflow:hidden; background:var(--mist); border-bottom:1px solid var(--line); padding-block:72px 120px; text-align:center; }
.hero .wrap { position:relative; display:flex; flex-direction:column; align-items:center; }
.hero .lead { margin-inline:auto; }
.switch { display:flex; align-items:center; gap:12px; margin-top:32px; font-size:14px; color:var(--muted); flex-wrap:wrap; justify-content:center; }
.seg { display:inline-flex; gap:4px; background:var(--surface); border:1px solid var(--line); padding:4px; border-radius:999px; }
.seg button { font:inherit; font-weight:650; font-size:14px; border:0; border-radius:999px; padding:8px 16px; background:transparent; color:var(--muted); cursor:pointer; }
.seg button[aria-checked="true"] { background:var(--ink); color:var(--on-ink); }
.pills { display:flex; flex-wrap:wrap; justify-content:center; gap:8px 18px; margin:20px 0 0; padding:0; list-style:none; font-size:14px; color:var(--muted); }
.pills li { display:flex; align-items:center; gap:6px; }
.pills .ok { color:var(--blue); width:16px; height:16px; }
/* Plans */
.plans { position:relative; margin-top:-72px; display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:14px; align-items:start; }
.plan { position:relative; display:flex; flex-direction:column; background:var(--surface); border:1px solid var(--line); border-radius:24px; padding:26px 24px; box-shadow:0 1px 2px rgb(10 20 40 / .04), 0 12px 32px -18px rgb(10 20 40 / .18); }
.plan .tag { margin:0; font-size:13px; font-weight:650; color:var(--blue-deep); }
.plan h3 { font-family:"Source Serif 4", Georgia, serif; font-weight:500; margin:8px 0 0; font-size:28px; letter-spacing:-.015em; color:var(--ink); }
.plan .for { margin:6px 0 0; font-size:14px; color:var(--muted); min-height:44px; }
.price { display:flex; align-items:baseline; flex-wrap:wrap; gap:4px 8px; margin:18px 0 0; }
.price strong { font-size:40px; line-height:1; letter-spacing:-.045em; color:var(--ink); font-variant-numeric:tabular-nums; white-space:nowrap; }
.price strong small { font-size:.45em; letter-spacing:-.01em; margin-left:4px; font-weight:650; }
.price > span { font-size:14px; color:var(--muted); }
.alt { margin:6px 0 0; font-size:13.5px; color:var(--muted); min-height:20px; font-variant-numeric:tabular-nums; }
.usage { margin:4px 0 0; font-size:13.5px; color:var(--blue-deep); font-weight:600; }
.levels { display:flex; gap:4px; background:var(--mist); padding:4px; border-radius:999px; margin-top:14px; }
.levels button { flex:1; font:inherit; font-weight:650; font-size:13.5px; border:0; border-radius:999px; padding:7px 4px; background:transparent; color:var(--muted); cursor:pointer; white-space:nowrap; }
.levels button[aria-checked="true"] { background:var(--ink); color:var(--on-ink); }
.level .price { margin-top:14px; }
.cta { display:flex; align-items:center; justify-content:center; text-align:center; margin:22px 0 0; border-radius:999px; padding:12px 16px; font-weight:650; font-size:15px; text-decoration:none; }
.cta-blue { background:var(--blue-deep); color:#fff; }
.cta-blue:hover { background:var(--blue); }
.cta-off { background:var(--mist); color:var(--muted); border:1px dashed var(--line); font-size:14px; }
.plan ul { list-style:none; margin:22px 0 0; padding:20px 0 0; border-top:1px solid var(--line); display:flex; flex-direction:column; gap:10px; font-size:14.5px; }
.plan li { display:flex; gap:10px; }
.plan li .ok { color:var(--blue); margin-top:2px; }
.plan.featured { background:var(--featured); border:2px solid var(--featured-line); color:var(--text); box-shadow:0 30px 60px -34px rgb(21 94 239 / .45); }
.plan.featured h3, .plan.featured .price strong { color:var(--ink); }
.plan.featured .tag, .plan.featured .usage { color:var(--blue); }
.plan.featured .for, .plan.featured .alt, .plan.featured .price > span { color:var(--muted); }
.plan.featured ul { border-color:var(--night-line); }
.plan.featured li .ok { color:var(--blue); }
.plan.featured .cta-off { background:var(--mist); border-color:var(--night-line); color:var(--muted); }
.badge { position:absolute; top:-12px; left:24px; margin:0; background:var(--blue-deep); color:#fff; font-size:12.5px; font-weight:650; border-radius:999px; padding:4px 12px; }
.fine { margin:20px 0 0; text-align:center; font-size:13.5px; color:var(--muted); }
/* Monthly or yearly: a year shows only on the monthly plans. */
.p-year, :root[data-period="year"] .p-month { display:none; }
:root[data-period="year"] .p-year { display:block; }
.note-y { margin:6px 0 0; font-size:13px; color:var(--blue-deep); font-weight:600; font-variant-numeric:tabular-nums; }
.plan.featured .note-y { color:var(--blue); }
.switches { display:flex; flex-wrap:wrap; justify-content:center; gap:12px 28px; margin-top:32px; }
.switches .switch { margin-top:0; }
.save { font-weight:700; font-size:12px; color:#fff; background:var(--blue-deep); border-radius:999px; padding:2px 7px; margin-left:4px; }
.plus { margin:20px 0 0; padding-top:18px; border-top:1px solid var(--line); font-size:13px; font-weight:650; color:var(--ink); }
.plan.featured .plus { color:var(--ink); border-color:var(--night-line); }
.plan .plus + ul { margin-top:12px; padding-top:0; border-top:0; }
/* Companies */
.biz { margin-top:96px; background:var(--night); border:1px solid var(--night-line); color:var(--night-muted); border-radius:32px; padding:56px 48px; }
.biz h2 { color:var(--ink); }
.biz h2 em { color:var(--blue); }
.biz .kicker { color:var(--blue); }
.biz .lead { color:var(--muted); }
.biz-head { display:grid; grid-template-columns:minmax(0, 1fr) 260px; gap:40px; align-items:end; }
.biz-side { display:flex; flex-direction:column; gap:10px; }
.biz-price { margin:0; color:var(--ink); font-family:"Source Serif 4", Georgia, serif; font-size:32px; font-weight:500; letter-spacing:-.02em; }
.cta-white { background:var(--blue-deep); color:#fff; margin:0; }
.biz-mail { margin:0; font-size:13.5px; }
.biz-for { list-style:none; margin:32px 0 0; padding:0; display:flex; flex-wrap:wrap; gap:8px; }
.biz-for li { border:1px solid var(--night-line); border-radius:999px; padding:6px 14px; font-size:14px; color:var(--text); }
.biz-grid { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:1px; margin-top:32px; background:var(--night-line); border:1px solid var(--night-line); border-radius:20px; overflow:hidden; }
.biz-grid div { background:var(--night-2); padding:22px; }
.biz-grid b { display:block; color:var(--ink); font-size:16px; margin-bottom:4px; }
.biz-grid p { margin:0; font-size:14.5px; line-height:1.55; }
.biz-note { margin:20px 0 0; font-size:13.5px; }
/* Usage */
.usage-grid { display:grid; grid-template-columns:minmax(0, 1fr) minmax(0, 1fr); gap:48px; align-items:center; margin-top:48px; }
.gauges { background:var(--mist); border:1px solid var(--line); border-radius:24px; padding:28px; display:flex; flex-direction:column; gap:22px; }
.live { display:inline-block; width:8px; height:8px; border-radius:50%; background:#22c55e; margin-right:8px; box-shadow:0 0 0 3px rgb(34 197 94 / .2); animation:pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 50% { opacity:.35; } }
.bar i { transition:width .7s cubic-bezier(.2,.7,.2,1), background-color .3s; }
.g-five.full .bar i { background:#f59e0b; }
.g-five.full .g-note { color:#b45309; font-weight:600; }
.feed { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; min-height:112px; }
.feed li { display:flex; justify-content:space-between; gap:12px; font-size:13.5px; color:var(--muted); background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:7px 12px; animation:rise .4s ease both; }
.feed li b { color:var(--blue-deep); font-variant-numeric:tabular-nums; }
@keyframes rise { from { opacity:0; transform:translateY(6px); } }
.gauges .ex { margin:0; font-size:12.5px; font-weight:650; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); }
.gauge { background:var(--surface); border:1px solid var(--line); border-radius:16px; padding:16px 18px; }
.gauge p { display:flex; justify-content:space-between; margin:0; font-size:14.5px; color:var(--ink); font-weight:600; }
.gauge p span { font-variant-numeric:tabular-nums; }
.bar { height:8px; margin:12px 0 8px; border-radius:999px; background:var(--track); overflow:hidden; }
.bar .w62 { width:62%; } .bar .w34 { width:34%; }
.bar i { display:block; height:100%; border-radius:inherit; background:var(--blue); }
.gauge small { font-size:13px; color:var(--muted); }
.steps { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:22px; counter-reset:s; }
.steps li { display:grid; grid-template-columns:44px minmax(0, 1fr); gap:14px; counter-increment:s; }
.steps li::before { content:counter(s, decimal-leading-zero); font-family:"Source Serif 4", Georgia, serif; font-size:30px; line-height:1; color:var(--blue); }
.steps b { display:block; color:var(--ink); font-size:17px; margin-bottom:2px; }
.steps p { margin:0; color:var(--muted); }
/* Compare */
.table { margin-top:40px; overflow-x:auto; border:1px solid var(--line); border-radius:20px; background:var(--surface); }
table { width:100%; min-width:720px; border-collapse:collapse; font-size:14.5px; }
th, td { padding:15px 18px; text-align:left; border-bottom:1px solid var(--line); vertical-align:middle; }
thead th { font-size:16px; color:var(--ink); }
tbody th { font-weight:550; color:var(--text); width:30%; }
tbody tr:last-child th, tbody tr:last-child td { border-bottom:0; }
td { color:var(--ink); font-variant-numeric:tabular-nums; }
td .ok { color:var(--blue); }
.hl { background:var(--blue-soft); }
/* Media */
.media-grid { display:grid; grid-template-columns:minmax(0, 1.1fr) minmax(0, .9fr); gap:20px; margin-top:40px; }
.packs { list-style:none; margin:0; padding:0; display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:12px; }
.packs li { display:flex; flex-direction:column; background:var(--surface); border:1px solid var(--line); border-radius:20px; padding:22px; }
.packs li.mid { border-color:var(--blue-line); background:var(--blue-soft); }
.packs strong { font-size:40px; letter-spacing:-.045em; line-height:1; color:var(--ink); font-variant-numeric:tabular-nums; }
.packs .u { margin-top:4px; color:var(--muted); font-size:14px; }
.packs .pp { margin-top:auto; padding-top:22px; font-weight:650; color:var(--ink); font-variant-numeric:tabular-nums; }
.costs { background:var(--night); border:1px solid var(--night-line); color:var(--night-muted); border-radius:20px; padding:22px 24px; }
.costs h3 { margin:0 0 8px; color:var(--ink); font-size:17px; }
.costs ul { list-style:none; margin:0; padding:0; }
.costs li { display:flex; justify-content:space-between; gap:12px; padding:11px 0; border-bottom:1px solid var(--night-line); font-size:14.5px; }
.costs li b { color:var(--ink); font-variant-numeric:tabular-nums; white-space:nowrap; }
.costs p { margin:14px 0 0; font-size:13.5px; color:var(--blue); }
/* Pay */
.pay { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:14px; margin-top:40px; }
.pay div { background:var(--surface); border:1px solid var(--line); border-radius:20px; padding:24px; }
.pay .i { width:26px; height:26px; color:var(--blue); }
.pay b { display:block; margin:14px 0 4px; color:var(--ink); font-size:17px; }
.pay p { margin:0; color:var(--muted); font-size:14.5px; }
.soon { display:flex; align-items:center; gap:10px; margin:16px 0 0; background:var(--blue-soft); border:1px solid var(--blue-line); border-radius:14px; padding:13px 16px; color:var(--ink); font-size:14.5px; font-weight:550; }
.soon::before { content:""; flex:none; width:8px; height:8px; border-radius:50%; background:var(--blue); box-shadow:0 0 0 4px rgb(26 109 255 / .2); }
/* FAQ */
.faq { margin-top:36px; border-top:1px solid var(--line); }
.faq details { border-bottom:1px solid var(--line); }
.faq summary { display:flex; justify-content:space-between; align-items:center; gap:16px; cursor:pointer; list-style:none; padding:20px 0; color:var(--ink); font-weight:650; font-size:17px; }
.faq summary::-webkit-details-marker { display:none; }
.faq summary::after { content:"+"; font-weight:400; font-size:24px; line-height:1; color:var(--blue); transition:transform .2s; }
.faq details[open] summary::after { transform:rotate(45deg); }
.faq p { margin:0 0 20px; max-width:68ch; color:var(--muted); }
.faq-grid { display:grid; grid-template-columns:minmax(0, .8fr) minmax(0, 1.2fr); gap:56px; }
.faq-grid .faq { margin-top:0; }
.mail { margin:20px 0 0; color:var(--muted); font-size:15px; }
.mail a { color:var(--blue-deep); font-weight:600; }
/* Final */
.final { margin-top:112px; background:var(--night); border:1px solid var(--night-line); color:var(--muted); border-radius:32px; padding:64px 40px; text-align:center; position:relative; overflow:hidden; }
.final h2 { color:var(--ink); }
.final h2 em { color:var(--blue); }
.final p { margin:14px auto 0; max-width:52ch; font-size:17px; }
.final a { display:inline-flex; margin-top:28px; background:var(--blue-deep); color:#fff; text-decoration:none; font-weight:650; border-radius:999px; padding:14px 24px; }
footer { background:var(--night); color:var(--night-muted); margin-top:96px; padding-block:40px; font-size:14px; border-top:1px solid var(--night-line); }
footer .wrap { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:16px; }
footer .brand { color:var(--ink); }
footer nav { display:flex; flex-wrap:wrap; gap:18px; }
footer a { text-decoration:none; }
footer a:hover { color:var(--ink); }
:focus-visible { outline:2px solid var(--blue); outline-offset:3px; border-radius:6px; }
@media (max-width: 1040px) {
  .plans { grid-template-columns:repeat(2, minmax(0, 1fr)); }
  .usage-grid, .media-grid, .faq-grid, .biz-head { grid-template-columns:minmax(0, 1fr); gap:28px; }
  .biz-grid { grid-template-columns:repeat(2, minmax(0, 1fr)); }
  .menu a:not(.btn) { display:none; }
}
@media (max-width: 680px) {
  .plans, .pay, .packs, .biz-grid { grid-template-columns:minmax(0, 1fr); }
  .biz { padding:36px 22px; border-radius:24px; }
  .plan .for { min-height:0; }
  .section { padding-block:72px 0; }
  .final { padding:48px 22px; border-radius:24px; }
}
@media (max-width: 440px) { .menu .btn { display:none; } }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior:auto; } .faq summary::after, .bar i { transition:none; } .live, .feed li { animation:none; } }
${LOGO_ALIVE_CSS}
</style>
</head>
<body>
<header class="top">
  <div class="wrap">
    <a class="brand" href="/">${logoTileLive(32)}${logoWord(25)}</a>
    <nav class="menu" aria-label="Baarali">
      <a href="/">${escape(t.home)}</a>
      <a href="${PRICING_PATH}" aria-current="page">${escape(t.prices)}</a>
      <a href="#questions">${escape(t.questions)}</a>
      <button class="theme" type="button" aria-label="${escape(t.theme)}" title="${escape(t.theme)}">${SUN}${MOON}</button>
      <a class="btn" href="/auth/v1/sign-in">${escape(t.signIn)}</a>
    </nav>
  </div>
</header>
<main>
<div class="hero">
  <div class="wrap">
    <p class="kicker">${escape(t.kicker)}</p>
    <h1>${titled(t.heading)}</h1>
    <p class="lead">${escape(t.lead)}</p>
    <div class="switches">
      <div class="switch"><span id="per">${escape(t.period)}</span>
        <div class="seg seg-period" role="radiogroup" aria-labelledby="per"><button type="button" role="radio" data-period="month" aria-checked="true">${escape(t.monthly)}</button><button type="button" role="radio" data-period="year" aria-checked="false">${escape(t.yearly)} <b class="save">${escape(t.save)}</b></button></div>
      </div>
      <div class="switch"><span id="cur">${escape(t.currency)}</span>
        <div class="seg seg-currency" role="radiogroup" aria-labelledby="cur"><button type="button" role="radio" data-currency="xof" aria-checked="true">F CFA</button><button type="button" role="radio" data-currency="eur" aria-checked="false">Euros</button></div>
      </div>
    </div>
    <ul class="pills">${t.pills.map((p) => `<li>${CHECK}${escape(p)}</li>`).join('')}</ul>
  </div>
</div>
<div class="wrap">
  <div class="plans">${others.map((o) => card(o)).join('')}${proCard}</div>

  <section class="section" id="utilisation" aria-labelledby="usage-title">
    <div class="head"><p class="kicker">${escape(t.usageKicker)}</p><h2 id="usage-title">${titled(t.usageTitle)}</h2><p class="lead">${escape(t.usageLead)}</p></div>
    <div class="usage-grid">
      <ol class="steps">${t.steps.map(([b, p]) => `<li><div><b>${escape(b)}</b><p>${escape(p)}</p></div></li>`).join('')}</ol>
      <div class="gauges" aria-label="${escape(t.gaugeExample)}" data-tasks="${escape(JSON.stringify(t.demoTasks))}" data-limit="${escape(t.demoLimit)}" data-later="${escape(t.demoLater)}" data-renew="${escape(t.renewIn)}" data-five-note="${escape(t.gaugeFiveNote)}">
        <p class="ex"><i class="live"></i>${escape(t.gaugeExample)}</p>
        <div class="gauge g-five"><p>${escape(t.gaugeFive)}<span class="pct">62 %</span></p><div class="bar"><i class="w62"></i></div><small class="g-note">${escape(t.gaugeFiveNote)}</small></div>
        <div class="gauge g-week"><p>${escape(t.gaugeWeek)}<span class="pct">34 %</span></p><div class="bar"><i class="w34"></i></div><small>${escape(t.gaugeWeekNote)}</small></div>
        <ul class="feed" aria-live="off"></ul>
      </div>
    </div>
  </section>

  <section class="biz" id="entreprises" aria-labelledby="biz-title">
    <div class="biz-head">
      <div><p class="kicker">${escape(t.bizKicker)}</p><h2 id="biz-title">${titled(t.bizTitle)}</h2><p class="lead">${escape(t.bizLead)}</p></div>
      <div class="biz-side"><p class="biz-price">${escape(t.bizPrice)}</p><a class="cta cta-white" href="mailto:${CONTACT}?subject=Baarali%20Entreprise">${escape(t.bizCta)}</a><p class="biz-mail">${CONTACT}</p></div>
    </div>
    <ul class="biz-for">${t.bizFor.map((f) => `<li>${escape(f)}</li>`).join('')}</ul>
    <div class="biz-grid">${t.bizPoints.map(([b, p]) => `<div><b>${escape(b)}</b><p>${escape(p)}</p></div>`).join('')}</div>
    <p class="biz-note">${escape(t.bizNote)}</p>
  </section>

  <section class="section" id="comparer" aria-labelledby="compare-title">
    <div class="head"><p class="kicker">${escape(t.compareKicker)}</p><h2 id="compare-title">${titled(t.compareTitle)}</h2></div>
    <div class="table">${table}</div>
  </section>

  <section class="section" id="medias" aria-labelledby="media-title">
    <div class="head"><p class="kicker">${escape(t.mediaKicker)}</p><h2 id="media-title">${titled(t.mediaTitle)}</h2><p class="lead">${escape(t.mediaLead)}</p></div>
    <div class="media-grid">
      <ul class="packs">${packs}</ul>
      <div class="costs"><h3>${escape(t.costTitle)}</h3><ul>${t.costs.map(([what, n]) => `<li>${escape(what)}<b>${n} ${escape(t.credits)}</b></li>`).join('')}</ul><p>${escape(t.refund)}</p></div>
    </div>
  </section>

  <section class="section" id="payer" aria-labelledby="pay-title">
    <div class="head"><p class="kicker">${escape(t.payKicker)}</p><h2 id="pay-title">${titled(t.payTitle)}</h2></div>
    <div class="pay">${t.pay.map(([b, p], i) => `<div>${PAY_ICONS[i]}<b>${escape(b)}</b><p>${escape(p)}</p></div>`).join('')}</div>
    <p class="soon">${escape(t.paySoon)}</p>
  </section>

  <section class="section" id="questions" aria-labelledby="faq-title">
    <div class="faq-grid">
      <div class="head"><p class="kicker">${escape(t.faqKicker)}</p><h2 id="faq-title">${titled(t.faqTitle)}</h2><p class="mail">${escape(t.write)} <a href="mailto:${CONTACT}">${CONTACT}</a></p></div>
      <div class="faq">${t.faq.map(([q, a]) => `<details><summary>${escape(q)}</summary><p>${escape(a)}</p></details>`).join('')}</div>
    </div>
  </section>

  <div class="final">
    <h2>${titled(t.finalTitle)}</h2>
    <p>${escape(t.finalLead)}</p>
    <a href="/auth/v1/sign-in">${escape(t.start)}</a>
  </div>
</div>
</main>
<footer>
  <div class="wrap">
    <a class="brand" href="/">${logoTile(28)}${logoWord(22)}</a>
    <nav aria-label="${escape(legal[0]?.label ?? '')}">${legal.map((l) => `<a href="${l.href}">${escape(l.label)}</a>`).join('')}<a href="mailto:${CONTACT}">${CONTACT}</a></nav>
    <span>© ${new Date().getFullYear()} OpenBaara SAS · Burkina Faso</span>
  </div>
</footer>
<script nonce="${opts.nonce}">
"use strict";
const root = document.documentElement;
document.querySelector(".theme").addEventListener("click", () => {
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("baarali-theme", root.dataset.theme); } catch {}
});
// Monthly or yearly: the monthly plans show their year.
const periods = [...document.querySelectorAll(".seg-period button")];
for (const b of periods) b.addEventListener("click", () => {
  if (b.dataset.period === "year") root.dataset.period = "year"; else delete root.dataset.period;
  for (const o of periods) o.setAttribute("aria-checked", String(o === b));
});
// The gauges at work: tasks fill the 5 hours until the limit, then the
// window renews; the week fills slowly underneath. Still, if motion is off.
const demo = document.querySelector(".gauges");
if (demo && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const tasks = JSON.parse(demo.dataset.tasks);
  const five = demo.querySelector(".g-five"), week = demo.querySelector(".g-week"), feed = demo.querySelector(".feed");
  const note = five.querySelector(".g-note");
  const set = (g, v) => { g.querySelector(".bar i").style.width = v + "%"; g.querySelector(".pct").textContent = Math.round(v) + " %"; };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let f = 0, w = 12, i = 0;
  const loop = async () => {
    for (;;) {
      const [name, cost] = tasks[i++ % tasks.length];
      f = Math.min(100, f + cost); w = Math.min(96, w + cost / 6);
      const li = document.createElement("li");
      li.innerHTML = "<span></span><b></b>";
      li.firstChild.textContent = name; li.lastChild.textContent = "+" + cost + " %";
      feed.prepend(li);
      while (feed.children.length > 3) feed.lastChild.remove();
      set(five, f); set(week, w);
      const h = Math.max(0, Math.round((100 - f) / 100 * 299));
      note.textContent = demo.dataset.renew + " " + Math.floor(h / 60) + " h " + String(h % 60).padStart(2, "0");
      await wait(1500);
      if (f >= 100) {
        five.classList.add("full"); note.textContent = demo.dataset.limit;
        await wait(2600);
        note.textContent = demo.dataset.later; f = 0; set(five, 0);
        await wait(1800);
        five.classList.remove("full");
        if (w > 90) w = 12;
      }
    }
  };
  set(five, 0); set(week, w); note.textContent = demo.dataset.fiveNote;
  setTimeout(loop, 600);
}
// CFA francs or euros: every price on the page follows, and it is remembered.
const seg = [...document.querySelectorAll(".seg-currency button")];
const showCurrency = (c) => {
  if (c === "eur") root.dataset.currency = "eur"; else delete root.dataset.currency;
  for (const b of seg) b.setAttribute("aria-checked", String(b.dataset.currency === c));
};
showCurrency(root.dataset.currency === "eur" ? "eur" : "xof");
for (const b of seg) b.addEventListener("click", () => {
  showCurrency(b.dataset.currency);
  try { localStorage.setItem("baarali-currency", b.dataset.currency); } catch {}
});
for (const b of document.querySelectorAll(".levels button")) {
  b.addEventListener("click", () => {
    for (const o of document.querySelectorAll(".levels button")) o.setAttribute("aria-checked", String(o === b));
    for (const l of document.querySelectorAll(".level")) l.hidden = l.dataset.level !== b.dataset.level;
  });
}
${LOGO_ALIVE_JS}
</script>
</body>
</html>`;
}
