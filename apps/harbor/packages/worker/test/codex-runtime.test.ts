import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CodexRuntime } from '../src/codex/runtime.js';
import { silentLogger } from '../src/log.js';
import { TurnOverError, type TurnEvent } from '../src/runtime.js';

// The Codex adapter against a stand-in app-server speaking the same lines
// (test/fake-app-server.mjs): a turn's events and answer, a steer folded in,
// a steer refused once the turn is over, an interrupt, a crash mid-turn and
// the restart after it, and the model list.

const FAKE = resolve(import.meta.dirname, 'fake-app-server.mjs');
const runtimes: CodexRuntime[] = [];

function runtime(): CodexRuntime {
  const r = new CodexRuntime({
    orgUrl: 'http://harbor.test',
    agentKey: 'rbk_test',
    cwd: mkdtempSync(join(tmpdir(), 'codex-runtime-')),
    log: silentLogger,
    command: process.execPath,
    commandArgs: [FAKE],
    signInProbe: false,
    requestTimeoutMs: 5_000,
  });
  runtimes.push(r);
  return r;
}

afterEach(async () => {
  for (const r of runtimes.splice(0)) await r.stop();
});

describe('CodexRuntime', () => {
  it('runs a turn: the command shows as activity, the final message is the answer, the session resumes next time', async () => {
    const r = runtime();
    const { sessionId } = await r.openSession({ cwd: '/tmp' });
    expect(sessionId).toMatch(/^thr-/);
    const events: TurnEvent[] = [];
    const handle = await r.turn({ sessionId, prompt: 'say pong', onEvent: (e) => events.push(e) });
    const result = await handle.done;
    expect(result).toEqual({ status: 'completed', answer: 'pong' });
    expect(events).toContainEqual({ type: 'activity', activity: 'is running `/bin/sh -c "echo hi"`' });
    expect(events).toContainEqual({ type: 'answer', text: 'pong' });
    // The same session again is a resume, not a new thread.
    expect(await r.openSession({ sessionId, cwd: '/tmp' })).toEqual({ sessionId });
    expect((await r.openSession({ sessionId: 'gone-1', cwd: '/tmp' })).sessionId).toMatch(/^thr-/);
  });

  it('steers a running turn, and refuses a steer once it is over', async () => {
    const r = runtime();
    const { sessionId } = await r.openSession({ cwd: '/tmp' });
    const handle = await r.turn({ sessionId, prompt: 'wait for more', onEvent: () => {} });
    await handle.steer('also marmalade');
    expect(await handle.done).toEqual({ status: 'completed', answer: 'pong | also marmalade' });
    await expect(handle.steer('too late')).rejects.toBeInstanceOf(TurnOverError);
  });

  it('interrupts a turn, which ends interrupted', async () => {
    const r = runtime();
    const { sessionId } = await r.openSession({ cwd: '/tmp' });
    const handle = await r.turn({ sessionId, prompt: 'wait for a stop', onEvent: () => {} });
    await handle.interrupt();
    expect(await handle.done).toEqual({ status: 'interrupted' });
  });

  it('reports a failed turn with the harness’s words', async () => {
    const r = runtime();
    const { sessionId } = await r.openSession({ cwd: '/tmp' });
    const handle = await r.turn({ sessionId, prompt: 'please fail', onEvent: () => {} });
    expect(await handle.done).toEqual({ status: 'failed', error: 'the fake failed as asked' });
  });

  it('fails the turns in flight when the app-server dies, and starts another for the next session', async () => {
    const r = runtime();
    const { sessionId } = await r.openSession({ cwd: '/tmp' });
    const handle = await r.turn({ sessionId, prompt: 'crash now', onEvent: () => {} });
    const result = await handle.done;
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/Codex stopped/);
    const again = await r.openSession({ sessionId, cwd: '/tmp' });
    expect(again.sessionId).toBe(sessionId);
    expect(await (await r.turn({ sessionId, prompt: 'say pong', onEvent: () => {} })).done).toEqual({ status: 'completed', answer: 'pong' });
  });

  it('lists the models the composer may offer, hidden ones left out', async () => {
    const r = runtime();
    expect(await r.models()).toEqual([
      { id: 'gpt-fake-fast', label: 'Fake Fast' },
      { id: 'gpt-fake-big', label: 'Fake Big' },
    ]);
    expect(r.efforts().map((e) => e.id)).toEqual(['low', 'medium', 'high']);
  });
});
