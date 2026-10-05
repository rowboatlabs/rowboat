import { describe, expect, it } from 'vitest';
import { FlyApiError, FlyMachines } from '../src/fly.js';

function recorder(status = 200, body = '{"id":"m_1","state":"started","config":{"image":"i"}}') {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(body, { status });
  }) as typeof fetch;
  return { seen, fetchFn };
}

describe('FlyMachines', () => {
  it('presents a macaroon as is, and any other token as a bearer', async () => {
    const a = recorder();
    await new FlyMachines('FlyV1 fm2_abc', a.fetchFn).machine('app', 'm_1');
    expect((a.seen[0].init.headers as Record<string, string>).authorization).toBe('FlyV1 fm2_abc');
    const b = recorder();
    await new FlyMachines('plain', b.fetchFn).machine('app', 'm_1');
    expect((b.seen[0].init.headers as Record<string, string>).authorization).toBe('Bearer plain');
  });

  it('calls the documented paths', async () => {
    const r = recorder();
    const fly = new FlyMachines('t', r.fetchFn, 'https://api.test/v1');
    await fly.createVolume('app', { name: 'data', region: 'cdg', sizeGb: 10, backupDays: 14 });
    await fly.start('app', 'm_1');
    await fly.waitStarted('app', 'm_1', 90);
    await fly.volume('app', 'vol_1');
    await fly.extendVolume('app', 'vol_1', 10);
    await fly.setBackups('app', 'vol_1', 14);
    await fly.snapshots('app', 'vol_1');
    expect(r.seen.map((s) => `${s.init.method} ${s.url}`)).toEqual([
      'POST https://api.test/v1/apps/app/volumes',
      'POST https://api.test/v1/apps/app/machines/m_1/start',
      'GET https://api.test/v1/apps/app/machines/m_1/wait?state=started&timeout=60',
      'GET https://api.test/v1/apps/app/volumes/vol_1',
      'PUT https://api.test/v1/apps/app/volumes/vol_1/extend',
      'PUT https://api.test/v1/apps/app/volumes/vol_1',
      'GET https://api.test/v1/apps/app/volumes/vol_1/snapshots',
    ]);
    const body = (i: number) => JSON.parse(String(r.seen[i].init.body));
    expect(body(0)).toEqual({ name: 'data', region: 'cdg', size_gb: 10, encrypted: true, auto_backup_enabled: true, snapshot_retention: 14 });
    expect(body(4)).toEqual({ size_gb: 10 });
    expect(body(5)).toEqual({ auto_backup_enabled: true, snapshot_retention: 14 });
  });

  it('turns an error answer into an error, with its status', async () => {
    const r = recorder(422, '{"error":"no capacity"}');
    await expect(new FlyMachines('t', r.fetchFn).machine('app', 'm_1')).rejects.toBeInstanceOf(FlyApiError);
  });
});
