# Audit de l'architecture Rowboat

Photographie du dépôt au commit upstream **`09f817b9`** (29/09/2026, PR #1139 `org-roster`), faite avant tout changement Baarali. Ce document dit **ce qui existe**. Ce que Baarali en fera est l'objet de `TARGET_AGENTIC_ARCHITECTURE.md`, et la façon de rester à jour avec l'upstream est dans [`UPSTREAM.md`](./UPSTREAM.md).

Les chemins sont relatifs à la racine du dépôt. `core/` abrège `apps/x/packages/core/src/`, et `shared/` abrège `apps/x/packages/shared/src/`.

---

## 1. Vue d'ensemble

Rowboat est un **assistant personnel local-first** : chaque personne fait tourner son propre Rowboat, avec sa mémoire, ses connexions et ses clés de modèles. Le travail d'équipe passe par des **Spaces** hébergés sur un petit serveur, **Harbor**, qui ne transporte que ce qu'un membre choisit de publier. Le principe est écrit dans `apps/harbor/SPEC.md` : « every act of intelligence happens on a member's own machine ».

- **Licence :** Apache-2.0.
- **Taille :** ≈ 0,3 million de lignes, 956 fichiers `.ts` et 361 `.tsx`, un seul langage (TypeScript).
- **Tests :** 211 fichiers `*.test.ts` (Vitest).
- **Activité :** 271 commits upstream sur les 30 derniers jours.

```
                 ┌──────────────── apps/x (workspace pnpm) ────────────────┐
  Desktop        │ apps/main (Electron) ─ apps/preload ─ apps/renderer (React)│
  Mobile         │ apps/mobile (Expo)                                        │
                 │        │  HTTP + WebSocket (clé serveur / appairage)      │
  Serveur perso  │ apps/server (rowboat-server, headless possible)          │
                 │        │                                                  │
  Cœur           │ packages/core ── packages/shared (schémas zod) ── client │
                 └────────┼─────────────────────────────────────────────────┘
                          │ MCP + HTTP/WS (en tant que membre)
                 ┌────────▼──────── apps/harbor (workspace pnpm) ───────────┐
  Serveur d'org  │ packages/server (Postgres/PGlite, S3/disque, OIDC)        │
                 │ packages/protocol (@rowboat/spaces-protocol, zod)         │
                 └──────────────────────────────────────────────────────────┘
                          │
  Services fermés   api.x.rowboatlabs.com (compte, crédits, passerelle LLM,
  de Rowboat Labs   recherche, Composio, voix) · PostHog (télémétrie)
```

## 2. Composants

| Chemin | Rôle | Taille indicative |
|---|---|---|
| `apps/x/apps/main` | Processus Electron : fenêtres, navigateur intégré (`src/browser/`), capture réunion, quick-ask, push-to-talk, pointeur d'écran, tray, mises à jour. `src/ipc.ts` fait 135 Ko. | — |
| `apps/x/apps/renderer` | UI React. `src/App.tsx` = **8 288 lignes**, et l'UI n'a **aucune i18n** (chaînes anglaises en dur). | — |
| `apps/x/apps/server` | `rowboat-server` : transport HTTP/WS vers le cœur. Il comprend `standalone.ts` (sans Electron), `channels.ts` (≈ 296 canaux migrés), `core-deps.ts`, `auth.ts` (clé porteur unique), `lock.ts` (un serveur par dossier de travail) et `file-cipher.ts`. | — |
| `apps/x/apps/mobile` | App Expo **fonctionnelle**, 51 fichiers : chat, notes, Spaces, appairage, notifications push, choix du modèle, suivi des tours en direct. ⚠️ Son `README.md` est celui du gabarit Expo, ce qui induit en erreur : l'app n'est pas vide. | 51 fichiers |
| `core/runtime` | Moteur d'agent : `turns/`, `sessions/`, `assembly/` (agents, skills, instructions), `tools/` (catalogue + 25 domaines), `legacy/`. | 150 fichiers |
| `core/knowledge` | « Brain » : synchro Gmail/Outlook/agendas/Granola/Fireflies, graphe de notes, curation. | 77 fichiers |
| `core/code-mode` | Pilotage de Claude Code / Codex via ACP, projets, sessions, git. | 31 fichiers |
| `core/spaces` | Côté client des Spaces (orgs, OAuth, MCP vers Harbor). | 29 fichiers |
| `core/models` | Catalogue et fournisseurs de modèles (OpenAI, Anthropic, Google, OpenRouter, Ollama, compatibles OpenAI, passerelle Rowboat). | 29 fichiers |
| `core/background-tasks`, `core/agent-schedule`, `core/todo` | Agents d'arrière-plan, planification, liste de tâches déléguées + planificateur du matin. | 7 + 3 + 9 |
| `core/mcp`, `core/composio` | Client MCP ; intégrations Composio. | 2 + 5 |
| `core/auth` | OAuth (boucle locale), ChatGPT, Google via backend, jetons. | 18 |
| `core/security` | Classifieur d'auto-permission. | 1 |
| `core/billing`, `core/account`, `core/analytics` | Compte et crédits Rowboat Labs ; PostHog. | 3 + 1 + 6 |
| `core/apps` | Mini-apps : registre, installateur, publication, API hôte. | 11 |
| `core/voice`, `core/meetings`, `core/channels` | Dictée/TTS ; réunions ; **WhatsApp + Telegram** (`channels/transports/`). | 3 + 1 + 6 |
| `apps/harbor/packages/server` | Serveur Spaces multi-org : `core/`, `policy.ts`, `pg-store.ts`, `migrations.ts`, `http.ts`, `ws.ts`, `mcp.ts`, `auth-oidc.ts`, `push.ts`. | — |
| `apps/harbor/packages/protocol` | Contrat partagé (zod) : objets, routes, événements, outils MCP. | — |

## 3. Flux de données

**Une demande dans le chat.** Le renderer passe par l'IPC, puis `apps/server` (canal forwardé), puis `sessions.sendMessage`, qui crée un tour (turn) dans `TurnRuntime`. Ensuite, en boucle :

1. le modèle est appelé via l'AI SDK v7 ;
2. il propose des appels d'outils ;
3. `IPermissionChecker` décide, avec au besoin le classifieur, et peut suspendre le tour pour attendre une réponse humaine ;
4. l'outil s'exécute.

Chaque fait est écrit dans un JSONL, et le flux temps réel remonte au renderer ou au mobile par WebSocket.

**Synchro de connaissances.** Les planificateurs de `core/knowledge` récupèrent emails, agendas et transcriptions en markdown sous le dossier de travail. `build_graph.ts` lance un agent qui extrait les entités en notes liées. Une curation quotidienne (`note_curation.ts`) consolide et fait oublier ce qui est périmé.

**Arrière-plan.** Un déclencheur (cron, fenêtre horaire, ponctuel ou événement) passe par `background-tasks/scheduler.ts`, puis `runner.ts` démarre un agent headless (`runtime/assembly/headless-app.ts`). Le résultat réécrit `index.md` (mode OUTPUT) ou produit un effet de bord journalisé (mode ACTION).

**Spaces.** `@rowboat` dans un Space réveille le Rowboat *du membre*, sur sa machine. Il travaille avec son contexte, puis publie le résultat dans Harbor au nom du membre (« You (via Rowboat) »).

## 4. Moteur d'agent (Turn Runtime)

Spécifié dans `apps/x/packages/core/docs/turn-runtime-design.md` (statut : « implemented and live »), code dans `core/runtime/turns/`. **C'est la pièce la plus précieuse du dépôt pour Baarali.**

- **Un journal JSONL append-only par tour, qui fait foi** (§4.1). L'état est reconstruit par relecture, sans fichier d'état mutable.
- **Barrières durables avant tout effet de bord** (§4.4) : `tool_invocation_requested` est écrit *avant* d'exécuter l'outil.
- **Permissions par appel d'outil** (§9) :
  - `IPermissionChecker` est injecté et **ferme par défaut** : un outil sans déclaration `"none"` exige une permission ;
  - un `IPermissionClassifier` optionnel répond `allow`, `deny` ou `defer` ;
  - la matrice `autoPermission` × `humanAvailable` fixe le comportement ;
  - chaque décision est tracée (`tool_permission_required` / `classified` / `resolved`, avec sa `source`).
- **Suspension et reprise** (§11) : attente d'une décision humaine, d'une réponse `ask-human` ou d'un résultat d'outil asynchrone.
- **Reprise après crash sans ré-exécution** (§23) : un outil synchrone interrompu reçoit un résultat « indéterminé », jamais une seconde exécution. Les outils asynchrones utilisent `toolCallId` comme clé de corrélation.
- **Annulation** (§22) et **limite d'appels modèle** `maxModelCalls` (§20), qui produit une issue distincte (`model-call-limit`).
- **Usage** tracé par appel (§8.2, `turns/usage-reporter.ts`).
- **Sessions** (`core/docs/session-design.md`) : une session est une suite ordonnée de tours, avec un seul tour actif, une file de messages et le « steering » (guidage en cours de route). Les réponses externes sont routées vers le bon tour.
- **Ce qui manque :** pas de notion d'objectif au-dessus d'une session, pas de plafond de coût ni de durée, pas de ré-essai automatique des appels modèle (non-objectif assumé §2), et pas d'idempotence des entrées externes.

`core/runtime/legacy/` n'existe plus que pour l'API hôte des mini-apps. Il doit disparaître dès leur migration.

## 5. Brain / mémoire

- **Stockage :** des fichiers markdown « à la Obsidian » (notes liées, frontmatter) sous le dossier de travail, versionnés par git (`knowledge/version_history.ts`).
- **Alimentation :** Gmail, Outlook, agendas Google/Outlook, Granola, Fireflies, extension Chrome, conversations.
- **Agents :** `note_creation` (extraction d'entités : personnes, entreprises, projets), `note_tagging_agent`, `note_curation` (le « jardinier » quotidien : résume au mois, promeut les faits récurrents, retire le périmé), `agent_notes` (ce que l'assistant apprend de l'utilisateur).
- **Détection des changements :** mtime + hash (`graph_state.ts`).
- **Mémoire procédurale embryonnaire :** les préférences et retours du planificateur (`todo/planner-memory.ts`) et le retour sur l'importance des emails (`email_importance_feedback.ts`).
- **Ce qui manque :** pas de recherche vectorielle, pas de portée par organisation, pas de rétention ni d'export configurables. La mémoire est celle d'**un** propriétaire (`buildOwnerBlock()`).

## 6. Navigateur

- Un **navigateur Electron intégré**, isolé du navigateur personnel de l'utilisateur, qui s'y connecte lui-même aux seuls comptes qu'il veut confier (`apps/main/src/browser/` : `view.ts`, `page-scripts.ts`, `control-service.ts`).
- L'outil `browser-control` (`core/runtime/tools/domains/browser.ts`) lit la page, liste les **éléments interactifs indexés** et navigue, clique, tape ou presse des touches. C'est une approche **DOM structurée, pas de la vision pure**.
- `browser-skill` charge des recettes par site depuis la bibliothèque *browser-use / browser-harness*, mises en cache.
- **Limite pour Baarali :** tout vit dans le processus Electron. Un serveur headless **n'a pas de navigateur**, donc il faudra une implémentation Chromium headless derrière la même interface d'outil.

## 7. MCP

- **Client** (`core/mcp/mcp.ts`) : transports stdio, SSE et HTTP streamable, configuration `mcp.json` fusionnée avec les serveurs dérivés des orgs Spaces. Les appels `mcp:*` exigent une permission.
- **Serveur :** Harbor expose ses opérations en MCP (`apps/harbor/packages/server/src/mcp.ts`), avec parité obligatoire avec l'API HTTP, vérifiée par `mcp-parity.test.ts`.
- **Composio** (`core/composio/`) : des centaines d'apps, via le backend Rowboat Labs (`/v1/composio`).

## 8. Agents d'arrière-plan

- Un bg-task est un dossier `bg-tasks/<slug>/` avec trois éléments : `task.yaml`, `index.md` (l'artefact visible) et `runs/*.jsonl` (`shared/background-task.ts`).
- **Déclencheurs :** cron, fenêtre horaire (une fois à un moment aléatoire dans la plage), ponctuel, événements (nouvel email…).
- **Deux modes, choisis par l'agent selon les verbes des instructions :** OUTPUT (réécrire `index.md`) ou ACTION (effet de bord + journal). Une tâche peut aussi être une **tâche de code**, épinglée à un dépôt : chaque lancement tourne dans son propre worktree.
- **Garde-fous :** backoff sur `lastAttemptAt`, dernière exécution réussie conservée, pause possible.
- **Planificateur du matin** (`core/todo/planner-task.ts`) : un bg-task pré-installé qui *propose* au plus trois tâches. Il n'agit jamais sans l'accord de l'utilisateur, et il couvre déjà le **scénario F** de la mission.
- **Todo** (`core/todo/`) : chaque élément délégué *est* une session. Le résultat revient sous forme de « reçu » dans `todo.md`. **C'est la forme la plus proche du couple Goal → Task de la mission.**

## 9. Code Mode

- `core/code-mode/` pilote de **vrais agents de code en CLI** (Claude Code, Codex) via le protocole **ACP** : `acp/manager.ts`, `engine-provisioner.ts`, `permission-broker.ts`, `claude-exec.ts`.
- Il gère les projets (dépôts enregistrés), les sessions de code (« une session de code EST une session de chat » depuis l'unification d'août 2026), le git, la revue des changements et un terminal PTY.
- **Couvre le scénario E**, à condition d'avoir la machine et les identifiants de l'utilisateur. En cloud, il faudra un bac à sable par utilisateur.

## 10. Harbor, Spaces, organisations et membres

Spécifié dans `apps/harbor/SPEC.md`, `CONTRACT.md` et `AGENTS.md`. **C'est la seule partie multi-tenant du dépôt.**

- **Organisation = tenant.** Un déploiement sert une ou plusieurs orgs (`deployment.ts`, `directory.ts`, `apex.ts`). Toutes les tables indexées par membre portent `org_id`.
- **Membres humains et membres agents**, avec propriétaires et clés d'agent révocables (`core/agents.ts`, `agent-keys.ts`). « Le Rowboat de Sarah » agit *en tant que* Sarah (attribution universelle).
- **Règles d'accès pures et testées** dans `policy.ts` (`policy.test.ts`).
- **Journal append-only par Space** : écritures sous verrou transactionnel, *outbox* publiée après commit.
- **Trois portes, un seul cœur :** HTTP, WebSocket, MCP.
- **Stockage :** Postgres (production) ou PGlite (tests et dev, même SQL). Blobs sur disque ou S3.
- **Notifications push** via Expo (`push.ts`).
- Harbor ne fait tourner **aucun agent**.

## 11. Authentification

| Où | Mécanisme |
|---|---|
| Client ↔ `rowboat-server` | **Une clé porteur unique** (`~/.rowboat/server-key`, mode 0600), présentée par tous les clients (desktop, téléphones appairés). La rotation révoque tout le monde. **Un seul utilisateur par serveur.** |
| Compte Rowboat | Supabase, via le backend Rowboat Labs (`RowboatApiConfig.supabaseUrl`, `/v1/me`). |
| Connecteurs (Google, Slack, Composio, ChatGPT…) | OAuth avec **retour sur un serveur loopback local** (`core/auth/loopback-server.ts`, `oauth-flows.ts`). Google peut aussi passer par le backend (`google-backend-oauth.ts`). |
| Harbor | Pilotes d'auth par org, dont **OIDC** (`auth-oidc.ts`), écran de consentement, métadonnées RFC 9728, clés d'agent hachées. |
| Secrets | Trousseau de l'OS (`safeStorage` d'Electron) sur desktop. En headless, `apps/server/src/file-cipher.ts` ; le plan de séparation note qu'il manque une implémentation hors trousseau. |

### Dépendances aux services de Rowboat Labs

`API_URL` vaut `https://api.x.rowboatlabs.com` par défaut (`core/config/env.ts`). Points d'appel relevés :

| Route | Fonction |
|---|---|
| `/v1/config` | Config distante : URLs, catalogue d'offres, modèles recommandés |
| `/v1/me` | Compte |
| `/v1/llm`, `/v1/llm/models` | Passerelle LLM facturée en crédits |
| `/v1/search/exa` | Recherche web (sinon, clé Exa personnelle dans `config/exa-search.json`) |
| `/v1/composio` | Intégrations Composio |
| `/v1/voice/text-to-speech/` | Synthèse vocale |
| `/v1/google-oauth/claim-picked` | OAuth Google par le backend |
| `/v1/billing/credit-activations`, `/v1/referral` | Crédits et parrainage |

S'y ajoute la **télémétrie PostHog** (`us.i.posthog.com`, `core/analytics/`). Tout cela est **hors du dépôt** : Baarali doit le remplacer ou le désactiver.

## 12. Stockage

- **Côté `apps/x` :** tout est en fichiers sous le dossier de travail (`~/.rowboat` par défaut, configurable par `ROWBOAT_WORKDIR`, cf. `core/config/config.ts`) : JSONL des tours et sessions, markdown des notes, YAML des tâches, JSON de config.
- **Ampleur :** 145 fichiers référencent le dossier de travail, 166 font des entrées-sorties disque directes.
- **Des interfaces existent déjà :** 19 interfaces `I*Repo`, avec pour certaines une implémentation fichier (`fs-repo.ts`) *et* une en mémoire (`in-memory-*-repo.ts`). Ce sont les coutures par lesquelles on pourra brancher un autre stockage.
- **Côté Harbor :** Postgres + blobs disque ou S3.

## 13. Base de données

- `apps/x` n'a **pas de base de données**.
- Harbor a Postgres, avec une échelle de migrations append-only (`migrations.ts`, 38 Ko). Ses tables décrivent les orgs, membres, Spaces, journal, assets et versions, fil de discussion, états de lecture, clés d'agent et inscriptions push.
- **Aucune des entités de la mission n'existe en base :** ni Goal, ni Action, ni Approval, ni Mandate, ni Ledger, ni UsageRecord.

## 14. Temps réel

- **`rowboat-server` :** hub WebSocket (`apps/server/src/ws-hub.ts`), sur lequel circulent les événements de tour en direct et les événements de service. Un bus d'événements interne (`core/events/` : producer, consumer, processor, routing) déclenche les agents sur des événements.
- **Harbor :** `ws.ts` et `hub.ts` (diffusion en mémoire), relais filtrés par appartenance, rejeu depuis un offset.
- **Mobile :** `apps/mobile/src/lib/use-live-turn.ts` suit un tour en direct.

## 15. Tests et CI

- `.github/workflows/x-tests.yml` : construit Harbor, lint `apps/x` (sauf le renderer, qui a une dette de lint), puis lance Vitest sur `shared`, `core`, `server` et `renderer`.
- `.github/workflows/electron-build.yml` : ne se déclenche **qu'à la publication d'une release**, et exige les secrets Apple et PostHog. Il est inerte sur le fork tant qu'on ne publie pas de release.
- Harbor a un fichier de test par fonctionnalité, sur Postgres en mémoire.

---

## 16. Ce que la mission demande face à ce qui existe

| Primitive de la mission | Existe dans Rowboat ? | Où |
|---|---|---|
| Main Agent unique | ✅ | Agent `copilot` (`core/runtime/assembly/copilot`) |
| Goal | ❌ | L'élément de `todo` + sa session en est l'ébauche |
| Task (dépendances, attente, reprise) | ⚠️ | Sessions/tours (suspension, reprise) ; pas de graphe de dépendances |
| Action tracée | ✅ | Événements `tool_invocation_*` du journal de tour |
| Approval par action précise | ✅ | Permissions par `toolCallId` (§4) ; pas encore de niveaux de risque ni de montants |
| Limites (durée, actions, coût) | ⚠️ | `maxModelCalls` seulement |
| Vérification (exécuté ≠ vérifié) | ❌ | — |
| Artifact | ⚠️ | `index.md` des bg-tasks, reçus todo, fichiers ; pas d'entité |
| Mémoire scopée (perso / org / tâche) | ⚠️ | Mémoire perso seulement |
| Background (cron, événement, webhook) | ✅ | `background-tasks`, `agent-schedule`, `core/events` |
| Coding Agent | ✅ | `code-mode` (ACP) |
| Navigateur structuré | ✅ desktop / ❌ serveur | §6 |
| MCP | ✅ | §7 |
| Email / Agenda | ✅ | `core/knowledge` |
| Multi-tenant | ⚠️ | Harbor seulement ; le cœur est mono-utilisateur |
| Permissions par capacité | ⚠️ | Par outil (`permission` déclarée) ; pas de rôles |
| Credential Vault | ⚠️ | Trousseau / `file-cipher` ; les secrets ne passent jamais dans un outil Harbor |
| Événements / temps réel | ✅ | §14 |
| File de jobs (retry, backoff, priorité) | ⚠️ | Backoff des bg-tasks ; pas de file générique |
| Usage / coûts | ⚠️ | Usage par appel modèle ; crédits côté backend fermé |
| FR/EN | ❌ | Aucune i18n |
| Pays / providers / Money | ❌ | — |
| Paiements, mandats, ledger | ❌ | — |
| WhatsApp / Telegram | ✅ | `core/channels/transports/` |
| Mobile | ✅ | `apps/mobile` (appairé à un serveur perso) |
| Voix | ⚠️ | Dictée, push-to-talk, TTS via backend |

## 17. Matrice de décision

La décision **provisoire** porte sur chaque composant. Elle sera justifiée et détaillée dans `TARGET_AGENTIC_ARCHITECTURE.md`.

| Composant | Décision | Raison |
|---|---|---|
| Turn Runtime + Sessions (`core/runtime/turns`, `sessions`) | **KEEP** | Déjà la boucle agir → suspendre → reprendre de la mission, avec journal durable et reprise sans ré-exécution. On l'enveloppe, on ne le réécrit pas. |
| Permissions (`IPermissionChecker` / `Classifier`) | **MODIFY** (par injection) | Ajouter niveaux de risque, montants et mandats *derrière* les interfaces existantes. Le classifieur LLM ne doit jamais trancher une dépense. |
| Catalogue d'outils, skills | **KEEP** | Coutures d'extension naturelles pour Baarali. |
| `code-mode` (ACP) | **KEEP** | Scénario E. Bac à sable cloud à ajouter. |
| `knowledge` (Brain) | **KEEP** puis **MODIFY** | Excellent en mono-utilisateur ; portée organisation et rétention à ajouter. |
| `background-tasks`, `agent-schedule`, `events` | **KEEP** | Scénarios F et G. Budget et conditions d'arrêt à ajouter. |
| `todo` + planificateur | **MODIFY** | Point de départ naturel de Goal / Task. |
| Navigateur Electron | **KEEP** (desktop) | Plus un **NEW** : navigateur headless côté serveur, même interface d'outil. |
| Client MCP, Composio | **KEEP** / **REPLACE** | MCP tel quel ; Composio à rebrancher sans le backend Rowboat. |
| `rowboat-server` | **MODIFY** | Devient l'« instance Baarali » d'un utilisateur ; auth par jeton émis par le plan de contrôle au lieu de la clé unique. |
| `apps/mobile` | **KEEP** puis **MODIFY** | Base réelle pour approbations et notifications mobiles. |
| Harbor | **KEEP** comme socle du **plan de contrôle** | Seule brique multi-tenant (orgs, membres, agents, politique, temps réel, push). Les entités Baarali s'y ajoutent dans leur propre échelle de migrations. |
| `models` | **MODIFY** | OpenRouter est déjà supporté ; en faire le fournisseur par défaut et retirer la passerelle Rowboat. |
| Backend Rowboat Labs (`API_URL`), `billing`, `account`, crédits | **REPLACE** | Service fermé, hors dépôt. Remplacé par le plan de contrôle Baarali. |
| PostHog (`analytics`) | **REPLACE** / désactiver | Aucune donnée vers Rowboat Labs. |
| `runtime/legacy` | **REMOVE** (à terme) | Déjà condamné par l'upstream. Le laisser mourir chez eux. |
| i18n FR/EN | **NEW** | Aucune base. Chantier le plus conflictuel (`App.tsx`) : voir §18. |
| Goal, Verification, Artifact, Money, Country/Provider, PaymentIntent / Mandate / Ledger, UsageRecord, Credential Vault serveur | **NEW** | Absents. |

Aucune proposition **REMOVE** ne vise une capacité fonctionnelle. Ce qui ne sert pas Baarali au lancement (tableau blanc, notes de réunion, mini-apps) reste en place, ne coûte rien et continue de recevoir les mises à jour upstream.

## 18. Risques relevés

1. **Conflits upstream.** `App.tsx` (57 commits/mois) et `shared/ipc.ts` (54) sont des aimants à conflits. L'i18n FR/EN *doit* y toucher. Options à trancher en architecture cible :
   - extraire progressivement, composant par composant ;
   - proposer l'i18n à l'upstream, ce qui supprimerait la divergence ; leurs README sont déjà traduits en 6 langues.
2. **Hypothèse « une machine = une personne »** : verrou de dossier (`apps/server/src/lock.ts`), clé serveur unique, OAuth sur `localhost`. La voie la moins coûteuse vers le cloud est **une instance isolée par utilisateur**, avec `ROWBOAT_WORKDIR` propre. Un serveur partagé imposerait de réécrire la majorité des 166 fichiers qui font des entrées-sorties disque.
3. **Coût d'infrastructure par utilisateur.** Une instance par utilisateur n'est viable qu'avec une mise en veille quand elle ne sert pas. C'est à chiffrer avant d'y engager le produit.
4. **Dépendance cachée au backend Rowboat Labs.** Sans compte Rowboat, plusieurs fonctions se dégradent (recherche, voix, Composio, crédits). À recenser fonction par fonction avant le premier lancement.
5. **Le classifieur d'auto-permission est un LLM.** Acceptable pour « lire un fichier », inacceptable pour « payer ». La mission l'exige : les limites financières sont du code déterministe (mission §77 et §91).
6. **Le README mobile trompe.** L'app mobile n'est pas vide (cf. §2).

## 19. Annexe : emprunts à Hermes Agent et OpenClaw

Nous comparons les trois bases le 29/09/2026 :

| | Rowboat | Hermes Agent | OpenClaw |
|---|---|---|---|
| Taille | ≈ 0,3 M lignes | ≈ 3,1 M | ≈ 12 M |
| Langages | TypeScript | Python + TypeScript | TypeScript + Swift + Kotlin |
| Licence | Apache-2.0 | MIT | MIT |

Rowboat est retenu comme base. On emprunte aux deux autres des **idées**, pas du code :

- **Hermes Agent :**
  - boucle d'apprentissage (skills créés à partir de l'expérience, améliorés à l'usage), qui alimente la mémoire procédurale (mission §19) ;
  - recherche plein texte dans les anciennes sessions ;
  - environnements qui s'hibernent quand ils ne servent pas (Modal, Daytona), ce qui rend viable l'instance par utilisateur (risque 3).
- **OpenClaw :** le principe « passerelle de confiance, exécution non fiable, politique déterministe », qui fonde le Payment Policy Engine. Et, comme référence, ses apps natives iOS et Android.
