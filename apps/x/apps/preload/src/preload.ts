import { contextBridge, ipcRenderer } from 'electron';
import { ipc as ipcShared } from '@x/shared';

type InvokeChannels = ipcShared.InvokeChannels;
type IPCChannels = ipcShared.IPCChannels;
type SendChannels = ipcShared.SendChannels;
const { validateRequest } = ipcShared;

const ipc = {
  /**
   * Invoke a channel that expects a response (request/response pattern)
   * Only channels with non-null responses can be invoked
   */
  invoke<K extends InvokeChannels>(
    channel: K,
    args: IPCChannels[K]['req']
  ): Promise<IPCChannels[K]['res']> {
    // Runtime validation of request payload
    const validatedArgs = validateRequest(channel, args);
    return ipcRenderer.invoke(channel, validatedArgs);
  },

  /**
   * Send a message to a channel without expecting a response (fire-and-forget)
   * Only channels with null responses can be sent
   */
  send<K extends SendChannels>(
    channel: K,
    args: IPCChannels[K]['req']
  ): void {
    // Runtime validation of request payload
    const validatedArgs = validateRequest(channel, args);
    ipcRenderer.send(channel, validatedArgs);
  },

  /**
   * Listen to a send channel event
   * Returns a cleanup function to remove the listener
   */
  on<K extends SendChannels>(
    channel: K,
    handler: (event: IPCChannels[K]['req']) => void
  ): () => void {
    const listener = (_event: unknown, data: IPCChannels[K]['req']) => {
      handler(data);
    };
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
};

contextBridge.exposeInMainWorld('ipc', ipc);