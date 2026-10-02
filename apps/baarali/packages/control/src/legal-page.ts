import { FAVICON, logoTile, logoWord, LOGO_ALIVE_CSS, LOGO_ALIVE_JS, logoTileLive } from './logo.js';
import { pickLang } from './sign-in-page.js';

// The legal pages of baarali.com (decided 01/10/2026, before the first real
// test): who publishes Baarali, what is done with personal data, and the
// terms of use. Facts only: every host and processor named here is one the
// code calls (main.ts, fly.toml), nothing more. The company's registration
// details are shown once COMPANY has them, never invented. Strings live here
// until @baarali/i18n exists (roadmap phase 1).

type Lang = 'fr' | 'en';
export type LegalDoc = 'mentions' | 'privacy' | 'terms';

/** Where each document lives; the same path in both languages. */
export const LEGAL_PATHS: Record<LegalDoc, string> = {
  mentions: '/mentions-legales',
  privacy: '/confidentialite',
  terms: '/conditions',
};

export const CONTACT = 'contact@baarali.com';

/** Filled in as the registration completes; an empty field is not shown. */
const COMPANY = { name: 'OpenBaara SAS', country: 'Burkina Faso', capital: '', rccm: '', address: '' };

const VERSION = '1.0';

/** A paragraph, a list, a table, or a highlighted note. */
type Block = string | { list: string[] } | { table: { head: string[]; rows: string[][] } } | { note: string };
interface Section {
  id: string;
  title: string;
  blocks: Block[];
}
interface Doc {
  kicker: string;
  title: [string, string, string];
  lead: string;
  /** The page in four points, before the articles. */
  summary?: Array<[string, string]>;
  sections: Section[];
}

const company = (lang: Lang): Block[] => {
  const fr = lang === 'fr';
  const rows: string[][] = [
    [fr ? 'Dénomination' : 'Company name', COMPANY.name],
    [fr ? 'Forme' : 'Legal form', fr ? 'Société par actions simplifiée (droit OHADA)' : 'Simplified joint-stock company (OHADA law)'],
    [fr ? 'Pays' : 'Country', COMPANY.country],
  ];
  if (COMPANY.capital) rows.push([fr ? 'Capital' : 'Share capital', COMPANY.capital]);
  if (COMPANY.rccm) rows.push(['RCCM', COMPANY.rccm]);
  if (COMPANY.address) rows.push([fr ? 'Siège' : 'Registered office', COMPANY.address]);
  rows.push([fr ? 'Contact' : 'Contact', CONTACT]);
  rows.push([fr ? 'Directeur de la publication' : 'Publication director', fr ? `Le président d’${COMPANY.name}` : `The president of ${COMPANY.name}`]);
  return [{ table: { head: [fr ? 'Élément' : 'Item', fr ? 'Information' : 'Details'], rows } }];
};

const DOCS: Record<Lang, Record<LegalDoc, Doc>> = {
  fr: {
    mentions: {
      kicker: 'Mentions légales',
      title: ['Qui ', 'publie', ' Baarali.'],
      lead: 'Les informations sur l’éditeur du site et de l’application, leur hébergement et la propriété de la marque.',
      sections: [
        { id: 'editeur', title: 'Éditeur', blocks: ['Le site baarali.com et l’application Baarali sont édités par :', ...company('fr')] },
        {
          id: 'hebergement',
          title: 'Hébergement',
          blocks: [
            'Le site, l’application et les espaces de travail sont hébergés par les prestataires suivants :',
            { table: { head: ['Prestataire', 'Rôle', 'Localisation des serveurs'], rows: [['Fly.io, Inc.', 'Site, application, espaces de travail', 'Paris, France'], ['Neon', 'Base de données des comptes', 'Francfort, Allemagne']] } },
          ],
        },
        {
          id: 'propriete',
          title: 'Propriété intellectuelle',
          blocks: [
            `Le nom Baarali, son logo, son personnage, ses textes et ses visuels sont la propriété d’${COMPANY.name}. Toute reproduction, représentation ou adaptation, totale ou partielle, sans autorisation écrite est interdite.`,
            'Les exemples présentés sur le site (noms de clients, devis, messages) sont fictifs et servent d’illustration.',
          ],
        },
        {
          id: 'logiciels',
          title: 'Logiciels libres',
          blocks: ['Certaines parties de l’application reposent sur des logiciels libres, utilisés dans le respect de leurs licences respectives.', 'Les polices Inter, Source Serif 4 et Instrument Serif (dont le nom Baarali est dessiné) sont distribuées sous licence SIL Open Font License 1.1.'],
        },
        {
          id: 'responsabilite',
          title: 'Responsabilité',
          blocks: ['Les informations du site sont fournies à titre indicatif et peuvent évoluer. Les prix affichés sont hors taxes. Les liens vers des sites tiers n’engagent pas leur contenu.'],
        },
        { id: 'contact', title: 'Nous écrire', blocks: [`Pour toute question, ou pour signaler un contenu : ${CONTACT}.`] },
      ],
    },
    privacy: {
      kicker: 'Confidentialité',
      title: ['Vos données ', 'restent les vôtres', '.'],
      lead: 'Ce que nous collectons, pourquoi, où c’est stocké, avec qui nous travaillons, et comment exercer vos droits.',
      summary: [
        ['Le minimum', 'Nous ne collectons que ce qui fait fonctionner Baarali.'],
        ['Aucune revente', 'Pas de publicité, pas de traceurs publicitaires, aucune vente de données.'],
        ['Votre espace', 'Votre travail vit dans un espace séparé de celui des autres.'],
        ['Vous décidez', 'Accès, correction, export ou suppression, sur simple demande.'],
      ],
      sections: [
        { id: 'responsable', title: 'Responsable du traitement', blocks: [`${COMPANY.name}, ${COMPANY.country}, est responsable du traitement de vos données personnelles. Contact : ${CONTACT}.`] },
        {
          id: 'donnees',
          title: 'Les données que nous traitons',
          blocks: [
            {
              table: {
                head: ['Catégorie', 'Exemples', 'Pourquoi', 'Durée'],
                rows: [
                  ['Compte', 'Email ou téléphone, date de création', 'Vous connecter, vous identifier', 'Tant que le compte existe'],
                  ['Codes de connexion', 'Code à 6 chiffres', 'Vérifier que c’est bien vous', '5 minutes'],
                  ['Travail', 'Conversations, fichiers, mémoire de l’assistant', 'Faire fonctionner l’assistant', 'Tant que le compte existe'],
                  ['Utilisation', 'Consommation du forfait et des crédits médias', 'Décompter et facturer', 'Tant que le compte existe, puis selon les obligations comptables'],
                  ['Appareils', 'Nom de l’appareil, dernière connexion', 'Vous laisser retirer un appareil', 'Jusqu’au retrait de l’appareil'],
                  ['Échanges', 'Vos emails au support', 'Vous répondre', '3 ans après le dernier échange'],
                ],
              },
            },
            'Nous n’utilisons pas vos conversations pour entraîner des modèles d’IA.',
          ],
        },
        {
          id: 'bases',
          title: 'Bases légales',
          blocks: [{ list: ['L’exécution du contrat : vous fournir le service que vous avez demandé.', 'L’intérêt légitime : protéger votre compte et prévenir les abus.', 'L’obligation légale : conserver les éléments de facturation.'] }],
        },
        {
          id: 'hebergement',
          title: 'Où sont vos données',
          blocks: ['Chaque compte a son propre espace de travail, séparé des autres, hébergé à Paris (France), sans adresse publique : il n’est joignable qu’avec une clé valide. Les données de compte sont stockées à Francfort (Allemagne).'],
        },
        {
          id: 'prestataires',
          title: 'Nos prestataires',
          blocks: [
            {
              table: {
                head: ['Prestataire', 'Rôle', 'Localisation'],
                rows: [
                  ['Fly.io', 'Hébergement du site, de l’application et des espaces de travail', 'Paris, France'],
                  ['Neon', 'Base de données des comptes', 'Francfort, Allemagne'],
                  ['Resend', 'Envoi des codes de connexion par email', 'États-Unis'],
                  ['OpenRouter', 'Acheminement de vos demandes vers les modèles d’IA', 'États-Unis, puis le fournisseur du modèle'],
                  ['Pixazo', 'Génération des vidéos, voix et musiques', 'Hors Union européenne'],
                ],
              },
            },
            { note: 'Quand vous posez une question à l’assistant, seul ce qui est nécessaire à la demande est transmis au modèle d’IA. Vos fichiers ne sont envoyés que si la tâche en a besoin.' },
          ],
        },
        {
          id: 'transferts',
          title: 'Transferts hors de l’Union européenne',
          blocks: ['Certains prestataires traitent des données hors de l’Union européenne et du Burkina Faso. Nous ne leur confions que ce qui est nécessaire au service, et nous choisissons des prestataires qui s’engagent contractuellement à protéger ces données.'],
        },
        {
          id: 'cookies',
          title: 'Cookies et stockage local',
          blocks: [
            { table: { head: ['Élément', 'Rôle', 'Durée'], rows: [['Cookie de session', 'Garder votre connexion pendant la connexion à l’application', 'Le temps de la session'], ['Thème (stockage local)', 'Retenir votre choix, clair ou sombre', 'Jusqu’à ce que vous le changiez']] } },
            'Aucun cookie publicitaire ni de mesure d’audience tierce.',
          ],
        },
        {
          id: 'securite',
          title: 'Sécurité',
          blocks: [{ list: ['Connexion par un code à usage unique, ou par un mot de passe choisi juste après un code et gardé seulement sous forme d’empreinte.', 'Clés d’appareil conservées uniquement sous forme d’empreinte, révocables une par une.', 'Espaces de travail séparés, sans adresse publique.', 'Échanges chiffrés (HTTPS) de bout en bout entre l’application et nos serveurs.'] }],
        },
        {
          id: 'droits',
          title: 'Vos droits',
          blocks: [
            'Vous pouvez à tout moment demander :',
            { list: ['l’accès à vos données ;', 'leur correction ;', 'leur suppression, avec celle de votre compte ;', 'leur export dans un format lisible ;', 'la limitation ou l’opposition à un traitement.'] },
            `Écrivez à ${CONTACT}. Nous répondons sous 30 jours.`,
            'Ces droits sont garantis par la loi burkinabè n° 001-2021/AN portant protection des personnes à l’égard du traitement des données à caractère personnel et, si vous êtes dans l’Union européenne, par le RGPD. Vous pouvez saisir la Commission de l’informatique et des libertés (CIL) du Burkina Faso, ou l’autorité de protection des données de votre pays.',
          ],
        },
        { id: 'mineurs', title: 'Mineurs', blocks: ['Baarali est ouvert à partir de 13 ans. Entre 13 et 18 ans, il faut l’accord d’un parent ou d’un tuteur, qui souscrit lui-même tout forfait payant. Si vous pensez qu’un enfant de moins de 13 ans a créé un compte, écrivez-nous : nous le supprimerons.'] },
        { id: 'changements', title: 'Modifications', blocks: ['Nous vous préviendrons de tout changement important de cette politique, par email ou dans l’application, avant qu’il ne s’applique.'] },
      ],
    },
    terms: {
      kicker: 'Conditions d’utilisation',
      title: ['Les règles, ', 'clairement', '.'],
      lead: 'Les conditions qui encadrent l’utilisation de Baarali, du site et de l’application.',
      summary: [
        ['Vous décidez', 'Les actions qui engagent attendent votre accord.'],
        ['C’est à vous', 'Ce que l’assistant produit pour vous vous appartient.'],
        ['Sans engagement', 'Changez de forfait ou partez quand vous voulez.'],
        ['Accès anticipé', 'Le service évolue : on vous prévient des changements.'],
      ],
      sections: [
        { id: 'objet', title: 'Objet', blocks: [`Ces conditions encadrent l’utilisation de Baarali, assistant édité par ${COMPANY.name}. En créant un compte, vous les acceptez.`] },
        {
          id: 'definitions',
          title: 'Définitions',
          blocks: [{ list: ['« Assistant » : le service Baarali, qui cherche, rédige, organise et crée pour vous.', '« Espace de travail » : l’environnement séparé où vivent votre travail et la mémoire de l’assistant.', '« Action engageante » : une action faite en votre nom vers l’extérieur, comme envoyer, publier ou payer.', '« Crédits médias » : les crédits qui paient les vidéos, voix et musiques.'] }],
        },
        { id: 'acces', title: 'Accès anticipé', blocks: ['Baarali est en accès anticipé. Le service évolue, peut changer ou s’interrompre ponctuellement. Nous faisons de notre mieux pour vous prévenir avant tout changement important.'] },
        { id: 'compte', title: 'Votre compte', blocks: ['Baarali est ouvert à partir de 13 ans, avec l’accord d’un parent avant 18 ans. Vous vous connectez avec votre email ou votre téléphone, par un code à usage unique, ou avec le mot de passe que vous avez choisi. Vous êtes responsable de ce qui se fait avec votre compte et de vos appareils connectés ; prévenez-nous si vous pensez qu’il est utilisé par quelqu’un d’autre.'] },
        {
          id: 'accord',
          title: 'L’assistant et votre accord',
          blocks: ['Avant toute action engageante, l’assistant vous montre ce qu’il s’apprête à faire et attend votre accord. Vous pouvez refuser ou corriger.', { note: 'Ce que vous approuvez est fait en votre nom et sous votre responsabilité.' }],
        },
        {
          id: 'contenus',
          title: 'Ce qu’il produit',
          blocks: ['Les contenus produits pour vous vous appartiennent, dans le respect des droits des tiers. Une IA peut se tromper : relisez avant d’utiliser un résultat, en particulier pour les chiffres, le droit, la santé ou l’argent.'],
        },
        {
          id: 'usage',
          title: 'Utilisation interdite',
          blocks: ['Il est interdit d’utiliser Baarali pour :', { list: ['toute activité illégale, frauduleuse ou trompeuse ;', 'l’envoi de messages non sollicités en masse ;', 'le harcèlement, la haine ou la violence ;', 'porter atteinte aux droits d’autrui, notamment à la vie privée et à la propriété intellectuelle ;', 'tenter d’accéder aux espaces d’autres personnes ou de contourner les limites du service.'] }, 'Nous pouvons suspendre un compte qui ne respecte pas ces règles.'],
        },
        {
          id: 'forfaits',
          title: 'Forfaits, crédits et paiement',
          blocks: [{ list: ['Les prix sont affichés hors taxes, en euros et en F CFA.', 'L’utilisation des forfaits se renouvelle toutes les 5 heures et chaque semaine.', 'Les crédits médias n’expirent pas ; une génération qui échoue est remboursée.', 'Vous pouvez changer de forfait à tout moment.', 'Le paiement en ligne, par Mobile Money et par carte, arrive bientôt.'] }],
        },
        { id: 'disponibilite', title: 'Disponibilité', blocks: ['Nous faisons notre possible pour que Baarali soit disponible en continu, sans pouvoir le garantir. Des interruptions peuvent avoir lieu pour maintenance ou en cas d’incident.'] },
        { id: 'fin', title: 'Fermeture du compte', blocks: [`Vous pouvez fermer votre compte à tout moment en écrivant à ${CONTACT}. Si nous arrêtions Baarali, nous vous préviendrions à l’avance pour que vous puissiez récupérer votre travail.`] },
        { id: 'responsabilite', title: 'Responsabilité', blocks: [`Dans les limites permises par la loi, ${COMPANY.name} n’est pas responsable des dommages indirects liés à l’utilisation du service, ni des actions que vous avez approuvées.`] },
        { id: 'modifications', title: 'Modifications', blocks: ['Nous pouvons faire évoluer ces conditions. Nous vous préviendrons de tout changement important avant qu’il ne s’applique.'] },
        { id: 'droit', title: 'Droit applicable et litiges', blocks: [`Ces conditions sont soumises au droit burkinabè. En cas de désaccord, écrivez-nous d’abord à ${CONTACT} : nous cherchons toujours une solution à l’amiable.`] },
      ],
    },
  },
  en: {
    mentions: {
      kicker: 'Legal notice',
      title: ['Who ', 'publishes', ' Baarali.'],
      lead: 'Information about the publisher of the site and the app, their hosting and the ownership of the brand.',
      sections: [
        { id: 'editeur', title: 'Publisher', blocks: ['The baarali.com site and the Baarali app are published by:', ...company('en')] },
        {
          id: 'hebergement',
          title: 'Hosting',
          blocks: [
            'The site, the app and the workspaces are hosted by the following providers:',
            { table: { head: ['Provider', 'Role', 'Server location'], rows: [['Fly.io, Inc.', 'Site, app, workspaces', 'Paris, France'], ['Neon', 'Account database', 'Frankfurt, Germany']] } },
          ],
        },
        {
          id: 'propriete',
          title: 'Intellectual property',
          blocks: [
            `The Baarali name, logo, character, texts and visuals are the property of ${COMPANY.name}. Any reproduction, representation or adaptation, in whole or in part, without written permission is forbidden.`,
            'The examples shown on the site (client names, quotes, messages) are fictional and for illustration.',
          ],
        },
        { id: 'logiciels', title: 'Free software', blocks: ['Parts of the app rely on free software, used in accordance with their respective licences.', 'The Inter, Source Serif 4 and Instrument Serif (from which the Baarali name is drawn) fonts are distributed under the SIL Open Font License 1.1.'] },
        { id: 'responsabilite', title: 'Liability', blocks: ['The information on the site is provided for guidance and may change. Prices exclude taxes. Links to third-party sites do not make us responsible for their content.'] },
        { id: 'contact', title: 'Write to us', blocks: [`For any question, or to report content: ${CONTACT}.`] },
      ],
    },
    privacy: {
      kicker: 'Privacy',
      title: ['Your data ', 'stays yours', '.'],
      lead: 'What we collect, why, where it is stored, who we work with, and how to exercise your rights.',
      summary: [
        ['The minimum', 'We only collect what makes Baarali work.'],
        ['No selling', 'No advertising, no ad trackers, no data sold.'],
        ['Your space', 'Your work lives in a space separate from everyone else’s.'],
        ['You decide', 'Access, correction, export or deletion, just ask.'],
      ],
      sections: [
        { id: 'responsable', title: 'Data controller', blocks: [`${COMPANY.name}, ${COMPANY.country}, is the controller of your personal data. Contact: ${CONTACT}.`] },
        {
          id: 'donnees',
          title: 'The data we process',
          blocks: [
            {
              table: {
                head: ['Category', 'Examples', 'Why', 'How long'],
                rows: [
                  ['Account', 'Email or phone, creation date', 'Signing you in, identifying you', 'As long as the account exists'],
                  ['Sign-in codes', '6-digit code', 'Checking it is you', '5 minutes'],
                  ['Work', 'Conversations, files, the assistant’s memory', 'Running the assistant', 'As long as the account exists'],
                  ['Usage', 'Plan and media credit consumption', 'Counting and billing', 'As long as the account exists, then as accounting rules require'],
                  ['Devices', 'Device name, last seen', 'Letting you remove a device', 'Until the device is removed'],
                  ['Messages', 'Your emails to support', 'Answering you', '3 years after the last exchange'],
                ],
              },
            },
            'We do not use your conversations to train AI models.',
          ],
        },
        { id: 'bases', title: 'Legal bases', blocks: [{ list: ['Performing the contract: providing the service you asked for.', 'Legitimate interest: protecting your account and preventing abuse.', 'Legal obligation: keeping billing records.'] }] },
        { id: 'hebergement', title: 'Where your data is', blocks: ['Each account has its own workspace, separate from the others, hosted in Paris (France), with no public address: it can only be reached with a valid key. Account data is stored in Frankfurt (Germany).'] },
        {
          id: 'prestataires',
          title: 'Our providers',
          blocks: [
            {
              table: {
                head: ['Provider', 'Role', 'Location'],
                rows: [
                  ['Fly.io', 'Hosting the site, the app and the workspaces', 'Paris, France'],
                  ['Neon', 'Account database', 'Frankfurt, Germany'],
                  ['Resend', 'Sending sign-in codes by email', 'United States'],
                  ['OpenRouter', 'Routing your requests to AI models', 'United States, then the model provider'],
                  ['Pixazo', 'Generating videos, voices and music', 'Outside the European Union'],
                ],
              },
            },
            { note: 'When you ask the assistant something, only what the request needs is sent to the AI model. Your files are only sent when the task needs them.' },
          ],
        },
        { id: 'transferts', title: 'Transfers outside the European Union', blocks: ['Some providers process data outside the European Union and Burkina Faso. We only give them what the service needs, and we choose providers that commit by contract to protect that data.'] },
        {
          id: 'cookies',
          title: 'Cookies and local storage',
          blocks: [
            { table: { head: ['Item', 'Role', 'How long'], rows: [['Session cookie', 'Keeping you signed in while you connect the app', 'For the session'], ['Theme (local storage)', 'Remembering your light or dark choice', 'Until you change it']] } },
            'No advertising cookies and no third-party analytics.',
          ],
        },
        { id: 'securite', title: 'Security', blocks: [{ list: ['Sign-in with a one-time code, or a password chosen right after a code and kept only as a hash.', 'Device keys kept only as a hash, revocable one by one.', 'Separate workspaces, with no public address.', 'Encrypted traffic (HTTPS) between the app and our servers.'] }] },
        {
          id: 'droits',
          title: 'Your rights',
          blocks: [
            'At any time you can ask for:',
            { list: ['access to your data;', 'its correction;', 'its deletion, together with your account;', 'its export in a readable format;', 'the restriction of, or objection to, a processing.'] },
            `Write to ${CONTACT}. We answer within 30 days.`,
            'These rights are guaranteed by Burkina Faso law no. 001-2021/AN on the protection of personal data and, if you are in the European Union, by the GDPR. You can contact the Commission de l’informatique et des libertés (CIL) of Burkina Faso, or the data protection authority of your country.',
          ],
        },
        { id: 'mineurs', title: 'Minors', blocks: ['Baarali is open from age 13. Between 13 and 18, a parent or guardian must agree, and subscribes to any paid plan themselves. If you think a child under 13 has created an account, write to us: we will delete it.'] },
        { id: 'changements', title: 'Changes', blocks: ['We will tell you about any important change to this policy, by email or in the app, before it applies.'] },
      ],
    },
    terms: {
      kicker: 'Terms of use',
      title: ['The rules, ', 'plainly', '.'],
      lead: 'The terms that govern the use of Baarali, the site and the app.',
      summary: [
        ['You decide', 'Binding actions wait for your approval.'],
        ['It is yours', 'What the assistant produces for you belongs to you.'],
        ['No commitment', 'Change plans or leave whenever you want.'],
        ['Early access', 'The service evolves: we tell you about changes.'],
      ],
      sections: [
        { id: 'objet', title: 'Purpose', blocks: [`These terms govern the use of Baarali, an assistant published by ${COMPANY.name}. By creating an account, you accept them.`] },
        {
          id: 'definitions',
          title: 'Definitions',
          blocks: [{ list: ['“Assistant”: the Baarali service, which researches, writes, organizes and creates for you.', '“Workspace”: the separate environment where your work and the assistant’s memory live.', '“Binding action”: an action taken in your name towards the outside, such as sending, posting or paying.', '“Media credits”: the credits that pay for videos, voices and music.'] }],
        },
        { id: 'acces', title: 'Early access', blocks: ['Baarali is in early access. The service evolves, may change or be briefly interrupted. We do our best to warn you before any important change.'] },
        { id: 'compte', title: 'Your account', blocks: ['Baarali is open from age 13, with a parent’s agreement under 18. You sign in with your email or phone, with a one-time code, or with the password you chose. You are responsible for what is done with your account and your connected devices; tell us if you think someone else is using it.'] },
        { id: 'accord', title: 'The assistant and your approval', blocks: ['Before any binding action, the assistant shows you what it is about to do and waits for your approval. You can decline or correct it.', { note: 'What you approve is done in your name and under your responsibility.' }] },
        { id: 'contenus', title: 'What it produces', blocks: ['Content produced for you belongs to you, subject to the rights of others. An AI can be wrong: check a result before you use it, especially for figures, law, health or money.'] },
        {
          id: 'usage',
          title: 'Forbidden use',
          blocks: ['You may not use Baarali for:', { list: ['any illegal, fraudulent or misleading activity;', 'sending unsolicited messages in bulk;', 'harassment, hate or violence;', 'infringing the rights of others, including privacy and intellectual property;', 'trying to reach other people’s spaces or to get around the limits of the service.'] }, 'We may suspend an account that breaks these rules.'],
        },
        {
          id: 'forfaits',
          title: 'Plans, credits and payment',
          blocks: [{ list: ['Prices are shown excluding taxes, in euros and CFA francs.', 'Plan usage renews every 5 hours and every week.', 'Media credits do not expire; a failed generation is refunded.', 'You can change plans at any time.', 'Online payment, by mobile money and card, is coming soon.'] }],
        },
        { id: 'disponibilite', title: 'Availability', blocks: ['We do our best to keep Baarali available at all times, without being able to guarantee it. Interruptions may happen for maintenance or in case of incident.'] },
        { id: 'fin', title: 'Closing your account', blocks: [`You can close your account at any time by writing to ${CONTACT}. If we ever stopped Baarali, we would tell you in advance so you can take your work with you.`] },
        { id: 'responsabilite', title: 'Liability', blocks: [`To the extent the law allows, ${COMPANY.name} is not liable for indirect damage arising from the use of the service, nor for actions you approved.`] },
        { id: 'modifications', title: 'Changes', blocks: ['We may update these terms. We will tell you about any important change before it applies.'] },
        { id: 'droit', title: 'Governing law and disputes', blocks: [`These terms are governed by the law of Burkina Faso. If we disagree, write to us first at ${CONTACT}: we always look for an amicable solution.`] },
      ],
    },
  },
};

const UI = {
  fr: {
    names: { mentions: 'Mentions légales', privacy: 'Confidentialité', terms: 'Conditions d’utilisation' } as Record<LegalDoc, string>,
    home: 'Accueil',
    prices: 'Tarifs',
    signIn: 'Se connecter',
    contents: 'Sommaire',
    inForce: 'En vigueur le 1er octobre 2026',
    version: 'Version',
    summary: 'En bref',
    question: 'Une question ?',
    questionLead: 'Écrivez-nous, nous répondons sous 30 jours, souvent bien avant.',
    write: 'Nous écrire',
    theme: 'Changer de thème : clair ou sombre',
    top: 'Haut de page',
  },
  en: {
    names: { mentions: 'Legal notice', privacy: 'Privacy', terms: 'Terms of use' } as Record<LegalDoc, string>,
    home: 'Home',
    prices: 'Pricing',
    signIn: 'Sign in',
    contents: 'Contents',
    inForce: 'In force on 1 October 2026',
    version: 'Version',
    summary: 'In short',
    question: 'A question?',
    questionLead: 'Write to us, we answer within 30 days, often much sooner.',
    write: 'Write to us',
    theme: 'Switch theme: light or dark',
    top: 'Back to top',
  },
};

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The legal links, for the footers of the other pages. */
export function legalLinks(acceptLanguage: string | null): Array<{ href: string; label: string }> {
  const t = UI[pickLang(acceptLanguage)];
  return (Object.keys(LEGAL_PATHS) as LegalDoc[]).map((d) => ({ href: LEGAL_PATHS[d], label: t.names[d] }));
}

function block(b: Block): string {
  if (typeof b === 'string') return `<p>${escape(b)}</p>`;
  if ('list' in b) return `<ul>${b.list.map((x) => `<li>${escape(x)}</li>`).join('')}</ul>`;
  if ('note' in b) return `<p class="note">${escape(b.note)}</p>`;
  return `<div class="table"><table><thead><tr>${b.table.head.map((h) => `<th scope="col">${escape(h)}</th>`).join('')}</tr></thead><tbody>${b.table.rows
    .map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${escape(c)}</th>` : `<td>${escape(c)}</td>`)).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

const SUN = '<svg class="i sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>';
const MOON = '<svg class="i moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';

export function legalPage(doc: LegalDoc, opts: { lang: string | null; nonce: string }): string {
  const lang = pickLang(opts.lang);
  const t = UI[lang];
  const d = DOCS[lang][doc];
  const tabs = (Object.keys(LEGAL_PATHS) as LegalDoc[])
    .map((k) => (k === doc ? `<a class="tab on" aria-current="page" href="${LEGAL_PATHS[k]}">${escape(t.names[k])}</a>` : `<a class="tab" href="${LEGAL_PATHS[k]}">${escape(t.names[k])}</a>`))
    .join('');
  const num = (i: number) => String(i + 1).padStart(2, '0');
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escape(t.names[doc])} — Baarali</title>
<meta name="description" content="${escape(d.lead)}">
<link rel="icon" href="${FAVICON}">
<script nonce="${opts.nonce}">
try { const v = localStorage.getItem("baarali-theme"); if (v === "light" || v === "dark") document.documentElement.dataset.theme = v; } catch {}
</script>
<style nonce="${opts.nonce}">
@font-face { font-family:"Inter"; src:url(/assets/inter.woff2) format("woff2"); font-weight:400 800; font-display:swap; }
@font-face { font-family:"Source Serif 4"; src:url(/assets/source-serif-4.woff2) format("woff2"); font-weight:400 700; font-style:normal; font-display:swap; }
/* The home page's palette and type (home-page.ts), in both themes. */
:root { --paper:#ffffff; --mist:#f5f5f5; --surface:#ffffff; --line:#e7e7e7; --ink:#0d0d0d; --on-ink:#ffffff; --text:#2b2b2b; --muted:#5d5d5d; --blue:#1a6dff; --blue-deep:#155eef; --blue-soft:#eef3ff; --blue-line:#d3e0ff; --top-bg:rgb(255 255 255 / .85); --night:#f5f5f5; --night-line:#e7e7e7; --night-muted:#5d5d5d; --night-2:#ffffff; --surface-2:#fafafa; --dot:#e3e3e3; --skeleton:#e0e0e0; --hover-line:#cfcfcf; --glass:rgb(255 255 255 / .7); --track:#e5e5e5; --featured:#ffffff; --featured-line:#155eef; color-scheme:light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --paper:#212121; --mist:#1a1a1a; --surface:#2a2a2a; --line:#333333; --ink:#ececec; --on-ink:#0d0d0d; --text:#d4d4d4; --muted:#a6a6a6; --blue:#4d8dff; --blue-deep:#1a6dff; --blue-soft:#1d2738; --blue-line:#2f4670; --top-bg:rgb(33 33 33 / .85); --night:#1a1a1a; --night-2:#2a2a2a; --night-line:#333333; --night-muted:#a6a6a6; --surface-2:#262626; --dot:#3a3a3a; --skeleton:#3a3a3a; --hover-line:#474747; --glass:rgb(42 42 42 / .7); --track:#3a3a3a; --featured:#2a2a2a; --featured-line:#4d8dff; color-scheme:dark; } }
:root[data-theme="dark"] { --paper:#212121; --mist:#1a1a1a; --surface:#2a2a2a; --line:#333333; --ink:#ececec; --on-ink:#0d0d0d; --text:#d4d4d4; --muted:#a6a6a6; --blue:#4d8dff; --blue-deep:#1a6dff; --blue-soft:#1d2738; --blue-line:#2f4670; --top-bg:rgb(33 33 33 / .85); --night:#1a1a1a; --night-2:#2a2a2a; --night-line:#333333; --night-muted:#a6a6a6; --surface-2:#262626; --dot:#3a3a3a; --skeleton:#3a3a3a; --hover-line:#474747; --glass:rgb(42 42 42 / .7); --track:#3a3a3a; --featured:#2a2a2a; --featured-line:#4d8dff; color-scheme:dark; }
* { box-sizing:border-box; }
html { scroll-behavior:smooth; scroll-padding-top:96px; }
body { margin:0; background:var(--paper); color:var(--text); font:16px/1.7 "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing:antialiased; }
a { color:inherit; }
.wrap { max-width:1180px; margin:0 auto; padding-inline:20px; }
.i { width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
.top { position:sticky; top:env(safe-area-inset-top, 0px); z-index:20; background:var(--top-bg); backdrop-filter:saturate(1.6) blur(14px); -webkit-backdrop-filter:saturate(1.6) blur(14px); border-bottom:1px solid var(--line); }
.top .wrap { display:flex; align-items:center; justify-content:space-between; gap:16px; min-height:68px; }
.brand { display:flex; align-items:center; gap:10px; color:var(--ink); text-decoration:none; }
.menu { display:flex; align-items:center; gap:10px; font-size:14.5px; }
.menu a { text-decoration:none; color:var(--muted); padding:8px 10px; }
.menu a:hover { color:var(--ink); }
.menu .btn { color:var(--on-ink); background:var(--ink); border-radius:999px; padding:9px 16px; font-weight:650; }
.theme { display:inline-flex; align-items:center; justify-content:center; width:40px; height:40px; border-radius:50%; border:1px solid var(--line); background:var(--surface); color:var(--ink); cursor:pointer; padding:0; }
.theme .moon, :root[data-theme="dark"] .theme .sun { display:none; }
:root[data-theme="dark"] .theme .moon { display:block; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .theme .sun { display:none; } :root:not([data-theme="light"]) .theme .moon { display:block; } }
.hero { position:relative; overflow:hidden; background:var(--mist); border-bottom:1px solid var(--line); padding-block:64px 0; }
.hero .wrap { position:relative; }
.kicker { display:inline-flex; align-items:center; gap:8px; margin:0 0 16px; font-size:13px; font-weight:650; letter-spacing:.08em; text-transform:uppercase; color:var(--blue-deep); }
.kicker::before { content:""; width:6px; height:6px; border-radius:50%; background:var(--blue); }
h1 { font-family:"Source Serif 4", Georgia, serif; margin:0; color:var(--ink); font-size:clamp(38px, 6vw, 64px); line-height:1.04; letter-spacing:-.022em; font-weight:500; text-wrap:balance; }
h1 em { font-family:inherit; font-style:normal; font-weight:inherit; letter-spacing:inherit; color:var(--blue); }
.lead { margin:18px 0 0; max-width:60ch; color:var(--muted); font-size:18px; }
.meta { display:flex; flex-wrap:wrap; gap:8px; margin:24px 0 0; padding:0; list-style:none; }
.meta li { font-size:13px; font-weight:600; color:var(--muted); background:var(--surface); border:1px solid var(--line); border-radius:999px; padding:5px 12px; }
.tabs { display:flex; gap:4px; margin-top:44px; overflow-x:auto; }
.tab { flex:none; text-decoration:none; font-size:14.5px; font-weight:600; color:var(--muted); padding:12px 16px; border-bottom:2px solid transparent; }
.tab:hover { color:var(--ink); }
.tab.on { color:var(--ink); border-bottom-color:var(--blue-deep); }
.summary { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:12px; margin:48px 0 0; }
.summary div { background:var(--surface); border:1px solid var(--line); border-radius:18px; padding:18px; }
.summary b { display:block; color:var(--ink); font-size:15.5px; margin-bottom:4px; }
.summary p { margin:0; color:var(--muted); font-size:14px; line-height:1.55; }
.summary-title { margin:56px 0 0; font-size:13px; font-weight:650; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); }
.body { display:grid; grid-template-columns:240px minmax(0, 1fr); gap:64px; padding-block:56px 32px; }
.toc { position:sticky; top:96px; align-self:start; }
.toc p { margin:0 0 12px; font-size:12.5px; font-weight:650; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); }
.toc ol { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:2px; border-left:1px solid var(--line); }
.toc a { display:flex; gap:10px; text-decoration:none; color:var(--muted); font-size:14px; line-height:1.45; padding:6px 0 6px 14px; margin-left:-1px; border-left:2px solid transparent; }
.toc a span { font-variant-numeric:tabular-nums; color:var(--blue-deep); opacity:.7; }
.toc a:hover { color:var(--ink); }
.toc a.on { color:var(--ink); border-left-color:var(--blue-deep); font-weight:600; }
article { max-width:72ch; }
section { padding-bottom:40px; margin-bottom:40px; border-bottom:1px solid var(--line); }
section:last-child { border-bottom:0; }
h2 { font-family:"Source Serif 4", Georgia, serif; font-weight:500; display:flex; align-items:baseline; gap:14px; margin:0 0 16px; color:var(--ink); font-size:26px; letter-spacing:-.015em; }
h2 span { font-family:"Source Serif 4", Georgia, serif; font-weight:400; font-size:30px; color:var(--blue); font-variant-numeric:tabular-nums; }
article p { margin:0 0 14px; }
article ul { margin:0 0 14px; padding:0; list-style:none; display:flex; flex-direction:column; gap:8px; }
article li { position:relative; padding-left:22px; }
article li::before { content:""; position:absolute; left:4px; top:.72em; width:6px; height:6px; border-radius:50%; background:var(--blue); }
.note { background:var(--blue-soft); border:1px solid var(--blue-line); border-radius:14px; padding:14px 16px; color:var(--ink); font-weight:550; }
.table { overflow-x:auto; margin:6px 0 16px; border:1px solid var(--line); border-radius:14px; }
table { width:100%; border-collapse:collapse; font-size:14.5px; line-height:1.5; }
th, td { text-align:left; vertical-align:top; padding:12px 14px; border-bottom:1px solid var(--line); }
thead th { background:var(--mist); color:var(--muted); font-size:12.5px; font-weight:650; letter-spacing:.04em; text-transform:uppercase; white-space:nowrap; }
tbody th { color:var(--ink); font-weight:600; }
tbody tr:last-child th, tbody tr:last-child td { border-bottom:0; }
.ask { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:20px; background:var(--night); border:1px solid var(--night-line); color:var(--text); border-radius:24px; padding:32px 36px; margin:24px 0 0; }
.ask h3 { margin:0 0 4px; font-size:24px; letter-spacing:-.025em; color:var(--ink); }
.ask p { margin:0; color:var(--muted); }
.ask a { background:var(--blue-deep); color:#fff; text-decoration:none; font-weight:650; border-radius:999px; padding:12px 20px; }
footer { background:var(--night); color:var(--night-muted); margin-top:88px; padding-block:40px; font-size:14px; border-top:1px solid var(--night-line); }
footer .wrap { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:16px; }
footer .brand { color:var(--ink); }
footer nav { display:flex; flex-wrap:wrap; gap:18px; }
footer a { text-decoration:none; }
footer a:hover { color:var(--ink); }
:focus-visible { outline:2px solid var(--blue); outline-offset:3px; border-radius:6px; }
@media (max-width: 920px) {
  .body { grid-template-columns:minmax(0, 1fr); gap:24px; }
  .toc { position:static; }
  .summary { grid-template-columns:repeat(2, minmax(0, 1fr)); }
  .menu a:not(.btn) { display:none; }
}
@media (max-width: 560px) {
  .summary { grid-template-columns:minmax(0, 1fr); }
  .ask { padding:24px; }
  .menu .btn { display:none; }
}
@media (prefers-reduced-motion: reduce) { html { scroll-behavior:auto; } }
${LOGO_ALIVE_CSS}
</style>
</head>
<body>
<header class="top">
  <div class="wrap">
    <a class="brand" href="/">${logoTileLive(32)}${logoWord(25)}</a>
    <nav class="menu" aria-label="Baarali">
      <a href="/">${escape(t.home)}</a>
      <a href="/tarifs">${escape(t.prices)}</a>
      <button class="theme" type="button" aria-label="${escape(t.theme)}" title="${escape(t.theme)}">${SUN}${MOON}</button>
      <a class="btn" href="/auth/v1/sign-in">${escape(t.signIn)}</a>
    </nav>
  </div>
</header>
<main>
<div class="hero">
  <div class="wrap">
    <p class="kicker">${escape(d.kicker)}</p>
    <h1>${escape(d.title[0])}<em>${escape(d.title[1])}</em>${escape(d.title[2])}</h1>
    <p class="lead">${escape(d.lead)}</p>
    <ul class="meta"><li>${escape(t.inForce)}</li><li>${escape(t.version)} ${VERSION}</li><li>${escape(COMPANY.name)}</li></ul>
    <nav class="tabs" aria-label="${escape(t.names[doc])}">${tabs}</nav>
  </div>
</div>
<div class="wrap">
  ${d.summary ? `<p class="summary-title">${escape(t.summary)}</p><div class="summary">${d.summary.map(([b, p]) => `<div><b>${escape(b)}</b><p>${escape(p)}</p></div>`).join('')}</div>` : ''}
  <div class="body">
    <nav class="toc" aria-label="${escape(t.contents)}">
      <p>${escape(t.contents)}</p>
      <ol>${d.sections.map((s, i) => `<li><a href="#${s.id}"><span>${num(i)}</span>${escape(s.title)}</a></li>`).join('')}</ol>
    </nav>
    <article>
      ${d.sections.map((s, i) => `<section id="${s.id}" aria-labelledby="h-${s.id}"><h2 id="h-${s.id}"><span>${num(i)}</span>${escape(s.title)}</h2>${s.blocks.map(block).join('')}</section>`).join('\n      ')}
      <div class="ask"><div><h3>${escape(t.question)}</h3><p>${escape(t.questionLead)}</p></div><a href="mailto:${CONTACT}">${escape(t.write)} · ${CONTACT}</a></div>
    </article>
  </div>
</div>
</main>
<footer>
  <div class="wrap">
    <a class="brand" href="/">${logoTile(28)}${logoWord(22)}</a>
    <nav aria-label="${escape(t.names.mentions)}">${(Object.keys(LEGAL_PATHS) as LegalDoc[]).map((k) => `<a href="${LEGAL_PATHS[k]}">${escape(t.names[k])}</a>`).join('')}<a href="mailto:${CONTACT}">${CONTACT}</a></nav>
    <span>© ${new Date().getFullYear()} ${escape(COMPANY.name)} · ${escape(COMPANY.country)}</span>
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
// The contents follow the reading: the article on screen is lit.
const links = new Map([...document.querySelectorAll(".toc a")].map((a) => [a.getAttribute("href").slice(1), a]));
const seen = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) for (const [id, a] of links) a.classList.toggle("on", id === e.target.id);
}, { rootMargin: "-20% 0px -70% 0px" });
for (const s of document.querySelectorAll("article section")) seen.observe(s);
${LOGO_ALIVE_JS}
</script>
</body>
</html>`;
}
