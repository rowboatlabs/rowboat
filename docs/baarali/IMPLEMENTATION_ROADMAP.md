# Feuille de route d'implémentation

Ce document dit **dans quel ordre on construit Baarali, et à quoi on reconnaît qu'une étape est finie**. Il ferme la série : il s'appuie sur les six documents précédents et ne les redit pas. Il se termine par la synthèse demandée par la mission (§17 de l'audit, mise à jour) et par **le premier lot de code**.

Trois règles de la mission le structurent :

- **Pas de réécriture d'un bloc** (mission §59). On avance par **tranches verticales** : un flux complet qui marche, puis on l'élargit.
- **Le premier jalon est un flux, pas une interface** (mission §60) : « un utilisateur écrit une demande, et le système la mène au bout ».
- **FR/EN dès le premier jour** (mission §65) : le bilinguisme n'est pas une phase, c'est une règle de chaque phase (§3).

Chaque phase a un **critère de sortie** vérifiable. Une phase n'est finie que quand ce critère passe, en CI ou sur une instance réelle. La taille de chaque phase est indicative (**S** : quelques jours, **M** : une à deux semaines, **L** : plus), à revoir à la fin de chaque phase.

---

## 1. La synthèse : garder, modifier, remplacer, retirer, créer

Mise à jour de la matrice de l'audit (§17) avec les décisions des documents 2 à 6. **En gras**, ce qui a changé depuis l'audit.

### KEEP : garder tel quel

| Composant | Où | Pourquoi |
|---|---|---|
| Moteur de tours et sessions | `core/runtime/turns`, `core/runtime/sessions` | C'est la boucle agir → suspendre → reprendre de la mission. Baarali l'utilise par son API publique (runtime §1). |
| Vérificateur de permissions « fermé par défaut » | `turns/bridges/real-permission-checker.ts` | Bonne base (sécurité H1). Baarali l'enveloppe. |
| Catalogue d'outils, skills | `runtime/tools/`, `runtime/assembly/skills/` | Coutures d'extension. |
| Brain (mémoire personnelle) | `core/knowledge` | Mémoire de l'utilisateur, dans son instance (modèle §4.5). |
| Tâches d'arrière-plan | `core/background-tasks`, `agent-schedule`, `events` | Scénario F. Le réveil planifié s'ajoute à côté (archi §3.5). |
| Code Mode (ACP) | `core/code-mode` | Scénario E. |
| Client MCP | `core/mcp` | Intégrations (V1 : MCP et connecteurs natifs). |
| Harbor | `apps/harbor` | **Inchangé, à côté du plan de contrôle et non plus à sa base** (archi §3.5) : Spaces, membres, temps réel, push. |
| Application mobile | `apps/mobile` | Base réelle pour le chat, les approbations et les notifications. |
| Navigateur Electron | `apps/main/src/browser` | Reste le navigateur de l'application de bureau. |
| Outils médias | `runtime/tools/domains/image.ts`, `voice.ts`, `deck.ts`, `spreadsheet.ts`, `parsing.ts` | Génération d'images (par OpenRouter), synthèse vocale, transcription, présentations, tableurs, lecture de PDF et de documents. Ils passent par nos routes `/v1` ou par OpenRouter, sans clé dans l'instance. |
| Bundle headless du serveur | `apps/server/scripts/build-headless.mjs` | **Nouveau constat** : l'upstream sait déjà produire un serveur autonome sans Electron. C'est la base de l'image d'instance. |

### MODIFY : modifier, par injection plutôt que par édition

| Composant | Changement | Comment |
|---|---|---|
| Permissions | Risque, capacités, contamination, approbations à empreinte | `BaaraliPolicyChecker`, `BaaraliClassifier`, enregistrés par une ligne (sécurité §22) |
| `rowboat-server` | Devient l'instance Baarali | Image Fly.io, `ROWBOAT_WORKDIR=/data`, `API_URL` vers le plan de contrôle, `cipher-key` injectée ; **la clé porteur reste interne au plan de contrôle** (sécurité §2) |
| `todo` + planificateur du matin | Inspirent le moteur d'objectifs | **Pas modifiés** : `@baarali/goals` reprend leur motif (runtime §1) sans toucher leurs fichiers |
| Modèles | OpenRouter par défaut, via `/v1/llm` du plan de contrôle | Fichier de configuration, pas de code (archi §3.7) |
| Application mobile | Marque Baarali, FR/EN, approbations, connexion par SMS | Composants ajoutés ; écrans upstream touchés au minimum, tracés dans `DIVERGENCES.md` |
| Transports WhatsApp et Telegram | Désactivés dans les instances cloud | Configuration (sécurité §10) |
| Skills de navigateur | Version figée, sans rafraîchissement en cloud | Configuration, ou une divergence d'une ligne (sécurité §22) |

### REPLACE : remplacer

| Composant | Remplacé par |
|---|---|
| Backend Rowboat Labs (`API_URL` : config, identité, LLM, recherche, voix, OAuth Google, facturation) | Plan de contrôle Baarali, **mêmes routes, mêmes schémas** (archi §3.14) |
| Composio | **Désactivé en V1** ; MCP et connecteurs natifs (archi §8) |
| PostHog | Désactivé (pas de clé) ; observabilité Baarali (archi §4) |
| Jetons OAuth et clés en clair dans le volume | Coffre du plan de contrôle et baux courts (sécurité §6) |
| Transport WhatsApp « appareil lié » (en cloud) | API WhatsApp Business depuis le plan de contrôle (sécurité §10) |

### REMOVE : retirer

| Composant | Comment |
|---|---|
| `runtime/legacy` | **On ne le retire pas nous-mêmes** : l'upstream l'a condamné, on le laisse mourir chez eux. |
| Tout le reste | Rien. Ce qui ne sert pas au lancement (tableau blanc, notes de réunion, mini-apps) reste en place et continue de recevoir les mises à jour. |

### NEW : créer

| Paquet ou service | Contient | Documents |
|---|---|---|
| `@baarali/goals` (instance) | GoalEngine, Planner, TaskRunner, Verifier, LimitGuard, Relay, outil `goal.start` | runtime §1 |
| `@baarali/policy` (instance) | Catalogue des risques, checker, classifieur, contamination | sécurité §7, §12 |
| `@baarali/instance-bridge` (instance) | Relais d'événements, livraison des résultats asynchrones, baux de secrets, publication des échéances avant la veille | runtime §6, §10 |
| `@baarali/control` (service) | Identité SMS, organisations, capacités, instances (`InstanceHost` → Fly.io), passerelle client → instance, approbations, usage, coffre, notifications, routes `/v1/*` | archi §3.5, modèle §6 |
| `@baarali/payments` (service séparé) | Intentions, mandats, moteur de politique, ledger, budgets, adaptateur LigdiCash | archi §3.9, modèle §7, fournisseurs §4 |
| `@baarali/providers` | `CountryConfig`, registre et statuts, interfaces des fournisseurs | fournisseurs §2, §3 |
| `@baarali/i18n` | Clés FR/EN des chaînes Baarali, format `{ key, params }` | archi §3.12 |
| Moteur de navigateur headless | Chromium par instance, même service de contrôle, masquage, filtre de sortie | archi §3.10, sécurité §9, §11 |

Tout ce code vit dans **`apps/baarali/`**, un espace de travail pnpm à lui, qui consomme `@x/*` par des dépendances `link:`, **comme `apps/x` consomme déjà Harbor** (`/AGENTS.md`). Aucun fichier upstream n'est déplacé.

## 2. Les phases

L'exemple de découpage de la mission (§58) a quatorze phases horizontales (modèle, puis moteur, puis outils…). L'audit a montré que la plupart de ces couches **existent déjà**. On découpe donc par **jalons de la mission** (§60 à §64) : chaque phase livre un flux complet.

| Phase | Nom | Jalon de la mission | Scénarios | Taille |
|---|---|---|---|---|
| 0 | Socle : dépôt, instance sur Fly.io, plan de contrôle minimal | — | — | M |
| 1 | La boucle Goal → Task → Action → Vérification | 1ᵉʳ (§60) | A, H | L |
| 2 | Identité, organisations, plusieurs utilisateurs | — | — | M |
| 3 | Approbations | 2ᵉ (§61) | G | M |
| 4 | Navigateur côté serveur | 3ᵉ (§62) | B | L |
| 5 | Email, agenda, fichiers, secrets | — | C, D | M |
| 6 | Arrière-plan, veille et réveil planifié | 5ᵉ (§64) | F | M |
| 7 | Code Mode dans le cloud | 4ᵉ (§63) | E | M |
| 8 | Voix et téléphone | — | — | M |
| 9 | Paiements | Addendum §90 | — | L |
| 10 | Durcissement et pilote | — | A → H | M |

L'ordre des phases 4 à 8 est souple (**Latitude**). Chacune ne dépend que des phases 1 à 3.

### Phase 0 — Socle

**But :** une instance Rowboat tourne sur Fly.io, se met en veille, se réveille, et parle à un plan de contrôle Baarali qui remplace le backend Rowboat Labs.

- Espace de travail `apps/baarali/`, sa CI (`.github/workflows/baarali-tests.yml`), sans toucher la CI upstream.
- `@baarali/control` minimal : `/v1/config`, `/v1/me`, `/v1/llm` (mandataire vers OpenRouter, sous le quota 5 h / semaine au coût réel, archi §3.5). **Test de contrat** : les réponses sont validées par les schémas zod de `@x/shared`, ce qui casse à la synchro si l'upstream les change.
- Image d'instance : le bundle headless (`build-headless.mjs`) dans une image, `ROWBOAT_WORKDIR=/data` sur un volume Fly, `API_URL` vers le plan de contrôle.
- **Mesures** (archi §6) :
  - mémoire de l'instance, avec et sans Chromium : la suspension exige 2 Go au plus ;
  - temps de suspension et de réveil ;
  - latence vers Paris et vers Johannesburg, depuis le Burkina et la Côte d'Ivoire. On peut passer par des sondes de mesure publiques installées dans ces pays (réseau RIPE Atlas) plutôt que d'attendre quelqu'un sur place.
- Côté upstream (UPSTREAM.md §7) : une **issue** qui propose l'i18n, et une **issue** qui propose une limite réglable du `cwd` d'`executeCommand` pour le serveur à distance (sécurité H5 : le contrôle a été désactivé volontairement pour le bureau, on ne le réactive pas).

**Critère de sortie :** depuis l'app de bureau pointée sur l'instance Fly, une conversation fonctionne via OpenRouter. L'instance se suspend, puis se réveille à la requête suivante. Aucun appel ne part vers `rowboatlabs.com` ni PostHog (vérifié par le journal du filtre de sortie). Les mesures sont versées dans l'architecture §6.

### Phase 1 — Le premier jalon

**But :** le scénario de la mission §60. « Recherche trois ordinateurs adaptés au développement sous un budget donné et fais-moi un comparatif » → Goal créé, tâches planifiées, recherche, actions enregistrées, résultats vérifiés, Artifact produit, progression visible, Goal terminé, mémoire utile proposée.

- `@baarali/goals` : journaux de Goals, Planner (plan validé), TaskRunner (session + observateur de fin de tour), Verifier (`result_field`, `status_check`), LimitGuard, outil `goal.start`.
- Artifact (modèle §4.4), progression dans le chat (événements de Goal).
- `@baarali/i18n` : toutes les chaînes Baarali en FR/EN, dès la première.
- Mono-utilisateur : le plan de contrôle de la phase 0 suffit.

**Critère de sortie :** scénarios A et H de bout en bout sur une instance réelle ; tests runtime §15 n° 1, 2, 11, 12, 13 verts.

### Phase 2 — Identité et organisations

**But :** plusieurs vrais utilisateurs, chacun dans son instance, sans qu'aucun ne voie l'autre.

- Connexion par code SMS : plafonds, anti-fraude, période de 72 h (sécurité §4). Fournisseur SMS derrière `SmsProvider`, **choisi après le banc de mesure** (fournisseurs §5.1) ; faux fournisseur en attendant.
- Aussi par code email, Google, Apple et GitHub ; mot de passe facultatif, choisi après un code (02/10/2026) ; liaison seulement par email vérifié (archi §3.5, décidé le 01/10/2026).
- Organisation personnelle à l'inscription, capacités (sécurité §5), sécurité au niveau des lignes (sécurité §13).
- `InstanceHost` → Fly.io : création, réveil, veille, sauvegarde du volume.
- Passerelle client → instance (sécurité §2), relais d'événements, projections, `usage_records`, plafond de coût des modèles.
- Émetteur OIDC du plan de contrôle, pour que Harbor accepte nos utilisateurs sans modification.

**Critère de sortie :** deux utilisateurs inscrits, l'un par SMS, l'autre par Google ou par email, chacun avec son instance. Tests de sécurité S1, S2, S3, S9, S10, S12 et S16 verts.

### Phase 3 — Le deuxième jalon : approbations

**But :** mission §61. Plan → recherche → action préparée → demande d'approbation → pause → approbation → reprise → exécution → vérification → fin.

- `@baarali/policy` : catalogue des risques des outils Rowboat (sécurité §7.2), `BaaraliPolicyChecker`, `BaaraliClassifier`, marquage de contamination.
- Table `approvals`, empreinte du payload, expiration, rappels.
- Approbation sur mobile (push via Harbor) et dans l'app de bureau ; décision refusée par SMS (sécurité §7.3).

**Critère de sortie :** scénario G ; tests runtime n° 3 et 4, sécurité S4, S5, S6, S7, S8, S14.

### Phase 4 — Le troisième jalon : navigateur

**But :** mission §62. L'agent navigue, interagit, vérifie, et se relève d'une erreur sans tout recommencer.

- Moteur Chromium headless derrière le même service de contrôle, en réutilisant `page-scripts.ts` tel quel (archi §3.10).
- Filtre de sortie, masquage des champs sensibles, prise de main par l'utilisateur pour se connecter (sécurité §9.3, §11).
- **Banc JEV** : mêmes tâches sur des sites d'Afrique de l'Ouest, avec et sans JEV. On adopte JEV ou non sur ces mesures (archi §3.10).

**Critère de sortie :** scénario B (« trois hôtels à Dakar ») ; sécurité S3 et S13 sur le navigateur ; rapport du banc JEV.

### Phase 5 — Email, agenda, fichiers

**But :** scénarios C et D, avec les connecteurs natifs de Rowboat.

- OAuth Google par le plan de contrôle (fin du retour sur `localhost`), coffre, baux de jetons courts (sécurité §6.2).
- Envoi d'email = risque élevé ; les brouillons, non.

**Critère de sortie :** scénarios C et D ; S12 revérifié avec de vrais comptes connectés.

### Phase 6 — Le cinquième jalon : arrière-plan

**But :** mission §64. « Chaque matin, prépare mon briefing », avec une instance endormie le reste du temps.

- `scheduled_wakes` : l'instance publie ses échéances avant la veille, le plan de contrôle la réveille (archi §3.5, runtime §10).
- Reprise explicite des tours au réveil (runtime §10).

**Critère de sortie :** scénario F sur trois matins de suite, instance endormie entre-temps ; test runtime n° 9.

### Phase 7 — Le quatrième jalon : Code Mode

**But :** mission §63. Issue → analyse → correction → tests → PR.

- Code Mode dans la micro-VM de l'instance (isolation noyau, sécurité §9.1), ou dans un bac à sable éphémère si la mémoire l'exige (archi §6).
- Identifiants des agents de code par le coffre, jamais par le LLM (archi §3.11).

**Critère de sortie :** scénario E sur un dépôt de test.

### Phase 8 — Voix et téléphone

**But :** parler à Baarali, et le laisser appeler pour toi quand c'est utile. Dans la région, beaucoup de gens préfèrent parler qu'écrire : c'est aussi la porte d'entrée des langues nationales plus tard.

| Étape | Contenu | Condition pour commencer |
|---|---|---|
| 8a | **Voix dans l'app** : dictée, réponses lues à voix haute, conversation vocale. Rowboat a déjà la transcription (Deepgram) et la synthèse (ElevenLabs) : on les fait passer par la route `/v1/voice` du plan de contrôle (archi §3.14), sans clé dans l'instance. | Phase 2 |
| 8b | **Tu appelles Baarali** : un numéro par pays, qui répond avec ton agent. Ton numéro vérifié t'identifie pour les demandes, **jamais pour une décision à risque** (sécurité §10.1). | Phase 3 ; fournisseur de téléphonie par pays (fournisseurs §5.4) |
| 8c | **Baarali appelle pour toi** (hôtel, restaurant, prise de rendez-vous) : outil asynchrone à risque élevé, approbation de l'objet de l'appel, annonce qu'il s'agit d'un assistant, transcription gardée comme preuve. | 8b + vérification juridique de l'enregistrement des appels par pays |

**Critère de sortie :** une conversation vocale complète en français sur mobile (8a) ; un appel entrant qui crée un Goal (8b) ; un appel sortant approuvé, transcrit et vérifié (8c). Test de sécurité S17 : une approbation demandée par téléphone est refusée.

### Phase 9 — Paiements

L'ordre de l'addendum (§90), appliqué à ce que les fournisseurs permettent vraiment :

| Étape | Contenu | Condition pour commencer |
|---|---|---|
| 9a | `@baarali/payments` : intentions, mandats, moteur de politique, ledger, budgets, arrêt d'urgence, avec un **faux fournisseur** | Phase 3 finie |
| 9b | Adaptateur LigdiCash (fournisseurs §4.4) ; **abonnement Baarali** en premier | **Réponse écrite de LigdiCash sur son agrément et validation juridique** (fournisseurs §4.5) |
| 9c | Dépenses d'agents par la page du marchand (chemin A, fournisseurs §4.6) | 9a + phase 4 |
| 9d | Paiement pour compte de tiers (chemin D) | Réponse de LigdiCash à la question 2 (fournisseurs §8) |
| Plus tard | Cartes virtuelles, achats autonomes, crypto, routage avancé | Fournisseurs aujourd'hui UNAVAILABLE |

**Critère de sortie de 9a :** tests runtime n° 5, 6, 7, 8, 10 et sécurité S11, **sur le faux fournisseur**. Le test n° 7 (crash à chaque barrière, jamais de double paiement) est **bloquant** : pas d'argent réel tant qu'il ne passe pas.

### Phase 10 — Durcissement et pilote

- Les 17 tests de sécurité et les 13 scénarios runtime en CI ; les scénarios A à H rejoués sur une instance réelle.
- Guides d'intervention (sécurité §20), ancrage de l'audit (sécurité §15.2).
- Revue juridique : données personnelles par pays, montage de paiement (sécurité §18, archi décision 5).
- **Pilote** : un pays d'abord (**À trancher** : le Burkina Faso, où est LigdiCash, paraît naturel), avec un petit groupe d'utilisateurs choisis.

## 3. Ce qui court sur toutes les phases

| Piste | Règle |
|---|---|
| **FR/EN** | Toute chaîne Baarali naît en FR et en EN (`@baarali/i18n`). L'i18n des écrans **upstream** suit la décision « upstream d'abord » (archi §3.12) : issue en phase 0 ; si l'upstream refuse, extraction composant par composant, chaque écran touché étant tracé dans `DIVERGENCES.md`. |
| **Synchro upstream** | Chaque semaine (UPSTREAM.md §4). Aucune phase ne la suspend : une synchro repoussée coûte plus cher la semaine suivante. |
| **Tests** | Chaque phase ajoute ses tests de runtime et de sécurité à la CI Baarali. La CI upstream reste verte. |
| **Divergences** | Chaque fichier upstream touché a sa ligne dans `DIVERGENCES.md`, dans la PR qui le touche. Objectif : moins de 10 fichiers à la fin de la phase 3. |
| **Documents** | Une PR qui change un comportement documenté change le document dans la même PR (`/AGENTS.md`). |
| **Pas à pas** | Une étape propre (code + tests + lint) → relecture → correction → commit, puis seulement la suivante. |

## 4. Le premier lot

**C'est la proposition à valider avant d'écrire la première ligne de code.** Il couvre la phase 0, en cinq PR, dans cet ordre :

| # | PR | Contenu | Touche l'upstream ? | Preuve |
|---|---|---|---|---|
| 1 | `feat(baarali): espace de travail apps/baarali` | `package.json`, `pnpm-workspace.yaml`, `tsconfig`, Vitest, dépendances `link:` vers `@x/shared`. Workflow `baarali-tests.yml`. Un test trivial. | Non | CI verte |
| 2 | `feat(control): routes /v1 minimales` | `@baarali/control` (Hono, comme `rowboat-server`) : `/v1/config`, `/v1/me`, `/v1/llm` vers OpenRouter sous le quota 5 h / semaine au coût réel (archi §3.5), `/health`. Tests de contrat contre les schémas de `@x/shared`. | Non | Tests de contrat verts |
| 3 | `feat(instance): image et déploiement Fly.io` | Dockerfile qui empaquette `build-headless.mjs`, `fly.toml` (Paris, volume, `autostop = suspend`), script de déploiement du plan de contrôle et d'une instance de test. | Non | Instance joignable ; conversation via OpenRouter depuis l'app de bureau |
| 4 | `docs(baarali): mesures d'hébergement` | Mémoire (avec et sans Chromium), suspension et réveil, latence Paris / Johannesburg depuis BF et CI, coût d'une instance endormie. Mise à jour de l'architecture §6. | Non | Chiffres versés |
| 5 | Upstream : issue i18n, issue de la limite `cwd` | Textes rédigés ici, envoyés chez `rowboatlabs/rowboat` depuis une branche créée sur `upstream/main` (UPSTREAM.md §7) | Chez eux, pas chez nous | Liens des deux issues |

**Ce qu'il faut de ta part (🧑) pour ce lot :**

- un compte Fly.io et un jeton de déploiement (en secret GitHub, jamais dans le dépôt) ;
- une clé OpenRouter dédiée à Baarali, avec un plafond de dépense ;
- l'envoi des 12 questions à LigdiCash (fournisseurs §8). La réponse n'est nécessaire qu'en phase 9, mais elle peut prendre du temps ;
- ton accord sur ce lot.

**Ce que ce lot ne fait pas :** aucun écran, aucune table, aucun paiement. Il prouve que le socle tient (Rowboat en cloud, en veille, sans Rowboat Labs) avant qu'on y construise quoi que ce soit.

## 5. Hors V1

Repris de la mission (§45) et des documents précédents :

- marketplace, réseau social, CRM, ERP, comptabilité, modèle maison, portefeuille maison, super-application ;
- cartes virtuelles, achats autonomes par débit pré-autorisé, crypto (fournisseurs §4.6, §4.8) ;
- Composio (archi §8) ;
- les pays de la phase 3 de la mission (Nigeria, Ghana, Guinée…) : le registre est prêt à les accueillir sans refonte (fournisseurs §2) ;
- les catégories de la phase 2 de la mission (voyage, transport, livraison, commerce **par API**) : en V1, elles passent par le navigateur (fournisseurs §6).

## 6. Risques de calendrier

| Risque | Effet | Parade |
|---|---|---|
| L'instance dépasse 2 Go avec Chromium | Réveil de plusieurs secondes | Mesure dès la phase 0 ; Chromium à la demande (archi §6) |
| L'upstream refuse l'i18n | Divergence lourde sur `App.tsx` | Extraction composant par composant ; commencer par les écrans mobiles, plus petits |
| Réponse lente ou négative de LigdiCash sur l'agrément | Phase 9b bloquée | Questions envoyées dès maintenant ; second agrégateur étudié en parallèle (fournisseurs §4.9) |
| Délivrabilité SMS mauvaise dans un pays | Personne ne s'y connecte | Banc de mesure avant ouverture, deux fournisseurs (fournisseurs §5.1) |
| Une grosse refonte upstream en cours de phase | Synchro coûteuse | Synchro hebdomadaire, divergences minimes, tests de contrat |
| Le marquage de contamination rend l'agent pénible | Lassitude, approbations sans lire | Mesure en phase 3, réglage de la granularité (sécurité §12.2) |

## 7. Décisions

| # | Question | État |
|---|---|---|
| 1 | Découpage par jalons de la mission plutôt que par couches | **Décidé** (§2) |
| 2 | FR/EN en règle de chaque phase, pas en phase à part | **Décidé** (§3) |
| 3 | Code Baarali dans `apps/baarali/`, dépendances `link:` | **Décidé** (§1) |
| 4 | Pas d'argent réel avant le test « crash à chaque barrière » | **Décidé** (phase 9) |
| 5 | Premier lot = phase 0, en cinq PR | **Validé le 30/09/2026** ; PR 1 à 4 fusionnées (#8 à #12), mise en ligne sur Fly.io le 01/10/2026 (§4) |
| 6 | Pays pilote | **À trancher** avant la phase 10 |
| 7 | Voix et téléphone au plan, après les approbations | **Décidé 30/09** (phase 8) |
