# apps/baarali

Le code propre à Baarali : les packages `@baarali/*`. C'est un espace de travail pnpm à part, comme `apps/harbor`, pour ne jamais toucher les fichiers de l'upstream (`docs/baarali/UPSTREAM.md` §2). La conception est dans `docs/baarali/` ; ce guide ne dit que comment travailler ici.

| Package | Rôle | Conception |
|---|---|---|
| `packages/control` | Le plan de contrôle : remplace le backend Rowboat Labs en servant les mêmes routes `/v1/*` | `TARGET_AGENTIC_ARCHITECTURE.md` §3.5 |
| `packages/instance` | Le lanceur d'une instance : prépare le dossier de travail, démarre `rowboat-server` sur la boucle locale, ouvre le portier ; le serveur MCP `baarali-media` (vidéo, voix, musique) | `TARGET_AGENTIC_ARCHITECTURE.md` §3.1 et §3.5 |
| `packages/spaces` | Les espaces d'équipe, hébergés chez nous (décidé le 02/10/2026) : l'image de Harbor (`apps/harbor`, intact), ses pages dans la langue du visiteur (`src/pages.ts`) | « Les espaces » ci-dessous |
| `packages/desktop` | L'app de bureau Baarali : la marque appliquée au build (`scripts/brand.mjs`), l'icône, et le lien qui branche l'app sur l'instance du compte après la connexion (`src/cloud-link.ts`) | `TARGET_AGENTIC_ARCHITECTURE.md` §3.5 « Les instances », §3.13 |

## Dépendre de l'upstream

On importe les schémas de `@x/shared` par une dépendance **`link:`**, jamais `file:` (même raison qu'à la racine : `file:` copie et se périme). Il faut donc construire `@x/shared` avant d'installer ici :

```sh
cd apps/harbor && pnpm install && pnpm -r build
cd ../x && pnpm install && (cd packages/shared && npm run build)
cd ../baarali && pnpm install && pnpm typecheck && pnpm test
```

**zod est épinglé à 4.2.1**, la version de `@x/shared` et de Harbor. Un écart casse l'identité des types à travers le lien.

## Lancer le plan de contrôle

```sh
cd packages/control && pnpm build
BAARALI_PUBLIC_URL=http://127.0.0.1:8787 BAARALI_INSTANCE_TOKEN=<jeton> \
OPENROUTER_API_KEY=<clé> BAARALI_PLAN_ID=essentiel PORT=8787 pnpm start
```

| Variable | Rôle |
|---|---|
| `BAARALI_PUBLIC_URL` | URL publique du plan de contrôle, servie dans `/v1/config` |
| `BAARALI_INSTANCE_TOKEN` | Jeton porteur de l'instance (phase 0 : un seul propriétaire) ; gardé en empreinte SHA-256 |
| `OPENROUTER_API_KEY` | Ne sort jamais du plan de contrôle |
| `BAARALI_PLAN_ID` | Forfait du propriétaire, pris dans `src/catalog.ts` (budgets calculés depuis les prix, archi §3.5). Défaut : `essentiel` |
| `BAARALI_ACCOUNT_ID`, `BAARALI_ACCOUNT_EMAIL`, `BAARALI_ACCOUNT_CREATED_AT` | Le compte du propriétaire ; la semaine est ancrée à sa date de création |
| `PIXAZO_API_KEY` | Facultative : sans elle, `/v1/media` répond 503 et le texte marche quand même |
| `BAARALI_ADMIN_TOKEN` | Facultatif : le jeton de l'opérateur pour `/v1/admin/*` (recharges de crédits médias à la main). Absent : ces routes répondent 404 |
| `BAARALI_OWNER_MEDIA_CREDITS` | Crédits médias offerts au propriétaire, une seule fois en Postgres (référence `owner-grant`) ; en mémoire, à chaque démarrage |
| `DATABASE_URL` | Postgres (schéma `baarali`, migrations au démarrage, `src/db.ts`). Absente : tout reste en mémoire et s'oublie à l'arrêt de la machine. Chez Neon (choisi le 01/10/2026), l'adresse **directe**, pas celle du pooler (`-pooler` dans l'hôte) : le pooler en mode transaction perd le `search_path` et les verrous de migration |
| `RESEND_API_KEY`, `EMAIL_FROM` | Les codes par email, par Resend (choisi le 01/10/2026). `EMAIL_FROM` sur un domaine vérifié chez Resend, sinon l'envoi est refusé ou part en indésirable |
| `BAARALI_AUTH_SECRET` | Le serveur de connexion (`/auth/v1`, archi §3.5 « Comptes et connexion »), seulement avec `DATABASE_URL`. 32 octets aléatoires au moins. Absent : seul le jeton d'instance ouvre `/v1` |
| `GOOGLE_CLIENT_ID` / `_SECRET`, `APPLE_…`, `GITHUB_…`, `MICROSOFT_…` | Un fournisseur n'apparaît sur la page de connexion que si ses deux valeurs sont là |
| `BAARALI_GATEWAY_SECRET` | La passerelle vers les instances (archi §3.5 « Les instances »). 32 octets aléatoires au moins ; les clés de chaque instance en dérivent, le changer les change toutes. Absent : aucun appareil ne se connecte |
| `FLY_API_TOKEN`, `BAARALI_INSTANCE_IMAGE` | Créer les instances : un jeton limité à l'app des instances (`fly tokens create deploy -a baarali-instances`) et l'image à y lancer. Absents : seule l'instance du propriétaire est joignable |
| `BAARALI_INSTANCES_APP`, `BAARALI_INSTANCES_REGION`, `BAARALI_MAX_INSTANCES` | Défauts : `baarali-instances`, `cdg`, `20` |
| `BAARALI_OWNER_INSTANCE_APP` | L'app Fly de l'instance du propriétaire (phase 0, `warell-owner`), atteinte sans être modifiée |
| `BAARALI_SPACES_URL` | Notre serveur des espaces (Harbor, `apps/harbor`), décidé le 02/10/2026 : nous les hébergeons nous-mêmes. Servi dans `/v1/config` (`spacesApexUrl`), et seulement avec `BAARALI_AUTH_SECRET`. Absent : les apps n'affichent pas les espaces |
| `BAARALI_DEV_CODES` | `1` en développement seulement : les codes email et SMS s'écrivent dans le journal. Sans lui et sans vrai fournisseur, ni l'email ni le SMS ne sont proposés |
| `PORT` | Défaut : 8080 |

L'instance le trouve par `API_URL` : on ne modifie aucun fichier upstream qui l'appelle (archi §3.14).

## Déployer sur Fly.io

Deux apps, à Paris (`cdg`), construites sur les serveurs de Fly depuis la **racine du dépôt** (le contexte inclut `apps/harbor` et `apps/x`) :

```sh
fly deploy --config apps/baarali/packages/control/fly.toml  --dockerfile apps/baarali/packages/control/Dockerfile  --remote-only --ha=false .
fly deploy --config apps/baarali/packages/instance/fly.toml --dockerfile apps/baarali/packages/instance/Dockerfile --remote-only --ha=false --no-public-ips .
```

| App | Exposition | Secrets (`fly secrets`) |
|---|---|---|
| `warell-control` | Publique, **`https://app.baarali.com`** (aussi `https://warell-control.fly.dev`) | `OPENROUTER_API_KEY`, `BAARALI_INSTANCE_TOKEN`, `PIXAZO_API_KEY`, `BAARALI_ADMIN_TOKEN`, `BAARALI_GATEWAY_SECRET`, `FLY_API_TOKEN`, `BAARALI_INSTANCE_IMAGE` |
| `warell-owner` | **Privée** (Flycast), disque `data` monté sur `/data` | `BAARALI_INSTANCE_TOKEN`, `BAARALI_SERVER_KEY` |
| `baarali-spaces` | Publique, **`https://spaces.baarali.com`** et **`https://<équipe>.spaces.baarali.com`** | `DATABASE_URL` (Neon, sa propre base `baarali_spaces`), `AWS_ACCESS_KEY_ID` et `AWS_SECRET_ACCESS_KEY` (Tigris, posés par `fly storage create`) |
| `baarali-instances` | **Privée** (Flycast). Une machine et un volume par compte, créés par le plan de contrôle, jamais par `fly deploy` | Aucun : chaque machine reçoit ses clés à sa création |

Toutes se suspendent au repos et se réveillent à la requête suivante. Une instance n'a pas d'adresse publique : l'app l'atteint par la passerelle du plan de contrôle, `https://app.baarali.com/instance`, avec sa clé d'appareil. Pour une vérification à la main : `fly proxy 3221:80 warell-owner.flycast -a warell-owner`, puis `http://localhost:3221` avec la clé de l'instance.

**Publier une nouvelle image d'instance.** On la construit dans l'app des instances sans rien y déployer, puis le plan de contrôle la reçoit. Chaque machine y passe à la prochaine connexion d'un de ses appareils :

```sh
fly deploy --config apps/baarali/packages/instance/fly.toml --dockerfile apps/baarali/packages/instance/Dockerfile \
  -a baarali-instances --build-only --push --image-label vN --remote-only .
fly secrets set BAARALI_INSTANCE_IMAGE=registry.fly.io/baarali-instances:vN -a warell-control
```

**Le portier.** `rowboat-server` refuse tout `Host` qui n'est pas un nom de la machine (protection contre le *DNS rebinding*). Le portier (`packages/instance/src/gate.ts`) réécrit le `Host` vers la boucle locale ; la clé porteur du serveur reste exigée. Ainsi aucun fichier upstream ne change.

**Les noms des apps Fly** gardent l'ancien nom du produit (renommé Baarali le 01/10/2026) : Fly ne renomme pas une app, et en recréer une ferait migrer le disque de l'instance. Personne ne les voit : le public passe par `baarali.com`. Le dépôt GitHub, lui, s'appelle `benewende-dev/baarali` depuis le 02/10/2026 (ex-`benewende-dev/warell`, l'ancien site étant devenu `benewende-dev/wenastudio`), et le clone `~/baarali`.

**DNS** : `baarali.com` est chez Hostinger. `@` (A + AAAA de `warell-control`), `www` et `app` (CNAME vers `warell-control.fly.dev`), plus les lignes d'envoi Resend (`resend._domainkey`, `send`, `rsend`) et `_dmarc`. Les certificats sont émis par Fly (`fly certs list -a warell-control`).

## Les espaces

Harbor (`apps/harbor`) est le serveur des espaces : canaux, fils, fichiers partagés, et l'agent de chacun qui y agit en son nom. On l'héberge nous-mêmes, jamais chez l'upstream (décidé le 02/10/2026). Il ne connaît aucun mot de passe : il vérifie seul les jetons de notre serveur de connexion (« La connexion » ci-dessous), et l'équipe d'une personne est retrouvée par son identifiant de compte.

- **L'image** (`packages/spaces/Dockerfile`) construit Harbor tel quel, après `brand.mjs --only harbor` : ses pages (lien d'invitation, liens ouverts dans un navigateur) et le premier fichier d'une nouvelle équipe viennent de `packages/spaces/src/pages.ts`, en français ou en anglais selon la langue du navigateur ; une app qui ne dit rien reçoit du français.
- **Les adresses** : `spaces.baarali.com` crée les équipes et les liste ; chaque équipe vit sur `<équipe>.spaces.baarali.com`. Il faut donc un certificat joker chez Fly et trois lignes DNS chez Hostinger (`spaces`, `*.spaces`, `_acme-challenge.spaces`).
- **Les fichiers** vont chez Tigris (le stockage de Fly, compatible S3), seau `baarali-spaces-files`.
- **Les apps** l'apprennent par `BAARALI_SPACES_URL` sur le plan de contrôle (`/v1/config`) ; l'app mobile, par son build (`EXPO_PUBLIC_SPACES_APEX`).
- **L'app Mac passe par l'instance**, dont le jeton n'est connu que du plan de contrôle. L'instance l'échange contre un jeton Espaces (JWT ES256, 15 min, même identifiant de compte que le téléphone) sur `POST /v1/spaces/token` : `BAARALI_SPACES_TOKEN_URL`, posée par `packages/instance/src/main.ts`, lue par core (`auth/spaces-exchange.ts`).

```sh
fly deploy --config apps/baarali/packages/spaces/fly.toml --dockerfile apps/baarali/packages/spaces/Dockerfile --remote-only --ha=false .
```

## L'app de bureau

Le dépôt garde les fichiers de l'upstream tels quels. **La marque s'applique à la copie d'un build**, jamais au dépôt (`packages/desktop/scripts/brand.mjs`) :

- « Rowboat » devient « Baarali » dans les textes de `main`, `renderer` et `core` ;
- l'identifiant d'app macOS, les noms des installeurs, les icônes ;
- les liens (site, dépôt des mises à jour, contact) ;
- `API_URL` par défaut, `https://app.baarali.com` ;
- le lien vers l'instance : `src/cloud-link.ts`, copié dans `main` et démarré par une ligne.

Le script refuse d'écrire sans `--yes`. Chaque ancre doit se trouver exactement une fois : si l'upstream en change une, `test/brand.test.ts` casse sur la PR de synchro. L'image d'instance applique la même marque à `core` seulement (`--only core`), pour que l'agent se présente comme Baarali.

**Ce que fait l'app après la connexion.** L'accueil upstream connecte le compte, ce qui écrit `config/oauth.json`. Le lien voit la session, demande une clé d'appareil (`POST /v1/devices`), puis passe l'app en mode distant sur la passerelle et recharge les fenêtres. La première fois, l'instance est créée et démarre : le lien réessaie pendant environ une minute.

**Publier une version** : Actions › `baarali-desktop` › *Run workflow*, avec la version (`0.1.0`). Le workflow fait un brouillon de release `v0.1.0` : Mac arm64 et Intel, Windows. On le vérifie, puis on le publie. Le site pointe vers `releases/latest/download/` : `Baarali-mac-arm64.dmg`, `Baarali-mac-intel.dmg`, `Baarali-windows-setup.exe`. Les mises à jour automatiques passent par update.electronjs.org, qui lit ces releases.

**Signature (🧑).** Sans certificat, l'app Mac est signée ad hoc : macOS la dit « non vérifiée », et il faut l'autoriser une fois dans *Réglages › Confidentialité et sécurité*. Pour une app signée et notarisée, il faut un compte Apple Developer (99 $/an) et les secrets `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD` et `APPLE_TEAM_ID`. Windows affiche un avertissement SmartScreen tant que l'app n'est pas signée.

Ce qui reste en anglais : l'interface upstream, jusqu'à `@baarali/i18n` (archi §3.12).

## Changer un prix ou une devise

Tout est dans `packages/control/src/catalog.ts` : un prix en euros par forfait, le F CFA s'en déduit à la parité fixe (655,957, au franc près), et un taux par devise. La remise à l'année (`ANNUAL_DISCOUNT`, 10 %) ne s'affiche que sur `/tarifs` tant que le paiement n'est pas ouvert. Le budget se recalcule ; `test/pricing.test.ts` casse si la marge de 55 % ne tient plus dans une devise.

Les modèles de Découverte sont dans le même fichier (`DISCOVERY_MODELS`) : le premier est le défaut, les suivants prennent le relais. Avant d'en ajouter un, vérifier qu'il répond en français avec `reasoning: { enabled: false }` (archi §3.5, « Les modèles par forfait »).

Les médias sont dans `packages/control/src/media.ts` : un modèle = un chemin Pixazo, un corps et un prix. Un prix se relit sur `pixazo.ai/models/<famille>`, et on garde le prix normal quand une promotion court (archi §3.5, « Les médias »). Ils se paient en crédits médias, vendus en recharges (`MEDIA_PACKS` dans `catalog.ts`). `test/pricing.test.ts` casse si une recharge ne garde plus 55 %.

Ajouter une recharge à la main, tant qu'aucun paiement n'est branché (la même référence deux fois n'ajoute qu'une fois) :

```sh
curl -X POST https://app.baarali.com/v1/admin/media-credits \
  -H "authorization: Bearer $BAARALI_ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"account_id":"owner","pack":"medias-5","reference":"<reçu>"}'
```

## Postgres

Une migration déployée ne se modifie jamais : on ajoute la suivante à `MIGRATIONS` (`src/db.ts`). Les tests du magasin (`test/store.contract.test.ts`) passent les **mêmes** règles au magasin en mémoire et à Postgres. Pour Postgres, ils tournent sur PGlite, dans le processus : ni serveur ni Docker. PGlite met une dizaine de secondes à démarrer : une base par fichier de test, vidée entre deux tests.

## La connexion

`test/auth.test.ts` joue la connexion **comme le cœur la joue** : même `openid-client`, découverte à la même adresse, enregistrement dynamique avec les mêmes métadonnées, PKCE, puis `/v1/me` avec le jeton. Si l'upstream change sa façon de se connecter, c'est ce test qui doit casser.

Le serveur complète deux choses dans les requêtes de l'app (`asAppRequest`, `src/auth.ts`) : `offline_access`, sans quoi le cœur n'aurait pas de jeton de rafraîchissement, et `application_type: native`, sans quoi la redirection vers `http://localhost` (bureau) ou `com.baarali.app.mobile:/oauth-callback` (téléphone, RFC 8252 §7.1) serait refusée.

**Les espaces.** Harbor vérifie un jeton seul, avec nos clés publiques (`apps/harbor/packages/server/src/auth-oidc.ts`) : il lui faut un JWT signé en ES256 ou RS256. Avec `BAARALI_SPACES_URL`, chaque demande d'autorisation reçoit cette ressource (RFC 8707) : le jeton devient un JWT dont l'audience la nomme, signé par une clé ES256 ajoutée pour lui (Harbor ne lit pas l'EdDSA de la clé principale), et porte l'email seulement s'il est vérifié. `test/spaces-token.test.ts` joue le téléphone, puis lit le jeton comme Harbor.

## Les tests de contrat

Une réponse servie à l'instance est validée par le schéma zod de `@x/shared` lui-même, pas par une copie. Si l'upstream change un schéma, notre test casse à la synchro hebdomadaire, avant la production.

## Règles

- Les règles de la racine (`AGENTS.md`) s'appliquent : commentaires qui disent pourquoi, avec la date et la décision.
- Aucun appel vers `rowboatlabs.com` ni PostHog (`UPSTREAM.md` §6).
- Aucune chaîne visible par l'utilisateur écrite en dur : elles passeront par `@baarali/i18n` (roadmap phase 1).
