# Modèle de données de Warell

Ce document dit **quelles entités existent, où elles vivent, et ce qu'elles reprennent de l'existant**. Les zones (instance, plan de contrôle, service de paiement) viennent de [`TARGET_AGENTIC_ARCHITECTURE.md`](./TARGET_AGENTIC_ARCHITECTURE.md). Les transitions d'état sont spécifiées dans `AGENT_RUNTIME_SPEC.md`, les droits d'accès dans `AGENT_SECURITY_MODEL.md`.

C'est un **modèle proposé, pas une migration** (mission §54). Aucune table n'est créée tant que ce document n'est pas validé. Les schémas ci-dessous fixent les noms, les types et les contraintes, pas la syntaxe finale.

---

## 1. Conventions

| Sujet | Règle | Pourquoi |
|---|---|---|
| Identifiants | ULID en texte, **préfixé par le type** : `org_…`, `usr_…`, `gol_…`, `tsk_…`, `apv_…`, `pin_…` (payment intent), `man_…` (mandate), `led_…` (ledger)… | Triables dans le temps, uniques globalement (Harbor fait de même pour ses Spaces), et le préfixe rend les journaux lisibles. |
| Exception | Une **Action** garde l'identifiant de Rowboat : son `toolCallId`. | C'est déjà la clé de corrélation du moteur de tours (turn-runtime-design §23) ; en créer une seconde ferait deux vérités. |
| Horodatage | ISO-8601 UTC en texte dans les journaux JSONL (comme Rowboat) ; `timestamptz` en Postgres. | Harbor stocke du texte, mais le schéma Warell est séparé : on prend le type qui permet les requêtes par période sans conversion. |
| Argent | `Money = { amount_minor: bigint, currency: ISO 4217 }`. Montant **entier** dans l'unité mineure de la devise : XOF a 0 décimale (100 000 FCFA → `100000`), EUR et USD en ont 2 (25,00 € → `2500`). **Jamais de flottant.** | Mission §26. Un paiement se compte en unités indivisibles. |
| Coût interne | `Cost = { amount: numeric(24,12), currency }`, en général USD. | Un appel de modèle coûte des fractions de centime : il faut une décimale exacte, pas un entier. Réservé à l'usage, **jamais** aux paiements. |
| Conversion | Une conversion est un enregistrement séparé (`fx_rates` : paire, taux, source, date). Un montant garde **toujours sa devise d'origine**. | Mission §26 : « conversion séparée ». |
| Langue | BCP 47 (`fr`, `en`, `fr-CI`). | — |
| Pays | ISO 3166-1 alpha-2 (`CI`, `BF`, `BJ`, `SN`, `TG`, `ML`, `NE`). | — |
| Téléphone | E.164 (`+22507…`). | Identifiant principal (connexion par SMS). |
| Tenant | Toute table du plan de contrôle et du service de paiement porte `org_id`, protégé par la **sécurité au niveau des lignes** de Postgres (RLS). | Défense en profondeur : une requête oubliant son filtre ne voit rien (mission §43). |
| Append-only | Les journaux (Goals, audit, ledger) ne connaissent ni UPDATE ni DELETE : les droits de la base les interdisent, et un déclencheur les refuse. Pour l'audit et le ledger, chaque ligne porte l'empreinte de la précédente (`prev_hash`, `hash`). | Une modification après coup devient détectable (mission §76 : « immuable/auditable »). |

## 2. Où vit chaque donnée

Il y a quatre magasins. **Une donnée n'a qu'une source de vérité.** Les autres magasins en tiennent au plus une *projection*, recalculable.

| Magasin | Technologie | Contient | Qui écrit |
|---|---|---|---|
| **Instance** | Fichiers dans le dossier de travail (`ROWBOAT_WORKDIR`), comme Rowboat | Tours, sessions, **Goals et Tasks**, artefacts, Brain (mémoire), skills privés, bg-tasks | L'instance seule |
| **Plan de contrôle** | Postgres, schéma `warell` | Comptes, organisations, instances, approbations, usage, secrets, projections des Goals, audit | Le plan de contrôle seul |
| **Service de paiement** | Postgres, schéma `payments`, **rôle de base distinct** | Moyens de paiement, mandats, intentions, exécutions, ledger, remboursements | Le service de paiement seul |
| **Harbor** | Postgres, schéma par défaut, **inchangé** | Orgs Spaces, membres, Spaces, fichiers partagés, clés d'agent, push | Harbor seul |

Chaque schéma a **sa propre échelle de migrations** et sa propre table de suivi : `warell.schema_migrations`, `payments.schema_migrations`. Celle de Harbor (`public.schema_migrations`) n'est jamais touchée (UPSTREAM.md §2). Les connexions Warell fixent leur `search_path` explicitement, pour qu'une table Warell ne puisse jamais être créée par erreur dans le schéma de Harbor.

## 3. Correspondance avec la mission

La mission (§54 et addendum) liste des entités. Voici ce que chacune devient.

| Entité de la mission | Décision | Où | Reprend |
|---|---|---|---|
| Organization | **NEW**, liée optionnellement à une org Harbor | Plan de contrôle | Principe d'`orgs` Harbor (tenant, `org_id` partout) |
| User | **NEW** | Plan de contrôle | `member_identities` Harbor pour le lien OIDC |
| Membership | **NEW** | Plan de contrôle | Rôle de `members.role` Harbor |
| Agent | **NEW (registre)** ; la définition reste dans l'instance | Les deux | Registre d'agents Rowboat, membres `kind='agent'` Harbor |
| Goal | **NEW** (journal) + projection | Instance → plan de contrôle | Discipline JSONL des tours |
| Task | **NEW** (dans le journal du Goal) | Instance | Motif `core/todo` (élément ↔ session) |
| Action | **KEEP** : les événements `tool_*` des tours ; **NEW** : leur projection | Instance → plan de contrôle | `tool_invocation_requested`, `tool_result`… |
| Approval | **KEEP** pour le risque bas et moyen (permissions des tours) ; **NEW** pour le risque élevé | Plan de contrôle | `tool_permission_*` |
| Artifact | **NEW** (manifeste) ; les octets restent des fichiers | Instance | Dossier de travail, `index.md` des bg-tasks |
| Memory, MemoryEntity | **KEEP** : Brain ; **MODIFY** : portée et rétention | Instance, Spaces pour l'organisation | `core/knowledge` |
| Skill | **KEEP** : skills Rowboat ; **NEW** : registre d'organisation | Instance + plan de contrôle | `runtime/assembly/skills/` |
| Integration, Credential | **NEW** | Plan de contrôle | — (aujourd'hui : trousseau local) |
| ComputerSession | **NEW** : l'instance + ses bacs à sable | Plan de contrôle | — |
| Event | **KEEP** : journaux de l'instance ; **NEW** : relais + audit | Les deux | Bus d'événements, outbox Harbor |
| UsageRecord | **NEW** | Plan de contrôle | `TurnUsage` et `usage-reporter` Rowboat |
| ProviderConfiguration | **NEW** : registre en code + surcharges en base | `@warell/providers` + plan de contrôle | — |
| PaymentSource, PaymentMandate, PaymentIntent, AgentLedger, Refund | **NEW** | Service de paiement | — |
| Budget | **NEW**, en deux parties (§6.3 et §7.7) | Plan de contrôle + service de paiement | `maxModelCalls` Rowboat |

---

## 4. L'instance : les journaux

### 4.1 Ce qui existe et ne bouge pas

| Donnée | Emplacement | Format |
|---|---|---|
| Tour | Un fichier JSONL par tour | Une vingtaine de types d'événements, durables et flux en direct (`turn_created`, `tool_invocation_requested`, `tool_permission_resolved`, `tool_result`, `turn_suspended`, `turn_completed`…), `shared/turns.ts` |
| Session | Un fichier JSONL par session + un index en mémoire | `shared/sessions.ts` |
| Usage d'un appel modèle | Dans l'événement `model_call_completed` | `TurnUsage { inputTokens, outputTokens, reasoningTokens, cachedInputTokens, totalTokens }` |
| Limite | `turn_created.config.maxModelCalls` | Entier de 1 à 500 (`shared/turn-limits.ts`) |

Warell **lit** ces journaux ; il n'y ajoute aucun champ, et n'ajoute aucun type d'événement.

**Décidé :** le lien Task → session est tenu **dans le journal du Goal**, pas par une nouvelle « origine » de session. Ajouter une variante à `InputOrigin` / `SessionOrigin` (`shared/origins.ts`) modifierait une union volontairement fermée de l'upstream. Si l'upstream ajoute un jour l'origine « todo » qu'il annonce, on la réutilisera.

### 4.2 Le journal d'un Goal

Un fichier `warell/goals/<goalId>.jsonl` par objectif, dans le dossier de travail. Même discipline que les tours :

- append-only, un événement JSON validé par ligne ;
- l'état se reconstruit en relisant depuis le début ;
- pas de fichier d'état mutable.

Chaque événement porte `type`, `goalId`, `ts` et `seq` (entier croissant dans le fichier).

| Événement | Champs propres | Effet |
|---|---|---|
| `goal_created` | `title`, `description`, `constraints[]`, `priority`, `budget?: Money`, `locale`, `country?`, `createdBy` (utilisateur, bg-task ou canal), `origin` | État `DRAFT` |
| `goal_planning_started` | `plannerSessionId` | `PLANNING` |
| `plan_proposed` | `planVersion`, `tasks[]` (voir Task ci-dessous), `rationale` | — |
| `plan_accepted` | `planVersion`, `acceptedBy` (`user` ou `policy`) | `RUNNING` |
| `task_added` / `task_updated` | `task` | Replanification en cours de route |
| `task_started` | `taskId`, `sessionId`, `attempt` | — |
| `task_waiting` | `taskId`, `reason` (`user` \| `external`), `turnId`, `toolCallId?`, `approvalId?` | `WAITING_USER` / `WAITING_EXTERNAL` si plus rien d'autre ne peut avancer |
| `task_resumed` | `taskId` | — |
| `task_completed` | `taskId`, `output` (JSON validé par `outputSchema` si déclaré), `artifactIds[]` | — |
| `task_failed` | `taskId`, `error { code, message }`, `retryable` | Retry ou échec du Goal |
| `action_verified` | `toolCallId`, `turnId`, `taskId`, `verdict` (`verified` \| `unverified` \| `contradicted`), `method`, `evidence` (JSON), `verifiedAt` | Exécuté ≠ vérifié (architecture §3.6) |
| `artifact_added` | voir §4.4 | — |
| `limit_reached` | `limit` (`duration` \| `actions` \| `model_cost` \| `external_spend` \| `retries`), `value`, `max` | Suspension ou échec, selon la politique |
| `goal_paused` / `goal_resumed` | `by`, `reason?` | `PAUSED` |
| `goal_completed` | `summary`, `artifactIds[]` | `COMPLETED` |
| `goal_failed` | `error`, `lastTaskId` | `FAILED` |
| `goal_cancelled` | `by`, `reason?` | `CANCELLED` |

### 4.3 La Task

Une Task n'a pas de fichier propre : elle est l'agrégat des événements `task_*` de son Goal.

| Champ | Type | Note |
|---|---|---|
| `id` | `tsk_…` | — |
| `goalId` | `gol_…` | — |
| `parentTaskId` | `tsk_…?` | Sous-tâche (un seul niveau au départ, comme `todo`) |
| `kind` | `agent` \| `human` \| `wait` | `human` = question posée à l'utilisateur ; `wait` = condition externe (prix, date) |
| `agentId` | texte | Agent Rowboat qui exécute (`copilot`, agent de code, agent utilisateur) |
| `instructions` | texte | Dans la langue d'exécution du Goal |
| `dependsOn` | `tsk_…[]` | Graphe **acyclique**, vérifié à l'acceptation du plan |
| `inputSchema` / `outputSchema` | JSON Schema? | Si déclarés, la sortie est validée avant `task_completed` |
| `sessionId` | texte? | Session Rowboat de la tentative en cours |
| `status` | `pending` → `running` ⇄ `waiting_user` / `waiting_external` → `completed` / `failed` / `cancelled` | Transitions exactes dans `AGENT_RUNTIME_SPEC.md` |
| `attempt`, `maxAttempts` | entiers | Borné (mission §38) |
| `limits` | `{ maxDurationMs, maxActions, maxModelCalls, maxModelCost: Cost, maxExternalSpend: Money }` | `maxModelCalls` est transmis au tour Rowboat, qui l'applique déjà ; le reste est appliqué par `@warell/goals` |
| `startedAt`, `completedAt` | horodatages | — |

### 4.4 L'Artifact

Les octets restent des fichiers du dossier de travail (ou d'un Space pour un artefact partagé). Le Goal en tient le **manifeste** :

| Champ | Type |
|---|---|
| `id` | `art_…` |
| `kind` | `DOCUMENT` \| `FILE` \| `CODE` \| `IMAGE` \| `REPORT` \| `RECEIPT` \| `TICKET` \| `RESERVATION` \| `INVOICE` (mission §34) |
| `path` | Chemin relatif au dossier de travail |
| `mime`, `sizeBytes`, `sha256` | Calculés à partir des octets, jamais déclarés par l'agent (même règle que Harbor : « bytes-derived facts ») |
| `title`, `locale` | — |
| `sourceToolCallId` | Action qui l'a produit |

### 4.5 La mémoire

La mission demande cinq sortes de mémoire. Aucune ne demande un nouveau stockage.

| Mémoire (mission §18) | Réalisée par | Portée |
|---|---|---|
| Profil | `knowledge/Agent Notes/user.md` + `config/user.json` (bloc « Owner Of This Memory ») | Personnelle |
| Épisodique | Sessions et tours ; notes datées du Brain | Personnelle |
| Entités (personnes, entreprises, lieux, projets) | Notes du Brain avec frontmatter, curées chaque jour (`note_curation.ts`) | Personnelle |
| Procédurale | Skills privés + fichiers de préférences appris (modèle : `todo/planner-memory.ts`) | Personnelle ; d'organisation via le registre de skills (§6.6) |
| De travail | Contexte de la session en cours | Tâche |
| **D'organisation** | **Les fichiers d'un Space Harbor** : un dossier partagé, versionné, avec historique et droits | Organisation |

**Décidé :** la mémoire d'organisation est un Space, pas une nouvelle base. Harbor fournit déjà les droits, l'historique, la fusion et l'accès MCP pour les agents. Les deux organisations ne peuvent donc pas se mélanger : ce sont deux orgs Harbor distinctes.

**Rétention, export, suppression** (mission §44) : ce sont des opérations sur le dossier de travail (`knowledge/`, sessions, Goals), exposées par l'instance et déclenchées par le plan de contrôle. La suppression d'un compte détruit le volume de l'instance.

---

## 5. Harbor : ce qu'on réutilise tel quel

| Table Harbor | Usage Warell |
|---|---|
| `orgs`, `org_domains` | Org Spaces d'une organisation Warell **d'équipe**. Une organisation personnelle n'en crée pas. |
| `members` (`kind` `person` \| `agent`, `role`, `owner_id`) | Membres des Spaces, humains et agents |
| `member_identities (iss, sub)` | `iss` = émetteur OIDC du plan de contrôle, `sub` = `usr_…` : le lien entre un utilisateur Warell et son membre Harbor |
| `agent_keys` | Clés des agents qui agissent dans les Spaces |
| `push_tokens`, `push_prefs` | Notifications push mobiles |
| Spaces, assets, events | Mémoire et artefacts partagés d'organisation |

Aucune colonne Harbor n'est ajoutée ni modifiée.

## 6. Le plan de contrôle : schéma `warell`

Seuls les champs structurants sont listés. `org_id` est sous-entendu partout où l'entité appartient à une organisation. `created_at` et `updated_at` sont sous-entendus partout.

### 6.1 Identité et organisations

**`users`**

| Champ | Type | Contraintes |
|---|---|---|
| `id` | `usr_…` | PK |
| `phone_e164` | texte? | Unique si présent, **vérifié** par SMS |
| `email` | texte? | Unique si présent, **vérifié** (code email ou fournisseur qui l'atteste) |
| `display_name` | texte | — |
| `preferred_locale` | BCP 47 | Défaut selon le pays |
| `country` | ISO 3166 | — |
| `status` | `active` \| `suspended` \| `deleted` | — |

Un utilisateur a au moins un moyen de connexion : téléphone, email, ou une identité externe (décidé le 01/10/2026).

**`user_identities`** : `user_id`, `provider` (`phone` \| `email` \| `google` \| `apple` \| `github` \| `microsoft`), `subject` (le numéro, l'adresse, ou le `sub` du fournisseur), `email_verified`, `linked_at`. **Unique `(provider, subject)`.** Les tables de Better Auth (`user`, `account`, `session`, `verification`) en sont l'implémentation, dans le schéma `warell` (architecture §3.5).

**`phone_verifications`** : `id`, `phone_e164`, `code_hash` (jamais le code en clair), `attempts`, `max_attempts`, `expires_at`, `ip`, `consumed_at`. Des index par numéro et par IP permettent de plafonner les envois (fraude aux SMS, architecture §3.5). Les codes par email suivent la même forme.

**`organizations`**

| Champ | Type | Note |
|---|---|---|
| `id` | `org_…` | PK |
| `kind` | `personal` \| `team` \| `business` | Une organisation `personal` est créée à l'inscription (mission §29) |
| `name` | texte | — |
| `default_locale`, `country`, `default_currency` | — | — |
| `harbor_org_id` | texte? | Lien vers l'org Spaces, seulement pour `team` / `business` |
| `status` | `active` \| `suspended` | — |

**`memberships`** : `org_id`, `user_id`, `role` (`owner` \| `admin` \| `member`), `joined_at`. Clé primaire (`org_id`, `user_id`).

**`role_capabilities`** : `role`, `capability`. C'est de la donnée de référence, versionnée par migration. Les **capacités** (`email.send`, `payment.prepare`, `payment.execute`, `browser.use`, `memory.write`…, mission §30) sont la vraie unité de droit ; le rôle n'est qu'un paquet de capacités. Les règles d'évaluation sont dans `AGENT_SECURITY_MODEL.md`.

### 6.2 Agents

**`agents`** : le **registre**, pas la définition. La définition (instructions, modèle, outils) reste dans l'instance, là où Rowboat la lit (`runtime/assembly/registry.ts`, agents utilisateur, bg-tasks).

| Champ | Type | Note |
|---|---|---|
| `id` | `agt_…` | Référencé par les mandats, le ledger et l'usage |
| `org_id`, `owner_user_id` | — | — |
| `instance_id` | `ins_…` | Instance qui l'exécute |
| `instance_agent_ref` | texte | Identifiant côté instance (`copilot`, slug de bg-task…) |
| `display_name` | texte | — |
| `mode` | `interactive` \| `background` \| `event_driven` | Mission §10 |
| `capabilities` | texte[] | Plafond : l'agent n'a jamais plus que son propriétaire |
| `status` | `active` \| `paused` \| `revoked` | « Pause agent » (mission §75) agit ici |

Pourquoi un registre : un mandat, une ligne de ledger ou une règle de budget doivent désigner un agent **stable**, même si l'instance est endormie ou si l'agent est renommé.

### 6.3 Instances et sessions de calcul

**`instances`**

| Champ | Type | Note |
|---|---|---|
| `id` | `ins_…` | Une par utilisateur (architecture §1) |
| `user_id`, `org_id` | — | — |
| `status` | `provisioning` \| `running` \| `sleeping` \| `updating` \| `archived` | — |
| `region` | texte | — |
| `volume_ref` | texte | Volume persistant du dossier de travail |
| `image_version` | texte | Version de `rowboat-server` + `@warell/*` déployée |
| `server_key_hash` | texte | Empreinte de la clé porteur (même règle que `agent_keys` Harbor : jamais le secret) |
| `last_active_at`, `sleeping_since` | horodatages | Base de la mise en veille |

**`scheduled_wakes`** : `instance_id`, `due_at`, `reason` (`bg_task` \| `goal_wait` \| `mandate_expiry`…), `ref` (slug de bg-task, `gol_…`). Avant de s'endormir, l'instance publie ses prochaines échéances. Le réveil planifié (architecture §3.5) lit cette table.

**`computer_sessions`** : `id`, `instance_id`, `kind` (`browser` \| `code_sandbox`), `task_id?`, `status`, `started_at`, `expires_at`, `ended_at`. Il n'y a pas de table pour l'instance elle-même en tant qu'ordinateur : elle *est* la ComputerSession principale de l'utilisateur (mission §12).

**`usage_limits`** : `id`, `scope` (`org` \| `user` \| `agent` \| `goal`), `scope_id`, `metric` (`model_cost` \| `compute_seconds` \| `sms`), `period` (`day` \| `week` \| `month` \| `total`), `limit: Cost` ou quantité, `status`. C'est la partie « coût interne » des budgets. La partie « dépense externe » est dans le service de paiement (§7.7).

### 6.4 Approbations

**`approvals`** : la source de vérité des approbations **à risque élevé**. Les décisions de risque bas et moyen restent dans les tours (`tool_permission_resolved`) ; l'audit en garde une copie (§6.8).

| Champ | Type | Note |
|---|---|---|
| `id` | `apv_…` | — |
| `org_id`, `user_id` | — | Qui doit décider |
| `instance_id`, `goal_id?`, `task_id?`, `turn_id`, `tool_call_id` | — | L'action précise (mission §9 : on approuve une action, pas un agent) |
| `kind` | `action` \| `payment` \| `mandate` | Créer un mandat est **lui-même** une approbation |
| `risk` | `medium` \| `high` | — |
| `payload` | jsonb | Ce qui sera exécuté, tel quel |
| `payload_hash` | texte | SHA-256 du JSON canonique. L'exécution doit présenter **la même empreinte**, sinon elle est refusée : on ne peut pas approuver 50 000 FCFA et exécuter 500 000. |
| `summary` | jsonb | `{ key, params }` i18n, pas de texte figé : l'utilisateur la lit dans sa langue, sur n'importe quel canal |
| `amount` | Money? | Pour `payment` |
| `status` | `pending` \| `approved` \| `rejected` \| `expired` \| `cancelled` | — |
| `expires_at` | horodatage | Une approbation n'est pas éternelle |
| `decided_at`, `decided_by` | — | `decided_by` est toujours un `usr_…`, **jamais un agent** |
| `decision_channel` | `app` \| `mobile` \| `whatsapp` \| `sms` \| `web` | — |

### 6.5 Intégrations et secrets

**`credentials`** : le coffre (mission §28).

| Champ | Type | Note |
|---|---|---|
| `id` | `crd_…` | L'agent ne manipule que cet identifiant |
| `owner_scope` | `user` \| `org` | — |
| `kind` | `oauth` \| `api_key` \| `session` \| `provider` | — |
| `provider` | texte | `google`, `github`, fournisseur SMS… |
| `ciphertext` | bytea | Chiffrement enveloppe : une clé de données par secret, elle-même chiffrée par une clé maîtresse hors de la base |
| `key_version` | entier | Rotation de la clé maîtresse |
| `scopes` | texte[] | — |
| `expires_at`, `last_used_at`, `revoked_at` | — | — |

**`credential_leases`** (append-only) : `id`, `credential_id`, `instance_id`, `tool_call_id`, `granted_at`, `expires_at`. Un secret est remis à l'instance pour **un** usage autorisé et pour une courte durée. Chaque remise est tracée.

**`integrations`** : `id`, `owner_scope`, `provider`, `method` (`native` \| `mcp` \| `api`), `credential_id?`, `status`, `config` (jsonb, sans secret). Composio est absent en V1 (architecture §8).

### 6.6 Skills

**`skills`** : le registre des skills **d'organisation** (mission §16). Les skills officiels sont livrés dans le code, les skills privés restent dans l'instance.

| Champ | Type |
|---|---|
| `id`, `org_id` | — |
| `name`, `description` (i18n), `version` | — |
| `input_schema`, `output_schema` | JSON Schema |
| `required_capabilities` | texte[] |
| `risk` | `low` \| `medium` \| `high` |
| `executor` | `mcp` \| `api` \| `browser` \| `code` \| `internal` |
| `body` | Le contenu du skill (format des skills Rowboat) |
| `status` | `draft` \| `published` \| `retired` |

Ils sont synchronisés vers les instances des membres. **Un skill mémorisé n'accorde aucune capacité** : il en *demande* (mission §19).

### 6.7 Projections des Goals

Ce sont des vues lisibles quand l'instance dort, **recalculables** en rejouant le relais d'événements. Elles ne sont jamais la source de vérité.

| Table | Contenu |
|---|---|
| `goal_index` | `goal_id`, `instance_id`, `user_id`, `title`, `status`, `budget`, `locale`, dernières dates |
| `task_index` | `task_id`, `goal_id`, `status`, `agent_ref`, `attempt`, dates |
| `action_index` | `tool_call_id`, `turn_id`, `task_id?`, `goal_id?`, `tool_id`, `capabilities`, `risk`, `status` (`requested` \| `permitted` \| `denied` \| `executed` \| `verified` \| `unverified` \| `failed`), `duration_ms`, `cost` |
| `artifact_index` | Manifestes des artefacts |

Le niveau de risque et les capacités d'une Action viennent du **catalogue d'outils Warell** (architecture §3.3), figé au moment de la demande. On n'ajoute donc aucun champ aux événements Rowboat.

### 6.8 Événements, audit, usage, notifications

**`instance_events`** (relais) : `instance_id`, `seq`, `type`, `payload`, `received_at`, avec la clé primaire (`instance_id`, `seq`). Un événement relayé deux fois n'est enregistré qu'une fois, ce qui rend l'envoi sûr même sur une connexion instable (mission §42). C'est de là que partent les projections, les notifications et l'observabilité.

**`audit_log`** (append-only, chaîné) : `seq`, `org_id`, `actor` (`usr_…` \| `agt_…` \| `system`), `action` (`approval.decided`, `credential.leased`, `mandate.revoked`, `instance.woken`…), `target`, `details`, `at`, `prev_hash`, `hash`.

**`usage_records`**

| Champ | Type | Note |
|---|---|---|
| `id` | `use_…` | — |
| `org_id`, `user_id`, `instance_id` | — | — |
| `goal_id?`, `task_id?`, `turn_id?`, `tool_call_id?` | — | Rattachement le plus fin possible |
| `category` | `llm` \| `tool_api` \| `search` \| `browser_time` \| `compute_time` \| `storage` \| `sms` \| `provider_fee` | Mission §37 |
| `provider`, `model?` | — | — |
| `quantity`, `unit` | — | Jetons, secondes, messages… |
| `tokens` | jsonb? | Reprend `TurnUsage` tel quel |
| `cost` | Cost | Coût réel quand le fournisseur le donne (OpenRouter peut renvoyer le coût de chaque appel), sinon estimé depuis le catalogue, avec un indicateur `estimated` |
| `occurred_at` | — | — |

**`notifications`** : `id`, `user_id`, `channel`, `template` (`{ key, params }` i18n), `related` (`apv_…`, `pin_…`, `gol_…`), `status` (`queued` \| `sent` \| `delivered` \| `failed`), `provider_message_id`.

### 6.9 Pays et fournisseurs

Le **registre** (`CountryConfig`, disponibilités, statut `SUPPORTED` / `RESEARCH_REQUIRED` / `UNAVAILABLE`) est du **code versionné** dans `@warell/providers`. Chaque changement de statut passe par une PR qui cite sa source (mission §57 : « ne pas inventer les intégrations »).

La base ne tient que ce qui varie par déploiement :

- **`provider_configurations`** : `id`, `org_id?` (null = toute la plateforme), `country`, `category` (`payment` \| `sms` \| `travel`…), `provider`, `enabled`, `priority`, `credential_id?` (les clés de fournisseurs financiers vivent dans le service de paiement, §7).
- **`fx_rates`** : `base`, `quote`, `rate` (numeric exact), `source`, `observed_at`.

---

## 7. Le service de paiement : schéma `payments`

**Rappel décidé :** Warell ne détient jamais d'argent (architecture §3.9). Ces tables **décrivent et contrôlent** des paiements exécutés par des tiers : agrégateurs, opérateurs, émetteurs de cartes.

Les droits de base de données découlent de cette séparation :

- **`warell_payments`** possède le schéma et y écrit ;
- le plan de contrôle n'a qu'un droit de lecture sur des **vues sans secret** (pour afficher les dépenses) ;
- l'instance n'a **aucun** accès à la base.

### 7.1 `payment_sources`

| Champ | Type | Note |
|---|---|---|
| `id` | `psr_…` | L'agent ne voit que cet identifiant (mission §70) |
| `org_id`, `user_id` | — | — |
| `type` | `CARD` \| `VIRTUAL_CARD` \| `EPHEMERAL_CARD` \| `MOBILE_MONEY` \| `BANK` \| `CRYPTO_WALLET` \| `EXTERNAL_WALLET` | — |
| `provider` | texte | — |
| `provider_reference` | texte | Jeton **chez le fournisseur**. Warell ne stocke jamais de numéro de carte ni de CVV (conformité carte) |
| `display` | jsonb | Ce qu'on montre : 4 derniers chiffres, numéro masqué, réseau et actif crypto |
| `country`, `currency` | — | — |
| `crypto` | jsonb? | `{ network, asset, wallet_provider, wallet_reference, custody_mode }`. Jamais de clé privée ni de phrase de récupération (mission §79) |
| `supports_preauthorized_debit` | booléen | Voir la note ci-dessous |
| `status` | `active` \| `frozen` \| `revoked` | « Freeze payment source » (mission §75) |

**Note Mobile Money.** Aujourd'hui, un paiement Mobile Money se confirme en général par le **code secret de l'utilisateur, sur son téléphone**. Pour ces sources, un mandat autonome n'est possible que si le fournisseur propose un **débit pré-autorisé**. `supports_preauthorized_debit` le dit explicitement : sans lui, la politique renvoie `REQUIRE_APPROVAL` quel que soit le mandat, et l'approbation *est* la saisie du code. La vérification pays par pays est dans `WEST_AFRICA_PROVIDER_ARCHITECTURE.md`.

### 7.2 `payment_mandates`

Tous les champs de l'addendum (§68), avec leurs contraintes :

| Champ | Type | Note |
|---|---|---|
| `id` | `man_…` | — |
| `org_id`, `user_id` | — | — |
| `agent_id` | `agt_…` | Un mandat vaut pour **un** agent |
| `goal_id` | `gol_…?` | Borné à un objectif si présent |
| `payment_source_id` | `psr_…` | — |
| `currency` | ISO 4217 | Tous les montants du mandat sont dans cette devise |
| `max_amount_per_transaction`, `max_amount_per_day`, `max_amount_per_period`, `total_budget` | bigint (unités mineures)? | Au moins un plafond est **obligatoire** : un mandat sans limite est refusé à la création |
| `period` | `week` \| `month`? | Pour `max_amount_per_period` |
| `allowed_merchants`, `blocked_merchants` | texte[] | Liste bloquée prioritaire |
| `allowed_categories`, `blocked_categories` | texte[] | Catégories normalisées (`flight`, `hotel`, `transport`, `groceries`…) |
| `allowed_countries` | ISO 3166[] | — |
| `valid_from`, `expires_at` | horodatages | `expires_at` **obligatoire** |
| `max_transactions` | entier? | — |
| `requires_receipt`, `requires_verification` | booléens | Vrai par défaut |
| `status` | `draft` \| `active` \| `paused` \| `exhausted` \| `expired` \| `revoked` | — |
| `approval_id` | `apv_…` | L'approbation humaine qui l'a créé. **Un agent ne peut pas créer ni élargir un mandat.** |
| `revoked_at`, `revoked_reason` | — | « Revoke mandate » (mission §75) |
| `policy_version` | texte | Version des règles au moment de la création |

Un mandat ne se modifie pas : pour l'élargir, on le **remplace** (révocation + nouveau mandat, avec une nouvelle approbation). Le ledger garde ainsi une référence exacte des règles en vigueur au moment de chaque dépense.

### 7.3 `payment_intents`

| Champ | Type | Note |
|---|---|---|
| `id` | `pin_…` | — |
| `org_id`, `user_id`, `agent_id` | — | — |
| `instance_id`, `goal_id?`, `task_id?`, `turn_id`, `tool_call_id` | — | D'où vient la demande |
| `idempotency_key` | texte, **unique** | `instance_id:tool_call_id`. Une même demande relayée deux fois ne crée jamais deux intentions (mission §84) |
| `amount` | Money | Devise d'origine conservée |
| `merchant` | jsonb | `{ name, id?, url?, country, category }` |
| `purpose` | texte | — |
| `preferred_source_id` | `psr_…?` | — |
| `decision` | jsonb | `{ result: EXECUTE \| REQUIRE_APPROVAL \| BLOCK, reasons[], mandate_id?, policy_version, evaluated_at }`. Le résultat du moteur de politique, figé |
| `approval_id` | `apv_…?` | Si `REQUIRE_APPROVAL` |
| `status` | `PENDING` \| `REQUIRES_APPROVAL` \| `BLOCKED` \| `AUTHORIZED` \| `PROCESSING` \| `COMPLETED` \| `FAILED` \| `CANCELLED` \| `REFUNDED` \| `DISPUTED` | Mission §85, plus les états de décision |

### 7.4 `payment_attempts`

Il peut y avoir plusieurs tentatives par intention, mais **une nouvelle tentative n'est permise qu'après confirmation, auprès du fournisseur, que la précédente a échoué** (mission §84 : vérifier le statut, jamais relancer à l'aveugle).

Champs : `id`, `intent_id`, `payment_source_id`, `provider`, `route`, `provider_request_id`, `provider_transaction_id`, `status`, `error`, `started_at`, `finished_at`, `status_checked_at`.

### 7.5 `provider_webhooks`

`id`, `provider`, `provider_event_id` (**unique** par fournisseur), `received_at`, `signature_valid`, `payload`, `processed_at`. Un webhook rejoué ne s'applique qu'une fois.

### 7.6 `ledger_entries` : l'AgentLedger

Append-only et chaîné (§1). C'est la réponse à « où est passé mon argent ? » (mission §74 et §76).

| Champ | Type |
|---|---|
| `id` | `led_…` |
| `org_id`, `seq` | Séquence par organisation |
| `kind` | `charge` \| `refund` \| `reversal` \| `fee` |
| `amount` | Money, **signé** (un remboursement est négatif) |
| `intent_id`, `attempt_id` | — |
| `payment_source_id`, `mandate_id?`, `approval_id?` | Comment la dépense a été autorisée |
| `agent_id`, `goal_id?`, `task_id?` | Qui l'a faite, pour quoi |
| `merchant` | jsonb |
| `provider_transaction_id` | — |
| `receipt_artifact_id?` | Reçu (mission §68 `requires_receipt`) |
| `verification` | jsonb : preuve (numéro de réservation, confirmation) |
| `recorded_at`, `prev_hash`, `hash` | — |

Les écrans « AGENT SPENDING » (aujourd'hui, ce mois, par agent) sont des **agrégats du ledger**, jamais des compteurs tenus à part.

### 7.7 `spend_budgets`

`id`, `org_id`, `scope` (`org` \| `user` \| `agent` \| `goal`), `scope_id`, `period` (`day` \| `week` \| `month` \| `total`), `limit: Money`, `status`. Ce sont les budgets de dépense externe de la mission §77 (« Travel Agent : 500 000 XOF / mois »).

**Décidé :** le contrôle se fait **dans la même transaction que l'autorisation du paiement**. On verrouille les budgets concernés, on somme le ledger de la période, puis on décide. Deux paiements simultanés ne peuvent pas dépasser ensemble un budget qu'aucun des deux ne dépasse seul.

### 7.8 `refunds`

`id`, `intent_id`, `amount: Money`, `reason`, `requested_by` (`usr_…` \| `agt_…` sous mandat qui l'autorise), `status`, `provider_refund_id`, `created_at`. Un remboursement est **demandé** au marchand ou au fournisseur, jamais versé par Warell (mission §86).

**Hors de ce modèle :** l'abonnement de l'utilisateur à Warell. Warell y est le marchand : c'est un flux distinct, qui ne passe pas par ces tables.

---

## 8. Risques de régression

| Risque | Parade |
|---|---|
| Collision avec les migrations Harbor | Schémas séparés, échelles séparées, `search_path` explicite (§2) |
| L'upstream change le format des journaux de tours | Warell les lit par les types de `@x/shared` (même build). Un test de contrat dans `@warell/goals` casse à la synchro. |
| L'upstream change l'API des sessions | Même parade |
| Double source de vérité Goal (instance / projection) | Les projections sont recalculables et en lecture seule ; aucune décision n'est prise sur une projection |
| Double paiement | `idempotency_key` unique, nouvelle tentative seulement après statut confirmé, webhooks dédupliqués (§7.3–7.5) |
| Dépassement de budget concurrent | Verrou + somme du ledger dans la transaction d'autorisation (§7.7) |
| Fuite entre organisations | `org_id` partout + RLS ; mémoire d'organisation = Space distinct ; une instance par utilisateur |

## 9. Ce qui reste ouvert

Rien ne bloque ce modèle. Deux points seront précisés par les documents suivants :

- les **transitions d'état exactes** de Goal, Task, Action, Approval et PaymentIntent, et ce qui se passe à chaque panne → `AGENT_RUNTIME_SPEC.md` ;
- **qui peut lire et écrire chaque table**, rôle par rôle, et la gestion des clés de chiffrement → `AGENT_SECURITY_MODEL.md`.
