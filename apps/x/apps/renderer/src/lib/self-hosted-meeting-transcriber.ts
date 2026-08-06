import type { IPCChannels } from '@x/shared/dist/ipc';

type FeedResponse = IPCChannels['meeting:selfHostedTranscriptionFeed']['res'];
export type SelfHostedTranscriptSnapshot = FeedResponse['updates'][number];

export type CanonicalTranscriptUpdate = {
  channelIndex: 0 | 1;
  text: string;
  isFinal: boolean;
};

export interface SelfHostedMeetingTransport {
  begin(): Promise<{ connectionId: string }>;
  feed(connectionId: string, pcmBase64: string): Promise<FeedResponse>;
  finalize(connectionId: string): Promise<FeedResponse>;
  reset(connectionId: string): Promise<void>;
}

const MAX_QUEUED_PCM_BYTES = 5 * 16_000 * 2 * 2;

function pcmToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export class SelfHostedSnapshotAssembler {
  private committed: [string, string] = ['', ''];
  private revisions: [number, number] = [-1, -1];

  apply(snapshot: SelfHostedTranscriptSnapshot): CanonicalTranscriptUpdate[] {
    const channel = snapshot.channelIndex;
    if (snapshot.revision < this.revisions[channel]) {
      throw new Error('Self-hosted transcription revision moved backwards');
    }
    this.revisions[channel] = snapshot.revision;

    const previous = this.committed[channel];
    if (!snapshot.committed.startsWith(previous)) {
      throw new Error('Self-hosted transcription changed already committed text');
    }
    const updates: CanonicalTranscriptUpdate[] = [];
    const committedDelta = snapshot.committed.slice(previous.length);
    if (committedDelta.trim()) {
      updates.push({ channelIndex: channel, text: committedDelta, isFinal: true });
    }
    this.committed[channel] = snapshot.committed;

    const tentative = snapshot.tentative.trim();
    updates.push({ channelIndex: channel, text: tentative, isFinal: false });
    return updates;
  }
}

export class SelfHostedMeetingTranscriber {
  private connectionId: string | null = null;
  private accepting = true;
  private failed: Error | null = null;
  private queuedBytes = 0;
  private tail: Promise<void> = Promise.resolve();
  private readonly assembler = new SelfHostedSnapshotAssembler();
  private readonly transport: SelfHostedMeetingTransport;
  private readonly onTranscript: (update: CanonicalTranscriptUpdate) => void;
  private readonly onFatal: (error: Error) => void;

  constructor(
    transport: SelfHostedMeetingTransport,
    onTranscript: (update: CanonicalTranscriptUpdate) => void,
    onFatal: (error: Error) => void,
  ) {
    this.transport = transport;
    this.onTranscript = onTranscript;
    this.onFatal = onFatal;
  }

  async start(): Promise<void> {
    if (this.connectionId) throw new Error('Self-hosted transcription is already started');
    this.connectionId = (await this.transport.begin()).connectionId;
  }

  send(pcm: Int16Array): void {
    if (!this.accepting || this.failed || !this.connectionId) return;
    const byteLength = pcm.byteLength;
    if (this.queuedBytes + byteLength > MAX_QUEUED_PCM_BYTES) {
      this.fail(new Error('Self-hosted transcription fell more than five seconds behind'));
      return;
    }
    const encoded = pcmToBase64(pcm);
    const connectionId = this.connectionId;
    this.queuedBytes += byteLength;
    const operation = this.tail.then(async () => {
      if (this.failed) return;
      const response = await this.transport.feed(connectionId, encoded);
      this.apply(response);
    });
    this.tail = operation
      .catch((error: unknown) => this.fail(error))
      .finally(() => {
        this.queuedBytes -= byteLength;
      });
  }

  async finish(): Promise<void> {
    this.accepting = false;
    await this.tail;
    if (this.failed) throw this.failed;
    const connectionId = this.connectionId;
    if (!connectionId) return;
    try {
      this.apply(await this.transport.finalize(connectionId));
    } finally {
      this.connectionId = null;
    }
  }

  async cancel(): Promise<void> {
    this.accepting = false;
    const connectionId = this.connectionId;
    this.connectionId = null;
    if (!connectionId) return;
    await this.transport.reset(connectionId).catch(() => undefined);
  }

  private apply(response: FeedResponse): void {
    for (const snapshot of response.updates) {
      for (const update of this.assembler.apply(snapshot)) {
        this.onTranscript(update);
      }
    }
  }

  private fail(error: unknown): void {
    if (this.failed) return;
    this.failed = error instanceof Error ? error : new Error('Self-hosted transcription failed');
    this.accepting = false;
    const connectionId = this.connectionId;
    this.connectionId = null;
    if (connectionId) {
      void this.transport.reset(connectionId).catch(() => undefined);
    }
    this.onFatal(this.failed);
  }
}

export function createIpcSelfHostedMeetingTransport(): SelfHostedMeetingTransport {
  return {
    begin: () => window.ipc.invoke('meeting:selfHostedTranscriptionBegin', null),
    feed: (connectionId, pcmBase64) => window.ipc.invoke(
      'meeting:selfHostedTranscriptionFeed',
      { connectionId, pcmBase64 },
    ),
    finalize: (connectionId) => window.ipc.invoke(
      'meeting:selfHostedTranscriptionFinalize',
      { connectionId },
    ),
    reset: async (connectionId) => {
      await window.ipc.invoke('meeting:selfHostedTranscriptionReset', { connectionId });
    },
  };
}
