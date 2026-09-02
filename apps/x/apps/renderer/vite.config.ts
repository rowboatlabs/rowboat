import fs from "node:fs"
import path from "path"
import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Excalidraw resolves its fonts from window.EXCALIDRAW_ASSET_PATH (set to
// './excalidraw-assets/' by the whiteboard pane); unset it falls back to a
// CDN — broken offline and wrong for a desktop app. This plugin self-hosts:
// dev serves the fonts straight out of node_modules, build copies them into
// dist so the packaged app:// origin carries them.
function excalidrawAssets(): Plugin {
  const fontsSrc = path.resolve(__dirname, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts')
  const prefix = '/excalidraw-assets/'
  return {
    name: 'excalidraw-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0]
        if (!url.startsWith(`${prefix}fonts/`)) return next()
        const rel = path.normalize(decodeURIComponent(url.slice(`${prefix}fonts/`.length)))
        const file = path.join(fontsSrc, rel)
        if (rel.startsWith('..') || !file.startsWith(fontsSrc) || !fs.existsSync(file)) return next()
        res.setHeader('content-type', file.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream')
        fs.createReadStream(file).pipe(res)
      })
    },
    closeBundle() {
      const outDir = path.resolve(__dirname, 'dist/excalidraw-assets/fonts')
      if (fs.existsSync(fontsSrc)) fs.cpSync(fontsSrc, outDir, { recursive: true })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',  // Use relative paths for assets (required for Electron custom protocol)
  plugins: [
    react(),
    tailwindcss(),
    excalidrawAssets(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: 'dist',
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
})
