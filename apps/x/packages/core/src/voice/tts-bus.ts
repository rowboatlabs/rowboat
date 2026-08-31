// TTS chunk fan-out: the synthesize-stream handler publishes base64 MP3
// chunks here; Electron main relays them to windows, the WS hub to network
// clients. Renderers filter by requestId.

export type TtsChunkEvent = {
  requestId: string;
  chunkBase64?: string;
  done: boolean;
  error?: string;
};

const listeners = new Set<(e: TtsChunkEvent) => void>();
export function subscribeTtsChunks(listener: (e: TtsChunkEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function publishTtsChunk(event: TtsChunkEvent): void {
  for (const l of listeners) l(event);
}
