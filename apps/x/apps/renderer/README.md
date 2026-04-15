# Desktop Renderer

This package contains the React and Vite renderer for the Electron desktop app in `apps/x`.

## Responsibilities

- Render the desktop UI
- Talk to the Electron preload bridge instead of Node APIs directly
- Display workspace, chat, notes, graph, and other local-first product surfaces

## Commands

```bash
npm run dev
npm run build
npm run lint
```

Run these from `apps/x/apps/renderer` when working only on the renderer, or use `apps/x` and run `npm run dev` to launch the full desktop stack.

## Constraints

- Assume `nodeIntegration` is disabled in the renderer
- Use the preload IPC bridge for privileged operations
- Keep shared contracts in `packages/shared` when a renderer and the main process need the same schema
