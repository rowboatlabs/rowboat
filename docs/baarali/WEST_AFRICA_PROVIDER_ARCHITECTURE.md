# Fournisseurs d'Afrique de l'Ouest

Ce document dit **quels fournisseurs Baarali utilise, pays par pays, et avec quel niveau de preuve**. Les interfaces s'inscrivent dans [`TARGET_AGENTIC_ARCHITECTURE.md`](./TARGET_AGENTIC_ARCHITECTURE.md) §3.8 et §3.9 (*archi*), les tables dans [`AGENTIC_DATA_MODEL.md`](./AGENTIC_DATA_MODEL.md) §6.9 et §7 (*modèle*), les règles de sécurité dans [`AGENT_SECURITY_MODEL.md`](./AGENT_SECURITY_MODEL.md) (*sécurité*).

Mêmes poids que les documents précédents : **Décidé**, **Latitude**, **À trancher**.

---

## 1. Les règles du registre

La mission l'exige : **on n'invente pas d'intégration**. Chaque ligne du registre (`@baarali/providers`, modèle §6.9) porte un statut :

| Statut | Veut dire | Condition |
|---|---|---|
| **SUPPORTED** | Baarali peut s'en servir | Documentation publique lue **et** contrat signé **et** test réel réussi dans le pays |
| **DOCUMENTED** | La capacité existe chez le fournisseur, sur pièce | Documentation publique lue et citée ; pas encore de contrat ni de test |
| **RESEARCH_REQUIRED** | On croit que ça existe, sans preuve suffisante | — |
| **UNAVAILABLE** | Vérifié absent, ou exclu par une décision | Source ou décision citée |

La mission prévoyait trois statuts. On en ajoute un, **DOCUMENTED**, parce qu'il y a une vraie différence entre « c'est écrit dans leur doc » et « on l'a fait marcher à Ouagadougou ». **Aucun fournisseur n'est SUPPORTED aujourd'hui** : Baarali n'a encore ni contrat ni test.

Chaque ligne cite sa **source** et sa **date de vérification**. Un statut change par une PR qui cite la nouvelle source. Les vérifications de ce document datent du **30/09/2026**.

## 2. Les sept pays

Données de `CountryConfig`, du code versionné (archi §3.8).

| | 🇨🇮 CI | 🇧🇫 BF | 🇧🇯 BJ | 🇸🇳 SN | 🇹🇬 TG | 🇲🇱 ML | 🇳🇪 NE |
|---|---|---|---|---|---|---|---|
| Devise | XOF | XOF | XOF | XOF | XOF | XOF | XOF |
| Indicatif | +225 | +226 | +229 | +221 | +228 | +223 | +227 |
| Chiffres après l'indicatif | 10 | 8 | 10 | 9 | 8 | 8 | 8 |
| Fuseau | UTC+0 | UTC+0 | UTC+1 | UTC+0 | UTC+0 | UTC+0 | UTC+1 |
| Langue par défaut de Baarali | `fr` | `fr` | `fr` | `fr` | `fr` | `fr` | `fr` |

- **Une seule devise, un seul régulateur.** Les sept pays sont dans l'UEMOA : franc CFA (XOF, 0 décimale, modèle §1) et **BCEAO** pour tout ce qui touche au paiement. Le Burkina Faso, le Mali et le Niger ont quitté la CEDEAO (Alliance des États du Sahel), mais ils restent dans l'UEMOA à la date de ce document. **À surveiller** : une sortie de l'UEMOA changerait la devise et le régulateur de ces trois pays. `CountryConfig` est fait pour ça : ce serait un changement de données, pas de code.
- **Longueur des numéros.** Le Bénin est passé à 10 chiffres en 2024, la Côte d'Ivoire en 2021. La validation des numéros vient d'une bibliothèque tenue à jour (métadonnées de `libphonenumber`), **jamais** d'une expression régulière écrite à la main.
- **Langues nationales.** Plusieurs pays ont redéfini la place du français dans leur Constitution récente. Le français reste la langue de travail de Baarali partout en V1 ; les langues nationales (mooré, dioula, wolof, bambara, haoussa…) sont une évolution de l'i18n (archi §3.12), pas de ce registre.

## 3. Les interfaces

Chaque catégorie est une **interface** de `@baarali/providers`. Un fournisseur est un **adaptateur** qui l'implémente. Le cœur ne connaît jamais un fournisseur par son nom (archi §1, principe 5).

| Interface | Vit dans | Méthodes principales |
|---|---|---|
| `PaymentProvider` | **Service de paiement** seul | `createPayin`, `getStatus`, `createPayout?`, `parseCallback`, `capabilities()` |
| `CardIssuer` | Service de paiement seul | `issueSingleUseCard`, `destroyCard` |
| `SmsProvider` | Plan de contrôle | `send`, `getDeliveryStatus` |
| `MessagingProvider` (WhatsApp) | Plan de contrôle | `sendTemplate`, `sendText`, `parseInbound` |
| `VoiceProvider` (transcription, synthèse, voix en temps réel) | Plan de contrôle | `transcribe`, `synthesize`, `openRealtimeSession` |
| `TelephonyProvider` (numéros, appels) | Plan de contrôle | `provisionNumber`, `placeCall`, `parseInboundCall` |
| `TravelProvider`, `TransportProvider`, `DeliveryProvider`, `CommerceProvider` | Outils de l'instance, **risque déclaré** (sécurité §7.2) | Recherche (bas) ; réservation ou commande = outil **asynchrone** (archi §3.4) |

`capabilities()` rend ce que le fournisseur sait **vraiment** faire, par pays et par moyen de paiement : mode de validation, débit pré-autorisé, remboursement, montants minimum et maximum. Le moteur de politique et l'interface lisent ces capacités ; ils ne supposent rien.

**Le chemin par défaut quand il n'y a pas d'API : le navigateur.** Une compagnie aérienne, un hôtel ou une boutique en ligne sans API reste accessible par `browser-control` (archi §3.10) : lecture en risque bas, engagement en risque élevé (sécurité §7.2). C'est ce qui permet à Baarali d'être utile **avant** d'avoir signé des partenariats. Le navigateur n'est pas un fournisseur du registre : c'est le **repli** quand la ligne du registre est `RESEARCH_REQUIRED` ou `UNAVAILABLE`.

## 4. Paiements

### 4.1 Deux flux qui n'ont rien à voir

| | **Abonnement Baarali** | **Dépenses des agents** |
|---|---|---|
| Qui est le marchand | Baarali | Un tiers (compagnie, hôtel, boutique…) |
| Où va l'argent | Sur le compte marchand de Baarali | **Directement chez le tiers** (archi §3.9, décision 5) |
| Tables | Hors du modèle de paiement des agents (modèle §7.8) | `payment_intents`, `ledger_entries`… (modèle §7) |
| Décision | L'utilisateur s'abonne | Mandat ou approbation (runtime §5) |

Un même agrégateur peut servir aux deux, **mais pas de la même façon**. Pour l'abonnement, l'agrégateur encaisse pour Baarali. Pour une dépense, s'il encaissait pour Baarali puis reversait au marchand, **l'argent transiterait par Baarali**, ce que la décision 5 interdit.

### 4.2 LigdiCash : l'agrégateur retenu

**Décidé (30/09/2026, choix du propriétaire) : LigdiCash est l'agrégateur de paiement principal de Baarali.** Fintech burkinabè fondée à Bobo-Dioulasso, présente dans nos sept pays, plus la Guinée et la RD Congo.

Ce qu'on a lu dans sa documentation développeur ([developers.ligdicash.com](https://developers.ligdicash.com), 30/09/2026) :

| Capacité | Statut | Détail |
|---|---|---|
| Encaissement mobile money **avec redirection** vers une page LigdiCash | DOCUMENTED | Facture créée par API, client redirigé, statut vérifié |
| Encaissement mobile money **sans redirection** | DOCUMENTED | `POST /pay/v01/straight/checkout-invoice/create` ; un mode de validation par opérateur (§4.3) |
| Carte Visa | DOCUMENTED | 3D Secure obligatoire. Rien sur la conservation de la carte pour un usage ultérieur ni sur les paiements récurrents. |
| Reversement vers un numéro mobile money, ou vers un portefeuille LigdiCash | DOCUMENTED | Débité du solde marchand, sous-compte par opérateur |
| Vérification de statut | DOCUMENTED | Par le `token` rendu à la création |
| Notification de paiement (callback) | DOCUMENTED | **Non signée** : la doc impose de revérifier par l'API de statut avec le jeton qu'on a stocké. C'est exactement notre règle (sécurité §8.4). |
| SDK JavaScript / TypeScript | DOCUMENTED | Utilisable dans le service de paiement (Node) |
| SMS (produit séparé, clés séparées) | DOCUMENTED, détails non publiés | Voir §5.1 |
| Débit pré-autorisé, abonnement, paiement récurrent | **UNAVAILABLE** | Absent de la documentation |
| Remboursement par API | **UNAVAILABLE** | Absent de la documentation |
| Lecture du solde par API | **UNAVAILABLE** | « exclusivement » dans le tableau de bord |
| Environnement de test | **UNAVAILABLE** | « LigdiCash ne dispose pas de sandbox » : compte réel temporaire fourni pendant l'intégration |
| Idempotence côté LigdiCash | **Non documentée** | Rien ne dit ce que produit une création envoyée deux fois (§4.4) |
| Émission de cartes virtuelles | **UNAVAILABLE** | Absent |

### 4.3 Opérateurs par pays

Selon la documentation LigdiCash, pour l'encaissement sans redirection (30/09/2026) :

| Pays | Opérateur | Mode de validation par le client |
|---|---|---|
| 🇨🇮 CI | Orange Money | Redirection vers l'opérateur |
| | Moov Africa | Notification USSD (*push*), repli USSD guidé |
| | MTN MoMo | USSD guidé |
| 🇧🇫 BF | Orange Money | **Code OTP** : le client compose `*144*4*6#` **avant**, et saisit le code reçu dans le formulaire |
| | Moov Africa | Notification USSD, repli USSD guidé |
| 🇧🇯 BJ | Moov Africa | Notification USSD |
| | MTN MoMo | Notification USSD |
| 🇸🇳 SN | Orange Money, Wave, Free | Redirection LigdiCash |
| 🇹🇬 TG | Moov Africa, YAS | Notification USSD |
| 🇲🇱 ML | Orange Money | Redirection vers l'opérateur |
| 🇳🇪 NE | Airtel, Moov Africa | Notification USSD |
| | Zamani | USSD guidé |
| Tous | Portefeuille LigdiCash | Code OTP par SMS |

**Trous dans nos sept pays :** pas de Moov au Mali, pas de Wave hors du Sénégal. Montants documentés pour Orange Burkina : de 10 à 2 000 000 XOF par transaction ; les autres plafonds sont à relever opérateur par opérateur.

**Conséquence qui s'impose au produit : chaque paiement mobile money demande un geste du client sur son téléphone** (code, confirmation d'une notification USSD avec son code secret, ou page de l'opérateur). Donc :

- `payment_sources.supports_preauthorized_debit = false` pour toutes ces sources (modèle §7.1) ;
- un mandat sur du mobile money **ne supprime pas** ce geste. Il supprime la **décision** : pas d'écran « approuver ? » dans Baarali, seulement la confirmation sur le téléphone, qui arrive toute seule (notification USSD) ou qu'on guide (OTP, USSD guidé) ;
- l'interface affiche **le bon geste pour le bon opérateur**. Le parcours Orange Burkina (générer le code avant) n'a rien à voir avec celui de Moov (répondre à une notification). `capabilities()` porte ce mode, l'i18n porte les instructions.

C'est une bonne nouvelle pour la sécurité : même un mandat mal réglé ne peut pas vider un compte mobile money sans que son propriétaire tape son code.

### 4.4 L'adaptateur LigdiCash : règles

Ces règles découlent de ce que la documentation dit, **et de ce qu'elle ne dit pas**.

1. **Notre identifiant d'abord.** L'identifiant de l'intention (`pin_…`, modèle §7.3) est écrit en base **avant** l'appel, et passé dans `custom_data`, comme le recommande LigdiCash (motif `transaction_id`). La notification le rend inchangé.
2. **Jamais de nouvel envoi après une réponse perdue.** Si l'appel de création expire sans réponse, on n'a pas le `token`, donc on ne peut pas demander le statut. Et rien ne garantit qu'un second envoi ne créerait pas un second paiement. La tentative passe alors `indeterminate` : on attend la notification, qui porte notre identifiant, pendant un délai borné (Latitude : 30 min). Sans notification, **un humain rapproche** depuis le tableau de bord LigdiCash. Une nouvelle tentative n'est permise qu'après confirmation que la première n'a pas abouti (modèle §7.4).
3. **La notification ne fait jamais foi.** Elle déclenche une vérification par l'API de statut, avec le `token` stocké (sécurité §8.4). Elle est dédupliquée par `provider_webhooks` (modèle §7.5).
4. **Interrogation de secours.** La validation par l'opérateur peut prendre « de quelques secondes à plusieurs minutes ». Sans notification, on interroge le statut selon un calendrier croissant (Latitude : 15 s, 30 s, 1 min, 2 min, puis toutes les 5 min, jusqu'à 30 min).
5. **Pas de remboursement automatique.** `refunds` (modèle §7.8) enregistre une **demande**. Le remboursement se traite avec le marchand, ou avec LigdiCash par le support.
6. **Rapprochement quotidien.** Le solde n'étant pas lisible par API, un rapprochement quotidien compare le ledger avec l'export du tableau de bord. Au début, cet export est manuel. **À trancher** : demander à LigdiCash un export automatisable.

### 4.5 Le statut réglementaire

Depuis l'instruction BCEAO n° 001-01-2024 sur les services de paiement dans l'UMOA, fournir un service de paiement demande un agrément ou un adossement à un établissement agréé.

**Constat du 30/09/2026 :** LigdiCash **n'apparaît pas** dans la liste des établissements de paiement agréés dans l'UMOA publiée par la BCEAO au 28/02/2026 (pour le Burkina Faso, la liste compte INTOUCH Burkina et KERRY Payments Burkina). Ça ne prouve pas une irrégularité : de nombreux agrégateurs opèrent adossés à une banque ou à un émetteur de monnaie électronique agréé. Mais **Baarali doit savoir sous quelle licence passe l'argent de ses utilisateurs**.

**Décidé :** aucun encaissement réel avant une réponse écrite de LigdiCash sur son statut (agrément propre, ou établissement agréé partenaire, avec son numéro), validée par le juriste qui valide déjà le montage de Baarali (archi §8, décision 5).

### 4.6 Dépenses des agents : les chemins

| Chemin | Comment | Statut | Pourquoi |
|---|---|---|---|
| **A. Page de paiement du marchand** | L'agent prépare l'achat jusqu'à la page de paiement du marchand (son propre agrégateur, son lien de paiement). L'utilisateur paie **directement le marchand** avec son mobile money. | **Chemin V1**, par le navigateur | L'argent ne touche jamais Baarali. Le geste du client sur son téléphone (§4.3) *est* l'approbation. Le ledger enregistre la dépense avec la preuve (reçu, confirmation) relevée par le vérificateur (runtime §3.5). |
| **B. Marchand payé par API** | Le marchand expose une API de paiement que le service de paiement appelle, pour le compte de l'utilisateur | RESEARCH_REQUIRED, marchand par marchand | Dépend de chaque marchand |
| **C. Encaissement LigdiCash par Baarali, puis reversement au marchand** | Payin sur le compte Baarali, payout vers le marchand | **UNAVAILABLE : exclu par la décision 5** | L'argent transiterait par Baarali |
| **D. Paiement pour compte de tiers chez LigdiCash** | Le client paie via LigdiCash, mais les fonds vont **directement** sur le sous-compte du marchand, sans passer par celui de Baarali | RESEARCH_REQUIRED | À demander à LigdiCash (§8). S'il existe, c'est le meilleur chemin pour les marchands qui acceptent LigdiCash. |
| **E. Carte virtuelle à usage unique** | Saisie hors du modèle dans un formulaire web (runtime §6, sécurité §8.5) | **UNAVAILABLE** en V1 | Aucun émetteur de cartes virtuelles vérifié dans nos pays à ce jour. RESEARCH_REQUIRED pour la suite. |

**Conséquence sur la mission :** le scénario « achats autonomes » (addendum §90, étape 5) n'est pas réalisable en V1 avec du mobile money, faute de débit pré-autorisé. Ce qui est réalisable : **l'agent fait tout, sauf taper le code**. C'est l'essentiel du gain pour l'utilisateur, et c'est le bon niveau de sécurité.

### 4.7 L'abonnement Baarali

Le flux le plus simple, et le premier à construire : LigdiCash en **encaissement avec redirection** (ou sans, pour l'application mobile), Baarali marchand, dans les sept pays. Faute de paiement récurrent, un abonnement est une **suite de paiements** : un rappel avant l'échéance, un paiement par période, une période de grâce en cas d'échec. Même logique que les forfaits prépayés que les utilisateurs connaissent déjà (crédit téléphonique).

### 4.8 Crypto et stablecoins

**UNAVAILABLE en V1.** L'abstraction du modèle reste (modèle §7.1, `CRYPTO_WALLET`), mais aucun fournisseur n'est retenu. Le cadre réglementaire des actifs numériques dans l'UMOA est à étudier avec le juriste. RESEARCH_REQUIRED.

### 4.9 Un second agrégateur

Dépendre d'un seul agrégateur, c'est s'arrêter quand il s'arrête. **Latitude, à la phase paiement de la roadmap** : un second adaptateur de `PaymentProvider`, avec les mêmes règles (§4.4), choisi sur les mêmes critères. Le routeur de fournisseurs (archi §3.9, étape 7) basculera de l'un à l'autre. Candidats à étudier (RESEARCH_REQUIRED) : les agrégateurs régionaux déjà présents dans les sept pays, d'abord ceux qui figurent sur la liste BCEAO.

## 5. Communication

### 5.1 SMS : codes de connexion et alertes

Le SMS porte la connexion (sécurité §4.1). Il faut un fournisseur **par pays**, choisi sur la **délivrabilité mesurée** et le coût (archi §3.5).

| Candidat | Statut | Note |
|---|---|---|
| LigdiCash SMS | DOCUMENTED (existence, usage OTP annoncé) ; couverture, tarifs, identifiant d'expéditeur et accusés de réception **non publiés** | Même partenaire que les paiements : un contrat de moins. Mais aussi le même point de panne que les paiements : si LigdiCash tombe, ni connexion ni paiement. |
| Autres agrégateurs SMS régionaux ou internationaux | RESEARCH_REQUIRED | Au moins un second, pour le secours |

**Décidé :**

- **Deux fournisseurs SMS au moins** avant l'ouverture d'un pays, avec bascule automatique quand l'un échoue. Sans SMS, personne ne se connecte.
- **Mesure avant choix** : un banc d'envoi vers de vrais numéros de chaque opérateur de chaque pays (délai de réception, taux de livraison) décide de la priorité, pays par pays. Ce banc est une tâche de la roadmap.
- **L'identifiant d'expéditeur** (« BAARALI ») doit être déclaré auprès des opérateurs dans plusieurs pays. RESEARCH_REQUIRED, pays par pays.

### 5.2 WhatsApp

En cloud, WhatsApp passe par l'**API WhatsApp Business** depuis le plan de contrôle (sécurité §10).

| | Statut |
|---|---|
| API WhatsApp Business de Meta (Cloud API) | RESEARCH_REQUIRED : vérification de l'entreprise, numéro, tarifs par pays |
| Intermédiaire agréé par Meta, si la vérification directe bloque | RESEARCH_REQUIRED |

Les notifications sortantes d'approbation sont des **messages modèles** que Meta doit valider, en français et en anglais. Leur texte vient des clés i18n (modèle §6.4, `summary`).

### 5.3 Notifications push et email

| | Statut | Note |
|---|---|---|
| Push mobile | **Réutilise l'existant** | Harbor envoie déjà des notifications Expo (`apps/harbor/packages/server/src/push.ts`) |
| Email | RESEARCH_REQUIRED | Fournisseur d'envoi transactionnel standard ; secondaire dans la région |

### 5.4 Voix et téléphone

Prévu en phase 8 de la roadmap. Règles de sécurité : sécurité §10.1.

| Besoin | Candidat | Statut |
|---|---|---|
| Transcription (parole → texte) | Deepgram, déjà utilisé par Rowboat (`core/voice/voice.ts`) | DOCUMENTED par le code upstream ; qualité sur le français d'Afrique de l'Ouest **à mesurer** |
| Synthèse (texte → parole) | ElevenLabs, déjà utilisé par Rowboat | DOCUMENTED par le code upstream ; choix d'une voix Baarali FR/EN à faire |
| Voix en temps réel (conversation sans attente) | Modèles vocaux temps réel | RESEARCH_REQUIRED : latence depuis la région, coût à la minute |
| Numéros locaux et appels, dans les 7 pays | Fournisseurs de téléphonie programmable, opérateurs locaux | RESEARCH_REQUIRED, pays par pays : disponibilité des numéros, règles sur la téléphonie par internet, coût des appels vers les mobiles |
| Langues nationales à la voix | — | RESEARCH_REQUIRED, après le français et l'anglais |

**Décidé :** Baarali ne passe par un fournisseur de téléphonie que s'il fournit des numéros **légalement attribués** dans le pays. Pas de numéro étranger présenté comme local.

## 6. Voyage, transport, livraison, commerce

C'est là que la mission demande le plus de prudence : les API ouvertes sont rares dans la région, et **aucune n'a été vérifiée** pour ce document.

| Catégorie | Exemples d'usage (scénarios de la mission) | Statut du registre, 7 pays | Chemin en V1 |
|---|---|---|---|
| **Voyage** (vols, hôtels) | Trouver et réserver un vol Ouagadougou → Abidjan, un hôtel | RESEARCH_REQUIRED | Navigateur, sur les sites des compagnies et des hôtels ; JEV en lecture si activé (sécurité §11.4) |
| **Transport** (VTC, moto-taxi, bus interurbain) | Réserver une course, un billet de car | RESEARCH_REQUIRED | Navigateur quand un site existe ; sinon l'agent **prépare** et l'utilisateur réserve |
| **Livraison** | Faire livrer un colis, un repas | RESEARCH_REQUIRED | Idem |
| **Commerce** (boutiques en ligne) | Comparer, commander | RESEARCH_REQUIRED | Navigateur ; paiement par le chemin A (§4.6) |

**Décidé :** un fournisseur de ces catégories n'entre dans le registre qu'avec une **API documentée et un accord**. D'ici là, le navigateur fait le travail, avec les règles de risque de la sécurité (§7.2), et le vérificateur exige une preuve (numéro de réservation, confirmation par email) avant de dire « c'est fait » (runtime §3.5).

**Latitude :** l'ordre dans lequel on cherche des partenaires suit l'usage réel. On mesurera, pendant les premiers mois, les sites que l'agent visite le plus pour chaque catégorie et dans chaque pays : les plus visités sont les premiers partenaires à approcher, et les premiers skills de navigateur à écrire.

## 7. La matrice

État au 30/09/2026. **D** = DOCUMENTED, **R** = RESEARCH_REQUIRED, **U** = UNAVAILABLE, **N** = chemin navigateur (repli, pas une intégration).

| Catégorie | CI | BF | BJ | SN | TG | ML | NE |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Abonnement Baarali : mobile money (LigdiCash) | D | D | D | D | D | D (Orange seul) | D |
| Abonnement Baarali : carte Visa (LigdiCash) | D | D | D | D | D | D | D |
| Dépense d'agent : page du marchand (chemin A) | N | N | N | N | N | N | N |
| Dépense d'agent : pour compte de tiers LigdiCash (chemin D) | R | R | R | R | R | R | R |
| Dépense d'agent : débit pré-autorisé | U | U | U | U | U | U | U |
| Carte virtuelle à usage unique | U | U | U | U | U | U | U |
| Crypto | U | U | U | U | U | U | U |
| SMS (LigdiCash) | R | R | R | R | R | R | R |
| SMS (second fournisseur) | R | R | R | R | R | R | R |
| WhatsApp Business | R | R | R | R | R | R | R |
| Voix : transcription et synthèse (Deepgram, ElevenLabs) | D | D | D | D | D | D | D |
| Téléphonie : numéros locaux | R | R | R | R | R | R | R |
| Push (Expo, via Harbor) | ✓ existant | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Voyage, transport, livraison, commerce | R / N | R / N | R / N | R / N | R / N | R / N | R / N |

Aucune case n'est SUPPORTED : ce sera le cas à la signature du contrat et au premier test réel, pays par pays.

## 8. Les questions à poser à LigdiCash

À envoyer par écrit, réponses versées dans ce document par PR :

1. **Statut réglementaire** : agrément BCEAO propre, ou établissement agréé partenaire (nom, numéro d'agrément), pour chacun des sept pays ?
2. **Paiement pour compte de tiers** : un client peut-il payer un marchand tiers via LigdiCash sans que les fonds passent par le compte de l'intégrateur (répartition, place de marché) ? (Chemin D.)
3. **Idempotence** : que produit une création de transaction envoyée deux fois avec le même `custom_data` ? Peut-on retrouver une transaction par notre identifiant, sans `token` ?
4. **Débit pré-autorisé** : est-il prévu, chez un opérateur au moins ?
5. **Remboursement** : une API est-elle prévue ? Sinon, quel délai par le support ?
6. **Tarifs** : commission par opérateur et par pays, en encaissement et en reversement.
7. **Plafonds** : montants minimum et maximum par opérateur.
8. **Notifications** : une signature ou une liste d'adresses IP d'émission est-elle prévue ?
9. **Export** : un export automatisable des transactions, pour le rapprochement quotidien ?
10. **SMS** : couverture par pays et par opérateur, tarifs, identifiant d'expéditeur, accusés de réception.
11. **Disponibilité** : engagement de disponibilité, page d'état, contact en cas d'incident.
12. **Données** : où sont hébergées les données de transaction, et combien de temps sont-elles conservées ?

## 9. Risques

| Risque | Parade |
|---|---|
| Statut réglementaire de l'agrégateur non conforme | Pas d'encaissement réel avant réponse écrite et validation juridique (§4.5) |
| Double paiement après une réponse perdue | Pas de nouvel envoi ; attente de la notification puis rapprochement humain (§4.4) |
| Fausse notification | Revérification systématique par l'API de statut (§4.4, sécurité §8.4) |
| LigdiCash indisponible | Second agrégateur (§4.9) ; pour le SMS, second fournisseur obligatoire (§5.1) |
| Pas de sandbox : les tests coûtent de l'argent réel | Petits montants, compte de test fourni par LigdiCash, un jeu de tests bornés et rejouables |
| Un parcours opérateur change (code USSD, redirection) | Mode de validation dans `capabilities()` et instructions en i18n : on corrige des données, pas du code |
| Un pays quitte l'UEMOA | `CountryConfig` et registre par pays (§2) |

## 10. Décisions

| # | Question | État |
|---|---|---|
| 1 | Agrégateur de paiement principal | **Décidé 30/09 : LigdiCash**, sous condition du statut réglementaire (§4.5) |
| 2 | Un statut DOCUMENTED entre « lu » et « testé » | **Décidé** (§1) |
| 3 | Dépenses d'agents en V1 : page du marchand, geste du client sur son téléphone | **Décidé** (§4.6) |
| 4 | Payin + payout via le compte Baarali | **Exclu** par la décision 5 de l'architecture (§4.6) |
| 5 | Deux fournisseurs SMS au moins par pays, choisis sur mesure | **Décidé** (§5.1) |
| 6 | Voyage, transport, livraison, commerce : navigateur en V1, partenaires sur API et accord | **Décidé** (§6) |
| 7 | Second agrégateur de paiement | **À trancher** à la phase paiement (§4.9) |
| 8 | Fournisseur WhatsApp Business (direct ou intermédiaire) | **À trancher** (§5.2) |
| 9 | Crypto | **UNAVAILABLE** en V1 (§4.8) |
