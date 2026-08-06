import { describe, expect, it, vi } from 'vitest';
import {
  SelfHostedMeetingTranscriber,
  SelfHostedSnapshotAssembler,
  type SelfHostedMeetingTransport,
  type SelfHostedTranscriptSnapshot,
} from './self-hosted-meeting-transcriber';

function snapshot(
  channelIndex: 0 | 1,
  overrides: Partial<SelfHostedTranscriptSnapshot> = {},
): SelfHostedTranscriptSnapshot {
  return {
    channelIndex,
    full: '',
    committed: '',
    tentative: '',
    final: false,
    revision: 0,
    inputMs: 0,
    bufferedMs: 0,
    ...overrides,
  };
}

function emptyResponse() {
  return { updates: [snapshot(0), snapshot(1)] as [SelfHostedTranscriptSnapshot, SelfHostedTranscriptSnapshot] };
}

describe('SelfHostedSnapshotAssembler', () => {
  it('emits only new stable text and keeps tentative text replaceable', () => {
    const assembler = new SelfHostedSnapshotAssembler();
    expect(assembler.apply(snapshot(0, {
      full: 'hello wor',
      committed: 'hello',
      tentative: 'wor',
      revision: 1,
    }))).toEqual([
      { channelIndex: 0, text: 'hello', isFinal: true },
      { channelIndex: 0, text: 'wor', isFinal: false },
    ]);
    expect(assembler.apply(snapshot(0, {
      full: 'hello world',
      committed: 'hello world',
      tentative: '',
      revision: 2,
    }))).toEqual([
      { channelIndex: 0, text: ' world', isFinal: true },
      { channelIndex: 0, text: '', isFinal: false },
    ]);
  });

  it('keeps microphone and system channel revisions independent', () => {
    const assembler = new SelfHostedSnapshotAssembler();
    expect(assembler.apply(snapshot(1, {
      committed: 'remote',
      revision: 4,
    }))[0]).toEqual({ channelIndex: 1, text: 'remote', isFinal: true });
    expect(assembler.apply(snapshot(0, {
      committed: 'local',
      revision: 1,
    }))[0]).toEqual({ channelIndex: 0, text: 'local', isFinal: true });
  });

  it('preserves punctuation attachment in committed deltas', () => {
    const assembler = new SelfHostedSnapshotAssembler();
    assembler.apply(snapshot(0, { committed: 'hello', revision: 1 }));
    expect(assembler.apply(snapshot(0, { committed: 'hello, world', revision: 2 }))[0])
      .toEqual({ channelIndex: 0, text: ', world', isFinal: true });
  });

  it('exposes stable audio intervals for independent speaker evidence', () => {
    const assembler = new SelfHostedSnapshotAssembler();
    expect(assembler.apply(snapshot(1, {
      committed: 'first',
      inputMs: 3_200,
      bufferedMs: 600,
      revision: 1,
    }))[0]).toEqual({
      channelIndex: 1,
      text: 'first',
      isFinal: true,
      stableStartMs: 0,
      stableEndMs: 2_600,
    });
    expect(assembler.apply(snapshot(1, {
      committed: 'first second',
      inputMs: 4_800,
      bufferedMs: 400,
      revision: 2,
    }))[0]).toEqual({
      channelIndex: 1,
      text: ' second',
      isFinal: true,
      stableStartMs: 2_600,
      stableEndMs: 4_400,
    });
  });

  it('rejects revision rollback and committed-text mutation', () => {
    const assembler = new SelfHostedSnapshotAssembler();
    assembler.apply(snapshot(0, { committed: 'stable', revision: 2 }));
    expect(() => assembler.apply(snapshot(0, { committed: 'stable', revision: 1 })))
      .toThrow(/revision moved backwards/);
    expect(() => assembler.apply(snapshot(0, { committed: 'changed', revision: 3 })))
      .toThrow(/changed already committed text/);
  });
});

describe('SelfHostedMeetingTranscriber', () => {
  it('serializes feed requests so a slow worker cannot reorder audio', async () => {
    let active = 0;
    let maximumActive = 0;
    const feed = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return emptyResponse();
    });
    const transport: SelfHostedMeetingTransport = {
      begin: async () => ({ connectionId: '11111111-1111-4111-8111-111111111111' }),
      feed,
      finalize: async () => emptyResponse(),
      reset: async () => undefined,
    };
    const client = new SelfHostedMeetingTranscriber(transport, () => undefined, () => undefined);
    await client.start();
    client.send(new Int16Array(64));
    client.send(new Int16Array(64));
    await client.finish();

    expect(feed).toHaveBeenCalledTimes(2);
    expect(maximumActive).toBe(1);
  });

  it('fails visibly instead of growing an unbounded audio queue', async () => {
    const fatal = vi.fn();
    const reset = vi.fn(async () => undefined);
    const transport: SelfHostedMeetingTransport = {
      begin: async () => ({ connectionId: '11111111-1111-4111-8111-111111111111' }),
      feed: async () => emptyResponse(),
      finalize: async () => emptyResponse(),
      reset,
    };
    const client = new SelfHostedMeetingTranscriber(transport, () => undefined, fatal);
    await client.start();
    client.send(new Int16Array(200_000));

    expect(fatal).toHaveBeenCalledOnce();
    expect(fatal.mock.calls[0][0].message).toMatch(/five seconds behind/);
    expect(reset).toHaveBeenCalledOnce();
  });
});
