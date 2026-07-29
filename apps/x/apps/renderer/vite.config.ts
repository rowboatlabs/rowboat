import path from "path"
import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * pptx-react-viewer lazily imports an AI chat panel built against `ai` v6 and
 * `@ai-sdk/react` (both optional peers we don't install — the app is on `ai`
 * v5, and PptxFileViewer never passes the viewer's `ai` prop, so the panel is
 * unreachable at runtime). Rollup and the dev-mode dependency optimizer still
 * walk the chunk and fail on the v6-only exports it imports, so replace it
 * with a stub in both.
 */
const PPTX_AI_CHAT_PANEL = /[\\/]pptx-react-viewer[\\/]dist[\\/]AiChatPanel-[^\\/]*\.mjs$/
const PPTX_AI_CHAT_PANEL_STUB = 'export default function AiChatPanel() { return null }'

function stubPptxAiChatPanel(): Plugin {
  return {
    name: 'stub-pptx-ai-chat-panel',
    enforce: 'pre',
    load(id) {
      return PPTX_AI_CHAT_PANEL.test(id) ? PPTX_AI_CHAT_PANEL_STUB : null
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',  // Use relative paths for assets (required for Electron custom protocol)
  plugins: [
    react(),
    tailwindcss(),
    stubPptxAiChatPanel(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      plugins: [
        {
          name: 'stub-pptx-ai-chat-panel',
          setup(build) {
            build.onLoad({ filter: PPTX_AI_CHAT_PANEL }, () => ({
              contents: PPTX_AI_CHAT_PANEL_STUB,
              loader: 'js',
            }))
          },
        },
      ],
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
