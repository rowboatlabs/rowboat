// In-process buses for connector state pushes (oauth:didConnect,
// composio:didConnect, chatgpt:statusChanged). Hosts fan these out to their
// clients: Electron main → webContents.send, rowboat-server → WS hub.

export type OAuthConnectEvent = { provider: string; success: boolean; error?: string; userId?: string };
export type ComposioConnectEvent = { toolkitSlug: string; success: boolean; error?: string };
export type ChatGPTStatusEvent = { signedIn: boolean };

function makeBus<T>() {
  const listeners = new Set<(e: T) => void>();
  return {
    subscribe(listener: (e: T) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish(event: T): void {
      for (const l of listeners) l(event);
    },
  };
}

export const oauthConnectBus = makeBus<OAuthConnectEvent>();
export const composioConnectBus = makeBus<ComposioConnectEvent>();
export const chatgptStatusBus = makeBus<ChatGPTStatusEvent>();
