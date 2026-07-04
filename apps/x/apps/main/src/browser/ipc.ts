import { BrowserWindow } from 'electron';
import { ipc } from '@x/shared';
import { browserViewManager, type BrowserState, type HttpAuthRequest } from './view.js';

type IPCChannels = ipc.IPCChannels;

type InvokeHandler<K extends keyof IPCChannels> = (
  event: Electron.IpcMainInvokeEvent,
  args: IPCChannels[K]['req'],
) => IPCChannels[K]['res'] | Promise<IPCChannels[K]['res']>;

type BrowserHandlers = {
  'browser:setBounds': InvokeHandler<'browser:setBounds'>;
  'browser:setVisible': InvokeHandler<'browser:setVisible'>;
  'browser:newTab': InvokeHandler<'browser:newTab'>;
  'browser:switchTab': InvokeHandler<'browser:switchTab'>;
  'browser:closeTab': InvokeHandler<'browser:closeTab'>;
  'browser:navigate': InvokeHandler<'browser:navigate'>;
  'browser:back': InvokeHandler<'browser:back'>;
  'browser:forward': InvokeHandler<'browser:forward'>;
  'browser:reload': InvokeHandler<'browser:reload'>;
  'browser:getState': InvokeHandler<'browser:getState'>;
  'browser:httpAuthResponse': InvokeHandler<'browser:httpAuthResponse'>;
};

/**
 * Browser-specific IPC handlers, exported as a plain object so they can be
 * spread into the main `registerIpcHandlers({...})` call in ipc.ts. This
 * mirrors the convention of keeping feature handlers flat and namespaced by
 * channel prefix (`browser:*`).
 */
export const browserIpcHandlers: BrowserHandlers = {
  'browser:setBounds': async (_event, args) => {
    browserViewManager.setBounds(args);
    return { ok: true };
  },
  'browser:setVisible': async (_event, args) => {
    browserViewManager.setVisible(args.visible);
    return { ok: true };
  },
  'browser:newTab': async (_event, args) => {
    return browserViewManager.newTab(args.url);
  },
  'browser:switchTab': async (_event, args) => {
    return browserViewManager.switchTab(args.tabId);
  },
  'browser:closeTab': async (_event, args) => {
    return browserViewManager.closeTab(args.tabId);
  },
  'browser:navigate': async (_event, args) => {
    return browserViewManager.navigate(args.url);
  },
  'browser:back': async () => {
    return browserViewManager.back();
  },
  'browser:forward': async () => {
    return browserViewManager.forward();
  },
  'browser:reload': async () => {
    browserViewManager.reload();
    return { ok: true };
  },
  'browser:getState': async () => {
    return browserViewManager.getState();
  },
  'browser:httpAuthResponse': async (_event, args) => {
    return browserViewManager.respondToHttpAuth(args);
  },
};

/**
 * Wire the BrowserViewManager's state-updated event to all renderer windows
 * as a `browser:didUpdateState` push. Must be called once after the main
 * window is created so the manager has a window to attach to.
 */
export function setupBrowserEventForwarding(): void {
  // Only send to app windows, never to OAuth/SSO popup windows created by
  // page window.open() — those render untrusted web content, and browsing
  // state / auth-challenge metadata must not cross into them.
  const broadcast = (channel: string, payload: unknown) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed() || !win.webContents) continue;
      if (browserViewManager.isPopupWindow(win)) continue;
      win.webContents.send(channel, payload);
    }
  };

  browserViewManager.on('state-updated', (state: BrowserState) => {
    broadcast('browser:didUpdateState', state);
  });

  browserViewManager.on('http-auth-request', (request: HttpAuthRequest) => {
    broadcast('browser:httpAuthRequest', request);
  });

  browserViewManager.on('http-auth-resolved', (requestId: string) => {
    broadcast('browser:httpAuthResolved', { requestId });
  });
}
