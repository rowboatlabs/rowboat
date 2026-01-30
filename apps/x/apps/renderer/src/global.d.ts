import { ipc } from '@x/shared';
type InvokeChannels = ipc.InvokeChannels;
type SendChannels = ipc.SendChannels;
type IPCChannels = ipc.IPCChannels;

declare global {
  interface Window {
    ipc: {
      /**
       * Invoke a channel that expects a response (request/response pattern)
       * Only channels with non-null responses can be invoked
       */
      invoke<K extends InvokeChannels>(
        channel: K,
        args: IPCChannels[K]['req']
      ): Promise<IPCChannels[K]['res']>;
      
      /**
       * Send a message to a channel without expecting a response (fire-and-forget)
       * Only channels with null responses can be sent
       */
      send<K extends SendChannels>(
        channel: K,
        args: IPCChannels[K]['req']
      ): void;
      
      /**
       * Listen to a send channel event
       * Returns a cleanup function to remove the listener
       */
      on<K extends SendChannels>(
        channel: K,
        handler: (event: IPCChannels[K]['req']) => void
      ): () => void;
    };
    electronUtils: {
      getPathForFile: (file: File) => string;
    };
  }
}

export { };