# apps/warell

Le code propre à Warell : les packages `@warell/*`. C'est un espace de travail pnpm à part, comme `apps/harbor`, pour ne jamais toucher les fichiers de l'upstream (`docs/warell/UPSTREAM.md` §2). La conception est dans `docs/warell/` ; ce guide ne dit que comment travailler ici.

| Package | Rôle | Conception |
|---|---|---|
| `packages/control` | Le plan de contrôle : remplace le backend Rowboat Labs en servant les mêmes routes `/v1/*` | `TARGET_AGENTIC_ARCHITECTURE.md` §3.5 |
| `packages/instance` | Le lanceur d'une instance : prépare le dossier de travail, démarre `rowboat-server` sur la boucle locale, ouvre le portier ; le serveur MCP `warell-media` (vidéo, voix, musique) | `TARGET_AGENTIC_ARCHITECTURE.md` §3.1 et §3.5 |

## Dépendre de l'upstream

On importe les schémas de `@x/shared` par une dépendance **`link:`**, jamais `file:` (même raison qu'à la racine : `file:` copie et se périme). Il faut donc construire `@x/shared` avant d'installer ici :

```sh
cd apps/harbor && pnpm install && pnpm -r build
cd ../x && pnpm install && (cd packages/shared && npm run build)
cd ../warell && pnpm install && pnpm typecheck && pnpm test
```

**zod est épinglé à 4.2.1**, la version de `@x/shared` et de Harbor. Un écart casse l'identité des types à travers le lien.

## Lancer le plan de contrôle

```sh
cd packages/control && pnpm build
WARELL_PUBLIC_URL=http://127.0.0.1:8787 WARELL_INSTANCE_TOKEN=<jeton> \
OPENROUTER_API_KEY=<clé> WARELL_PLAN_ID=essentiel PORT=8787 pnpm start
```

| Variable | Rôle |
|---|---|
| `WARELL_PUBLIC_URL` | URL publique du plan de contrôle, servie dans `/v1/config` |
| `WARELL_INSTANCE_TOKEN` | Jeton porteur de l'instance (phase 0 : un seul propriétaire) ; gardé en empreinte SHA-256 |
| `OPENROUTER_API_KEY` | Ne sort jamais du plan de contrôle |
| `WARELL_PLAN_ID` | Forfait du propriétaire, pris dans `src/catalog.ts` (budgets calculés depuis les prix, archi §3.5). Défaut : `essentiel` |
| `WARELL_ACCOUNT_ID`, `WARELL_ACCOUNT_EMAIL`, `WARELL_ACCOUNT_CREATED_AT` | Le compte du propriétaire ; la semaine est ancrée à sa date de création |
| `PIXAZO_API_KEY` | Facultative : sans elle, `/v1/media` répond 503 et le texte marche quand même |
| `WARELL_ADMIN_TOKEN` | Facultatif : le jeton de l'opérateur pour `/v1/admin/*` (recharges de crédits médias à la main). Absent : ces routes répondent 404 |
| `WARELL_OWNER_MEDIA_CREDITS` | Crédits médias offerts au propriétaire, une seule fois en Postgres (référence `owner-grant`) ; en mémoire, à chaque démarrage |
| `DATABASE_URL` | Postgres (schéma `warell`, migrations au démarrage, `src/db.ts`). Absente : tout reste en mémoire et s'oublie à l'arrêt de la machine |
| `WARELL_AUTH_SECRET` | Le serveur de connexion (`/auth/v1`, archi §3.5 « Comptes et connexion »), seulement avec `DATABASE_URL`. 32 octets aléatoires au moins. Absent : seul le jeton d'instance ouvre `/v1` |
| `GOOGLE_CLIENT_ID` / `_SECRET`, `APPLE_…`, `GITHUB_…`, `MICROSOFT_…` | Un fournisseur n'apparaît sur la page de connexion que si ses deux valeurs sont là |
| `WARELL_DEV_CODES` | `1` en développement seulement : les codes email et SMS s'écrivent dans le journal. Sans lui et sans vrai fournisseur, ni l'email ni le SMS ne sont proposés |
| `PORT` | Défaut : 8080 |

L'instance le trouve par `API_URL` : on ne modifie aucun fichier upstream qui l'appelle (archi §3.14).

## Déployer sur Fly.io

Deux apps, à Paris (`cdg`), construites sur les serveurs de Fly depuis la **racine du dépôt** (le contexte inclut `apps/harbor` et `apps/x`) :

```sh
fly deploy --config apps/warell/packages/control/fly.toml  --dockerfile apps/warell/packages/control/Dockerfile  --remote-only --ha=false .
fly deploy --config apps/warell/packages/instance/fly.toml --dockerfile apps/warell/packages/instance/Dockerfile --remote-only --ha=false --no-public-ips .
```

| App | Exposition | Secrets (`fly secrets`) |
|---|---|---|
| `warell-control` | Publique, `https://warell-control.fly.dev` | `OPENROUTER_API_KEY`, `WARELL_INSTANCE_TOKEN`, `PIXAZO_API_KEY`, `WARELL_ADMIN_TOKEN` |
| `warell-owner` | **Privée** (Flycast), disque `data` monté sur `/data` | `WARELL_INSTANCE_TOKEN` |

Les deux se suspendent au repos et se réveillent à la requête suivante. Une instance n'a pas d'adresse publique : en phase 0, on l'atteint par un tunnel, `fly proxy 3221:80 warell-owner.flycast -a warell-owner`, puis `http://localhost:3221` avec la clé de `/data/server-key`.

**Le portier.** `rowboat-server` refuse tout `Host` qui n'est pas un nom de la machine (protection contre le *DNS rebinding*). Le portier (`packages/instance/src/gate.ts`) réécrit le `Host` vers la boucle locale ; la clé porteur du serveur reste exigée. Ainsi aucun fichier upstream ne change.

## Changer un prix ou une devise

Tout est dans `packages/control/src/catalog.ts` : un prix par devise et par forfait, et un taux par devise. Le budget se recalcule ; `test/pricing.test.ts` casse si la marge de 55 % ne tient plus dans une devise.

Les modèles de Découverte sont dans le même fichier (`DISCOVERY_MODELS`) : le premier est le défaut, les suivants prennent le relais. Avant d'en ajouter un, vérifier qu'il répond en français avec `reasoning: { enabled: false }` (archi §3.5, « Les modèles par forfait »).

Les médias sont dans `packages/control/src/media.ts` : un modèle = un chemin Pixazo, un corps et un prix. Un prix se relit sur `pixazo.ai/models/<famille>`, et on garde le prix normal quand une promotion court (archi §3.5, « Les médias »). Ils se paient en crédits médias, vendus en recharges (`MEDIA_PACKS` dans `catalog.ts`). `test/pricing.test.ts` casse si une recharge ne garde plus 55 %.

Ajouter une recharge à la main, tant qu'aucun paiement n'est branché (la même référence deux fois n'ajoute qu'une fois) :

```sh
curl -X POST https://warell-control.fly.dev/v1/admin/media-credits \
  -H "authorization: Bearer $WARELL_ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"account_id":"owner","pack":"medias-5","reference":"<reçu>"}'
```

## Postgres

Une migration déployée ne se modifie jamais : on ajoute la suivante à `MIGRATIONS` (`src/db.ts`). Les tests du magasin (`test/store.contract.test.ts`) passent les **mêmes** règles au magasin en mémoire et à Postgres. Pour Postgres, ils tournent sur PGlite, dans le processus : ni serveur ni Docker. PGlite met une dizaine de secondes à démarrer : une base par fichier de test, vidée entre deux tests.

## La connexion

`test/auth.test.ts` joue la connexion **comme le cœur la joue** : même `openid-client`, découverte à la même adresse, enregistrement dynamique avec les mêmes métadonnées, PKCE, puis `/v1/me` avec le jeton. Si l'upstream change sa façon de se connecter, c'est ce test qui doit casser.

Le serveur complète deux choses dans les requêtes de l'app (`asAppRequest`, `src/auth.ts`) : `offline_access`, sans quoi le cœur n'aurait pas de jeton de rafraîchissement, et `application_type: native`, sans quoi la redirection vers `http://localhost` serait refusée.

## Les tests de contrat

Une réponse servie à l'instance est validée par le schéma zod de `@x/shared` lui-même, pas par une copie. Si l'upstream change un schéma, notre test casse à la synchro hebdomadaire, avant la production.

## Règles

- Les règles de la racine (`AGENTS.md`) s'appliquent : commentaires qui disent pourquoi, avec la date et la décision.
- Aucun appel vers `rowboatlabs.com` ni PostHog (`UPSTREAM.md` §6).
- Aucune chaîne visible par l'utilisateur écrite en dur : elles passeront par `@warell/i18n` (roadmap phase 1).
