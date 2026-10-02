# Architecture cible de Baarali

Ce document dit **comment Baarali est découpé** : les zones, les modules, qui possède quoi, et les frontières. Il part de l'existant décrit dans [`ROWBOAT_ARCHITECTURE_AUDIT.md`](./ROWBOAT_ARCHITECTURE_AUDIT.md) (§ entre parenthèses = section de l'audit) et respecte les règles de [`UPSTREAM.md`](./UPSTREAM.md). Les champs de chaque entité sont dans `AGENTIC_DATA_MODEL.md`, le pas-à-pas d'exécution dans `AGENT_RUNTIME_SPEC.md`, les règles de sécurité détaillées dans `AGENT_SECURITY_MODEL.md`.

Chaque décision porte un poids, comme dans les specs de l'upstream :

- **Décidé** : la décision tient. La changer, c'est rouvrir l'argument, pas seulement le code.
- **Latitude** : l'exigence est fixée, le mécanisme reste libre.
- **À trancher** : il faut une décision du propriétaire avant la phase concernée.

---

## 1. Les principes qui tranchent

Quand deux choix se valent, ces principes décident, dans cet ordre.

1. **Ce qui engage vit hors de l'agent.** L'argent, les approbations, les secrets, les budgets et l'audit sont tenus par du code déterministe, dans une zone où le modèle n'a pas accès. L'agent *demande*, il n'exécute jamais un engagement. (Mission §9, §77, §83, §91.)
2. **On enveloppe Rowboat, on ne le réécrit pas.** Le moteur de tours (audit §4) est déjà la boucle *agir → suspendre → reprendre* de la mission. Goal, Task et Action se construisent **au-dessus**, pas à côté.
3. **Une personne, une instance.** Chaque utilisateur a son Baarali isolé. C'est l'hypothèse de Rowboat (audit §18.2), et on la transforme en frontière d'isolation au lieu de la combattre.
4. **On ajoute, on n'édite pas.** Tout le code Baarali vit dans un workspace à lui (`apps/baarali/`) et se branche aux coutures existantes (UPSTREAM.md §2).
5. **Les particularités d'un pays sont des données et des fournisseurs, jamais du cœur.** (Mission §22–24, §50.)

## 2. La topologie

```
 ┌────────────────────────────── CLIENTS ──────────────────────────────┐
 │ Desktop (Electron)   Mobile (Expo)   Web (à venir)   WhatsApp / SMS │
 └──────┬─────────────────────┬──────────────────────────────┬─────────┘
        │ RPC + WS (@x/client) │ approbations, notifs, statut │ canaux
        ▼                      ▼                              ▼
 ┌─────────────────────────────── PLAN DE CONTRÔLE (partagé, de confiance) ──┐
 │ Identité & orgs · Instances (réveil, veille) · Goals (projection)        │
 │ Approbations · Politique · Budgets · Usage · Coffre de secrets           │
 │ Notifications · Pays & fournisseurs · Réveil planifié · Journal d'audit  │
 │            ▲ Harbor : Spaces, membres, temps réel, push (inchangé)       │
 └────────────┼──────────────────────────────────┬─────────────────────────┘
              │ jeton d'instance, flux d'events   │ intentions de paiement
              ▼                                   ▼
 ┌──────────── INSTANCE BAARALI (une par utilisateur, isolée) ─┐  ┌── SERVICE DE PAIEMENT ──┐
 │ rowboat-server headless (ROWBOAT_WORKDIR propre)           │  │ PaymentIntent / Mandate  │
 │ Moteur de tours + sessions (inchangé)                      │  │ Moteur de politique      │
 │ + Moteur d'objectifs (Goal / Task / Verify)                │  │ Routeur de fournisseurs  │
 │ Brain · bg-tasks · Code Mode · MCP · canaux                │  │ Ledger immuable          │
 │ Navigateur headless · bac à sable de code                  │  │ Secrets financiers       │
 └──────────────┬─────────────────────────────────────────────┘  └────────────┬────────────┘
                │ outils, API, MCP, navigateur                                │
                ▼                                                             ▼
          Monde extérieur (sites, APIs, Gmail, GitHub…)          Mobile Money, cartes, banques, crypto
```

Il y a quatre zones de confiance, de la moins sûre à la plus sûre. Le détail est dans `AGENT_SECURITY_MODEL.md`.

| Zone | Contient | Confiance |
|---|---|---|
| Client | UI, canaux de messagerie | L'utilisateur, mais l'appareil peut être perdu |
| **Instance** | LLM, contenu web, code généré | **Non fiable** : peut être manipulée par injection de prompt |
| **Plan de contrôle** | Règles, approbations, budgets, secrets | De confiance, code déterministe |
| **Service de paiement** | Argent et secrets financiers | Maximale, isolé même du plan de contrôle |

## 3. Les modules et leurs responsabilités

### 3.1 L'instance Baarali : `rowboat-server` enveloppé

**Décidé.** L'instance *est* le `rowboat-server` de l'upstream (`apps/x/apps/server`, audit §2), lancé en headless (`standalone.ts`) avec un `ROWBOAT_WORKDIR` dédié. Tout ce que Rowboat sait faire, elle le sait : moteur de tours, sessions, Brain, bg-tasks, Code Mode, MCP, WhatsApp/Telegram.

| | |
|---|---|
| Existe | Serveur headless ; ≈ 296 canaux migrés ; WebSocket ; verrou par dossier ; clé porteur. |
| Manque | Auth par le plan de contrôle ; navigateur sans Electron ; mise en veille ; remontée des événements. |
| Changement | Un package `@baarali/instance-bridge` enregistré au démarrage. Il apporte : les implémentations Baarali des interfaces injectées (§3.3), le client du plan de contrôle et le relais d'événements. Côté upstream, **une seule ligne d'enregistrement** dans `apps/x/apps/server/src/standalone.ts` (divergence déclarée). |
| Risque | `standalone.ts` et `core-deps.ts` bougent souvent : garder l'accroche à une ligne. |

**Auth de l'instance (Décidé).** La clé porteur unique (`apps/server/src/auth.ts`) reste, mais elle est émise et tournée par le plan de contrôle, jamais saisie par l'utilisateur. Les clients n'appellent pas l'instance avec cette clé. Ils obtiennent du plan de contrôle un jeton court, et le plan de contrôle fait office de mandataire.

### 3.2 Le moteur d'objectifs (Goal / Task / Verify), dans l'instance

**Décidé : au-dessus des sessions.** Un **Goal** possède un plan de **Tasks**. Chaque Task s'exécute comme une **session** Rowboat. C'est exactement le motif de `core/todo/runner.ts` (audit §8) : l'élément délégué est une session, et son résultat revient comme un reçu. On généralise ce motif au lieu d'en inventer un autre.

| Élément mission | Réalisé par |
|---|---|
| Goal | Nouveau : fichier JSONL append-only par objectif dans le dossier de travail, même discipline que les tours (audit §4). |
| Planner | Une session d'agent dédiée qui produit un plan structuré (sortie validée par zod). |
| Task | Une session Rowboat, plus ses dépendances, son état et ses limites. |
| Action | Un appel d'outil du journal de tour (`tool_invocation_*`), déjà tracé, avec sa clé `toolCallId`. |
| WAITING_USER | Une session suspendue sur `ask-human` ou sur une permission (audit §4). |
| WAITING_EXTERNAL | Une session suspendue sur un outil **asynchrone** (§3.4). |
| Verify | Nouveau : étape explicite qui attache une **preuve** à une Action (§3.6). |
| Artifact | Fichiers du dossier de travail, référencés par le Goal. |

**Pourquoi dans l'instance et pas dans le plan de contrôle.** Le Goal pilote des sessions, qui vivent dans l'instance. Le mettre ailleurs créerait deux sources de vérité pour une même exécution. Le plan de contrôle tient une **projection** en lecture seule (§3.5) pour le mobile et l'observabilité, alimentée par les événements.

| | |
|---|---|
| Existe | `core/todo` (délégation → session → reçu), planificateur du matin, sessions, file de messages. |
| Manque | Plan structuré, dépendances, limites de durée, de coût et de dépense, vérification, états WAITING_*. |
| Changement | Package nouveau `@baarali/goals`, qui consomme l'API publique des sessions (`core/runtime/sessions/api.ts`) sans la modifier. |
| Risque | L'API sessions peut évoluer upstream. Un test de contrat dans `@baarali/goals` casse en premier à la synchro, c'est voulu. |

### 3.3 Le moteur d'actions : pas un nouveau moteur, trois coutures

La mission demande un `ActionEngine` central par lequel tout passe. **Il existe déjà** : chaque appel d'outil traverse le moteur de tours, qui écrit l'intention avant l'effet (audit §4, barrières durables) et consulte `IPermissionChecker`. Baarali ne crée pas de second chemin, il remplace les implémentations injectées :

| Couture existante | Implémentation Baarali | Rôle |
|---|---|---|
| `IPermissionChecker` (`turns/bridges/real-permission-checker.ts`) | `BaaraliPolicyChecker`, qui délègue d'abord à l'original | Ajoute le **niveau de risque** et la **capacité** requise à chaque outil, puis consulte les règles de l'utilisateur et de l'organisation. |
| `IPermissionClassifier` (`turns/bridges/real-permission-classifier.ts`) | `BaaraliClassifier`, qui enveloppe l'original | Le classifieur LLM ne peut répondre `allow` **que pour le risque bas**. Pour le risque moyen, c'est la règle de l'utilisateur. Pour le risque élevé, il est court-circuité : `defer` systématique. |
| Catalogue d'outils (`runtime/tools/`) | Outils Baarali dans leur propre module de domaine | Chaque outil déclare `risk: low \| medium \| high`, ses capacités (`email.send`, `payment.prepare`…) et comment le vérifier. |

**Décidé :** tout outil sans niveau de risque déclaré est traité comme **élevé**. Même principe que le « ferme par défaut » de l'upstream (turn-runtime-design §9.1).

### 3.4 Les actions engageantes : des outils asynchrones

**Décidé. C'est la frontière de sécurité centrale de Baarali.**

Le moteur de tours connaît des outils **asynchrones** : ils n'ont *aucun exécuteur dans l'instance*. Leur demande est exposée à l'extérieur, et leur résultat revient par `advanceTurn` sous la forme `async_tool_result` (turn-runtime-design §10.1, `core/runtime/turns/api.ts`).

Toutes les actions engageantes de Baarali sont des outils asynchrones :

```
Agent (instance)                Plan de contrôle              Service de paiement
─────────────────               ────────────────              ───────────────────
payment.request(intent) ──►  tool_invocation_requested
 (aucun code d'exécution)       │ reçu via le relais d'events
                                ├─ politique + mandat ─────────►  vérifie, route,
                                ├─ approbation humaine si requise  exécute, prouve
                                │◄──────────────────────── résultat + preuve
advanceTurn(async_tool_result) ◄┘
```

Conséquences :

- **Même une instance entièrement compromise ne peut pas payer.** Le code qui paie n'existe pas dans l'instance.
- **`toolCallId` devient la clé d'idempotence** de bout en bout (turn-runtime-design §23). Une reprise après crash ne relance jamais un paiement : elle attend le résultat, ou interroge le statut.
- **L'utilisateur peut être absent.** La tâche reste en WAITING_EXTERNAL, l'instance peut s'endormir, et la réponse la réveille (§3.5).
- **Les mandats de l'addendum** (§67–91) s'évaluent dans le service de paiement, jamais dans l'instance.

Même traitement, plus tard, pour les autres engagements irréversibles : réservation payante, publication publique sensible, signature.

### 3.5 Le plan de contrôle

**Décidé : un service nouveau, `apps/baarali/packages/control`, à côté de Harbor, pas dedans.**

Harbor reste inchangé et continue de servir les Spaces, les membres, le temps réel et le push (audit §10). Le plan de contrôle :

- partage son **Postgres**, mais dans un **schéma `baarali` séparé**, avec **sa propre échelle de migrations** (UPSTREAM.md §2) ;
- reprend **ses méthodes** (politique pure dans un `policy.ts` testé, journal append-only avec outbox publiée après commit, parité HTTP / MCP), en les recopiant et non en les important, pour ne pas coupler nos versions.

| Sous-module | Responsabilité |
|---|---|
| Identité & organisations | Compte, organisation personnelle créée à l'inscription (mission §29), membres, rôles → capacités (§30). |
| Instances | Crée, réveille, endort, sauvegarde, met à jour les instances ; émet leurs jetons. |
| Réveil planifié | Connaît la prochaine échéance de chaque bg-task et réveille l'instance à temps. Sans lui, une instance endormie **ne déclenche plus rien** (le planificateur de `core/background-tasks` vit dans l'instance). |
| Approbations | Source de vérité des demandes d'approbation à risque élevé : payload exact, empreinte, expiration, décision. Joignable même quand l'instance dort. |
| Budgets & usage | `UsageRecord` par appel modèle (déjà rapporté par `turns/usage-reporter.ts`), par outil et par fournisseur ; plafonds par Goal, agent et organisation. |
| Coffre de secrets | Jetons OAuth et clés API, chiffrés. L'instance reçoit un secret au moment de l'usage autorisé, jamais en bloc (mission §28). |
| Projection des Goals | Vue lisible des objectifs, tâches et actions, alimentée par le relais d'événements. |
| Notifications | Push (via Harbor/Expo), WhatsApp, SMS, email ; approbations depuis le téléphone. |
| Pays & fournisseurs | Registre `CountryConfig` et disponibilité des fournisseurs (§3.8). |
| Journal d'audit | Append-only : qui a demandé, approuvé et exécuté quoi. |

#### Comptes et connexion

**Décidé (29/09/2026) : on se connecte par numéro de téléphone, avec un code reçu par SMS.** C'est l'identifiant principal. **Décidé (01/10/2026) : l'email, Google, Apple et GitHub sont proposés aussi, dès la première version**, à l'inscription comme à la connexion. S'inscrire et se connecter sont le même geste : le compte naît à la première connexion réussie, sur le forfait Découverte.

| Moyen | Preuve | Pourquoi |
|---|---|---|
| Téléphone | Code de 6 chiffres par SMS (sécurité §4.1) | Ce que tout le monde a, dans les 7 pays |
| Email | Code de 6 chiffres par email, mêmes règles que le SMS | Partout, et dans les pays où le SMS n'est pas ouvert |
| Google | OpenID Connect ; l'email compte seulement si Google le dit vérifié | Le compte le plus répandu sur Android |
| Apple | OpenID Connect | **Obligatoire** sur iPhone dès qu'on propose Google (règle 4.8 de l'App Store) |
| GitHub | OAuth ; seul l'email principal **vérifié** compte (`/user/emails`) | Les profils techniques |
| Microsoft | OpenID Connect | Prévu, éteint tant qu'aucune demande ne le justifie |

**Pas de mot de passe** (décidé le 01/10/2026). Un mot de passe se réutilise d'un site à l'autre, se vole, et sa réinitialisation passe de toute façon par l'email. Un code à usage unique ne laisse rien à voler. Les clés d'accès (*passkeys*) viendront ensuite (sécurité §4.3).

**Un utilisateur, plusieurs identités** (`user_identities`, modèle §6.1) :

- **La liaison automatique ne se fait que par un email vérifié des deux côtés.** Exemple : quelqu'un inscrit par code email se connecte ensuite avec Google, sur la même adresse, que Google dit vérifiée. Sinon, c'est un nouveau compte. Lier un email non vérifié, c'est la porte classique du vol de compte.
- **Un numéro de téléphone ne se lie jamais automatiquement** : les opérateurs réattribuent les numéros.
- **Lier, ajouter ou retirer un moyen depuis les réglages** est un geste sensible (revalidation de moins de 5 min, sécurité §4.3). On ne retire jamais le dernier moyen.
- **La période de 72 h** (sécurité §4.4) s'applique à toute connexion depuis un nouvel appareil sans passkey, quel que soit le moyen. Un compte Google ou GitHub se vole aussi.

**Comment l'app se connecte, sans toucher à l'upstream.** Le cœur connaît déjà un serveur d'autorisation : celui de Rowboat Labs. Il le trouve à `${supabaseUrl}/auth/v1/.well-known/oauth-authorization-server` (`core/auth/providers.ts`), y enregistre l'app par enregistrement dynamique (DCR), puis se connecte en OAuth 2.1 avec PKCE et une redirection vers la machine de l'utilisateur. Le plan de contrôle joue ce rôle à la même adresse (`/v1/config` sert déjà `supabaseUrl`). La page de connexion qu'il sert propose les moyens ci-dessus. Deux compléments sont apportés aux requêtes du cœur, côté serveur : `offline_access`, pour qu'il reçoive un jeton de rafraîchissement tournant (sécurité §4.2), et `application_type: native`, puisqu'il reçoit le code sur un port local (RFC 8252). Un nouvel inscrit reçoit son compte sur Découverte. Le jeton reçu ouvre `/v1/*` pour cet utilisateur. Harbor consomme le même émetteur OIDC (`auth-oidc.ts`) sans modification.

**Une bibliothèque, pas du code à la main.** Écrire soi-même un serveur OAuth, la vérification des jetons Google ou Apple et la liaison de comptes, c'est une source connue de failles. Le plan de contrôle s'appuie sur **Better Auth** (MIT, TypeScript). Elle fournit :

- les codes par email et par SMS ;
- Google, Apple, GitHub et Microsoft ;
- la liaison de comptes et les sessions ;
- la limitation de débit ;
- le serveur OAuth 2.1 avec DCR et PKCE (`@better-auth/oauth-provider`).

Ses tables vont dans le schéma `baarali`. Nos règles s'ajoutent par ses points d'extension : liaison seulement par email vérifié, période de 72 h, indicatifs ouverts au SMS.

**Latitude :** l'envoi des SMS et des emails passe par un `CommunicationProvider` (§3.8), jamais par un fournisseur codé en dur. En développement, un faux fournisseur écrit le code dans le journal. Le choix de l'agrégateur SMS se fait par pays, sur deux critères : la délivrabilité réelle dans chacun des 7 pays, et le coût par message. Voir `WEST_AFRICA_PROVIDER_ARCHITECTURE.md`. Les mêmes plafonds valent pour l'email : par adresse, par IP, avec une expiration courte et un nombre d'essais borné.

**L'ordre de construction :**
1. les comptes, l'usage et les crédits passent en Postgres ;
2. le serveur de connexion, avec ses six moyens et de faux envois ;
3. l'accueil : premier écran, choix du moyen, compte Découverte, puis une instance créée pour chaque compte ;
4. la page des tarifs dans l'app, puis le paiement.

Les vrais envois (agrégateur SMS, service d'email) et les applications OAuth chez Google, Apple et GitHub se branchent par des secrets, sans changer le code.

#### Les instances

**Décidé (01/10/2026) : une machine Fly et son volume par compte, dans une seule app Fly (`baarali-instances`), créées la première fois qu'un appareil du compte se connecte** (`packages/control/src/instances.ts`). Pas à l'inscription sur le site : quelqu'un qui n'installe jamais l'app ne coûte rien.

- **Même gabarit que l'instance du propriétaire** (`packages/instance/fly.toml`) : 2 Go, suspendue au repos, réveillée à la requête suivante.
- **Joignable seulement par Flycast**, à travers la passerelle (sécurité §2). L'en-tête `fly-force-instance-id` choisit la machine du compte parmi celles de l'app.
- **La passerelle** sert le mode distant de l'app upstream à `https://app.baarali.com/instance` : RPC, fichiers de l'espace de travail et WebSocket des événements. Elle réveille la machine si elle dort, puis relaie avec la clé de l'instance. Elle répond elle-même à `/instance/health`, que l'app interroge avant d'envoyer sa clé.
- **La mise à jour** suit la connexion d'un appareil : une machine sur une image plus ancienne que `BAARALI_INSTANCE_IMAGE` y passe à ce moment-là, jamais au milieu d'une session.
- **Accès anticipé** : au plus `BAARALI_MAX_INSTANCES` instances (20 par défaut). Au-delà, l'app reçoit `instances_full`.
- **Le plan de contrôle tourne sur une seule machine** : deux appareils qui se connectent ensemble obtiennent la même instance grâce à un verrou en mémoire. Le jour où il en a plusieurs, ce verrou passe en base.

#### Le quota d'utilisation

**Décidé (30/09/2026) : l'utilisation se mesure en deux fenêtres, 5 heures et une semaine,** comme chez les assistants grand public. L'utilisateur ne compte ni messages ni crédits : il voit une jauge par fenêtre et l'heure à laquelle elle se remet à zéro.

| | Fenêtre de session | Fenêtre hebdomadaire |
|---|---|---|
| Durée | 5 heures | 7 jours |
| Ouverture | Au premier appel modèle, quand aucune session n'est en cours | À la date d'ouverture du compte, puis tous les 7 jours à la même heure |
| Budget | Un quart du budget hebdomadaire | Fixé par le forfait |
| Remise à zéro | 5 heures après son ouverture | À l'échéance suivante |

- **Ce qu'on mesure : le coût réel de chaque appel**, lu dans `usage.cost` d'OpenRouter (le plan de contrôle demande `usage: { include: true }`). Il est compté en crédits, l'unité de l'upstream (`CREDITS_PER_DOLLAR`, 100 M = 1 $). Une réponse sans coût est comptée au **plancher** d'un millième de dollar et marquée `estimated`, jamais à zéro.
- **Tout passe par là :** texte, images et tâches de fond appellent `/v1/llm`, donc le même quota. Un Goal consomme le quota de son propriétaire, appel par appel.
- **Le refus se décide avant l'appel.** Si l'une des deux fenêtres est épuisée, `/v1/llm` répond `429` avec `{ error: { code: "quota_reached", window: "session" | "week", resets_at } }`. **Un appel commencé n'est jamais coupé** : il peut dépasser le budget de son propre coût, compté ensuite. Le moteur d'objectifs relira la jauge avant chaque tâche (phase 1).
- **Les budgets se calculent à partir des prix** (ci-dessous) : aucun budget n'est saisi à la main.

#### Les forfaits

**Décidé (30/09/2026) : une marge d'au moins 55 % garantie après le coût des modèles,** même pour quelqu'un qui épuise son quota chaque semaine. L'application est internationale : chaque forfait a **un prix fixe par devise**, hors taxes, choisi par le propriétaire (pas une conversion au jour le jour). **On facture en euros et en francs CFA seulement** : les deux francs CFA ont une parité fixe avec l'euro, donc nos prix ne dérivent jamais entre eux. Seuls les modèles se paient en dollars, d'où la réserve de change.

| Forfait | EUR | F CFA (XOF, XAF) | Période | Budget modèles / semaine | / session de 5 h |
|---|---|---|---|---|---|
| Découverte | gratuit | gratuit | — | 0,08 $ | 0,02 $ |
| Semaine | 5 € | 3 300 F | une semaine, prépayée | 2,04 $ | 0,51 $ |
| Essentiel | 20 € | 13 000 F | mois | 1,96 $ | 0,49 $ |
| Pro | 100 € | 65 000 F | mois | 9,96 $ | 2,49 $ |
| Pro | 200 € | 130 000 F | mois | 19,96 $ | 4,99 $ |

- **Semaine** est l'Essentiel d'une seule semaine, payé d'avance : LigdiCash ne sait pas prélever de façon récurrente, et le marché connaît le prépayé (crédit téléphonique).
- **Pro** existe en deux niveaux d'utilisation, environ 5 et 10 fois l'Essentiel.
- **Découverte** ne sert que les modèles les moins chers qui savent appeler des outils (environ 0,05 centime l'appel), jamais les modèles `:free` d'OpenRouter, dont la limite de requêtes est commune à toute notre clé. Son coût est un budget accepté, pas une marge.

Le budget d'une offre payante se déduit de son prix, dans cet ordre (`apps/baarali/packages/control/src/pricing.ts`) :

1. le prix converti en dollars, la monnaie des modèles, au taux de référence BCE du jour de la décision (parité fixe pour le franc CFA) ;
2. moins une **réserve de change** de 5 % (si l'euro baisse face au dollar) et une **réserve de frais de paiement** de 5 % plus 0,35 $ par paiement, à vérifier contre la réponse écrite de LigdiCash (fournisseurs §8) : c'est le revenu net ;
3. 45 % du revenu net au plus pour les modèles, **divisé par 1,055**, la commission d'OpenRouter sur l'achat de crédits ;
4. on garde **la devise la moins favorable**, pour que toutes tiennent la marge ; un mois se répartit sur 52/12 semaines.

Un test parcourt chaque offre et chaque devise, et casse si la marge à pleine utilisation passe sous 55 %. Changer un prix, un taux ou une commission ne se fait donc que dans `catalog.ts`, et le test dit tout de suite si la garantie tient encore.

Ce que la marge de 55 % paie encore : l'hébergement de l'instance, le plan de contrôle, les SMS, le support, et les utilisateurs de Découverte. Les taxes s'ajoutent au prix affiché.

#### Les modèles par forfait

Décidé le 30/09/2026. Les forfaits payants appellent n'importe quel modèle, dans leur quota. **Découverte** n'appelle que sa liste (`DISCOVERY_MODELS`, `catalog.ts`), testée en français le même jour : **DeepSeek V4.1 Flash** par défaut, au choix du propriétaire, puis **GPT-6 Luna** si le premier échoue. Le plan de contrôle applique la liste (`models.ts`) :

- un modèle hors liste est **remplacé** par le défaut, pas refusé : le travail de fond du cœur (notes, titres, connaissances) demande ses propres modèles et doit continuer de tourner ;
- chaque appel part avec la liste entière dans `models`, pour qu'OpenRouter passe au suivant si l'un tombe, et avec la **réflexion coupée** : sans elle, DeepSeek dépense les jetons de la réponse à réfléchir et ne rend rien ;
- la génération d'images et les autres routes que `/chat/completions` sont **refusées** (403 `not_in_plan`) avant le quota, sans ouvrir de session ;
- le catalogue `GET /v1/llm/models` ne montre que la liste, pour que le sélecteur ne propose rien qui serait remplacé ;
- l'enregistrement d'usage garde le modèle demandé à côté du modèle servi.

L'instance part sur DeepSeek V4.1 Flash quel que soit le forfait (`BAARALI_ASSISTANT_MODEL` le change) ; un choix déjà fait dans l'app n'est jamais écrasé.

#### Les médias

Décidé le 30/09/2026. La vidéo, la voix et la musique passent par **Pixazo**, avec une seule clé gardée dans le plan de contrôle (`/v1/media`, `media.ts` et `media-route.ts`). Les prix ont été lus sur les pages modèles de pixazo.ai le 30/09/2026. Quand une promotion court, on garde le prix normal, pour ne jamais compter moins que ce qu'on paie.

| Modèle | Usage | Prix retenu | Crédits (requête par défaut) |
|---|---|---|---|
| Seedance 2.0 Mini | vidéo, 4 à 30 s, 720p | 0,0756 $/s (promotion : 0,03024 $/s) | 38 (5 s) |
| Veo 3.1 Fast | vidéo, 4, 6 ou 8 s | 0,10 $/s sans son, 0,15 $/s avec | 80 (8 s) |
| Veo 3.1 | vidéo, 720p, son compris | 0,40 $/s | 320 (8 s) |
| Gemini 3.8 Flash TTS | voix, 4 000 caractères au plus | 0,01728 $ la minute commencée, estimée à 12 caractères par seconde | 2 la minute |
| Lyria 3 / Lyria 3 Pro | musique | 0,042 $ / 0,084 $ le morceau | 5 / 9 |

**Des crédits médias, pas le quota du texte** (décidé le 01/10/2026). Une vidéo coûte d'un coup ce qu'une conversation coûte en plusieurs heures : un quota taillé pour le texte la refusait, ou se vidait d'un coup. Les médias se paient donc sur un **solde de crédits médias**, acheté en recharges et gardé jusqu'à ce qu'il soit dépensé :

- **Un crédit = un centime de notre coût** (`MEDIA_CREDIT_USD`), arrondi au-dessus. Ce sont des nombres qu'on lit (« 38 crédits »), alors que les unités du quota en montreraient des millions.
- **Les recharges** (`MEDIA_PACKS`, `catalog.ts`) gardent la même garantie que les forfaits : une recharge dépensée jusqu'au dernier crédit laisse au moins 55 % de ce qu'on garde de son prix, dans chaque devise (`packCredits`, `test/pricing.test.ts`). Les frais de Pixazo sur ses propres recharges ne sont écrits nulle part : on réserve ceux d'OpenRouter (5,5 %) en attendant.

| Recharge | EUR | F CFA | Crédits |
|---|---|---|---|
| `medias-2` | 2 € | 1 300 F | 71 |
| `medias-5` | 5 € | 3 300 F | 203 |
| `medias-20` | 20 € | 13 000 F | 851 |

- **Tous les forfaits y ont droit, Découverte compris** : un crédit est payé avant d'être dépensé, il ne prend rien au budget du forfait.
- **Le solde est un journal** (`MediaLedgerEntry`) : recharge, débit et remboursement. Le solde est leur somme. Le débit se fait **avant l'envoi**, en une seule opération atomique, pour que deux demandes simultanées ne dépensent pas les mêmes crédits. S'il n'y a pas assez de crédits, la réponse est `402 insufficient_media_credits`, avec le prix et le solde.
- **Un échec est rendu, une seule fois.** Si Pixazo refuse l'envoi, ou si la génération échoue (y compris une génération « terminée » sans fichier), le débit est rendu. Le journal n'applique qu'un remboursement par débit, même si deux suivis se croisent.
- **Une recharge n'est appliquée qu'une fois par paiement** : sa référence (le reçu, la transaction mobile money) est unique. Tant qu'aucun moyen de paiement n'est branché, l'opérateur ajoute une recharge à la main (`POST /v1/admin/media-credits`, jeton `BAARALI_ADMIN_TOKEN`). Le paiement appellera la même règle.
- **Une génération n'est visible que de son compte.** Celle d'un autre compte répond 404.
- **Le relevé d'usage** (`UsageRecord`) garde le coût réel de chaque génération, dans l'unité du quota, pour suivre ce qu'on dépense chez Pixazo.

**Durable avec Postgres** (`DATABASE_URL`, décidé le 01/10/2026). Le journal y est en ajout seul : un déclencheur refuse toute modification et toute suppression. Un débit verrouille la ligne du compte pendant sa transaction. Sans base, le magasin en mémoire oublie tout quand la machine s'arrête, et le solde du propriétaire (`BAARALI_OWNER_MEDIA_CREDITS`) revient à chaque démarrage.

**Côté agent**, l'instance déclare un serveur MCP `baarali-media` dans `config/mcp.json` et un skill disque `skills/baarali-media/SKILL.md` (`packages/instance`, `seed.ts` et `media-mcp.ts`). Aucun fichier de l'upstream ne change :
- le skill se charge quand on demande une vidéo, une voix ou une musique, et n'attache que les outils MCP existants (`listMcpTools`, `executeMcpTool`), qui gardent leur demande d'accord avant chaque appel ;
- le serveur expose trois outils : `list_models`, `generate` et `check`. Le client MCP du cœur abandonne au bout de 60 s, alors qu'une voix prend déjà plus d'une minute. `generate` rend donc la main tout de suite, et `check` attend au plus 45 s par appel. L'agent rappelle `check` jusqu'à ce que le fichier soit enregistré dans `generated_media/` ;
- le jeton est lu dans `oauth.json` : `mcp.json` ne contient aucun secret.

**Sur le fil, on garde le schéma de l'upstream** (§3.14) : `GET /v1/me` porte la session dans le compartiment `daily` et la semaine dans `monthly`, et `usageDay` donne l'heure de remise à zéro de la session. Les libellés de l'écran d'usage upstream (« jour », « mois ») sont donc faux jusqu'à ce que la couche de marque et d'i18n (§3.12) les remplace : c'est accepté pour la phase 0, où seul le propriétaire utilise l'app.

### 3.6 La vérification : exécuté ≠ vérifié

**Décidé.** Une Action a deux états distincts : `executed` et `verified`. Chaque outil à effet déclare comment prouver son effet :

- identifiant renvoyé par l'API ;
- relecture d'un endpoint de statut ;
- état du DOM après l'action ;
- email de confirmation reçu ;
- reçu du fournisseur ;
- pour la blockchain, la confirmation on-chain.

La preuve est attachée à l'Action dans le journal. Un Goal ne passe `COMPLETED` que si ses actions critiques sont `verified`. Sinon il passe WAITING_USER, avec la raison. (Mission §35, §85.)

**Latitude :** la vérification peut être un outil appelé par l'agent, ou une étape automatique du moteur d'objectifs. Il faut commencer par la seconde pour les outils engageants, la première pour le reste.

### 3.7 Modèles : OpenRouter par défaut

| | |
|---|---|
| Existe | OpenRouter et Ollama déjà supportés (`core/models/`). La configuration distingue déjà un `assistantModel` et des `taskModels` par type de tâche (`shared/models.ts`) : c'est le **routage par tâche** de la mission §11, déjà en place. |
| Manque | Retirer la passerelle Rowboat Labs (`/v1/llm`, audit §11) ; router aussi selon le coût et la disponibilité. |
| Changement | Config initiale Baarali : fournisseur = OpenRouter, avec des modèles recommandés par tâche. C'est un fichier de données, pas du code. |
| Risque | Les identifiants de modèles meurent. Il faut une synchro du catalogue (le `models-dev.ts` upstream la fait déjà) et une alerte quand le solde OpenRouter s'épuise (le 402 coupe *tous* les modèles, y compris les gratuits). |

### 3.8 Pays et fournisseurs

**Décidé.** Un package `@baarali/providers`, sans aucune dépendance au runtime, contient :

- les interfaces `PaymentProvider`, `CommerceProvider`, `TravelProvider`, `TransportProvider`, `DeliveryProvider`, `MapsProvider`, `CommunicationProvider` ;
- le type `Money { amount: entier en unité mineure, currency: ISO 4217 }` : jamais de flottant (mission §26) ;
- le registre `CountryConfig` : pays, devise, langues, fournisseurs disponibles par catégorie, avec un statut `SUPPORTED`, `RESEARCH_REQUIRED` ou `UNAVAILABLE`.

Qui utilise quoi :

- **Le service de paiement** implémente `PaymentProvider`.
- **L'instance** utilise les autres interfaces à travers des **skills** (chercher un vol, comparer des produits), avec le repli dans l'ordre de la mission §14 : API native, puis MCP, puis intégration, puis navigateur, puis vision.
- **Ajouter un pays = ajouter une entrée de registre et des implémentations.** Le cœur ne change pas.

Le détail par marché est dans `WEST_AFRICA_PROVIDER_ARCHITECTURE.md`.

### 3.9 Le service de paiement

**Décidé : un déploiement séparé du plan de contrôle** (`apps/baarali/packages/payments`), avec son propre rôle de base de données. Ce rôle est le seul à pouvoir écrire dans le ledger, et le seul à détenir les secrets financiers.

Il porte, dans cet ordre de construction (mission §90) :

1. `PaymentIntent`, `PaymentMandate`, le moteur de politique et le ledger ;
2. les fournisseurs existants ;
3. le Mobile Money ;
4. les cartes virtuelles ;
5. les achats autonomes ;
6. la crypto ;
7. le routage avancé.

Le **moteur de politique** est une fonction pure. Il prend l'intention, le mandat et l'historique du ledger, et rend `EXECUTE`, `REQUIRE_APPROVAL` ou `BLOCK` avec la raison. Il se teste exhaustivement sans réseau, comme `policy.ts` dans Harbor.

**Décidé (29/09/2026) : Baarali ne détient jamais d'argent.** Dans la zone UEMOA, détenir des fonds pour autrui ou émettre de la monnaie électronique relève d'agréments de la BCEAO. Baarali reste donc **orchestrateur** : l'argent va directement du moyen de paiement de l'utilisateur au marchand, via un agrégateur ou un établissement agréé, et ne transite jamais par un compte Baarali.

Conséquences qui s'imposent au code :

- pas de solde, pas de portefeuille, pas de compte de passage côté Baarali ;
- le ledger **enregistre** des mouvements exécutés par des tiers, il n'en **porte** aucun ;
- un remboursement est demandé au fournisseur ou au marchand, jamais versé par Baarali ;
- l'abonnement de l'utilisateur à Baarali est un flux séparé (Baarali y est le marchand) et n'a rien à voir avec les dépenses des agents.

Reste à faire valider ce montage par un juriste avant le premier encaissement réel.

### 3.10 Le navigateur côté serveur

**Décidé : même outil, autre moteur.** L'outil `browser-control` (audit §6) parle aujourd'hui au navigateur Electron. Baarali fournit une implémentation **Chromium headless** du même service de contrôle, par instance, avec :

- son propre profil (cookies et sessions de l'utilisateur, isolés) ;
- les mêmes éléments indexés (DOM structuré, pas de vision par défaut) ;
- les mêmes skills par site.

**JEV** (`benewende-dev/jev-ultrafast`, fork de `browser-use/jev-ultrafast`, MIT, v0.1.0 du 18/09/2026) est un agent de navigation **par choix plutôt que par génération**. À chaque étape, il lit un tableau indexé des éléments de la page. Un modèle spécialisé (Jev, de TypeSafe) choisit en un seul aller-retour l'opération (`CLICK`, `TYPE_TEXT`, `SELECT`, `SCROLL`, `WAIT`, `DONE`, `BLOCKED`) et l'élément visé. Un petit LLM (via OpenRouter) n'écrit du texte que pour `TYPE_TEXT`.

| | |
|---|---|
| Forces | Très rapide (Google Flights en ≈ 7 s selon ses mesures). Pas de vision. Aucune sortie du modèle ne devient sélecteur, coordonnées ou JavaScript. Petit (≈ 850 lignes, lisible). Même famille que les skills par site déjà utilisés par Rowboat (browser-use / browser-harness). |
| Limites (déclarées par ses auteurs) | Pas d'iframes, de shadow DOM, d'upload, de pop-ups, de canvas, ni de défilement imbriqué. Or les pages de paiement sont souvent en iframe : **JEV ne fera pas de checkout**, ce qui tombe bien, puisque les paiements passent par le service de paiement (§3.4). Les auteurs précisent aussi que leurs mesures ne sont pas un banc de fiabilité : 3 exécutions d'une seule tâche. |
| Dépendance | L'API de TypeSafe (`api.typesafe.ai`, clé payante) reçoit l'état de la page à chaque étape. C'est un tiers qui voit ce que l'agent voit, donc un point à couvrir dans `AGENT_SECURITY_MODEL.md` (données de l'utilisateur envoyées hors de Baarali). |
| Langage | Python ≥ 3.12, alors que l'instance est en Node. |

**Décidé : JEV est un accélérateur optionnel, pas le moteur du navigateur.**

- Il tourne comme **processus annexe (Python) dans l'instance**, relié au même Chromium headless par le protocole de débogage (CDP).
- Il est exposé comme **un outil de plus**, `browser.pursue(url, goal)`, réservé aux **objectifs de lecture et de recherche** : trouver des vols, filtrer des hôtels, ouvrir une page. Son `DONE` est toujours suivi d'une vérification indépendante (§3.6), comme le font ses propres exemples.
- **Tout geste engageant** (valider un formulaire, réserver) repasse par `browser-control`, avec son niveau de risque et son approbation.
- **Si TypeSafe est indisponible, trop cher ou refusé par l'utilisateur, `browser-control` fait le travail seul.** Baarali ne dépend pas de JEV pour fonctionner.
- L'adopter pour de bon se décide sur **mesures** : un banc de tâches réelles sur des sites d'Afrique de l'Ouest (compagnies régionales, hôtels, commerce en ligne), qui compare taux de réussite, durée et coût avec `browser-control` seul.

| | |
|---|---|
| Existe | Interface d'outil, éléments indexés, skills par site ; `apps/main/src/browser/control-service.ts`. |
| Manque | Un moteur sans Electron. |
| Risque | `page-scripts.ts` (18 Ko) contient la logique d'indexation dans le processus Electron. Il faut la réutiliser telle quelle (injectée dans Chromium) plutôt que la réécrire, pour profiter des corrections upstream. |

### 3.11 Code Mode dans le cloud

Code Mode (audit §9) lance Claude Code ou Codex sur la machine qui héberge le serveur. En cloud, cette machine est l'instance. Il faut donc un **bac à sable de code** à l'intérieur de l'instance, ou un bac à sable éphémère à part pour chaque session de code.

**Latitude.** Les identifiants des agents de code (compte Claude ou ChatGPT de l'utilisateur, ou clés via le coffre) ne passent jamais par le LLM.

### 3.12 FR / EN

**Décidé : l'i18n est une couche, pas une réécriture.**

- **Agents et contenus :** la langue d'exécution (`executionLocale`) est injectée dans les instructions composées (`runtime/assembly/compose-instructions.ts`) par un « trait » Baarali. On ne modifie pas le prompt de base de l'upstream.
- **UI :** toutes les chaînes Baarali naissent traduites, via un package `@baarali/i18n`. **Décidé (29/09/2026)** pour les chaînes **upstream** :
  1. **D'abord, proposer l'i18n à l'upstream.** Une issue d'abord, pour valider l'approche avec leurs mainteneurs, puis une première PR petite (le mécanisme et un écran) plutôt qu'une extraction massive. Si elle est acceptée, la divergence disparaît et le monde entier en profite.
  2. **Seulement en cas de refus, extraire nous-mêmes, composant par composant**, en évitant `App.tsx`. Chaque extraction est alors une divergence déclarée.
- **Marque :** « Baarali » ne s'affiche que via la couche i18n et marque. Les identifiants internes ne bougent pas (UPSTREAM.md §2).

### 3.13 Clients

| Client | Existe | Cible |
|---|---|---|
| Desktop | ✅ | Deux modes : instance **locale** (le Rowboat d'aujourd'hui, données sur la machine) ou instance **cloud** (le plan de séparation upstream l'a validé, `apps/x/REMOTE_SERVER.md`). **Décidé (01/10/2026) : l'app distribuée est en cloud.** Après la connexion, elle se branche d'elle-même sur l'instance du compte, par la passerelle (§3.5 « Les instances », `apps/baarali/packages/desktop`). |
| Mobile | ✅ (appairage, chat, notifications) | Ajouter la connexion au plan de contrôle, **les approbations** (mission §40) et le statut des Goals. |
| Web | ❌ | Le renderer parle à `window.ipc`, et `@x/client` fournit déjà le jumeau HTTP typé des mêmes canaux (`packages/client/src/rpc.ts`). Une coquille web qui adapte l'un à l'autre est **faisable sans réécrire l'UI**. À planifier après le premier jalon. |
| WhatsApp / SMS | ✅ WhatsApp, Telegram (`core/channels`) | Canal de premier rang pour les approbations et le suivi : c'est l'interface réelle du marché. |
| Voix | ⚠️ dictée et TTS | Même runtime (mission §41) ; la TTS du backend Rowboat Labs est à remplacer. |

### 3.14 Ce qui remplace le backend Rowboat Labs

Chaque appel à `API_URL` (audit §11) trouve son remplaçant, **fonction par fonction** :

| Route Rowboat Labs | Remplaçant Baarali |
|---|---|
| `/v1/config` | Config servie par le plan de contrôle (même schéma `RowboatApiConfig`). |
| `/v1/me` | Identité du plan de contrôle. |
| `/v1/llm`, `/v1/llm/models` | OpenRouter directement, avec la clé détenue par le plan de contrôle. |
| `/v1/search/exa` | Recherche via le plan de contrôle (Exa ou autre, clé chez nous). |
| `/v1/composio` | **Désactivé en V1.** Les intégrations V1 passent par les connecteurs natifs de Rowboat (Gmail, agendas) et par MCP. Composio se réévalue quand le besoin d'intégrations nombreuses apparaît (§8). `/v1/config` le dit (`composio: false`, 02/10/2026) : l'app ne l'appelle plus, seule une clé Composio de l'utilisateur l'active. |
| `/v1/voice/text-to-speech/` | Mandataire TTS dans le plan de contrôle. |
| `/v1/google-oauth/claim-picked` | OAuth Google géré par le plan de contrôle (fin du retour sur `localhost` en cloud). |
| `/v1/billing/*`, `/v1/referral` | Budgets et usage Baarali ; parrainage hors V1. |
| PostHog | Désactivé ; observabilité Baarali propre (§4). |

**Décidé :** le plan de contrôle expose ces routes **avec les mêmes chemins et les mêmes schémas**. L'instance pointe simplement `API_URL` vers le plan de contrôle. On ne modifie aucun des fichiers qui appellent `API_URL` : c'est la plus grosse économie de divergence du projet.

## 4. Observabilité

Chaque Goal s'inspecte sans lire de logs épars (mission §36) :

- **Dans l'instance :** les journaux JSONL de tours et de Goals sont déjà la trace complète (outil, entrée, sortie, permission, durée, usage). `inspect-cli.ts` existe côté upstream.
- **Dans le plan de contrôle :** la projection indexe `goalId`, `taskId`, `toolCallId` (qui sert d'`actionId`) et un `traceId`. L'écran « pourquoi a-t-il échoué ? » lit cette projection.
- **Coûts :** `UsageRecord` agrège modèle, outils, navigateur, calcul et fournisseurs par Goal.

## 5. Cycles de vie

Les états et transitions exacts sont spécifiés dans `AGENT_RUNTIME_SPEC.md`. En résumé :

| Objet | États |
|---|---|
| Goal | DRAFT → PLANNING → RUNNING ⇄ WAITING_USER / WAITING_EXTERNAL / PAUSED → COMPLETED / FAILED / CANCELLED |
| Task | pending → running ⇄ waiting_user / waiting_external → verified / failed / cancelled (avec retry borné) |
| Action | requested → (permission) → executed → verified / unverified / failed |
| Approval | pending → approved / rejected / expired ; liée à **une** action et à l'empreinte de son payload |
| Instance | provisioning → running ⇄ sleeping → updating → archived |
| Mandate | draft → active ⇄ paused → exhausted / expired / revoked |

## 6. Hébergement

**Décidé (29/09/2026) : les instances s'endorment quand elles ne servent pas.** Une instance inactive ne consomme pas de calcul ; elle se réveille sur une requête d'un client, sur une réponse attendue (approbation, résultat de paiement) ou sur le réveil planifié (§3.5).

**Décidé (30/09/2026) : Fly.io, région Paris (`cdg`).** Chaque instance est une *Fly Machine* avec son volume.

| Besoin | Réponse de Fly.io (documentation lue le 30/09/2026) |
|---|---|
| Volume persistant | Un volume par Machine, lié à sa région. Il n'est pas répliqué : les sauvegardes sont à notre charge (sécurité §6.3). |
| Veille | `autostop = suspend` : la mémoire est figée dans un instantané, et le réveil prend « quelques centaines de millisecondes ». Une Machine suspendue ne coûte **que son stockage**. |
| Réveil | Le proxy Fly réveille la Machine à la première requête (`autostart`). Le plan de contrôle et le réveil planifié passent par lui. |
| Isolation | Chaque Machine est une micro-VM Firecracker : **isolation noyau pour toutes les instances** (sécurité §9.1). |
| Région | Paris (`cdg`) et Johannesburg (`jnb`) existent. Paris est retenu parce que le trafic d'Afrique de l'Ouest passe en grande partie par l'Europe (câbles sous-marins). **Mesuré le 01/10/2026 : Paris répond 3,5 fois plus vite que Johannesburg** depuis l'Afrique de l'Ouest (ci-dessous). |

**Limite connue.** La suspension exige une Machine de **2 Go de mémoire au plus**. Mesuré : l'instance en utilise environ 610 Mo, ce qui laisse 1,4 Go pour un Chromium headless. Si ça ne suffit pas, deux parades : lancer Chromium seulement quand une tâche en a besoin, ou accepter l'arrêt simple (`autostop = stop`), avec un réveil de plusieurs secondes.

#### Mesures de la phase 0 (01/10/2026)

Faites sur les deux apps réelles (`warell-control` et `warell-owner`, `shared-cpu-1x`, Paris), et sur une app jetable à deux Machines identiques (Paris et Johannesburg), supprimée aussitôt après.

**Mémoire de l'instance**, avec l'app de bureau et l'app mobile connectées : 610 Mo utilisés sur 2 Go. Dossier de travail : 10 Mo. Chromium n'est pas dans l'image : en phase 0, les actions de navigateur passent par le client connecté (capacité `browser-control` de l'upstream). Sa mémoire se mesurera quand il entrera dans l'image.

**Démarrage et réveil**

| | Durée |
|---|---|
| Démarrage à froid de l'instance (Machine lancée → serveur prêt) | 9 s |
| Réveil de l'instance suspendue, par le tunnel `fly proxy` | 2,3 s |
| Réveil du plan de contrôle suspendu, par Internet (3 essais) | 0,9 à 1,1 s |
| Requête sur le plan de contrôle éveillé | 0,4 s |

Le réveil coûte donc environ **une demi-seconde à deux secondes de plus** sur la première requête, ce qui reste invisible à côté du temps de réponse d'un modèle.

**Latence depuis l'Afrique de l'Ouest** (sondes publiques Globalping, HTTPS, temps jusqu'au premier octet, médiane de 3 essais) :

| Sonde | Vers Paris | Vers Johannesburg | Porte d'entrée Fly |
|---|---|---|---|
| Ouagadougou (Burkina Faso Internet Exchange) | 132 ms | 453 ms | Amsterdam |
| Cotonou (ISOCEL) | 107 ms | 491 ms | Paris |
| Lagos | 128 ms | 479 ms | Londres |

Le trafic d'Afrique de l'Ouest entre chez Fly **en Europe** dans tous les cas : une Machine à Johannesburg ajoute l'aller-retour Europe-Afrique du Sud. Aucune sonde publique n'existe en Côte d'Ivoire sur ce réseau : Abidjan reste à mesurer, par une sonde RIPE Atlas ou par un testeur sur place.

**Coût** (tarifs Fly.io lus le 01/10/2026 ; Paris = tarif de base × 1,13) :

| | Prix |
|---|---|
| Instance 2 Go éveillée | 12,13 $ par 30 jours, soit 0,017 $ de l'heure |
| Instance endormie | stockage seulement : volume 1 Go à 0,15 $/mois, plus le disque système de la Machine à 0,15 $/Go/mois |
| Plan de contrôle 256 Mo éveillé en continu | 2,21 $ par 30 jours |
| Trafic sortant (Europe) | 0,02 $/Go |

Une instance éveillée **2 heures par jour** coûte environ **1,20 $ par mois** ; 8 heures par jour, environ 4,20 $. Ce coût sort de la marge de 55 % (§3.5).

**Ce que les mesures ont appris**

- **Une app ouverte garde l'instance éveillée** : le lien WebSocket de l'app de bureau ou du téléphone compte comme du trafic. Le coût réel dépend donc du temps où l'app reste ouverte, pas seulement du temps de travail de l'agent.
- **Une instance suspendue ne fait plus rien** : ses tâches de fond sont gelées avec elle. Le réveil planifié du plan de contrôle (§3.5) est donc indispensable avant d'ouvrir les tâches programmées.
- **L'accueil upstream exige un espace d'équipe** dès qu'un compte est connecté, et bloque tant qu'aucun serveur d'espaces n'existe. **Traité** : la préparation de l'instance (`packages/instance/src/seed.ts`) le marque comme fait. L'accueil Baarali (connexion par téléphone) le remplacera.

**Les alternatives regardées** (30/09/2026), pour pouvoir changer si Fly.io déçoit :

| Plateforme | Ce qui convient | Ce qui bloque |
|---|---|---|
| Koyeb | Micro-VM Firecracker, veille légère avec réveil en ≈ 200 ms | Rachetée par Mistral en février 2026, recentrée sur l'inférence IA ; la veille légère est citée parmi les fonctions menacées ; compatibilité veille + volume non documentée |
| Northflank | Micro-VM, veille qui garde le volume, déploiement possible dans notre propre compte cloud | Réveil à froid (pas d'instantané mémoire) |
| Railway | Volumes, facturation à la minute, veille | Conteneurs, pas de micro-VM ; créer une instance par utilisateur par API est moins naturel |
| Modal, Daytona | Bacs à sable rapides à créer | Faits pour des sessions courtes (durée de vie bornée, archivage automatique) : bons candidats pour le **bac à sable de code** (§3.11), pas pour l'instance |
| Cloudflare Containers | Une instance par utilisateur, veille gratuite | **Disque effacé à chaque veille** : incompatible avec le dossier de travail |
| Grands clouds (AWS, Google, Azure) | Tout est possible | Tout est à construire et à administrer |

**Plan de repli : Northflank**, parce qu'il garde l'isolation par micro-VM et permet de migrer plus tard vers notre propre compte cloud. Rien dans l'instance ne dépend de Fly.io : le plan de contrôle parle à l'hébergeur par une interface `InstanceHost` (créer, réveiller, endormir, sauvegarder), dont Fly.io est la première implémentation.

Contrainte connue : on privilégie le **managé**, pas de VPS à administrer soi-même. Le plan de contrôle et le service de paiement, eux, sont des services classiques.

## 7. Récapitulatif

**Ce qu'on garde de Rowboat, sans y toucher :**

- le moteur de tours et les sessions ;
- les permissions (via leurs interfaces) ;
- le catalogue d'outils et les skills ;
- le Brain, les bg-tasks, Code Mode, MCP ;
- les canaux WhatsApp et Telegram ;
- `rowboat-server`, l'app mobile, le desktop ;
- Harbor.

**Ce qu'on ajoute**, dans `apps/baarali/` :

| Package | Contenu |
|---|---|
| `@baarali/instance-bridge` | Politique, classifieur, relais d'événements, client du plan de contrôle |
| `@baarali/goals` | Goal, planner, tâches, vérification |
| `@baarali/providers` | Interfaces fournisseurs, `Money`, `CountryConfig` |
| `@baarali/i18n` | Traductions et marque |
| `control` | Le plan de contrôle |
| `payments` | Le service de paiement |
| (package à nommer) | Le navigateur headless |

**Ce qu'on modifie dans l'upstream**, et déclare dans `DIVERGENCES.md` :

- une ligne d'enregistrement dans `apps/x/apps/server/src/standalone.ts` ;
- la configuration initiale des modèles ;
- plus tard, l'extraction i18n si l'upstream la refuse.

**Ce qu'on remplace :** le backend Rowboat Labs (par le plan de contrôle, en gardant les mêmes routes) et PostHog.

**Ce qu'on laisse mourir chez eux :** `runtime/legacy`.

## 8. Décisions

| # | Question | État |
|---|---|---|
| 1 | Connexion | **Décidé 29/09 :** téléphone + code SMS (§3.5). **Décidé 01/10 :** aussi email + code, Google, Apple, GitHub ; pas de mot de passe ; liaison seulement par email vérifié ; Better Auth. Restent l'agrégateur SMS par pays et le service d'email. |
| 2 | Hébergement des instances | **Décidé 29/09 :** mise en veille obligatoire. **Décidé 30/09 :** Fly.io, Paris, repli Northflank (§6). |
| 3 | i18n des chaînes upstream | **Décidé 29/09 :** proposée d'abord à l'upstream (§3.12). |
| 4 | Composio | **Décidé 29/09 :** désactivé en V1, MCP et connecteurs natifs à la place (§3.14). |
| 5 | Argent des clients | **Décidé 29/09 :** Baarali ne détient jamais d'argent (§3.9). Reste la validation juridique. |
| 6 | JEV | **Décidé 29/09 :** accélérateur optionnel de lecture et recherche, adopté sur mesures (§3.10). |
| 7 | Facturation de l'usage | **Décidé 30/09 :** quota en deux fenêtres, 5 h et semaine, au coût réel ; Découverte gratuite, Semaine 5 €, Essentiel 20 €, Pro 100 € ou 200 €, prix fixes en euros et en F CFA ; marge de 55 % garantie à pleine utilisation (§3.5). |
