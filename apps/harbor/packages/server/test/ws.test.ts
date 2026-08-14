import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ServerFrame } from '@rowboat/spaces-protocol';
import { startHarbor, type RunningHarbor } from '../src/server.js';

// Live-face tests: subscribe/replay/live/presence over a real socket.

let harbor: RunningHarbor;
let spaceId: string;

beforeAll(async () => {
  harbor = await startHarbor({
    seedMembers: [
      { id: 'ramnique', displayName: 'Ramnique' },
      { id: 'gagan', displayName: 'Gagan' },
    ],
    seedSpaces: [{ name: 'Live', creator: 'ramnique', assets: [{ path: 'README.md', content: '# Live\n' }] }],
  });
  const spaces = await harbor.service.listSpaces({ memberId: 'ramnique' });
  spaceId = spaces[0]!.id;
});

afterAll(async () => {
  await harbor.close();
});

interface LiveClient {
  frames: ServerFrame[];
  send(frame: unknown): void;
  until(pred: (frames: ServerFrame[]) => boolean, label?: string): Promise<void>;
  close(): void;
}

async function connect(token: string): Promise<LiveClient> {
  const ws = new WebSocket(`ws://localhost:${harbor.port}/v1/live?token=${token}`);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  const frames: ServerFrame[] = [];
  let waiters: Array<() => void> = [];
  ws.on('message', (data) => {
    frames.push(JSON.parse(String(data)) as ServerFrame);
    const w = waiters;
    waiters = [];
    for (const fn of w) fn();
  });
  return {
    frames,
    send: (frame) => ws.send(JSON.stringify(frame)),
    async until(pred, label = 'condition') {
      const deadline = Date.now() + 3000;
      while (!pred(frames)) {
        if (Date.now() > deadline) {
          throw new Error(`timeout waiting for ${label}; got: ${JSON.stringify(frames, null, 2)}`);
        }
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
          setTimeout(resolve, 25);
        });
      }
    },
    close: () => ws.close(),
  };
}

function eventFrames(frames: ServerFrame[]) {
  return frames.filter((f): f is Extract<ServerFrame, { kind: 'event' }> => f.kind === 'event');
}

describe('live face', () => {
  it('rejects upgrades without a token', async () => {
    const ws = new WebSocket(`ws://localhost:${harbor.port}/v1/live`);
    const err = await new Promise<Error>((resolve) => ws.once('error', resolve));
    expect(String(err)).toContain('401');
  });

  it('subscribe with afterOffset 0 replays the full space log, in order, after the subscribed frame', async () => {
    const client = await connect('dev-ramnique');
    client.send({ kind: 'subscribe', spaceId, afterOffset: 0 });
    await client.until((fs) => eventFrames(fs).length >= 3, 'replay of seeded events');

    expect(client.frames[0]).toMatchObject({ kind: 'subscribed', spaceId, fromOffset: 0 });
    const events = eventFrames(client.frames);
    // Seed produced: ramnique joined, gagan joined, then the README change.
    expect(events.map((e) => e.event.type)).toEqual(['membership', 'membership', 'change']);
    expect(events.map((e) => e.offset)).toEqual([1, 2, 3]);
    client.close();
  });

  it('subscribe without afterOffset skips replay and goes straight to live', async () => {
    const client = await connect('dev-ramnique');
    client.send({ kind: 'subscribe', spaceId });
    await client.until((fs) => fs.some((f) => f.kind === 'subscribed'), 'subscribed ack');
    const head = (client.frames[0] as Extract<ServerFrame, { kind: 'subscribed' }>).fromOffset;
    expect(head).toBeGreaterThanOrEqual(2);
    expect(eventFrames(client.frames)).toHaveLength(0);

    await harbor.service.proposeChange({ memberId: 'ramnique' }, spaceId, {
      assetPath: 'README.md',
      baseVersion: 1,
      newContent: '# Live\nupdated\n',
      actingMode: 'direct',
    });
    await client.until((fs) => eventFrames(fs).length === 1, 'live change event');
    const [ev] = eventFrames(client.frames);
    expect(ev!.offset).toBe(head + 1);
    expect(ev!.event.type).toBe('change');
    client.close();
  });

  it('resume from a mid-stream offset replays only the tail; offsets stay contiguous across replay→live', async () => {
    const head = await harbor.service.headOffset(spaceId);
    const client = await connect('dev-gagan'); // gagan seeded into the space
    client.send({ kind: 'subscribe', spaceId, afterOffset: head - 1 });
    await client.until((fs) => eventFrames(fs).length >= 1, 'tail replay');
    expect(eventFrames(client.frames).map((e) => e.offset)).toEqual([head]);

    await harbor.service.postMessage({ memberId: 'ramnique' }, spaceId, {
      body: 'New topic while gagan is live',
      actingMode: 'direct',
    });
    await client.until((fs) => eventFrames(fs).length >= 3, 'live topic+message events');
    const offsets = eventFrames(client.frames).map((e) => e.offset);
    expect(offsets).toEqual([head, head + 1, head + 2]); // no gaps, no duplicates
    client.close();
  });

  it('subscribing to a space you are not in yields an error frame', async () => {
    const other = await harbor.service.createSpace({ memberId: 'ramnique' }, 'Private');
    const client = await connect('dev-gagan');
    client.send({ kind: 'subscribe', spaceId: other.id });
    await client.until((fs) => fs.some((f) => f.kind === 'error'), 'error frame');
    const err = client.frames.find((f) => f.kind === 'error') as Extract<ServerFrame, { kind: 'error' }>;
    expect(err.code).toBe('forbidden');
    client.close();
  });

  it('presence fans out to space subscribers as ephemeral frames', async () => {
    const watcher = await connect('dev-ramnique');
    watcher.send({ kind: 'subscribe', spaceId });
    await watcher.until((fs) => fs.some((f) => f.kind === 'subscribed'), 'watcher subscribed');

    const typer = await connect('dev-gagan');
    typer.send({ kind: 'presence', spaceId, state: 'typing' });
    await watcher.until((fs) => fs.some((f) => f.kind === 'presence'), 'presence frame');
    const presence = watcher.frames.find((f) => f.kind === 'presence') as Extract<ServerFrame, { kind: 'presence' }>;
    expect(presence).toMatchObject({ spaceId, memberId: 'gagan', state: 'typing' });
    expect('offset' in presence).toBe(false);
    expect('topicId' in presence).toBe(false); // absent = space-wide

    // Topic-scoped presence (agent_working on a thread) carries the topicId through.
    const topicId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    typer.send({ kind: 'presence', spaceId, state: 'agent_working', topicId });
    await watcher.until(
      (fs) => fs.some((f) => f.kind === 'presence' && f.state === 'agent_working'),
      'topic-scoped presence frame',
    );
    const scoped = watcher.frames.find(
      (f) => f.kind === 'presence' && f.state === 'agent_working',
    ) as Extract<ServerFrame, { kind: 'presence' }>;
    expect(scoped).toMatchObject({ spaceId, memberId: 'gagan', state: 'agent_working', topicId });
    watcher.close();
    typer.close();
  });

  it('malformed frames get an error frame, not a dropped socket', async () => {
    const client = await connect('dev-ramnique');
    client.send({ kind: 'subscribe' }); // missing spaceId
    await client.until((fs) => fs.some((f) => f.kind === 'error'), 'validation error frame');
    client.send({ kind: 'subscribe', spaceId, afterOffset: 0 });
    await client.until((fs) => fs.some((f) => f.kind === 'subscribed'), 'socket still alive');
    client.close();
  });
});
