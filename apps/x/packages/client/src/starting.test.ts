import { describe, expect, it } from 'vitest';
import { fetchWhileStarting } from './starting.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function clock() {
  let t = 0;
  const waits: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      waits.push(ms);
      t += ms;
    },
    waits,
  };
}

describe('fetchWhileStarting', () => {
  it('asks again while the instance wakes or boots, then hands back the answer', async () => {
    const answers = [
      json(503, { error: { code: 'instance_waking' } }),
      json(503, { error: { code: 'instance_starting' } }),
      json(200, { ok: true }),
    ];
    const c = clock();
    const res = await fetchWhileStarting(async () => answers.shift()!, c);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(c.waits).toEqual([1000, 2000]);
  });

  it('never asks again after any other failure: it may have reached the server', async () => {
    let calls = 0;
    for (const res of [json(502, { error: { code: 'instance_unavailable' } }), json(503, { error: { code: 'other' } }), json(500, {})]) {
      calls = 0;
      const got = await fetchWhileStarting(async () => {
        calls += 1;
        return res.clone();
      }, clock());
      expect(got.status).toBe(res.status);
      expect(calls).toBe(1);
    }
  });

  it('gives up after its budget, with the last answer, its body still readable', async () => {
    const c = clock();
    let calls = 0;
    const res = await fetchWhileStarting(async () => {
      calls += 1;
      return json(503, { error: { code: 'instance_starting', message: 'still booting' } });
    }, { ...c, budgetMs: 20_000 });
    expect(res.status).toBe(503);
    expect((await res.json()).error.message).toBe('still booting');
    expect(c.waits).toEqual([1000, 2000, 4000, 5000, 5000]);
    expect(calls).toBe(6);
  });
});
