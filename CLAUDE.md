# CLAUDE.md - AI Coding Agent Context

This file provides context for AI coding agents working on the Rowboat monorepo.

## Quick Reference Commands

```bash
# Electron App (apps/x)
cd apps/x && pnpm install          # Install dependencies
cd apps/x && npm run deps          # Build workspace packages (shared → core → preload)
cd apps/x && npm run dev           # Development mode (builds deps, runs app)
cd apps/x && npm run lint          # Lint check
cd apps/x/apps/main && npm run package   # Production build (.app)
cd apps/x/apps/main && npm run make      # Create DMG distributable
```

## Monorepo Structure

```
rowboat/
├── apps/
│   ├── x/                 # Electron desktop app (focus of this doc)
│   ├── rowboat/           # Next.js web dashboard
│   ├── rowboatx/          # Next.js frontend
│   ├── cli/               # CLI tool
│   ├── python-sdk/        # Python SDK
│   └── docs/              # Documentation site
├── CLAUDE.md              # This file
└── README.md              # User-facing readme
```

## Electron App Architecture (`apps/x`)

The Electron app is a **nested pnpm workspace** with its own package management.

```
apps/x/
├── package.json           # Workspace root, dev scripts
├── pnpm-workspace.yaml    # Defines workspace packages
├── pnpm-lock.yaml         # Lockfile
├── apps/
│   ├── main/              # Electron main process
│   │   ├── src/           # Main process source
│   │   ├── forge.config.cjs   # Electron Forge config
│   │   └── bundle.mjs     # esbuild bundler
│   ├── renderer/          # React UI (Vite)
│   │   ├── src/           # React components
│   │   └── vite.config.ts
│   └── preload/           # Electron preload scripts
│       └── src/
└── packages/
    ├── shared/            # @x/shared - Types, utilities, validators
    └── core/              # @x/core - Business logic, AI, OAuth, MCP
```

### Build Order (Dependencies)

```
shared (no deps)
   ↓
core (depends on shared)
   ↓
preload (depends on shared)
   ↓
renderer (depends on shared)
main (depends on shared, core)
```

**The `npm run deps` command builds:** shared → core → preload

### Key Entry Points

| Component | Entry | Output |
|-----------|-------|--------|
| main | `apps/main/src/main.ts` | `.package/dist/main.cjs` |
| renderer | `apps/renderer/src/main.tsx` | `apps/renderer/dist/` |
| preload | `apps/preload/src/preload.ts` | `apps/preload/dist/preload.js` |

## Build System

- **Package manager:** pnpm (required for `workspace:*` protocol)
- **Main bundler:** esbuild (bundles to single CommonJS file)
- **Renderer bundler:** Vite
- **Packaging:** Electron Forge
- **TypeScript:** ES2022 target

### Why esbuild bundling?

pnpm uses symlinks for workspace packages. Electron Forge's dependency walker can't follow these symlinks. esbuild bundles everything into a single file, eliminating the need for node_modules in the packaged app.

## Key Files Reference

| Purpose | File |
|---------|------|
| Electron main entry | `apps/x/apps/main/src/main.ts` |
| React app entry | `apps/x/apps/renderer/src/main.tsx` |
| Forge config (packaging) | `apps/x/apps/main/forge.config.cjs` |
| Main process bundler | `apps/x/apps/main/bundle.mjs` |
| Vite config | `apps/x/apps/renderer/vite.config.ts` |
| Shared types | `apps/x/packages/shared/src/` |
| Core business logic | `apps/x/packages/core/src/` |
| Workspace config | `apps/x/pnpm-workspace.yaml` |
| Root scripts | `apps/x/package.json` |

## Common Tasks

### LLM configuration (single provider)
- Config file: `~/.rowboat/config/models.json`
- Schema: `{ provider: { flavor, apiKey?, baseURL?, headers? }, model: string }`
- Models catalog cache: `~/.rowboat/config/models.dev.json` (OpenAI/Anthropic/Google only)

### Add a new shared type
1. Edit `apps/x/packages/shared/src/`
2. Run `cd apps/x && npm run deps` to rebuild

### Modify main process
1. Edit `apps/x/apps/main/src/`
2. Restart dev server (main doesn't hot-reload)

### Modify renderer (React UI)
1. Edit `apps/x/apps/renderer/src/`
2. Changes hot-reload automatically in dev mode

### Add a new dependency to main
1. `cd apps/x/apps/main && pnpm add <package>`
2. Import in source - esbuild will bundle it

### Verify compilation
```bash
cd apps/x && npm run deps && npm run lint
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop | Electron 39.x |
| UI | React 19, Vite 7 |
| Styling | TailwindCSS, Radix UI |
| State | React hooks |
| AI | Vercel AI SDK, OpenAI/Anthropic/Google/OpenRouter providers, Vercel AI Gateway, Ollama, models.dev catalog |
| IPC | Electron contextBridge |
| Build | TypeScript 5.9, esbuild, Electron Forge |

## Environment Variables (for packaging)

For production builds with code signing:
- `APPLE_ID` - Apple Developer ID
- `APPLE_PASSWORD` - App-specific password
- `APPLE_TEAM_ID` - Team ID

Not required for local development.
