# Divergences avec l'upstream

Chaque fichier **venu de `rowboatlabs/rowboat`** que Baarali modifie a une ligne ici : ce qu'on y change, pourquoi, depuis quand. Les fichiers créés par Baarali n'y figurent pas, ils ne peuvent pas entrer en conflit. La méthode est dans [`UPSTREAM.md`](./UPSTREAM.md).

Une ligne s'ajoute dans le même commit que la modification, et disparaît dans le même commit que son retrait.

| Fichier upstream | Changement | Pourquoi | Depuis |
|---|---|---|---|
| `apps/x/packages/core/src/models/gateway.ts` | `listGatewayModels` garde le `name` du catalogue de la passerelle | Le sélecteur montrait l'identifiant brut (`deepseek/deepseek-v4.1-flash`) ; le plan de contrôle sert des noms lisibles (archi §3.5) | 30/09/2026 |
| `apps/x/apps/renderer/src/hooks/use-models.ts` (+ son test) | Ajoute `namesByKey` à l'instantané | Même raison : le nom suit le modèle jusqu'au sélecteur | 30/09/2026 |
| `apps/x/apps/renderer/src/components/model-selector.tsx` | Affiche et cherche par le nom quand il existe, l'identifiant sinon | Même raison | 30/09/2026 |

Ces trois changements sont génériques (les fournisseurs BYOK portent déjà un nom que le sélecteur ignorait) : à proposer à l'upstream, et à retirer d'ici s'il les accepte.
