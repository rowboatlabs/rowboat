import path from 'path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { excalidrawAssets } from './vite.config'

// The Spaces web app (2026-10-09): the same renderer source, a second entry
// (web.html → src/web/main.tsx) served from a domain instead of app://. So:
// absolute asset paths (deep links like /acme/s/<id> must find /assets/…),
// its own output directory, and every navigation answered with web.html —
// the dev server here, the host's rewrite in production (vercel.json).

const OUT_DIR = 'dist-web'

function spaFallback(): Plugin {
  return {
    name: 'web-spa-fallback',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? ''
        if (req.method === 'GET' && req.headers.accept?.includes('text/html') && !url.startsWith('/@') && !url.startsWith('/web.html')) {
          req.url = '/web.html'
        }
        next()
      })
    },
  }
}

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss(), excalidrawAssets(OUT_DIR), spaFallback()],
  resolve: {
    // Linked workspace dependencies must share the renderer's React instance.
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Its own static files: the theme script and the icon, not the desktop's public/.
  publicDir: 'web-public',
  server: { port: 5174, strictPort: true },
  preview: { port: 5174, strictPort: true },
  build: {
    outDir: OUT_DIR,
    rollupOptions: { input: { web: path.resolve(__dirname, 'web.html') } },
  },
})
