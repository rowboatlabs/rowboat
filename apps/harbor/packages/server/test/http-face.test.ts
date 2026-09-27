import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunningHarbor } from '../src/server.js';
import { startTestHarbor } from './helpers.js';

// The render face's body discipline: every JSON route goes through one
// helper that caps the size and turns a malformed body into a 400 with a
// plain message — never a 500 with "unexpected error" in the log.

let harbor: RunningHarbor;

beforeAll(async () => {
  harbor = await startTestHarbor({ seedMembers: [{ id: 'ramnique', displayName: 'Ramnique' }] });
});
afterAll(async () => {
  await harbor.close();
});

async function postRaw(path: string, raw: string) {
  const res = await fetch(`${harbor.url}${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer dev-ramnique', 'content-type': 'application/json' },
    body: raw,
  });
  return { status: res.status, body: (await res.json()) as { code?: string; message?: string } };
}

describe('the render face refuses a malformed body the same way on every route', () => {
  it.each(['/v1/activity/seen', '/v1/activity/read-all', '/v1/spaces'])('%s → 400 invalid_request', async (path) => {
    const res = await postRaw(path, '{');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'invalid_request', message: 'body is not valid JSON' });
  });

  it('and still serves a well-formed one', async () => {
    expect((await postRaw('/v1/activity/read-all', '{}')).status).toBe(200);
    expect((await postRaw('/v1/activity/seen', JSON.stringify({ at: '2026-09-22T00:00:00.000Z' }))).status).toBe(200);
  });
});
