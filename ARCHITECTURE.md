# Architecture

This repository contains multiple Rowboat product surfaces. The quickest way to get oriented is to start from the table below instead of treating the repo as a single application.

## Product Map

| Surface | Path | Status | Purpose |
|---|---|---|---|
| Desktop app | `apps/x` | Primary | Local-first Electron app with Markdown memory, knowledge graph sync, and on-device workflows |
| Hosted web app | `apps/rowboat` | Active | Next.js platform with project-scoped agents, RAG, jobs, billing, and integrations |
| CLI/runtime | `apps/cli` | Active | Local HTTP runtime, workflow packaging, and npm-distributed `rowboatx` tooling |
| New frontend | `apps/rowboatx` | Active, evolving | Static Next.js UI that talks to the local runtime and shell-provided APIs |
| Docs | `apps/docs` | Active | Mintlify documentation site |
| Python SDK | `apps/python-sdk` | Supporting | Thin Python client for the hosted chat API |
| Experiments | `apps/experimental` | Experimental | Prototypes and one-off services not considered part of the core product |

## How The Pieces Fit Together

### `apps/x`
- Nested `pnpm` workspace for the desktop product.
- `apps/main` runs the Electron main process.
- `apps/preload` exposes the validated IPC bridge.
- `apps/renderer` contains the React UI.
- `packages/shared` holds shared schemas and IPC contracts.
- `packages/core` contains workspace, knowledge graph, agent, and integration logic.

### `apps/rowboat`
- Hosted or self-hosted Next.js application.
- Uses MongoDB, Redis, Qdrant, uploads storage, background workers, and external providers.
- Organized into `application`, `entities`, `infrastructure`, and `interface-adapters` layers.

### `apps/cli` + `apps/rowboatx`
- `apps/cli` provides the local API and runtime for runs, tools, permissions, and event streaming.
- `apps/rowboatx` is the browser UI that expects a runtime behind `/api/stream`, `/api/rowboat/*`, or a configured `window.config.apiBase`.

## Shared Runtime Concepts

- Local data lives under `~/.rowboat` by default.
- The desktop product stores knowledge as Markdown files and maintains Git-backed history for those notes.
- The hosted app uses project-scoped data stores instead of the desktop Markdown vault.
- Both the desktop and hosted surfaces rely on model/provider abstraction, tool calling, and external integrations.

## Recommended Entry Points

- Working on desktop memory, sync, or Electron UX: start in `apps/x`
- Working on hosted APIs, jobs, RAG, or project management: start in `apps/rowboat`
- Working on local runtime, SSE events, or packaging flows: start in `apps/cli`
- Working on the newer dashboard UI for the local runtime: start in `apps/rowboatx`

## Common Commands

### Desktop app
```bash
cd apps/x
pnpm install
npm run verify
npm run dev
npm run test
```

### Hosted web app
```bash
cd apps/rowboat
npm install
npm run verify
npm run dev
```

### CLI runtime
```bash
cd apps/cli
npm install
npm run verify
npm run server
```

### Local runtime frontend
```bash
cd apps/rowboatx
npm install
npm run dev
```

## Contributor Rules Of Thumb

- Prefer `apps/x` when the change is local-first or knowledge-vault oriented.
- Prefer `apps/rowboat` when the change requires server-side persistence, auth, billing, or hosted APIs.
- Treat `apps/experimental` as non-core unless you are intentionally working on a prototype.
- When adding documentation, update the README closest to the surface you changed.
