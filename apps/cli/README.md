# Rowboat CLI And Local Runtime

`apps/cli` contains the npm-distributed `@rowboatlabs/rowboatx` package and the local HTTP runtime used by the newer frontend.

## What Lives Here

- Hono server for runs, messages, permissions, and SSE streaming
- Model and MCP configuration repositories under `~/.rowboat`
- Workflow import and export helpers
- Packaged CLI entrypoint in `bin/app.js`

## Local Development

Install and build:

```bash
npm install
npm run verify
```

Run the local server:

```bash
npm run server
```

## Key Commands

- `npm run build` - compile TypeScript into `dist/`
- `npm run lint` - run CLI lint checks
- `npm run typecheck` - run TypeScript checks without emitting
- `npm run server` - start the local Hono runtime
- `npm run verify` - run lint, typecheck, and tests together
- `npm run migrate-agents` - run bundled agent migration script

## Data Location

The CLI/runtime stores configuration and runtime state in `~/.rowboat` by default.

## Related Surfaces

- `apps/rowboatx` provides the newer frontend that talks to this runtime
- `apps/x` has its own local-first desktop runtime and is the primary desktop product

See the root `ARCHITECTURE.md` for the repo-level map.
