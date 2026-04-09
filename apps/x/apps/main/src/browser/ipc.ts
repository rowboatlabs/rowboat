import { BrowserWindow } from 'electron';
import { ipc } from '@x/shared';
import { browserViewManager, type BrowserState } from './view.js';

type IPCChannels = ipc.IPCChannels;

type InvokeHandler<K extends keyof IPCChannels> = (
  event: Electron.IpcMainInvokeEvent,
  args: IPCChannels[K]['req'],
) => IPCChannels[K]['res'] | Promise<IPCChannels[K]['res']>;

type BrowserHandlers = {
  'browser:setBounds': InvokeHandler<'browser:setBounds'>;
  'browser:setVisible': InvokeHandler<'browser:setVisible'>;
  'browser:navigate': InvokeHandler<'browser:navigate'>;
  'browser:back': InvokeHandler<'browser:back'>;
  'browser:forward': InvokeHandler<'browser:forward'>;
  'browser:reload': InvokeHandler<'browser:reload'>;
  'browser:getState': InvokeHandler<'browser:getState'>;
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
};

/**
 * Wire the BrowserViewManager's state-updated event to all renderer windows
 * as a `browser:didUpdateState` push. Must be called once after the main
 * window is created so the manager has a window to attach to.
 */
export function setupBrowserEventForwarding(): void {
  browserViewManager.on('state-updated', (state: BrowserState) => {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed() && win.webContents) {
        win.webContents.send('browser:didUpdateState', state);
      }
    }
  });
}
