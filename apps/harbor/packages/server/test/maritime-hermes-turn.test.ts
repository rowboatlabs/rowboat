import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RUNTIMES } from '../src/connectors/maritime/runtimes.js';

// The Hermes turn waits out a gateway that is not ready yet (2026-11-04, "Gateway draining: not_ready" on prod).
// The turn's last line runs here under sh, with Hermes and sleep stubbed: the stub fails the way Hermes does
// for its first `failures` calls, then writes a result.
describe('Hermes turn: a gateway that is not ready', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function turn(failures: number, words = 'Gateway draining: not_ready') {
    dir = mkdtempSync(join(tmpdir(), 'hermes-turn-'));
    const files = { promptPath: join(dir, 't.prompt'), outPath: join(dir, 't.jsonl'), errPath: join(dir, 't.err'), lastPath: join(dir, 't.last') };
    const line = RUNTIMES.hermes!.command({ serverUrl: 'https://acme.example', agentKey: 'rbk_x', session: 'rb-t', ...files }).split('\n').at(-1)!;
    const stub = [
      `calls=${join(dir, 'calls')}`,
      'sleep() { :; }',
      `run() { echo x >> "$calls"; if [ "$(wc -l < "$calls")" -le ${failures} ]; then echo '{"type":"result","exit_code":1,"error":"${words}"}'; echo '${words}' >&2; return 1; fi; echo '{"type":"result","exit_code":0,"text":"Done."}'; }`,
    ].join('\n');
    let exitCode = 0;
    try {
      execFileSync('sh', ['-c', `set -e\n${stub}\n${line}`], { stdio: 'pipe' });
    } catch (err) {
      exitCode = (err as { status: number }).status;
    }
    const calls = readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n').length;
    return { exitCode, calls, reading: RUNTIMES.hermes!.read(readFileSync(files.outPath, 'utf8'), undefined, readFileSync(files.errPath, 'utf8'), exitCode) };
  }

  it('runs the turn again while the gateway is draining or starting, and answers once it is ready', () => {
    expect(turn(2)).toEqual({ exitCode: 0, calls: 3, reading: { answer: 'Done.' } });
    expect(turn(1, 'Gateway starting: not_ready').calls).toBe(2);
  });

  it('does not run a turn again that failed for any other reason', () => {
    const { exitCode, calls, reading } = turn(1, 'Provider refused the key');
    expect({ exitCode, calls }).toEqual({ exitCode: 1, calls: 1 });
    expect(reading.failure).toBe('Provider refused the key');
  });

  it('gives up after two minutes of a gateway that never becomes ready, with its words', () => {
    const { exitCode, calls, reading } = turn(100);
    expect({ exitCode, calls }).toEqual({ exitCode: 1, calls: 24 });
    expect(reading.failure).toBe('Gateway draining: not_ready');
  });
});
