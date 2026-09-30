# apps/warell

Le code propre à Warell : les packages `@warell/*`. C'est un espace de travail pnpm à part, comme `apps/harbor`, pour ne jamais toucher les fichiers de l'upstream (`docs/warell/UPSTREAM.md` §2). La conception est dans `docs/warell/` ; ce guide ne dit que comment travailler ici.

| Package | Rôle | Conception |
|---|---|---|
| `packages/control` | Le plan de contrôle : remplace le backend Rowboat Labs en servant les mêmes routes `/v1/*` | `TARGET_AGENTIC_ARCHITECTURE.md` §3.5 |

## Dépendre de l'upstream

On importe les schémas de `@x/shared` par une dépendance **`link:`**, jamais `file:` (même raison qu'à la racine : `file:` copie et se périme). Il faut donc construire `@x/shared` avant d'installer ici :

```sh
cd apps/harbor && pnpm install && pnpm -r build
cd ../x && pnpm install && (cd packages/shared && npm run build)
cd ../warell && pnpm install && pnpm typecheck && pnpm test
```

**zod est épinglé à 4.2.1**, la version de `@x/shared` et de Harbor. Un écart casse l'identité des types à travers le lien.

## Les tests de contrat

Une réponse servie à l'instance est validée par le schéma zod de `@x/shared` lui-même, pas par une copie. Si l'upstream change un schéma, notre test casse à la synchro hebdomadaire, avant la production.

## Règles

- Les règles de la racine (`AGENTS.md`) s'appliquent : commentaires qui disent pourquoi, avec la date et la décision.
- Aucun appel vers `rowboatlabs.com` ni PostHog (`UPSTREAM.md` §6).
- Aucune chaîne visible par l'utilisateur écrite en dur : elles passeront par `@warell/i18n` (roadmap phase 1).
