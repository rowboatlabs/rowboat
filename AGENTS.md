# Rowboat monorepo

Two applications, each its own pnpm workspace, plus product docs. Each area keeps its own guide; this file holds only what is true everywhere.

| Path | What | Guide |
|---|---|---|
| `apps/x/` | The Rowboat desktop app (Electron + React) and its packages, including the mobile app | none yet — read `apps/x/package.json` scripts and the package READMEs |
| `apps/harbor/` | Harbor, the Spaces server, and the spaces protocol package | [`apps/harbor/AGENTS.md`](apps/harbor/AGENTS.md) |
| `docs/` | Product docs that belong to no one app (the Spaces design language, notes) | — |

## How the two apps relate

`apps/x` consumes `@rowboat/spaces-protocol` and `@rowboat/harbor` from `apps/harbor` as **`link:` dependencies** — never `file:`, which pnpm copies at install time and which then goes stale during co-development. Build harbor before installing or testing x:

```sh
cd apps/harbor && pnpm install && pnpm -r build
cd ../x && pnpm install && npm test
```

**zod is pinned to one version (4.2.1) in both workspaces.** A mismatch breaks type identity across the link. CI (`.github/workflows/x-tests.yml`) builds harbor first in every job, including release builds.

## Rules that hold everywhere

- Comments explain **why**, with the date and the decision or PR they implement. The code says what.
- Documents own one kind of fact each and link to each other rather than restate. There are no status documents: status is the PR description and `git log`.
- A PR that changes a documented behavior changes the document in the same PR. For harbor the three questions are in its guide.
- Nothing speculative: no seat reserved for a rule or a feature that has no route yet.
