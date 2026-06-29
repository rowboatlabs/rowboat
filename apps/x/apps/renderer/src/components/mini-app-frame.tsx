import { useEffect, useRef } from 'react'
import type { MiniApp, MiniAppOutboundMessage } from '@/mini-apps/types'
import { MINI_APP_MESSAGE } from '@/mini-apps/types'

// Host side of the Mini App bridge. Renders the app's self-contained HTML in a
// sandboxed iframe and answers the postMessage protocol in mini-apps/types.ts.
//
// Phase 2: the bridge is real. App rpc calls (callAction/searchTools/
// isConnected/connect) are scope-checked against the app's declared scope and
// routed to Composio over IPC. Per-app state is still in-memory for now.

// Sandbox intentionally omits allow-same-origin: the app gets an opaque origin so
// it cannot reach host cookies/storage. The bridge is the only channel out.
const SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads'

export function MiniAppFrame({ app }: { app: MiniApp }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  // In-memory per-app state for Phase 1/2 (resets when the frame unmounts).
  const stateRef = useRef<Record<string, unknown>>({})

  useEffect(() => {
    stateRef.current = {}

    function postToFrame(message: unknown) {
      iframeRef.current?.contentWindow?.postMessage(message, '*')
    }

    // Dispatch an app rpc call to real Composio IPC. Throws on scope violation
    // or failure; the caller turns that into an rpc-result error.
    async function handleRpc(method: string, params: Record<string, unknown>): Promise<unknown> {
      const scope = typeof params.scope === 'string' ? params.scope : ''
      if (!scope || !app.scope.includes(scope)) {
        throw new Error(`This app is not allowed to use "${scope || '(none)'}".`)
      }
      switch (method) {
        case 'isConnected': {
          const r = await window.ipc.invoke('composio:get-connection-status', { toolkitSlug: scope })
          return r.isConnected
        }
        case 'connect': {
          const r = await window.ipc.invoke('composio:initiate-connection', { toolkitSlug: scope })
          if (!r.success && r.error) throw new Error(r.error)
          return { started: r.success }
        }
        case 'searchTools': {
          const query = typeof params.query === 'string' ? params.query : ''
          const r = await window.ipc.invoke('composio:search-tools', { toolkitSlug: scope, query })
          if (r.error) throw new Error(r.error)
          return r.tools
        }
        case 'callAction': {
          const tool = typeof params.tool === 'string' ? params.tool : ''
          if (!tool) throw new Error('No tool specified.')
          const args = (params.args && typeof params.args === 'object' ? params.args : {}) as Record<string, unknown>
          const r = await window.ipc.invoke('composio:execute-tool', { toolkitSlug: scope, toolSlug: tool, arguments: args })
          if (!r.successful) throw new Error(r.error || 'Action failed.')
          return r.data
        }
        default:
          throw new Error(`Unknown bridge method "${method}".`)
      }
    }

    function handleMessage(event: MessageEvent) {
      const frameWindow = iframeRef.current?.contentWindow
      if (!frameWindow || event.source !== frameWindow) return

      const msg = event.data as MiniAppOutboundMessage
      if (!msg || typeof msg !== 'object') return

      switch (msg.type) {
        case MINI_APP_MESSAGE.ready: {
          postToFrame({ type: MINI_APP_MESSAGE.data, data: app.data })
          postToFrame({ type: MINI_APP_MESSAGE.state, state: stateRef.current })
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
  }, [app])

  return (
    <iframe
      ref={iframeRef}
      title={app.name}
      srcDoc={app.html}
      className="h-full w-full border-0 bg-neutral-950"
      sandbox={SANDBOX}
    />
  )
}
