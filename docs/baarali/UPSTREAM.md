# Rester branché sur l'upstream

Baarali est un fork de [`rowboatlabs/rowboat`](https://github.com/rowboatlabs/rowboat) (Apache-2.0). L'upstream est très actif : **271 commits sur les 30 jours précédant le 29/09/2026**, soit une soixantaine par semaine. Ce document fixe comment on récupère ce travail sans se noyer dans les conflits. Ce qu'on a *changé* chez eux, fichier par fichier, vit dans [`DIVERGENCES.md`](./DIVERGENCES.md).

## 1. Les remotes

| Remote | URL | Rôle |
|---|---|---|
| `origin` | `benewende-dev/warell` (ex-`benewende-dev/rowboat`, renommé le 29/09/2026) | Notre dépôt. `main` = Baarali. |
| `upstream` | `rowboatlabs/rowboat` | Lecture seule : push désactivé (`git remote set-url --push upstream DISABLED`). |

Le renommage n'a pas cassé le lien de fork, et GitHub redirige l'ancienne URL. Mettre à jour un clone existant : `git remote set-url origin https://github.com/benewende-dev/warell.git`.

## 2. La règle d'or : on ajoute, on n'édite pas

Chaque ligne modifiée dans un fichier upstream est un conflit potentiel, **pour toujours**. Chaque fichier *nouveau* n'en provoque jamais. D'où, par ordre de préférence :

1. **Nouveau fichier, nouveau package.** Le code Baarali vit dans des emplacements que l'upstream ne connaît pas : `docs/baarali/`, `scripts/baarali-*`, `.github/workflows/baarali-*`, et plus tard des packages `@baarali/*` dans les workspaces existants.
2. **Brancher sur une couture existante.** Rowboat est construit par injection de dépendances (Awilix, `packages/core/src/di/`) et par catalogues. On enregistre, on ne réécrit pas :
   - un outil = un module dans `runtime/tools/domains/` ;
   - un skill = un dossier dans `runtime/assembly/skills/` ;
   - une politique d'approbation = une implémentation de `IPermissionChecker` / `IPermissionClassifier` (cf. `packages/core/docs/turn-runtime-design.md` §9) ;
   - une capacité serveur Harbor = la « tranche » décrite dans `apps/harbor/AGENTS.md`.
3. **Modifier un fichier upstream en dernier recours**, avec le diff le plus petit possible : une ligne d'import ou d'enregistrement plutôt qu'un bloc réécrit. Chaque modification porte un commentaire `// BAARALI(<date>): <pourquoi>` et une ligne dans `DIVERGENCES.md`.

### Ce qu'on ne renomme jamais

Les identifiants internes restent ceux de Rowboat : packages `@x/*` et `@rowboat/*`, variables `ROWBOAT_*`, dossier `~/.rowboat` (configurable par `ROWBOAT_WORKDIR`), noms de workflows. Les renommer toucherait des milliers de lignes et rendrait chaque synchro conflictuelle. **La marque Baarali ne vit qu'à la surface visible par l'utilisateur**, par deux couches appliquées à la fabrication, jamais dans le dépôt :

- la marque, `apps/baarali/packages/desktop/scripts/brand.mjs`. Elle couvre :
  - le nom ;
  - les liens ;
  - la mention que l'on tape pour appeler l'assistant, `@baarali` au lieu de `@rowboat`. L'ancre du protocole des espaces (`#rowboat`) reste inchangée ;
  - ce que le cœur écrit dans un nouveau compte (premières tâches, planificateur) ;
  - la règle de langue de l'agent ;
- la traduction, `apps/baarali/packages/desktop/src/i18n/`. Son `i18n-extract.mjs --check` bloque toute version qui laisserait une phrase en anglais. Elle couvre :
  - l'écran du bureau, par une couche qui observe la page ;
  - les menus ;
  - l'app mobile, par un module de compilation (`src/i18n/mobile/`). Ce module est branché par `brand.mjs --only mobile`, qui donne aussi au mobile son nom, ses icônes et son accent bleu, et le retire du compte Expo de l'upstream.

Pourquoi c'est obligatoire, et pas seulement pratique : la licence Apache-2.0 ne donne **aucun droit sur la marque « Rowboat »** (§6). Le produit distribué doit donc s'appeler Baarali partout où l'utilisateur le voit. Voir [`/NOTICE`](../../NOTICE).

### Fichiers brûlants

Voici les fichiers les plus modifiés par l'upstream sur les 30 jours précédant le 29/09/2026. Les toucher coûte le plus cher.

| Fichier | Commits / 30 j | Consigne |
|---|---|---|
| `apps/x/apps/renderer/src/App.tsx` (8 288 lignes) | 57 | Ne rien y écrire. Monter nos écrans par composants séparés, avec une seule ligne d'accroche. |
| `apps/x/packages/shared/src/ipc.ts` | 54 | Nos canaux dans un fichier à nous, fusionné par une ligne. |
| `apps/x/apps/renderer/src/components/spaces-view.tsx` et `spaces/*` | 20–40 | Ne pas y toucher. |
| `apps/harbor/packages/server/src/pg-store.ts`, `store.ts`, `service.ts` | 22–29 | Nos tables dans **notre** échelle de migrations (ci-dessous). |
| `apps/x/apps/main/src/ipc.ts`, `apps/x/apps/server/src/core-deps.ts` | 23–28 | Enregistrement par une ligne. |

Pour recalculer la liste :
`git log --since='30 days ago' --name-only --format='' upstream/main | sort | uniq -c | sort -rn | head -20`

### Migrations de base de données

Harbor a une échelle de migrations append-only et numérotée (`apps/harbor/packages/server/src/migrations.ts`, `0NN-<concern>`). Si on y ajoutait `042-baarali-goals`, le prochain `042` de l'upstream entrerait en collision. **Les tables Baarali ont donc leur propre échelle**, avec sa propre table de suivi, et ne sont jamais intercalées dans celle de Harbor.

## 3. Fusionner, jamais rebaser

`main` est publié : on **fusionne** l'upstream (merge commit), on ne rebase pas. Rebaser réécrirait l'historique partagé et ferait perdre à `rerere` la mémoire des conflits déjà résolus. Pour la même raison, la PR de synchro se fusionne avec **« Create a merge commit »**, jamais en squash.

## 4. Le rythme : une fois par semaine

Une synchro de 60 commits se relit ; une synchro de 600 se subit. Deux chemins :

- **Automatique.** `.github/workflows/baarali-upstream-sync.yml` tourne le lundi à 06:00 UTC (ou à la demande depuis l'onglet Actions).
  - Si la fusion est propre, il pousse `sync/upstream-AAAA-MM-JJ`, ouvre la PR et lance les tests.
  - S'il y a conflit, il ouvre une issue avec la liste des fichiers, et le run passe au rouge.
- **Manuel.** `scripts/baarali-sync-upstream.sh [ref]`. Ce script prépare la même branche en local, sans rien pousser.

Avant de fusionner une PR de synchro :

1. la CI (`x-tests.yml` : lint + Vitest de `shared`, `core`, `server`, `renderer` ; Harbor construit d'abord) est verte ;
2. chaque fichier de `DIVERGENCES.md` qui a bougé a été relu ;
3. l'upstream n'a ajouté aucun appel vers un service hébergé par Rowboat Labs (§6).

### Réglages GitHub à faire une fois (🧑)

- Actions activées sur le fork. GitHub les désactive par défaut sur un fork.
- *Settings › Actions › General* : cocher « Allow GitHub Actions to create and approve pull requests ».
- Recommandé : un secret `BAARALI_SYNC_TOKEN`. C'est un jeton fine-grained limité à ce dépôt, avec les droits contents, pull-requests, issues et workflows en écriture. Sans lui, deux limites :
  - une synchro qui touche `.github/workflows` ne peut pas être poussée ;
  - les tests doivent être relancés par `workflow_dispatch`.
- Facultatif : activer les Issues du fork, pour recevoir les alertes de conflit sous forme d'issue et pas seulement d'un run rouge.

## 5. Résoudre un conflit

1. `scripts/baarali-sync-upstream.sh` : le script liste les fichiers en conflit. `rerere` est activé, donc les conflits déjà tranchés se résolvent seuls.
2. Pour chaque fichier, ouvrir sa ligne dans `DIVERGENCES.md` : elle dit *pourquoi* on diverge. On garde leur changement **et** notre intention.
3. Si notre modification est devenue inutile (l'upstream a résolu le problème autrement), on la supprime, ainsi que sa ligne. **Chaque divergence retirée est une victoire.**
4. `git add -A && git commit --no-edit`, tests, push, PR.

## 6. Ce que l'upstream appelle chez lui

Rowboat dépend d'un backend fermé, `https://api.x.rowboatlabs.com` (`packages/core/src/config/env.ts`, surchargeable par `API_URL`), et d'une télémétrie PostHog (`us.i.posthog.com`). Baarali ne doit **ni dépendre de ces services ni y envoyer de données**. Le détail des points d'appel est dans [`ROWBOAT_ARCHITECTURE_AUDIT.md`](./ROWBOAT_ARCHITECTURE_AUDIT.md) §11.

À chaque synchro, vérifier qu'aucun nouvel appel n'est apparu :

```sh
git diff origin/main...upstream/main -- apps | grep -nE 'API_URL|rowboatlabs\.com|posthog' | grep '^+'
```

## 7. Rendre à l'upstream

Un correctif générique (bug, test, robustesse) sans rapport avec Baarali se propose d'abord à l'upstream. Accepté, il disparaît de notre diff. C'est la façon la moins chère de réduire nos divergences. Les contributions partent d'une branche créée depuis `upstream/main`, jamais depuis notre `main`.
