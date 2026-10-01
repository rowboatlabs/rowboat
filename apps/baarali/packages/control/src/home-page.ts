import type { SoldPack } from './admin.js';
import type { Money, Offer } from './pricing.js';
import { CONTACT, legalLinks } from './legal-page.js';
import { FAVICON, logoTile, logoWord, mascot } from './logo.js';
import { pickLang } from './sign-in-page.js';

// The home page at baarali.com, with the prices (decided 01/10/2026). Prices
// and credits come from the catalog the quota is computed from (catalog.ts),
// never written here: the page cannot drift from what is billed. Usage is
// shown relative to Essentiel, never in dollars: the margin stays ours.
// Strings live in STRINGS until @baarali/i18n exists (roadmap phase 1).
//
// Redrawn the same day in the brand's three colours, white, blue and black,
// with the character brought to life and the app shown at work in the hero
// (the « simulateur »). Fonts are served from this origin (assets.ts): the
// CSP admits nothing from elsewhere.

type Lang = 'fr' | 'en';

const STRINGS = {
  fr: {
    title: 'Baarali — l’assistant qui agit pour vous',
    description: 'Il cherche, rédige et crée pour vous. Vous validez.',
    nav: { how: 'Comment ça marche', features: 'Ce qu’il fait', prices: 'Tarifs', faq: 'Questions' },
    navSignIn: 'Se connecter',
    beta: 'Bêta',
    eyebrow: 'Accès anticipé · Afrique de l’Ouest',
    hero: ['L’assistant qui ', 'agit', ' pour vous.'],
    lead: 'Devis, emails, recherches, vidéos : Baarali s’en charge. Vous validez avant chaque envoi.',
    theme: 'Changer de thème : clair ou sombre',
    start: 'Créer mon compte gratuit',
    download: 'Télécharger Baarali',
    seeHow: 'Voir comment ça marche',
    trust: ['Gratuit pour commencer', 'Sans mot de passe', 'Français et anglais'],
    sim: {
      label: 'Aperçu de l’app Baarali au travail',
      newTask: 'Nouvelle tâche',
      tasks: ['Devis pour Awa Traoré', 'Veille sur le cajou', 'Publication de lancement'],
      ask: 'Prépare un devis pour Awa Traoré, 40 sacs de ciment, et envoie-le-lui.',
      steps: ['J’ai retrouvé Awa Traoré dans vos contacts.', 'J’ai rédigé le devis : 40 × 6 500 F CFA.'],
      file: 'Devis-Awa-Traore.pdf',
      fileMeta: '260 000 F CFA · 1 page',
      approve: 'Envoyer le devis à awa.traore@exemple.ci ?',
      approveWhy: 'Ce message part en votre nom : j’attends votre accord.',
      no: 'Refuser',
      yes: 'Approuver',
      sent: 'Envoyé. Je vous préviens dès qu’Awa répond.',
      input: 'Demandez quelque chose à Baarali…',
      replay: 'Rejouer',
    },
    featuresKicker: 'Ce qu’il fait',
    featuresTitle: ['Un collègue qui ', 'ne s’arrête pas', '.'],
    featuresLead: 'Vous demandez avec vos mots. Il s’organise, utilise les bons outils et vous rend un travail fini.',
    features: [
      ['Il cherche et résume', 'Le web, vos documents, vos notes : il lit à votre place et vous rend l’essentiel, avec ses sources.'],
      ['Il rédige', 'Devis, comptes rendus, tableaux, présentations : prêts à envoyer, dans votre ton.'],
      ['Il écrit vos messages', 'Emails et réponses préparés pour vous. Rien ne part sans votre accord.'],
      ['Il crée des médias', 'Des vidéos, des voix et de la musique, avec des crédits médias à part du forfait.'],
      ['Il travaille en arrière-plan', 'Les tâches longues continuent quand vous fermez l’app. Il vous prévient à la fin.'],
      ['Il se souvient', 'Vos clients, vos prix, vos habitudes : ce qu’il apprend reste dans votre espace.'],
    ],
    demo: {
      search: 'prix du cajou cette semaine',
      sources: ['3 sources lues', 'Résumé en 5 points'],
      table: [['Article', 'Qté', 'Total'], ['Ciment', '40', '260 000'], ['Livraison', '1', '15 000']],
      draft: 'Brouillon',
      draftTo: 'À : Awa Traoré',
      media: 'Voix · 0:42',
      background: [['Veille sur le cajou', 'chaque lundi'], ['Relance des factures', 'en cours']],
      memory: ['Client : Awa Traoré', 'TVA 18 %', 'Paiement à 30 jours', 'Ton : chaleureux'],
    },
    controlKicker: 'Vous gardez la main',
    controlTitle: ['Rien ne part ', 'sans votre accord', '.'],
    controlLead: 'Baarali agit, mais c’est vous qui décidez. Avant d’envoyer, de publier ou de payer, il vous montre exactement ce qu’il va faire.',
    control: [
      ['Il demande avant d’agir', 'Chaque geste engageant attend votre « oui ». Vous pouvez refuser, ou corriger avant.'],
      ['Votre espace à vous', 'Chaque compte a son propre espace de travail, séparé des autres, hébergé en Europe.'],
      ['Vous fixez les règles', 'Ce qu’il peut faire seul, ce qui demande votre accord : c’est vous qui choisissez.'],
    ],
    requests: [
      ['Envoyer un email', 'à awa.traore@exemple.ci', 'approved'],
      ['Publier sur la page', 'Lancement de la nouvelle offre', 'waiting'],
      ['Supprimer 12 fichiers', 'dans Documents/Archives', 'refused'],
    ],
    requestState: { approved: 'Approuvé', waiting: 'En attente', refused: 'Refusé' },
    howKicker: 'Comment ça marche',
    howTitle: ['Prêt en ', 'deux minutes', '.'],
    how: [
      ['Installez l’app', 'Sur Mac ou sur Windows. Sur téléphone, bientôt.'],
      ['Connectez-vous', 'Avec votre email, sans mot de passe : vous recevez un code. Votre espace se crée tout seul.'],
      ['Demandez', 'Avec vos mots, en français ou en anglais. Il s’occupe du reste et vous montre où il en est.'],
    ],
    hereKicker: 'Pensé pour ici',
    hereTitle: ['Fait pour l’Afrique de l’Ouest, ', 'pas adapté après coup', '.'],
    here: [
      ['F CFA', 'Des prix fixes en F CFA, comme en euros.'],
      ['FR · EN', 'Il comprend et répond en français et en anglais.'],
      ['Mobile Money', 'Le paiement par Mobile Money et par carte arrive bientôt.'],
      ['À la semaine', 'Un forfait sans engagement, payé à la semaine.'],
    ],
    pricesKicker: 'Tarifs',
    pricesTitle: ['Simple, ', 'sans surprise', '.'],
    pricesLead: 'Une utilisation qui se renouvelle toutes les 5 heures et chaque semaine. Changez de forfait quand vous voulez.',
    perWeek: 'par semaine',
    perMonth: 'par mois',
    free: 'Gratuit',
    popular: 'Le plus choisi',
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
    downloadKicker: 'Télécharger',
    downloadTitle: ['Baarali, ', 'sur votre ordinateur', '.'],
    downloadLead: 'Installez l’app, connectez-vous avec votre email : votre espace Baarali se crée tout seul, et vous retrouvez tout d’un appareil à l’autre.',
    macArm: 'Mac · Apple M1 et plus récent',
    macIntel: 'Mac · Intel',
    windows: 'Windows 10 et 11',
    macNote: 'Au premier lancement sur Mac, si macOS refuse d’ouvrir l’app : Réglages Système › Confidentialité et sécurité › Ouvrir quand même.',
    phoneNote: 'Sur téléphone : bientôt.',
    faqKicker: 'Questions',
    faqTitle: ['Ce qu’on ', 'nous demande', '.'],
    faq: [
      ['Comment je me connecte ?', 'Dans l’app, sans mot de passe : vous recevez un code par email. Google, Apple et GitHub arrivent bientôt, puis le SMS.'],
      ['Faut-il une carte bancaire pour commencer ?', 'Non. Le forfait Découverte est gratuit : il suffit de votre email.'],
      ['Que se passe-t-il quand j’atteins ma limite ?', 'Vous attendez la fin de la fenêtre de 5 heures ou de la semaine, ou vous passez au forfait du dessus. Une réponse commencée n’est jamais coupée.'],
      ['Mes crédits médias expirent-ils ?', 'Non. Ils restent sur votre compte jusqu’à ce que vous les utilisiez.'],
      ['Où sont mes données ?', 'Chaque compte a son propre espace de travail, séparé des autres, hébergé en Europe.'],
      ['Sur quels appareils ?', 'Mac et Windows aujourd’hui. Le téléphone arrive bientôt.'],
    ],
    finalTitle: ['Confiez-lui ', 'la suite', '.'],
    finalLead: 'Créez votre compte gratuit et donnez-lui sa première tâche aujourd’hui.',
    footerProduct: 'Produit',
    footerAccount: 'Compte',
    footerCreate: 'Créer un compte',
    footerLegal: 'Légal',
    footer: 'Baarali est un produit d’OpenBaara.',
  },
  en: {
    title: 'Baarali — the assistant that acts for you',
    description: 'It researches, writes and creates for you. You approve.',
    nav: { how: 'How it works', features: 'What it does', prices: 'Pricing', faq: 'Questions' },
    navSignIn: 'Sign in',
    beta: 'Beta',
    eyebrow: 'Early access · West Africa',
    hero: ['The assistant that ', 'acts', ' for you.'],
    lead: 'Quotes, emails, research, videos: Baarali handles them. You approve before anything goes out.',
    theme: 'Switch theme: light or dark',
    start: 'Create my free account',
    download: 'Download Baarali',
    seeHow: 'See how it works',
    trust: ['Free to start', 'No password', 'French and English'],
    sim: {
      label: 'A look at the Baarali app at work',
      newTask: 'New task',
      tasks: ['Quote for Awa Traoré', 'Cashew market watch', 'Launch post'],
      ask: 'Prepare a quote for Awa Traoré, 40 bags of cement, and send it to her.',
      steps: ['I found Awa Traoré in your contacts.', 'I drafted the quote: 40 × 6,500 CFA francs.'],
      file: 'Quote-Awa-Traore.pdf',
      fileMeta: '260,000 CFA francs · 1 page',
      approve: 'Send the quote to awa.traore@example.ci?',
      approveWhy: 'This goes out in your name: I am waiting for your approval.',
      no: 'Decline',
      yes: 'Approve',
      sent: 'Sent. I will tell you as soon as Awa replies.',
      input: 'Ask Baarali anything…',
      replay: 'Replay',
    },
    featuresKicker: 'What it does',
    featuresTitle: ['A colleague who ', 'keeps going', '.'],
    featuresLead: 'You ask in your own words. It plans, uses the right tools and hands you finished work.',
    features: [
      ['It researches and sums up', 'The web, your documents, your notes: it reads for you and gives you what matters, with its sources.'],
      ['It writes', 'Quotes, minutes, spreadsheets, slides: ready to send, in your tone.'],
      ['It drafts your messages', 'Emails and replies prepared for you. Nothing goes out without your approval.'],
      ['It creates media', 'Videos, voices and music, with media credits separate from your plan.'],
      ['It works in the background', 'Long tasks keep running when you close the app. It tells you when they are done.'],
      ['It remembers', 'Your clients, your prices, your habits: what it learns stays in your space.'],
    ],
    demo: {
      search: 'cashew price this week',
      sources: ['3 sources read', '5-point summary'],
      table: [['Item', 'Qty', 'Total'], ['Cement', '40', '260,000'], ['Delivery', '1', '15,000']],
      draft: 'Draft',
      draftTo: 'To: Awa Traoré',
      media: 'Voice · 0:42',
      background: [['Cashew market watch', 'every Monday'], ['Invoice follow-ups', 'running']],
      memory: ['Client: Awa Traoré', 'VAT 18%', 'Payment in 30 days', 'Tone: warm'],
    },
    controlKicker: 'You stay in charge',
    controlTitle: ['Nothing goes out ', 'without your approval', '.'],
    controlLead: 'Baarali acts, but you decide. Before it sends, posts or pays, it shows you exactly what it is about to do.',
    control: [
      ['It asks before acting', 'Every binding step waits for your yes. You can decline, or correct it first.'],
      ['A space of your own', 'Each account has its own workspace, separate from the others, hosted in Europe.'],
      ['You set the rules', 'What it may do alone and what needs your approval: you choose.'],
    ],
    requests: [
      ['Send an email', 'to awa.traore@example.ci', 'approved'],
      ['Post on the page', 'Launch of the new offer', 'waiting'],
      ['Delete 12 files', 'in Documents/Archives', 'refused'],
    ],
    requestState: { approved: 'Approved', waiting: 'Waiting', refused: 'Declined' },
    howKicker: 'How it works',
    howTitle: ['Ready in ', 'two minutes', '.'],
    how: [
      ['Install the app', 'On Mac or Windows. On your phone, soon.'],
      ['Sign in', 'With your email, no password: you get a code. Your space is set up for you.'],
      ['Ask', 'In your own words, in French or English. It takes care of the rest and shows you where it stands.'],
    ],
    hereKicker: 'Built for here',
    hereTitle: ['Made for West Africa, ', 'not adapted afterwards', '.'],
    here: [
      ['CFA', 'Fixed prices in CFA francs, as in euros.'],
      ['FR · EN', 'It understands and answers in French and English.'],
      ['Mobile money', 'Paying by mobile money and card is coming soon.'],
      ['Weekly', 'A plan with no commitment, paid by the week.'],
    ],
    pricesKicker: 'Pricing',
    pricesTitle: ['Simple, ', 'no surprises', '.'],
    pricesLead: 'Usage that renews every 5 hours and every week. Change plans whenever you want.',
    perWeek: 'per week',
    perMonth: 'per month',
    free: 'Free',
    popular: 'Most chosen',
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
    downloadKicker: 'Download',
    downloadTitle: ['Baarali, ', 'on your computer', '.'],
    downloadLead: 'Install the app and sign in with your email: your Baarali space is set up for you, and everything follows you from one device to another.',
    macArm: 'Mac · Apple M1 or newer',
    macIntel: 'Mac · Intel',
    windows: 'Windows 10 and 11',
    macNote: 'On a Mac, if macOS refuses to open the app the first time: System Settings › Privacy & Security › Open Anyway.',
    phoneNote: 'On your phone: soon.',
    faqKicker: 'Questions',
    faqTitle: ['What people ', 'ask us', '.'],
    faq: [
      ['How do I sign in?', 'In the app, with no password: you get a code by email. Google, Apple and GitHub are coming soon, then SMS.'],
      ['Do I need a card to start?', 'No. The Découverte plan is free: your email is enough.'],
      ['What happens when I reach my limit?', 'Wait for the 5-hour or weekly window to end, or move up a plan. An answer already started is never cut.'],
      ['Do my media credits expire?', 'No. They stay on your account until you use them.'],
      ['Where is my data?', 'Each account has its own workspace, separate from the others, hosted in Europe.'],
      ['Which devices?', 'Mac and Windows today. Phones are coming soon.'],
    ],
    finalTitle: ['Hand it ', 'what comes next', '.'],
    finalLead: 'Create your free account and give it its first task today.',
    footerProduct: 'Product',
    footerAccount: 'Account',
    footerCreate: 'Create an account',
    footerLegal: 'Legal',
    footer: 'Baarali is a product of OpenBaara.',
  },
} satisfies Record<Lang, unknown>;

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A title in three parts: the middle one is set in the serif italic, in blue. */
const titled = ([a, em, b]: string[]) => `${escape(a)}<em>${escape(em)}</em>${escape(b)}`;

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

// Small line icons, drawn here: nothing is loaded from elsewhere.
const ICON = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M9.5 12h6M9.5 16h6"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>',
  wave: '<path d="M4 12h1M8 8v8M12 5v14M16 9v6M20 11v2"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  brain: '<path d="M12 5a3 3 0 0 0-5.7 1.3A3 3 0 0 0 5 12a3 3 0 0 0 2 5.3A3 3 0 0 0 12 19zM12 5a3 3 0 0 1 5.7 1.3A3 3 0 0 1 19 12a3 3 0 0 1-2 5.3A3 3 0 0 1 12 19z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  shield: '<path d="M12 3 5 6v6c0 4 3 7.5 7 9 4-1.5 7-5 7-9V6z"/><path d="m9 12 2 2 4-4"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  sliders: '<path d="M5 7h9M18 7h1M5 17h3M12 17h7"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  apple: '<path d="M15.5 4.5c-.8.9-2 1.6-3 1.5-.2-1.1.4-2.3 1.1-3 .8-.9 2.1-1.5 3-1.5.1 1.1-.3 2.2-1.1 3zM18.6 16.4c-.5 1.1-.7 1.6-1.4 2.6-.9 1.4-2.2 3.1-3.8 3.1-1.4 0-1.8-.9-3.7-.9s-2.4.9-3.8.9c-1.6 0-2.8-1.6-3.7-3C-.3 15.2 0 10.6 2.3 8.4c1-.9 2.2-1.5 3.4-1.5 1.5 0 2.4.9 3.7.9 1.2 0 1.9-.9 3.7-.9 1.1 0 2.3.6 3.2 1.6-2.8 1.6-2.4 5.6.3 6.9z"/>',
  windows: '<path d="M3 5.5 10 4.5v7H3zM11.5 4.3 21 3v8.5h-9.5zM3 12.5h7v7L3 18.5zM11.5 12.5H21V21l-9.5-1.3z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  send: '<path d="M5 12h13M13 6l6 6-6 6"/>',
} as const;
const icon = (name: keyof typeof ICON, cls = '') =>
  `<svg class="i${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON[name]}</svg>`;

export function homePage(data: HomeData, opts: { lang: string | null; nonce: string }): string {
  const lang = pickLang(opts.lang);
  const t = STRINGS[lang];
  const s = t.sim;
  const d = t.demo;
  const base = data.weekCredits.essentiel || 1;
  const ratio = (id: string) => {
    const r = (data.weekCredits[id] ?? 0) / base;
    return r >= 2 ? String(Math.round(r)) : '1';
  };
  const primary = data.downloadBase
    ? `<a class="btn btn-blue" href="#telecharger">${escape(t.download)}${icon('arrow')}</a>`
    : `<a class="btn btn-blue" href="/auth/v1/sign-in">${escape(t.start)}${icon('arrow')}</a>`;

  // The app at work: the conversation is whole in the page (it reads without
  // script); the script only replays it, step by step.
  const simulator = `
<figure class="sim" aria-label="${escape(s.label)}">
  <div class="sim-bar"><span></span><span></span><span></span><b>Baarali</b><button class="replay" type="button" hidden>${escape(s.replay)}</button></div>
  <div class="sim-body">
    <aside class="sim-side">
      <p class="sim-new">${icon('plus')}${escape(s.newTask)}</p>
      ${s.tasks.map((x, i) => `<p class="sim-task${i === 0 ? ' on' : ''}">${escape(x)}</p>`).join('')}
    </aside>
    <div class="sim-chat">
      <p class="msg-me" data-step="1">${escape(s.ask)}</p>
      <div class="msg-it" data-step="2">${logoTile(26)}<div>
        ${s.steps.map((x) => `<p class="did">${icon('check')}${escape(x)}</p>`).join('')}
        <p class="file">${icon('doc')}<span><b>${escape(s.file)}</b><small>${escape(s.fileMeta)}</small></span></p>
      </div></div>
      <div class="ask" data-step="3">
        <p class="ask-q">${icon('shield')}<span><b>${escape(s.approve)}</b><small>${escape(s.approveWhy)}</small></span></p>
        <p class="ask-a"><span class="chip">${escape(s.no)}</span><span class="chip chip-blue" data-yes>${escape(s.yes)}</span></p>
      </div>
      <p class="sent" data-step="4">${icon('check')}${escape(s.sent)}</p>
      <p class="sim-input"><span>${escape(s.input)}</span>${icon('send')}</p>
    </div>
  </div>
</figure>`;

  // One small scene per feature, in the order of t.features.
  const scenes = [
    `<div class="scene"><p class="s-search">${icon('search')}${escape(d.search)}</p><p class="s-pills">${d.sources.map((x) => `<span>${escape(x)}</span>`).join('')}</p></div>`,
    `<div class="scene"><table class="s-table">${d.table.map((r, i) => `<tr>${r.map((c) => (i === 0 ? `<th>${escape(c)}</th>` : `<td>${escape(c)}</td>`)).join('')}</tr>`).join('')}</table></div>`,
    `<div class="scene"><p class="s-draft"><span class="chip">${escape(d.draft)}</span><small>${escape(d.draftTo)}</small></p><p class="s-lines"><i></i><i></i><i></i></p></div>`,
    `<div class="scene"><p class="s-wave">${Array.from({ length: 28 }, (_, i) => `<i data-h="${(i * 37) % 9}"></i>`).join('')}</p><p class="s-pills"><span>${escape(d.media)}</span></p></div>`,
    `<div class="scene">${d.background.map(([a, b], i) => `<p class="s-job">${icon(i === 0 ? 'clock' : 'check')}<span>${escape(a)}</span><small>${escape(b)}</small></p>`).join('')}</div>`,
    `<div class="scene"><p class="s-pills s-wrap">${d.memory.map((x) => `<span>${escape(x)}</span>`).join('')}</p></div>`,
  ];
  const featureIcons: (keyof typeof ICON)[] = ['search', 'doc', 'mail', 'wave', 'clock', 'brain'];

  const download = data.downloadBase
    ? `
<section id="telecharger" class="section" aria-labelledby="download">
  <div class="wrap">
    <div class="dl">
      <div class="dl-copy">
        <p class="kicker kicker-light">${escape(t.downloadKicker)}</p>
        <h2 id="download">${titled(t.downloadTitle)}</h2>
        <p class="sub">${escape(t.downloadLead)}</p>
        <div class="dl-buttons">${(['macArm', 'macIntel', 'windows'] as const)
          .map((k) => `<a class="btn ${k === 'macArm' ? 'btn-blue' : 'btn-glass'}" href="${escape(`${data.downloadBase}/${DOWNLOADS[k]}`)}">${icon(k === 'windows' ? 'windows' : 'apple', 'fill')}${escape(t[k])}</a>`)
          .join('')}</div>
        <p class="fine">${escape(t.macNote)} ${escape(t.phoneNote)}</p>
      </div>
      <div class="dl-art">${logoTile(220)}</div>
    </div>
  </div>
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
    const featured = offer.id === 'essentiel';
    return `<article class="plan${featured ? ' featured' : ''}">
      ${featured ? `<p class="badge">${escape(t.popular)}</p>` : ''}
      <p class="tag">${escape(copy.tag)}</p>
      <h3>${escape(offer.displayName)}</h3>
      ${extra || priceBlock(offer)}
      <ul>${copy.points.map((p) => `<li>${icon('check')}${escape(p)}</li>`).join('')}</ul>
      ${offer.billing.kind === 'free' ? `<a class="btn btn-blue" href="/auth/v1/sign-in">${escape(t.start)}</a>` : `<p class="note">${escape(t.payment)}</p>`}
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
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#FFFFFF">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0B0C0F">
<link rel="icon" href="${FAVICON}">
<script nonce="${opts.nonce}">
// The theme the viewer picked, before the first paint (no flash of the other).
try { const v = localStorage.getItem("baarali-theme"); if (v === "light" || v === "dark") document.documentElement.dataset.theme = v; } catch {}
</script>
<link rel="preload" href="/assets/inter.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/instrument-serif-italic.woff2" as="font" type="font/woff2" crossorigin>
<style nonce="${opts.nonce}">
@font-face { font-family:"Inter"; src:url(/assets/inter.woff2) format("woff2"); font-weight:400 800; font-display:swap; }
@font-face { font-family:"Instrument Serif"; src:url(/assets/instrument-serif-normal.woff2) format("woff2"); font-style:normal; font-display:swap; }
@font-face { font-family:"Instrument Serif"; src:url(/assets/instrument-serif-italic.woff2) format("woff2"); font-style:italic; font-display:swap; }
/* The brand's three colours (decided 01/10/2026): white, blue, black. The
   page is deliberately one look, light with black bands, in either theme. */
:root {
  --paper:#ffffff; --mist:#f4f6fb; --line:#e6e8ef; --ink:#0a0a0a; --text:#2a2d36; --muted:#5d6271;
  --blue:#1a6dff; --blue-deep:#155eef; --blue-soft:#eaf1ff; --blue-line:#cfdcff;
  --night:#0a0a0a; --night-2:#15161a; --night-line:#26282f; --night-muted:#a3a7b3;
  --surface:#ffffff; --surface-2:#fbfbfd; --dot:#e2e4ea; --skeleton:#dfe3ec; --on-ink:#ffffff; --hover-line:#c9ccd6; --top-bg:rgb(255 255 255 / .82); --glass:rgb(255 255 255 / .7); --hero-grid:.55; --shadow:rgb(10 10 10 / .35); --ring:rgb(255 255 255 / .6); --featured-line:var(--night);
  --sans:"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --serif:"Instrument Serif", Georgia, "Times New Roman", serif;
  color-scheme: light;
}
/* Dark (01/10/2026): the viewer's system choice, unless they picked one with
   the switch, which stamps data-theme on <html> before the first paint. */
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --paper:#0b0c0f; --mist:#121318; --line:#24262e; --ink:#f5f6f8; --text:#d3d5dc; --muted:#9a9fac;
  --blue:#4d8dff; --blue-deep:#1a6dff; --blue-soft:#14203a; --blue-line:#29437a;
  --night:#000000; --night-2:#111216; --night-line:#25272e;
  --surface:#15161b; --surface-2:#111216; --dot:#2c2e36; --skeleton:#2a2c34; --on-ink:#0a0a0a; --hover-line:#3a3d47; --top-bg:rgb(11 12 15 / .8); --glass:rgb(21 22 27 / .7); --hero-grid:.35; --shadow:rgb(0 0 0 / .7); --ring:rgb(255 255 255 / .04); --featured-line:#2f5fd0;
  color-scheme: dark;
} }
:root[data-theme="dark"] {
  --paper:#0b0c0f; --mist:#121318; --line:#24262e; --ink:#f5f6f8; --text:#d3d5dc; --muted:#9a9fac;
  --blue:#4d8dff; --blue-deep:#1a6dff; --blue-soft:#14203a; --blue-line:#29437a;
  --night:#000000; --night-2:#111216; --night-line:#25272e;
  --surface:#15161b; --surface-2:#111216; --dot:#2c2e36; --skeleton:#2a2c34; --on-ink:#0a0a0a; --hover-line:#3a3d47; --top-bg:rgb(11 12 15 / .8); --glass:rgb(21 22 27 / .7); --hero-grid:.35; --shadow:rgb(0 0 0 / .7); --ring:rgb(255 255 255 / .04); --featured-line:#2f5fd0;
  color-scheme: dark;
}
* { box-sizing:border-box; }
[hidden] { display:none !important; }
html { scroll-behavior:smooth; -webkit-text-size-adjust:100%; }
body { margin:0; background:var(--paper); color:var(--text); font:16px/1.6 var(--sans); -webkit-font-smoothing:antialiased; }
a { color:inherit; }
h1, h2, h3 { color:var(--ink); font-weight:750; letter-spacing:-.035em; text-wrap:balance; margin:0; }
h1 em, h2 em { font-family:var(--serif); font-style:italic; font-weight:400; letter-spacing:-.01em; color:var(--blue); }
.wrap { max-width:1180px; margin:0 auto; padding-inline:20px; }
.i { width:18px; height:18px; flex:none; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
.i.fill { fill:currentColor; stroke:none; }
.btn { display:inline-flex; align-items:center; justify-content:center; gap:10px; min-height:48px; padding:12px 20px; border-radius:999px; font-weight:650; font-size:15.5px; text-decoration:none; border:1px solid transparent; transition:transform .15s ease, background .15s ease, box-shadow .15s ease; }
.btn:hover { transform:translateY(-1px); }
.btn-blue { background:var(--blue-deep); color:#fff; box-shadow:0 8px 24px -10px rgb(21 94 239 / .7); }
.btn-blue:hover { background:#0f52d6; }
.btn-ink { background:var(--ink); color:var(--on-ink); }
.btn-line { background:var(--surface); color:var(--ink); border-color:var(--line); }
.btn-line:hover { border-color:var(--hover-line); }
.btn-white { background:#fff; color:#0a0a0a; }
.btn-glass { background:rgb(255 255 255 / .06); color:#fff; border-color:var(--night-line); }
.btn-glass:hover { background:rgb(255 255 255 / .1); }
.kicker { display:inline-flex; align-items:center; gap:8px; margin:0 0 16px; font-size:13px; font-weight:650; letter-spacing:.08em; text-transform:uppercase; color:var(--blue-deep); }
.kicker::before { content:""; width:6px; height:6px; border-radius:50%; background:var(--blue); }
.kicker-light { color:#8fb4ff; }
.kicker .num { font-variant-numeric:tabular-nums; opacity:.55; margin-right:2px; }
.kicker:has(.num)::before { display:none; }
.kicker .num::after { content:" /"; }
.section { padding-block:104px; }
.section h2 { font-size:clamp(32px, 4.6vw, 52px); line-height:1.05; }
.sub { font-size:18px; color:var(--muted); max-width:58ch; margin:18px 0 0; }
.head { margin-bottom:52px; }
.head-center { text-align:center; display:flex; flex-direction:column; align-items:center; }
.fine { color:var(--muted); font-size:14px; margin:24px 0 0; }

/* Header */
.top { position:sticky; top:env(safe-area-inset-top, 0px); z-index:20; background:var(--top-bg); backdrop-filter:saturate(1.6) blur(14px); -webkit-backdrop-filter:saturate(1.6) blur(14px); border-bottom:1px solid transparent; }
.top.scrolled { border-bottom-color:var(--line); }
.top .wrap { display:flex; align-items:center; justify-content:space-between; gap:16px; min-height:68px; }
.brand { display:flex; align-items:center; gap:10px; color:var(--ink); text-decoration:none; }
.menu { display:flex; align-items:center; gap:28px; font-size:15px; }
.menu a { text-decoration:none; color:var(--muted); }
.menu a:hover { color:var(--ink); }
.top-cta { display:flex; align-items:center; gap:10px; }
.top-cta .btn { min-height:40px; padding:8px 16px; font-size:14.5px; }
.top-cta .btn .i { display:none; }
.theme { display:inline-flex; align-items:center; justify-content:center; width:40px; height:40px; border-radius:50%; border:1px solid var(--line); background:var(--surface); color:var(--ink); cursor:pointer; padding:0; }
.theme:hover { border-color:var(--hover-line); }
.theme .i { width:18px; height:18px; }
.theme .moon, :root[data-theme="dark"] .theme .sun { display:none; }
:root[data-theme="dark"] .theme .moon { display:block; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .theme .sun { display:none; } :root:not([data-theme="light"]) .theme .moon { display:block; } }

/* Hero */
.hero { position:relative; overflow:hidden; padding-block:72px 96px; }
.hero::before { content:""; position:absolute; inset:-30% -10% auto; height:780px; background:radial-gradient(48% 52% at 72% 38%, rgb(26 109 255 / .16), transparent 70%), radial-gradient(30% 40% at 18% 20%, rgb(26 109 255 / .07), transparent 70%); pointer-events:none; }
.hero::after { content:""; position:absolute; inset:0; background-image:linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px); background-size:56px 56px; mask-image:radial-gradient(60% 55% at 50% 30%, #000 20%, transparent 75%); -webkit-mask-image:radial-gradient(60% 55% at 50% 30%, #000 20%, transparent 75%); opacity:var(--hero-grid); pointer-events:none; }
.hero .wrap { position:relative; z-index:1; display:grid; grid-template-columns:minmax(0, 1fr) minmax(0, 1.08fr); gap:56px; align-items:center; }
.pill { display:inline-flex; align-items:center; gap:10px; padding:6px 14px 6px 6px; border:1px solid var(--blue-line); background:var(--glass); border-radius:999px; font-size:13.5px; font-weight:600; color:var(--ink); }
.pill b { background:var(--blue-deep); color:#fff; font-size:11.5px; letter-spacing:.06em; text-transform:uppercase; padding:3px 9px; border-radius:999px; }
.hero h1 { font-size:clamp(44px, 6.6vw, 84px); line-height:.98; margin:26px 0 22px; }
.hero h1 em { font-size:1.08em; }
.lead { font-size:19px; line-height:1.6; color:var(--muted); max-width:52ch; margin:0 0 32px; }
.ctas { display:flex; flex-wrap:wrap; gap:12px; }
.trust { display:flex; flex-wrap:wrap; gap:8px 22px; list-style:none; padding:0; margin:28px 0 0; font-size:14px; color:var(--muted); }
.trust li { display:flex; align-items:center; gap:7px; }
.trust .i { width:16px; height:16px; color:var(--blue); }

/* The simulator */
.stage { position:relative; }
.sim { margin:0; background:var(--surface); border:1px solid var(--line); border-radius:20px; box-shadow:0 40px 80px -40px var(--shadow), 0 0 0 8px var(--ring); overflow:hidden; }
.sim-bar { display:flex; align-items:center; gap:7px; padding:12px 16px; border-bottom:1px solid var(--line); background:var(--surface-2); }
.sim-bar span { width:11px; height:11px; border-radius:50%; background:var(--dot); }
.sim-bar { position:relative; }
.sim-bar b { position:absolute; left:50%; transform:translateX(-50%); font-size:13px; font-weight:600; color:var(--muted); }
.replay { margin-left:auto; font:inherit; font-size:12.5px; font-weight:600; color:var(--blue-deep); background:var(--blue-soft); border:0; border-radius:999px; padding:4px 11px; cursor:pointer; }
.sim-body { display:grid; grid-template-columns:172px minmax(0, 1fr); min-height:430px; }
.sim-side { border-right:1px solid var(--line); background:var(--surface-2); padding:14px 10px; display:flex; flex-direction:column; gap:4px; font-size:13px; }
.sim-side p { margin:0; padding:8px 10px; border-radius:9px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.sim-new { display:flex; align-items:center; gap:6px; color:var(--ink) !important; font-weight:600; border:1px solid var(--line); background:var(--paper); margin-bottom:8px !important; }
.sim-new .i { width:15px; height:15px; }
.sim-task.on { background:var(--blue-soft); color:var(--blue-deep); font-weight:600; }
.sim-chat { padding:20px 20px 16px; display:flex; flex-direction:column; gap:14px; font-size:14px; line-height:1.5; }
.msg-me { align-self:flex-end; max-width:82%; margin:0; background:var(--ink); color:var(--on-ink); padding:10px 14px; border-radius:16px 16px 4px 16px; }
.msg-it { display:flex; gap:10px; align-items:flex-start; }
.msg-it > svg { flex:none; border-radius:7px; margin-top:2px; }
.msg-it > div { display:flex; flex-direction:column; gap:6px; }
.did { display:flex; gap:8px; align-items:flex-start; margin:0; color:var(--text); }
.did .i { width:16px; height:16px; color:#fff; background:var(--blue); border-radius:50%; padding:2.5px; margin-top:2px; stroke-width:2.6; }
.file { display:flex; gap:10px; align-items:center; margin:4px 0 0; padding:10px 12px; border:1px solid var(--line); border-radius:12px; max-width:290px; }
.file .i { width:30px; height:30px; padding:6px; border-radius:8px; background:var(--blue-soft); color:var(--blue-deep); }
.file span, .ask-q span { display:flex; flex-direction:column; }
.file b { font-size:13px; color:var(--ink); }
.file small, .ask-q small { color:var(--muted); font-size:12px; }
.ask { margin-left:36px; border:1px solid var(--blue-line); background:linear-gradient(180deg, var(--blue-soft), var(--surface)); border-radius:14px; padding:12px 14px; display:flex; flex-direction:column; gap:10px; }
.ask-q { display:flex; gap:10px; margin:0; }
.ask-q .i { color:var(--blue-deep); margin-top:1px; }
.ask-q b { font-size:13.5px; color:var(--ink); font-weight:650; }
.ask-a { display:flex; gap:8px; justify-content:flex-end; margin:0; }
.chip { display:inline-flex; align-items:center; padding:6px 13px; border-radius:999px; border:1px solid var(--line); background:var(--surface); font-size:13px; font-weight:600; color:var(--ink); }
.chip-blue { background:var(--blue-deep); border-color:var(--blue-deep); color:#fff; }
.chip-blue.press { transform:scale(.94); box-shadow:0 0 0 5px rgb(26 109 255 / .2); }
.sent { display:flex; gap:8px; align-items:center; margin:0 0 0 36px; color:var(--blue-deep); font-weight:600; font-size:13.5px; }
.sent .i { width:16px; height:16px; stroke-width:2.6; }
.sim-input { margin:auto 0 0; display:flex; align-items:center; justify-content:space-between; gap:10px; border:1px solid var(--line); border-radius:999px; padding:8px 8px 8px 16px; color:#9a9fac; font-size:13.5px; }
.sim-input .i { width:32px; height:32px; padding:7px; border-radius:50%; background:var(--ink); color:var(--on-ink); }
.sim [data-step] { transition:opacity .45s ease, transform .45s ease; }
.sim.play [data-step] { opacity:0; transform:translateY(8px); }
.sim.play [data-step].show { opacity:1; transform:none; }
.peek { position:absolute; right:-14px; bottom:-38px; width:104px; filter:drop-shadow(0 18px 24px rgb(21 94 239 / .35)); }
.peek .tile { display:block; width:100%; height:auto; }

/* The character */
.mascot .m-lids { transform-box:fill-box; transform-origin:center; animation:blink 5.2s infinite; }
.mascot .m-eyes { transform-box:fill-box; animation:look 9s ease-in-out infinite; }
.mascot .m-body { transform-box:fill-box; transform-origin:50% 100%; animation:breathe 3.6s ease-in-out infinite; }
.mascot .m-foot { transform-box:fill-box; transform-origin:center; animation:hop 3.6s ease-in-out infinite; }
.mascot .m-foot-2 { animation-delay:.18s; }
@keyframes blink { 0%, 44%, 50%, 100% { transform:scaleY(1); } 47% { transform:scaleY(.1); } }
@keyframes look { 0%, 20% { transform:translate(0, 0); } 28%, 48% { transform:translate(-16px, 2px); } 56%, 76% { transform:translate(8px, -4px); } 84%, 100% { transform:translate(0, 0); } }
@keyframes breathe { 0%, 100% { transform:translateY(0); } 50% { transform:translateY(-6px) scale(1.01, .99); } }
@keyframes hop { 0%, 100% { transform:translateY(0); } 50% { transform:translateY(-3px); } }

/* Features */
.bento { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:16px; }
.feat { background:var(--surface); border:1px solid var(--line); border-radius:22px; padding:24px; display:flex; flex-direction:column; gap:18px; transition:border-color .2s ease, box-shadow .2s ease, transform .2s ease; }
.feat:hover { border-color:var(--blue-line); box-shadow:0 18px 40px -26px rgb(21 94 239 / .45); transform:translateY(-2px); }
.feat-head { display:flex; flex-direction:column; gap:8px; }
.feat-head .i { width:40px; height:40px; padding:9px; border-radius:12px; background:var(--blue-soft); color:var(--blue-deep); margin-bottom:6px; }
.feat h3 { font-size:19px; letter-spacing:-.02em; }
.feat p { margin:0; color:var(--muted); font-size:15px; }
.scene { margin-top:auto; background:var(--mist); border-radius:14px; padding:14px; min-height:112px; display:flex; flex-direction:column; justify-content:center; gap:10px; font-size:13px; }
.scene p { margin:0; }
.s-search { display:flex; align-items:center; gap:8px; background:var(--surface); border:1px solid var(--line); border-radius:999px; padding:8px 12px; color:var(--ink); }
.s-search .i { width:15px; height:15px; color:var(--blue-deep); }
.s-pills { display:flex; gap:6px; }
.s-wrap { flex-wrap:wrap; }
.s-pills span { white-space:nowrap; background:var(--surface); border:1px solid var(--line); border-radius:999px; padding:4px 10px; color:var(--text); font-weight:550; }
.s-table { width:100%; border-collapse:collapse; background:var(--surface); border-radius:10px; overflow:hidden; font-variant-numeric:tabular-nums; }
.s-table th, .s-table td { text-align:left; padding:6px 10px; border-bottom:1px solid var(--line); }
.s-table th { color:var(--muted); font-weight:600; font-size:12px; background:var(--surface-2); }
.s-table tr:last-child td { border-bottom:0; }
.s-table td:last-child, .s-table th:last-child { text-align:right; }
.s-draft { display:flex; align-items:center; gap:10px; }
.s-draft small { color:var(--muted); }
.s-lines { display:flex; flex-direction:column; gap:7px; }
.s-lines i { display:block; height:7px; border-radius:4px; background:var(--skeleton); }
.s-lines i:nth-child(2) { width:86%; }
.s-lines i:nth-child(3) { width:58%; }
.s-wave { display:flex; align-items:center; gap:3px; height:44px; }
.s-wave i { flex:1; border-radius:3px; background:var(--blue); height:40%; animation:wave 1.6s ease-in-out infinite; }
.s-wave i:nth-child(2n) { height:70%; } .s-wave i:nth-child(3n) { height:95%; } .s-wave i:nth-child(5n) { height:25%; } .s-wave i:nth-child(7n) { height:60%; }
.s-wave i:nth-child(3n) { animation-delay:-.4s; } .s-wave i:nth-child(3n+1) { animation-delay:-.9s; } .s-wave i:nth-child(4n) { animation-delay:-1.2s; background:#8fb4ff; }
@keyframes wave { 0%, 100% { height:24%; } 50% { height:92%; } }
.s-job { display:grid; grid-template-columns:auto 1fr auto; gap:8px; align-items:center; background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:8px 10px; }
.s-job .i { width:15px; height:15px; color:var(--blue-deep); }
.s-job span { color:var(--ink); font-weight:550; }
.s-job small { color:var(--muted); }

/* Control (black band) */
.night { background:var(--night); color:#e8e9ed; border-block:1px solid var(--night-line); }
.night h2, .night h3 { color:#fff; }
.night .sub, .night p { color:var(--night-muted); }
.night h2 em { color:#6f9fff; }
.split { display:grid; grid-template-columns:minmax(0, 1fr) minmax(0, 1fr); gap:64px; align-items:center; }
.points { list-style:none; padding:0; margin:40px 0 0; display:flex; flex-direction:column; gap:24px; }
.points li { display:grid; grid-template-columns:auto 1fr; gap:16px; }
.points .i { width:42px; height:42px; padding:10px; border-radius:12px; background:var(--night-2); border:1px solid var(--night-line); color:#8fb4ff; }
.points h3 { font-size:17px; margin-bottom:4px; letter-spacing:-.015em; }
.points p { margin:0; font-size:15px; }
.queue { background:var(--night-2); border:1px solid var(--night-line); border-radius:22px; padding:22px; display:flex; flex-direction:column; gap:12px; box-shadow:0 40px 80px -40px rgb(26 109 255 / .4); }
.req { display:grid; grid-template-columns:1fr auto; gap:14px; align-items:center; background:#0f1013; border:1px solid var(--night-line); border-radius:14px; padding:16px; }
.req b { display:block; color:#fff; font-weight:600; font-size:15px; }
.req small { color:var(--night-muted); font-size:13px; }
.state { font-size:12.5px; font-weight:650; padding:5px 11px; border-radius:999px; white-space:nowrap; }
.state-approved { background:rgb(26 109 255 / .16); color:#8fb4ff; }
.state-waiting { background:#fff; color:#0a0a0a; }
.state-refused { background:#1d1e23; color:var(--night-muted); text-decoration:line-through; }
.req-waiting { border-color:#3a5fb0; box-shadow:0 0 0 4px rgb(26 109 255 / .12); }

/* Steps */
.steps { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:16px; counter-reset:step; list-style:none; padding:0; margin:0; }
.steps li { position:relative; border-top:2px solid var(--ink); padding:22px 6px 0 0; }
.steps li::before { counter-increment:step; content:"0" counter(step); display:block; font-family:var(--serif); font-style:italic; font-size:56px; line-height:1; color:var(--blue); margin-bottom:18px; }
.steps h3 { font-size:21px; margin-bottom:8px; letter-spacing:-.02em; }
.steps p { margin:0; color:var(--muted); }

/* Built for here (blue band) */
.blue { background:var(--blue-deep); color:#fff; position:relative; overflow:hidden; }
.blue h2 { color:#fff; }
.blue h2 em { color:#fff; opacity:.92; }
.blue .kicker { color:#cfe0ff; }
.blue .kicker::before { background:#fff; }
.here { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:14px; margin-top:52px; }
.here div { background:rgb(255 255 255 / .1); border:1px solid rgb(255 255 255 / .2); border-radius:20px; padding:24px; }
.here b { display:block; font-size:28px; letter-spacing:-.03em; margin-bottom:10px; }
.here p { margin:0; color:#e1ebff; font-size:15px; }

/* Pricing */
.plans { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:14px; align-items:stretch; }
.plan { position:relative; background:var(--surface); border:1px solid var(--line); border-radius:22px; padding:26px 22px; display:flex; flex-direction:column; gap:14px; }
.plan.featured { background:var(--night); border-color:var(--featured-line); color:#e8e9ed; box-shadow:0 30px 60px -30px rgb(10 10 10 / .55); }
.plan.featured h3 { color:#fff; }
.plan.featured .price span, .plan.featured .cfa, .plan.featured .note, .plan.featured li { color:var(--night-muted); }
.plan.featured .price strong { color:#fff; }
.plan.featured .tag { color:#8fb4ff; }
.badge { position:absolute; top:-12px; left:22px; margin:0; background:var(--blue-deep); color:#fff; font-size:12px; font-weight:650; padding:4px 11px; border-radius:999px; }
.plan h3 { font-size:24px; letter-spacing:-.03em; }
.tag { margin:0; font-size:13px; font-weight:650; color:var(--blue-deep); }
.price { margin:0; font-variant-numeric:tabular-nums; }
.price strong { font-size:38px; letter-spacing:-.04em; color:var(--ink); font-weight:750; }
.price span, .cfa, .usage, .note { color:var(--muted); font-size:14px; }
.cfa, .usage, .note { margin:0; }
.plan ul { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:9px; font-size:14.5px; }
.plan li { display:grid; grid-template-columns:auto 1fr; gap:9px; }
.plan li .i { width:16px; height:16px; color:var(--blue); margin-top:3px; stroke-width:2.4; }
.plan .btn, .plan .note { margin-top:auto; }
.levels { display:flex; gap:4px; background:var(--mist); padding:4px; border-radius:999px; }
.levels button { flex:1; font:inherit; font-weight:650; font-size:14px; border:0; border-radius:999px; padding:7px; background:transparent; color:var(--muted); cursor:pointer; }
.levels button[aria-checked="true"] { background:var(--ink); color:var(--on-ink); }
.media { margin-top:56px; display:grid; grid-template-columns:minmax(0, .9fr) minmax(0, 1.1fr); gap:40px; align-items:center; background:var(--mist); border-radius:24px; padding:36px; }
.media h3 { font-size:26px; }
.media .sub { font-size:16px; }
.packs { list-style:none; padding:0; margin:0; display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:12px; }
.packs li { background:var(--surface); border:1px solid var(--line); border-radius:16px; padding:18px; display:flex; flex-direction:column; gap:4px; font-variant-numeric:tabular-nums; }
.packs strong { font-size:22px; color:var(--ink); letter-spacing:-.02em; }
.packs span { color:var(--muted); font-size:13.5px; }

/* Download */
.dl { background:var(--night); color:#fff; border-radius:32px; padding:56px; display:grid; grid-template-columns:minmax(0, 1.3fr) minmax(0, .7fr); gap:40px; align-items:center; overflow:hidden; position:relative; }
.dl::before { content:""; position:absolute; right:-120px; top:-120px; width:480px; height:480px; background:radial-gradient(circle, rgb(26 109 255 / .45), transparent 65%); }
.dl h2 { color:#fff; }
.dl h2 em { color:#6f9fff; }
.dl .sub, .dl .fine { color:var(--night-muted); }
.dl-buttons { display:flex; flex-wrap:wrap; gap:10px; margin-top:30px; }
.dl-art { position:relative; display:flex; justify-content:center; }
.dl-art svg { width:min(220px, 100%); height:auto; border-radius:22%; transform:rotate(-6deg); box-shadow:0 30px 60px -20px rgb(26 109 255 / .6); }

/* FAQ */
.faq { display:grid; grid-template-columns:minmax(0, .8fr) minmax(0, 1.2fr); gap:64px; }
.qa details { border-bottom:1px solid var(--line); padding-block:20px; }
.qa details:first-child { border-top:1px solid var(--line); }
.qa summary { list-style:none; cursor:pointer; display:flex; justify-content:space-between; gap:20px; font-weight:650; font-size:17px; color:var(--ink); }
.qa summary::-webkit-details-marker { display:none; }
.qa summary::after { content:"+"; font-weight:400; font-size:24px; line-height:1; color:var(--blue-deep); transition:transform .2s ease; }
.qa details[open] summary::after { transform:rotate(45deg); }
.qa p { color:var(--muted); margin:12px 0 0; max-width:62ch; }

/* Final call */
.final { background:var(--blue-deep); color:#fff; border-radius:32px; padding:64px 56px; display:grid; grid-template-columns:minmax(0, 1fr) auto; gap:40px; align-items:center; position:relative; overflow:hidden; }
.final::before { content:""; position:absolute; inset:0; background:radial-gradient(60% 90% at 85% 50%, rgb(255 255 255 / .18), transparent 60%); }
.final > * { position:relative; }
.final h2 { color:#fff; font-size:clamp(36px, 5.4vw, 64px); }
.final h2 em { color:#fff; }
.final p { color:#dce8ff; font-size:18px; margin:16px 0 30px; max-width:46ch; }
.final .mascot { width:min(190px, 34vw); height:auto; }

/* Footer */
footer { background:var(--night); color:var(--night-muted); padding-block:64px 40px; margin-top:104px; font-size:14.5px; }
.foot { display:grid; grid-template-columns:minmax(0, 1.4fr) repeat(3, minmax(0, .6fr)); gap:40px; }
.foot .brand { color:#fff; }
.foot p { margin:16px 0 0; max-width:36ch; }
.foot h4 { margin:0 0 14px; color:#fff; font-size:14px; font-weight:650; }
.foot ul { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:10px; }
.foot a { text-decoration:none; }
.foot a:hover { color:#fff; }
.legal { margin-top:48px; padding-top:24px; border-top:1px solid var(--night-line); display:flex; flex-wrap:wrap; justify-content:space-between; gap:12px; font-size:13.5px; }

:focus-visible { outline:2px solid var(--blue); outline-offset:3px; border-radius:6px; }

@media (max-width: 1040px) {
  .menu { display:none; }
  .hero .wrap, .split, .faq, .media { grid-template-columns:minmax(0, 1fr); }
  .hero .wrap { gap:48px; }
  .bento { grid-template-columns:repeat(2, minmax(0, 1fr)); }
  .plans { grid-template-columns:repeat(2, minmax(0, 1fr)); }
  .here { grid-template-columns:repeat(2, minmax(0, 1fr)); }
  .peek { right:8px; }
}
@media (max-width: 680px) {
  .section { padding-block:72px; }
  .hero { padding-block:40px 80px; }
  .lead { font-size:17px; }
  .top-cta .btn-line { display:none; }
  .sim-body { grid-template-columns:minmax(0, 1fr); min-height:0; }
  .sim-side { display:none; }
  .sim-chat { padding:16px 14px 14px; font-size:13.5px; }
  .ask, .sent { margin-left:0; }
  .peek { width:76px; bottom:-30px; }
  .bento, .plans, .steps, .packs { grid-template-columns:minmax(0, 1fr); }
  .here { grid-template-columns:minmax(0, 1fr); }
  .dl, .final { padding:36px 24px; border-radius:24px; grid-template-columns:minmax(0, 1fr); }
  .dl-art { display:none; }
  .final .mascot { width:120px; }
  .media { padding:24px; }
  .foot { grid-template-columns:minmax(0, 1fr) minmax(0, 1fr); }
  .foot > div:first-child { grid-column:1 / -1; }
}
@media (max-width: 440px) {
  .top-cta .btn-ink { display:none; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation:none !important; transition:none !important; }
  html { scroll-behavior:auto; }
}
</style>
</head>
<body>
<header class="top">
  <div class="wrap">
    <a class="brand" href="/">${logoTile(32)}${logoWord(25)}</a>
    <nav class="menu" aria-label="Baarali">
      <a href="#fonctions">${escape(t.nav.features)}</a>
      <a href="#etapes">${escape(t.nav.how)}</a>
      <a href="#tarifs">${escape(t.nav.prices)}</a>
      <a href="#questions">${escape(t.nav.faq)}</a>
    </nav>
    <div class="top-cta">
      <button class="theme" type="button" aria-label="${escape(t.theme)}" title="${escape(t.theme)}">${icon('sun', 'sun')}${icon('moon', 'moon')}</button>
      <a class="btn btn-line" href="/auth/v1/sign-in">${escape(t.navSignIn)}</a>
      ${primary.replace('btn btn-blue', 'btn btn-ink')}
    </div>
  </div>
</header>
<main>
<section class="hero">
  <div class="wrap">
    <div>
      <p class="pill"><b>${escape(t.beta)}</b>${escape(t.eyebrow)}</p>
      <h1>${titled(t.hero)}</h1>
      <p class="lead">${escape(t.lead)}</p>
      <div class="ctas">${primary}<a class="btn btn-line" href="#etapes">${escape(t.seeHow)}</a></div>
      <ul class="trust">${t.trust.map((x) => `<li>${icon('check')}${escape(x)}</li>`).join('')}</ul>
    </div>
    <div class="stage">${simulator}
      <div class="peek">${mascotTile()}</div>
    </div>
  </div>
</section>${download}
<section id="fonctions" class="section" aria-labelledby="features">
  <div class="wrap">
    <div class="head">
      <p class="kicker"><span class="num">01</span>${escape(t.featuresKicker)}</p>
      <h2 id="features">${titled(t.featuresTitle)}</h2>
      <p class="sub">${escape(t.featuresLead)}</p>
    </div>
    <div class="bento">${t.features
      .map(([h, p], i) => `<article class="feat"><div class="feat-head">${icon(featureIcons[i])}<h3>${escape(h)}</h3><p>${escape(p)}</p></div>${scenes[i]}</article>`)
      .join('')}</div>
  </div>
</section>
<section class="section night" aria-labelledby="control">
  <div class="wrap split">
    <div>
      <p class="kicker kicker-light"><span class="num">02</span>${escape(t.controlKicker)}</p>
      <h2 id="control">${titled(t.controlTitle)}</h2>
      <p class="sub">${escape(t.controlLead)}</p>
      <ul class="points">${t.control
        .map(([h, p], i) => `<li>${icon((['shield', 'lock', 'sliders'] as const)[i])}<div><h3>${escape(h)}</h3><p>${escape(p)}</p></div></li>`)
        .join('')}</ul>
    </div>
    <div class="queue">${t.requests
      .map(([h, p, st]) => `<div class="req req-${st}"><div><b>${escape(h)}</b><small>${escape(p)}</small></div><span class="state state-${st}">${escape(t.requestState[st as keyof typeof t.requestState])}</span></div>`)
      .join('')}</div>
  </div>
</section>
<section id="etapes" class="section" aria-labelledby="how">
  <div class="wrap">
    <div class="head">
      <p class="kicker"><span class="num">03</span>${escape(t.howKicker)}</p>
      <h2 id="how">${titled(t.howTitle)}</h2>
    </div>
    <ol class="steps">${t.how.map(([h, p]) => `<li><h3>${escape(h)}</h3><p>${escape(p)}</p></li>`).join('')}</ol>
  </div>
</section>
<section class="section blue" aria-labelledby="here">
  <div class="wrap">
    <p class="kicker"><span class="num">04</span>${escape(t.hereKicker)}</p>
    <h2 id="here">${titled(t.hereTitle)}</h2>
    <div class="here">${t.here.map(([b, p]) => `<div><b>${escape(b)}</b><p>${escape(p)}</p></div>`).join('')}</div>
  </div>
</section>
<section id="tarifs" class="section" aria-labelledby="prices">
  <div class="wrap">
    <div class="head head-center">
      <p class="kicker"><span class="num">05</span>${escape(t.pricesKicker)}</p>
      <h2 id="prices">${titled(t.pricesTitle)}</h2>
      <p class="sub">${escape(t.pricesLead)}</p>
    </div>
    <div class="plans">${others.map((o) => card(o)).join('')}${proCard}</div>
    <p class="fine">${escape(t.taxes)}</p>
    <div class="media" aria-labelledby="media">
      <div><h3 id="media">${escape(t.mediaTitle)}</h3><p class="sub">${escape(t.mediaLead)}</p></div>
      <div><ul class="packs">${packs}</ul><p class="fine">${escape(t.examples)}</p></div>
    </div>
  </div>
</section>
<section id="questions" class="section" aria-labelledby="faq">
  <div class="wrap faq">
    <div>
      <p class="kicker"><span class="num">06</span>${escape(t.faqKicker)}</p>
      <h2 id="faq">${titled(t.faqTitle)}</h2>
    </div>
    <div class="qa">${t.faq.map(([q, a]) => `<details><summary>${escape(q)}</summary><p>${escape(a)}</p></details>`).join('')}</div>
  </div>
</section>
<section class="wrap" aria-labelledby="final">
  <div class="final">
    <div>
      <h2 id="final">${titled(t.finalTitle)}</h2>
      <p>${escape(t.finalLead)}</p>
      ${data.downloadBase ? `<a class="btn btn-white" href="#telecharger">${escape(t.download)}${icon('arrow')}</a>` : `<a class="btn btn-white" href="/auth/v1/sign-in">${escape(t.start)}${icon('arrow')}</a>`}
    </div>
    ${mascot(240)}
  </div>
</section>
</main>
<footer>
  <div class="wrap">
    <div class="foot">
      <div>
        <a class="brand" href="/">${logoTile(30)}${logoWord(24)}</a>
        <p>${escape(t.description)}</p>
      </div>
      <div>
        <h4>${escape(t.footerProduct)}</h4>
        <ul>
          <li><a href="#fonctions">${escape(t.nav.features)}</a></li>
          <li><a href="#tarifs">${escape(t.nav.prices)}</a></li>
          ${data.downloadBase ? `<li><a href="#telecharger">${escape(t.downloadKicker)}</a></li>` : ''}
          <li><a href="#questions">${escape(t.nav.faq)}</a></li>
        </ul>
      </div>
      <div>
        <h4>${escape(t.footerAccount)}</h4>
        <ul>
          <li><a href="/auth/v1/sign-in">${escape(t.navSignIn)}</a></li>
          <li><a href="/auth/v1/sign-in">${escape(t.footerCreate)}</a></li>
          <li><a href="mailto:${CONTACT}">${CONTACT}</a></li>
        </ul>
      </div>
      <div>
        <h4>${escape(t.footerLegal)}</h4>
        <ul>${legalLinks(opts.lang).map((l) => `<li><a href="${l.href}">${escape(l.label)}</a></li>`).join('')}</ul>
      </div>
    </div>
    <div class="legal"><span>© ${new Date().getFullYear()} OpenBaara SAS · Burkina Faso</span><span>${escape(t.footer)}</span></div>
  </div>
</footer>
<script nonce="${opts.nonce}">
"use strict";
for (const b of document.querySelectorAll(".levels button")) {
  b.addEventListener("click", () => {
    for (const o of document.querySelectorAll(".levels button")) o.setAttribute("aria-checked", String(o === b));
    for (const l of document.querySelectorAll(".level")) l.hidden = l.dataset.level !== b.dataset.level;
  });
}
// Light or dark: the switch wins over the system, and is remembered.
const root = document.documentElement;
document.querySelector(".theme").addEventListener("click", () => {
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("baarali-theme", root.dataset.theme); } catch {}
});
const top = document.querySelector(".top");
const onScroll = () => top.classList.toggle("scrolled", window.scrollY > 8);
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();
// The bars of the voice scene, each its own height.
for (const i of document.querySelectorAll(".s-wave i")) i.style.animationDuration = (1.1 + Number(i.dataset.h) / 10) + "s";
// The simulator replays the conversation, unless motion is turned down.
const sim = document.querySelector(".sim");
if (sim && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const steps = [...sim.querySelectorAll("[data-step]")];
  const yes = sim.querySelector("[data-yes]");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const replay = sim.querySelector(".replay");
  let runs = 0;
  const run = async () => {
    runs += 1;
    replay.hidden = true;
    sim.classList.add("play");
    for (const s of steps) s.classList.remove("show");
    await wait(600);
    for (const n of [1, 2, 3]) {
      for (const s of steps) if (Number(s.dataset.step) === n) s.classList.add("show");
      await wait(n === 3 ? 2200 : 1500);
    }
    yes.classList.add("press");
    await wait(260);
    yes.classList.remove("press");
    for (const s of steps) if (s.dataset.step === "4") s.classList.add("show");
    // Two rounds on its own, then it waits to be asked again.
    if (runs < 2) { await wait(5200); run(); } else replay.hidden = false;
  };
  replay.addEventListener("click", () => { runs = 0; run(); });
  run();
}
</script>
</body>
</html>`;
}

/** The character on its blue tile, peeking from behind the simulator. */
function mascotTile(): string {
  return `<svg class="tile mascot" viewBox="0 0 120 120" width="104" height="104" aria-hidden="true" focusable="false"><rect width="120" height="120" rx="27" fill="#1A6DFF"/><g transform="translate(-61.3 -42) scale(.24)">${mascot(380).replace(/<svg[^>]*>|<\/svg>/g, '')}</g></svg>`;
}
