#!/usr/bin/env bash
# Intègre l'upstream (rowboatlabs/rowboat) dans Baarali, sur une branche dédiée.
# Méthode et règles : docs/baarali/UPSTREAM.md.
#
#   scripts/baarali-sync-upstream.sh          # fusionne upstream/main
#   scripts/baarali-sync-upstream.sh <ref>    # fusionne jusqu'à un commit/tag précis
#
# Le script ne pousse rien et ne touche jamais main : il prépare une branche
# sync/upstream-AAAA-MM-JJ que l'on pousse et relit en PR.
set -euo pipefail

UPSTREAM_URL="https://github.com/rowboatlabs/rowboat.git"
TARGET="${1:-upstream/main}"

cd "$(git rev-parse --show-toplevel)"

if [ -n "$(git status --porcelain)" ]; then
  echo "✗ Arbre de travail modifié : committe ou range tes changements d'abord." >&2
  exit 1
fi

# Remote upstream en lecture seule : on ne pousse jamais chez eux par accident.
git remote get-url upstream >/dev/null 2>&1 || git remote add upstream "$UPSTREAM_URL"
git remote set-url --push upstream DISABLED

# rerere mémorise nos résolutions de conflits : un conflit déjà tranché une
# fois se résout tout seul aux synchros suivantes.
git config rerere.enabled true
git config rerere.autoupdate true

git fetch origin --quiet
git fetch upstream --quiet

behind=$(git rev-list --count "origin/main..$TARGET")
if [ "$behind" = 0 ]; then
  echo "✓ Déjà à jour avec $TARGET."
  exit 0
fi
echo "→ $behind commit(s) upstream à intégrer."

branch="sync/upstream-$(date +%Y-%m-%d)"
git switch --no-track -C "$branch" origin/main

if git merge --no-ff --no-edit -m "sync: intègre $TARGET ($(git rev-parse --short "$TARGET"))" "$TARGET"; then
  echo "✓ Fusion propre sur $branch."
  echo "  Étapes suivantes : tests (cf. UPSTREAM.md §4), puis"
  echo "  git push -u origin $branch && gh pr create --base main"
else
  echo "✗ Conflits à résoudre :" >&2
  git diff --name-only --diff-filter=U >&2
  echo "  Consulte docs/baarali/DIVERGENCES.md pour chaque fichier listé," >&2
  echo "  résous, puis : git add -A && git commit --no-edit" >&2
  exit 2
fi
