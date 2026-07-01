// Mini Apps — shared types and the host <-> iframe bridge protocol.
//
// Phase 1 is UI-only: apps are hardcoded in the renderer (see registry.ts) and
// rendered in a sandboxed iframe (see components/mini-app-frame.tsx). The shapes
// here intentionally mirror the eventual on-disk model (one self-contained folder
// per app under ~/.rowboat/apps/<id>/) so later phases can slot in without a
// rewrite.

/** A single Mini App. */
export type MiniApp = {
  /** Stable slug; also the eventual on-disk folder name. The card's accent
   *  theme and decorative pattern are derived deterministically from this. */
  id: string
  /** Display name shown on the card and in the open view. */
  name: string
  /** One-line description for the card (clamped to 2 lines). */
  description: string
  /** Primary integration shown in the card footer pill (e.g. 'Twitter'). */
  source: string
  /** Whether the app's agent is currently active (drives the status badge). */
  active: boolean
  /** Human last-run label for the card footer (e.g. '2m ago'). Static in V1. */
  lastRun: string
  /**
   * Composio integration scope this app is allowed to touch. Drives bridge
   * enforcement and the auth prompt in later phases; informational in Phase 1.
   */
  scope: string[]
  /**
   * The app's frontend: a single self-contained HTML document (React + Tailwind
   * + Babel via CDN). Rendered via the iframe `srcdoc` attribute.
   */
  html: string
  /**
   * The latest agent "backend" output. Static in Phase 1; produced by the agent
   * on a trigger in later phases. Delivered to the iframe via the bridge.
   */
  data: unknown
}

// ---------------------------------------------------------------------------
// Bridge protocol (host <-> iframe via postMessage).
//
// The app code inside the iframe talks to a small `window.rowboat` shim (injected
// as part of the app HTML) which speaks these messages. This is both the product
// surface the app codes against and the security boundary.
// ---------------------------------------------------------------------------

/**
 * Host RPC methods the app can call (all scope-checked against the app's
 * declared integration scope by the host before they run):
 * - callAction:  execute a Composio tool by slug   params: { scope, tool, args? }
 * - searchTools: find tool slugs within a toolkit   params: { scope, query }
 * - isConnected: is the toolkit connected?          params: { scope }
 * - connect:     trigger the Composio OAuth flow     params: { scope }
 */
export type MiniAppRpcMethod = 'callAction' | 'searchTools' | 'isConnected' | 'connect' | 'fetch'

/** Messages sent from the iframe (app) up to the host (renderer). */
export type MiniAppOutboundMessage =
  /** Handshake: app is mounted and wants its initial data + state. */
  | { type: 'rowboat:mini-app:ready' }
  /** A request/response call into the host, correlated by id. */
  | { type: 'rowboat:mini-app:rpc'; id: string; method: MiniAppRpcMethod; params?: unknown }
  /** App wants to persist a patch to its per-app state store. */
  | { type: 'rowboat:mini-app:setState'; patch: unknown }

/** Messages sent from the host (renderer) down to the iframe (app). */
export type MiniAppInboundMessage =
  /** Latest agent data; sent on ready and whenever data refreshes. */
  | { type: 'rowboat:mini-app:data'; data: unknown }
  /** Current per-app state; sent on ready and after setState. */
  | { type: 'rowboat:mini-app:state'; state: unknown }
  /** Host theme; sent on ready and whenever the app theme changes. */
  | { type: 'rowboat:mini-app:theme'; theme: 'light' | 'dark' }
  /** Result of a previously requested rpc call, correlated by id. */
  | { type: 'rowboat:mini-app:rpc-result'; id: string; ok: boolean; result?: unknown; error?: string }

export const MINI_APP_MESSAGE = {
  ready: 'rowboat:mini-app:ready',
  rpc: 'rowboat:mini-app:rpc',
  setState: 'rowboat:mini-app:setState',
  data: 'rowboat:mini-app:data',
  state: 'rowboat:mini-app:state',
  theme: 'rowboat:mini-app:theme',
  rpcResult: 'rowboat:mini-app:rpc-result',
} as const
