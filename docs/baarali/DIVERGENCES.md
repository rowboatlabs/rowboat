# Divergences avec l'upstream

Chaque fichier **venu de `rowboatlabs/rowboat`** que Baarali modifie a une ligne ici : ce qu'on y change, pourquoi, depuis quand. Les fichiers créés par Baarali n'y figurent pas, ils ne peuvent pas entrer en conflit. La méthode est dans [`UPSTREAM.md`](./UPSTREAM.md).

Une ligne s'ajoute dans le même commit que la modification, et disparaît dans le même commit que son retrait.

| Fichier upstream | Changement | Pourquoi | Depuis |
|---|---|---|---|
| `apps/x/packages/core/src/models/gateway.ts` | `listGatewayModels` garde le `name` du catalogue de la passerelle | Le sélecteur montrait l'identifiant brut (`deepseek/deepseek-v4.1-flash`) ; le plan de contrôle sert des noms lisibles (archi §3.5) | 30/09/2026 |
| `apps/x/apps/renderer/src/hooks/use-models.ts` (+ son test) | Ajoute `namesByKey` à l'instantané | Même raison : le nom suit le modèle jusqu'au sélecteur | 30/09/2026 |
| `apps/x/apps/renderer/src/components/model-selector.tsx` | Affiche et cherche par le nom quand il existe, l'identifiant sinon | Même raison | 30/09/2026 |
| `apps/x/apps/renderer/src/components/apps/catalog.tsx` | Cartes par `AppCard` et fiches (`fiches.ts`) : nom clair, à quoi l'app sert, ses accès ; rayons ; les apps sans fiche derrière un lien ; fenêtre d'installation en mots simples | Le catalogue montrait un nom de paquet, une phrase anglaise et un chemin GitHub ; une personne ne savait ni à quoi l'app sert ni ce qu'elle touche avant d'installer | 02/10/2026 |
| `apps/x/apps/renderer/src/components/apps/apps-view.tsx` | « Mes apps » passe par la même `AppCard`, avec les accès lus dans le manifeste | Même raison | 02/10/2026 |
| `apps/x/apps/renderer/src/components/sidebar-content.tsx` | Barre réordonnée : « Discuter avec Baarali » en tête, une seule liste (E-mail, Réunions, À faire, Projets, Apps, Tâches planifiées, Connecteurs), la Bibliothèque sous « Plus » ; jauge de session (`sidebar-session-gauge.tsx`) ; compte, visite et réglages sur une ligne en bas | Maquette validée par le fondateur (02/10/2026) : une app grand public met en avant ce qui sert le plus ; le bouton « Passer au supérieur » écrivait sur le nom du forfait | 02/10/2026 |
| `apps/x/apps/renderer/src/components/dock-sidebar.tsx` | Rail replié dans le même ordre, mêmes icônes (groupe de personnes, horloge, livre) | Même raison | 02/10/2026 |
| `apps/x/apps/renderer/src/components/spaces-sidebar-section.tsx` | Icône d'un groupe de personnes, titre au ton des autres entrées | Les deux bulles se confondaient avec les discussions | 02/10/2026 |
| `apps/x/apps/renderer/src/App.tsx` | Une loupe (⌘K) au bout des boutons du haut, et plus d'espace entre eux | Demandé par le fondateur (02/10/2026) | 02/10/2026 |
| `apps/x/apps/renderer/src/components/bg-tasks-view.tsx` | La liste devient des cartes (`bg-task-card.tsx`) : ce que fait la tâche, l'horaire en mots et en GMT (`lib/schedule-words.ts`), « Lancer » visible, la raison d'un échec ; la fenêtre « Nouvelle tâche » propose 6 idées (`lib/task-ideas.ts`) et garde le modèle des développeurs en bas | Le tableau montrait le nom de fichier et une expression cron ; le seul modèle servait aux développeurs (maquette validée le 02/10/2026) | 02/10/2026 |

**La marque n'est pas une divergence.** Elle ne touche aucun fichier du dépôt : elle s'applique à la copie d'un build, en CI ou dans l'image d'instance (`apps/baarali/packages/desktop/scripts/brand.mjs`, décidé le 01/10/2026). Ses ancres dans les fichiers upstream sont vérifiées par un test à chaque PR.

Ces trois changements sont génériques (les fournisseurs BYOK portent déjà un nom que le sélecteur ignorait) : à proposer à l'upstream, et à retirer d'ici s'il les accepte.
