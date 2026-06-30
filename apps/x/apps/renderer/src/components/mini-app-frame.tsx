import { useEffect, useRef } from 'react'
import { miniApp } from '@x/shared'
import type { MiniAppOutboundMessage } from '@/mini-apps/types'
import { MINI_APP_MESSAGE } from '@/mini-apps/types'

// Host side of the Mini App bridge. Loads the app's static assets from
// app://miniapp/<id>/ (served from ~/.rowboat/apps/<id>/dist) and answers the
// postMessage protocol in mini-apps/types.ts.
//
// - data: sourced from the app's on-disk data.json (agent output) via IPC.
// - bridge rpc (callAction/searchTools/isConnected/connect): scope-checked
//   against the manifest, routed to Composio over IPC.

// app://miniapp/<id> is a distinct origin from the renderer, so allow-same-origin
// here grants the app same-origin to its OWN origin only (lets it use fetch /
// remote assets) while staying isolated from the renderer.
const SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads'

export function MiniAppFrame({ manifest }: { manifest: miniApp.MiniAppManifest }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const stateRef = useRef<Record<string, unknown>>({})
  const scope = manifest.scope

  useEffect(() => {
    stateRef.current = {}

    function postToFrame(message: unknown) {
      iframeRef.current?.contentWindow?.postMessage(message, '*')
    }

    async function handleRpc(method: string, params: Record<string, unknown>): Promise<unknown> {
      const s = typeof params.scope === 'string' ? params.scope : ''
      if (!s || !scope.includes(s)) {
        throw new Error(`This app is not allowed to use "${s || '(none)'}".`)
      }
      switch (method) {
        case 'isConnected': {
          const r = await window.ipc.invoke('composio:get-connection-status', { toolkitSlug: s })
          return r.isConnected
        }
        case 'connect': {
          const r = await window.ipc.invoke('composio:initiate-connection', { toolkitSlug: s })
          if (!r.success && r.error) throw new Error(r.error)
          return { started: r.success }
        }
        case 'searchTools': {
          const query = typeof params.query === 'string' ? params.query : ''
          const r = await window.ipc.invoke('composio:search-tools', { toolkitSlug: s, query })
          if (r.error) throw new Error(r.error)
          return r.tools
        }
        case 'callAction': {
          const tool = typeof params.tool === 'string' ? params.tool : ''
          if (!tool) throw new Error('No tool specified.')
          const args = (params.args && typeof params.args === 'object' ? params.args : {}) as Record<string, unknown>
          const r = await window.ipc.invoke('composio:execute-tool', { toolkitSlug: s, toolSlug: tool, arguments: args })
          if (!r.successful) throw new Error(r.error || 'Action failed.')
          return r.data
        }
        default:
          throw new Error(`Unknown bridge method "${method}".`)
      }
    }

    async function handleReady() {
      let data: unknown = null
      try {
        const r = await window.ipc.invoke('mini-apps:get-data', { id: manifest.id })
        data = r.data
      } catch {
        data = null
      }
      postToFrame({ type: MINI_APP_MESSAGE.data, data })
      postToFrame({ type: MINI_APP_MESSAGE.state, state: stateRef.current })
    }

    function handleMessage(event: MessageEvent) {
      const frameWindow = iframeRef.current?.contentWindow
      if (!frameWindow || event.source !== frameWindow) return

      const msg = event.data as MiniAppOutboundMessage
      if (!msg || typeof msg !== 'object') return

      switch (msg.type) {
        case MINI_APP_MESSAGE.ready: {
          void handleReady()
          break
        }
        case MINI_APP_MESSAGE.rpc: {
          const { id, method, params } = msg
          handleRpc(method, (params ?? {}) as Record<string, unknown>)
            .then((result) => postToFrame({ type: MINI_APP_MESSAGE.rpcResult, id, ok: true, result }))
            .catch((err) => postToFrame({
              type: MINI_APP_MESSAGE.rpcResult,
              id,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            }))
          break
        }
        case MINI_APP_MESSAGE.setState: {
          stateRef.current = { ...stateRef.current, ...(msg.patch as Record<string, unknown>) }
          postToFrame({ type: MINI_APP_MESSAGE.state, state: stateRef.current })
          break
        }
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [manifest.id, scope])

  return (
    <iframe
      ref={iframeRef}
      title={manifest.title}
      src={`app://miniapp/${manifest.id}/index.html`}
      className="h-full w-full border-0 bg-neutral-950"
      sandbox={SANDBOX}
    />
  )
}
