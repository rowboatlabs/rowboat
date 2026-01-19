# Electron Main Process - Build & Packaging

## Overview
This is the Electron main process for the Rowboat app.

## Why We Use esbuild Bundling

**Problem**: pnpm uses symlinks for workspace packages (`@x/core`, `@x/shared`). 
Electron Forge's dependency walker (`flora-colossus`) cannot follow these symlinks, 
causing "Failed to locate module" errors during packaging. Note: npm workspaces 
also use symlinks, so this isn't pnpm-specific.

**Solution**: Bundle the entire main process into a single JS file using esbuild. 
This inlines all dependencies (except `electron` itself), eliminating the need 
for `node_modules` at runtime.

## Bundle Configuration (`bundle.mjs`)

The bundler uses these key settings:

- **Format: CommonJS** - Many dependencies use `require()` which doesn't work 
  with esbuild's ESM shim. CJS handles dynamic requires natively.
  
- **import.meta.url polyfill** - The source code uses ESM's `import.meta.url` 
  to derive `__dirname`, but CJS doesn't have `import.meta`. We solve this with:
  - `banner`: Injects `var __import_meta_url = require('url').pathToFileURL(__filename).href;`
  - `define`: Replaces all `import.meta.url` with `__import_meta_url`

- **External: electron** - Not bundled; provided by Electron runtime.

## Build Process

The build uses two Forge hooks in `forge.config.cjs`:

### 1. `generateAssets` Hook (Pre-packaging)
Prepares all build artifacts in a hidden `.package/` staging directory:
- Builds shared, renderer, preload, and main TypeScript
- Bundles main process with esbuild → `.package/dist-bundle/main.js`
- Copies preload/renderer dist to `.package/`

### 2. `packageAfterCopy` Hook (Post-copy)
After Forge copies source to output, this hook replaces source files with bundled/staged files:
- **Hook signature**: `async (config, buildPath, electronVersion, platform, arch)`
  - `buildPath` already points to `Contents/Resources/app` (not the `.app` bundle root)
- Removes unbundled `dist/` directory (has unresolvable `@x/core` imports)
- Copies bundled `dist-bundle/` from `.package/` staging directory
- Copies `preload/` and `renderer/` directories from staging
- Updates `package.json`: sets `main` to `dist-bundle/main.js`, removes 
  `"type": "module"` (since we bundle as CJS), removes all dependencies/devDependencies
- Cleans up source files (src/, tsconfig.json, forge.config.cjs, agents.md, .gitignore, bundle.mjs)

**Why this approach?** Electron Forge ignores `packagerConfig.dir` and always 
packages from the config file's directory. The `packageAfterCopy` hook is the 
reliable way to customize the packaged output by modifying files after Forge 
copies the source directory but before the app bundle is finalized.

## Staged Build Directory (`.package/`)

- **Why not copy into apps/main directly?** Would pollute source with build artifacts
- **Why .cjs extension for forge.config?** package.json has `"type": "module"`, 
  but Forge loads configs with `require()`. The `.cjs` extension forces CommonJS.
- **Why hidden (`.` prefix)?** Prevents accidental conflicts with developer-created dirs

## Development vs Production Paths

| Mode | main.js location | preload path | renderer path |
|------|------------------|--------------|---------------|
| Dev  | `dist/main.js` | `../../preload/dist/` | `../../renderer/dist/` |
| Prod | `dist-bundle/main.js` | `../preload/dist/` | `../renderer/dist/` |

Code uses `app.isPackaged` to select the correct paths at runtime.

## Build Commands

- `npm run start` - Development (runs from dist/, uses Vite dev server)
- `npm run package` - Creates .app bundle in `out/`
- `npm run make` - Creates DMG/ZIP in `out/make/`

## Troubleshooting

If the packaged app fails with module errors:
1. **Clean build**: `rm -rf out .package && npm run make`
2. **Reinstall fresh**: Delete `/Applications/Rowboat.app` before installing DMG
3. **Clear caches**: `rm -rf ~/Library/Caches/com.rowboat.app`
