import { useEffect, useRef } from 'react'
import type { MiniApp, MiniAppOutboundMessage } from '@/mini-apps/types'
import { MINI_APP_MESSAGE } from '@/mini-apps/types'

// Host side of the Mini App bridge. Renders the app's self-contained HTML in a
// sandboxed iframe and answers the postMessage protocol in mini-apps/types.ts.
//
// Phase 1: data is delivered from the static app.data, per-app state lives in
// memory only, and callAction is stubbed (returns a friendly demo result). Later
// phases replace the action/state handlers with real IPC to the agent + Composio.

// Sandbox intentionally omits allow-same-origin: the app gets an opaque origin so
// it cannot reach host cookies/storage. The bridge is the only channel out.
const SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads'

// Phase 1 stub: pretend the Composio action succeeded.
function stubActionResult(action: string): { message: string } {
  switch (action) {
    case 'repost': return { message: 'Reposted (demo)' }
    case 'reply': return { message: 'Reply sent (demo)' }
    case 'mark_read': return { message: 'Dismissed' }
    default: return { message: action + ' done (demo)' }
  }
}

export function MiniAppFrame({ app }: { app: MiniApp }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  // In-memory per-app state for Phase 1 (resets when the frame unmounts).
  const stateRef = useRef<Record<string, unknown>>({})

  useEffect(() => {
    // Reset state when switching apps.
    stateRef.current = {}

    function postToFrame(message: unknown) {
      iframeRef.current?.contentWindow?.postMessage(message, '*')
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
        case MINI_APP_MESSAGE.action: {
          // Phase 1: stubbed. (Phase 2 enforces app.scope and calls Composio.)
          const allowed = app.scope.includes(msg.scope)
          if (!allowed) {
            postToFrame({
              type: MINI_APP_MESSAGE.actionResult,
              id: msg.id,
              ok: false,
              error: 'Action scope "' + msg.scope + '" not granted to this app',
            })
            break
          }
          // Small delay so the UI's busy state is visible.
          window.setTimeout(() => {
            postToFrame({
              type: MINI_APP_MESSAGE.actionResult,
              id: msg.id,
              ok: true,
              result: stubActionResult(msg.action),
            })
          }, 350)
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
