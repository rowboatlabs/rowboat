# Rowboat Desktop App

`apps/x` is the primary local-first Rowboat desktop product. It is a nested `pnpm` workspace that packages the Electron app, renderer, preload bridge, shared contracts, and core knowledge/runtime logic.

## Workspace Layout

- `apps/main` - Electron main process
- `apps/renderer` - React and Vite renderer UI
- `apps/preload` - validated IPC bridge
- `packages/shared` - shared schemas and IPC contracts
- `packages/core` - workspace, knowledge graph, integrations, agents, and background services

## Local Development

Install dependencies:

```bash
pnpm install
```

Build shared dependencies used by the app:

```bash
npm run deps
```

Run the desktop app in development:

```bash
npm run dev
```

Useful verification commands:

```bash
npm run lint
npm run typecheck
npm run test
npm run verify
```

## Build Notes

- `npm run deps` builds `shared`, `core`, and `preload`
- `apps/main` bundles the Electron main process with esbuild for packaging
- The renderer uses Vite and hot reloads during development

## Local Data Model

- Default work directory: `~/.rowboat`
- Knowledge is stored as Markdown
- Knowledge note history is Git-backed for transparent local versioning

If you are new to the repo, read the root `ARCHITECTURE.md` before making cross-surface changes.
