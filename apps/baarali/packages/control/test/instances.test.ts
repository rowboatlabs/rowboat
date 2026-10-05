import { describe, expect, it } from 'vitest';
import { FlyApiError, type FlyApi, type Machine, type MachineConfig, type Volume, type VolumeOpts } from '../src/fly.js';
import { Instances, InstanceUnavailable, settleOwnerInstance, type InstancesConfig } from '../src/instances.js';
import { MemoryStore, hashToken, type Account, type Plan } from '../src/store.js';

const T0 = Date.UTC(2026, 9, 1, 8, 0, 0);
const PLAN: Plan = { id: 'decouverte', category: 'free', displayName: 'Découverte', weekCredits: 1, monthlyPrices: [], models: null };
const ME: Account = { id: 'acc_me', email: 'me@example.test', planId: 'decouverte', createdAt: T0 };
const OTHER: Account = { id: 'acc_other', email: null, planId: 'decouverte', createdAt: T0 };
const CONFIG: InstancesConfig = { app: 'baarali-instances', region: 'cdg', image: 'registry.fly.io/baarali-instances:v2', apiUrl: 'https://app.baarali.test', maxInstances: 2, diskGb: 10, backupDays: 14 };

/** Fly in memory: volumes and machines, and the calls made. */
class FakeFly implements FlyApi {
  readonly calls: string[] = [];
  readonly machines = new Map<string, Machine & { config: MachineConfig }>();
  failCreateMachine = false;
  readonly volumes = new Map<string, Volume>();
  failUpdate = false;
  failVolume = false;
  private n = 0;

  async createVolume(app: string, opts: VolumeOpts) {
    this.calls.push(`volume ${app} ${opts.sizeGb}GB ${opts.backupDays}d`);
    const id = `vol_${++this.n}`;
    this.volumes.set(id, { id, size_gb: opts.sizeGb, snapshot_retention: opts.backupDays, auto_backup_enabled: true });
    return { id };
  }
  async volume(_app: string, id: string) {
    this.calls.push(`get ${id}`);
    if (this.failVolume) throw new FlyApiError(500, 'volumes are down');
    return this.volumes.get(id)!;
  }
  async extendVolume(_app: string, id: string, sizeGb: number) {
    this.calls.push(`extend ${id} ${sizeGb}`);
    this.volumes.get(id)!.size_gb = sizeGb;
    return { needs_restart: true };
  }
  async setBackups(_app: string, id: string, days: number) {
    this.calls.push(`backups ${id} ${days}`);
    Object.assign(this.volumes.get(id)!, { snapshot_retention: days, auto_backup_enabled: true });
  }
  async snapshots() {
    return [];
  }
  async createMachine(app: string, { config }: { region: string; config: MachineConfig }) {
    this.calls.push(`create ${app} ${config.mounts[0].volume}`);
    // A tick, so two callers would overlap if nothing serialized them.
    await new Promise((r) => setTimeout(r, 5));
    if (this.failCreateMachine) throw new Error('fly is down');
    const machine = { id: `m_${++this.n}`, state: 'started', config };
    this.machines.set(machine.id, machine);
    return machine;
  }
  async machine(_app: string, id: string) {
    this.calls.push(`get ${id}`);
    return this.machines.get(id)!;
  }
  async updateMachine(_app: string, id: string, config: MachineConfig) {
    this.calls.push(`update ${id} ${config.image}`);
    if (this.failUpdate) throw new FlyApiError(422, 'fly refused the update');
    // Fly launches a stopped or suspended machine on its new config.
    const machine = { ...this.machines.get(id)!, config, state: 'started' };
    this.machines.set(id, machine);
    return machine;
  }
  async start(_app: string, id: string) {
    this.calls.push(`start ${id}`);
    this.machines.get(id)!.state = 'started';
  }
  async restart(_app: string, id: string) {
    this.calls.push(`restart ${id}`);
    this.machines.get(id)!.state = 'started';
  }
  async waitStarted(_app: string, id: string) {
    this.calls.push(`wait ${id}`);
  }
}

function setup(config: InstancesConfig | null = CONFIG) {
  const store = new MemoryStore(new Map([[hashToken('tok-me'), ME], [hashToken('tok-other'), OTHER]]), [PLAN]);
  const fly = new FakeFly();
  let clock = T0;
  const instances = new Instances({ store, secret: 'test-secret-0123456789abcdef0123', fly: config ? fly : undefined, config: config ?? undefined, now: () => clock });
  return { store, fly, instances, tick: (ms: number) => { clock += ms; } };
}

describe('Instances.ensure', () => {
  it('creates a volume and a machine once, with the keys and the control plane in its env', async () => {
    const { store, fly, instances } = setup();
    const record = await instances.ensure(ME);
    expect(record).toEqual({ accountId: ME.id, app: CONFIG.app, machineId: 'm_2', volumeId: 'vol_1', image: CONFIG.image, managed: true });
    expect(await store.instance(ME.id)).toEqual(record);
    const env = fly.machines.get('m_2')!.config.env;
    expect(env).toEqual({ API_URL: CONFIG.apiUrl, BAARALI_INSTANCE_TOKEN: instances.instanceToken(ME.id), BAARALI_SERVER_KEY: instances.serverKey(ME.id) });
    expect(fly.machines.get('m_2')!.config.services[0].autostop).toBe('suspend');
    expect(fly.machines.get('m_2')!.config.guest.memory_mb).toBeLessThanOrEqual(2048);
    // The instance's own token opens /v1 as its account.
    expect(await store.accountByToken(instances.instanceToken(ME.id))).toEqual(ME);

    await instances.ensure(ME);
    expect(fly.calls).toEqual(['volume baarali-instances 10GB 14d', 'create baarali-instances vol_1']);
  });

  it('gives two devices connecting together the same machine', async () => {
    const { fly, instances } = setup();
    const [a, b] = await Promise.all([instances.ensure(ME), instances.ensure(ME)]);
    expect(a).toEqual(b);
    expect(fly.calls.filter((c) => c.startsWith('create'))).toHaveLength(1);
  });

  it('resumes a creation cut short on the volume it already made', async () => {
    const { fly, instances } = setup();
    fly.failCreateMachine = true;
    await expect(instances.ensure(ME)).rejects.toThrow('fly is down');
    fly.failCreateMachine = false;
    expect((await instances.ensure(ME)).volumeId).toBe('vol_1');
    expect(fly.calls.filter((c) => c.startsWith('volume'))).toHaveLength(1);
  });

  it('moves a machine to the new image when a device connects', async () => {
    const { store, fly, instances } = setup();
    const old = await instances.ensure(ME);
    await store.saveInstance({ ...old, image: 'registry.fly.io/baarali-instances:v1' });
    expect((await instances.ensure(ME)).image).toBe(CONFIG.image);
    expect(fly.calls.at(-1)).toBe(`update ${old.machineId} ${CONFIG.image}`);
  });

  it('creates none beyond the cap, and none at all without Fly', async () => {
    const { instances } = setup({ ...CONFIG, maxInstances: 1 });
    await instances.ensure(ME);
    await expect(instances.ensure(OTHER)).rejects.toEqual(new InstanceUnavailable('full'));

    const off = setup(null);
    await expect(off.instances.ensure(ME)).rejects.toEqual(new InstanceUnavailable('off'));
  });

  it('leaves the owner instance of phase 0 as deployed', async () => {
    const { store, fly, instances } = setup();
    const owner = { accountId: 'owner', app: 'warell-owner', machineId: null, volumeId: null, image: null, managed: false };
    await store.saveInstance(owner);
    // Not a machine of ours: the record stands, nothing is created.
    expect(await instances.ensure({ ...ME, id: 'owner' })).toEqual(owner);
    expect(fly.calls).toEqual([]);
  });
});

describe('Instances keys and reach', () => {
  it('derives distinct keys per account and per purpose, the same every time', () => {
    const { instances } = setup();
    expect(instances.serverKey(ME.id)).toBe(instances.serverKey(ME.id));
    expect(instances.serverKey(ME.id)).not.toBe(instances.serverKey(OTHER.id));
    expect(instances.serverKey(ME.id)).not.toBe(instances.instanceToken(ME.id));
    const other = new Instances({ store: new MemoryStore(new Map(), []), secret: 'another-secret-0123456789abcdef', now: () => T0 });
    expect(other.serverKey(ME.id)).not.toBe(instances.serverKey(ME.id));
  });

  it('pins a managed machine over Flycast, and reaches the owner by its app', () => {
    const { instances } = setup();
    const managed = { accountId: ME.id, app: 'baarali-instances', machineId: 'm_9', volumeId: 'v', image: 'i', managed: true };
    expect(instances.target(managed)).toEqual({
      host: 'baarali-instances.flycast',
      port: 80,
      headers: { 'fly-force-instance-id': 'm_9' },
      key: instances.serverKey(ME.id),
    });
    expect(instances.target({ ...managed, accountId: 'owner', app: 'warell-owner', machineId: null, managed: false }).headers).toEqual({});
  });

  it('starts a suspended machine and waits for it, then trusts it awake for a while', async () => {
    const { fly, instances, tick } = setup();
    const record = await instances.ensure(ME);
    fly.machines.get(record.machineId!)!.state = 'suspended';
    fly.calls.length = 0;
    await instances.wake(record);
    expect(fly.calls).toEqual([`get ${record.machineId}`, `start ${record.machineId}`, `wait ${record.machineId}`]);
    await instances.wake(record);
    expect(fly.calls).toHaveLength(3);
    tick(31_000);
    await instances.wake(record);
    expect(fly.calls.at(-1)).toBe(`get ${record.machineId}`);
  });

  it('wakes a sleeping machine on the new image, and leaves a running one alone', async () => {
    const { store, fly, instances, tick } = setup();
    const record = await instances.ensure(ME);
    const old = { ...record, image: 'registry.fly.io/baarali-instances:v1' };
    await store.saveInstance(old);
    // Running: never restarted under its person.
    fly.calls.length = 0;
    await instances.wake(old);
    expect(fly.calls).toEqual([`get ${record.machineId}`]);
    expect((await store.instance(ME.id))!.image).toBe(old.image);
    // Asleep: woken on the new image, once.
    tick(31_000);
    fly.machines.get(record.machineId!)!.state = 'suspended';
    fly.calls.length = 0;
    await instances.wake(old);
    expect(fly.calls).toEqual([`get ${record.machineId}`, `update ${record.machineId} ${CONFIG.image}`, `wait ${record.machineId}`]);
    expect((await store.instance(ME.id))!.image).toBe(CONFIG.image);
    expect(fly.machines.get(record.machineId!)!.config.env.BAARALI_SERVER_KEY).toBe(instances.serverKey(ME.id));
  });

  it('starts a sleeping machine as it is when Fly refuses the image update, and tries again next time', async () => {
    const { store, fly, instances } = setup();
    const record = await instances.ensure(ME);
    const old = { ...record, image: 'registry.fly.io/baarali-instances:v1' };
    await store.saveInstance(old);
    fly.machines.get(record.machineId!)!.state = 'suspended';
    fly.failUpdate = true;
    fly.calls.length = 0;
    await instances.wake(old);
    expect(fly.calls).toEqual([`get ${record.machineId}`, `update ${record.machineId} ${CONFIG.image}`, `start ${record.machineId}`, `wait ${record.machineId}`]);
    expect((await store.instance(ME.id))!.image).toBe(old.image);
  });

  it('asks Fly once for a burst of requests', async () => {
    const { fly, instances } = setup();
    const record = await instances.ensure(ME);
    fly.machines.get(record.machineId!)!.state = 'suspended';
    fly.calls.length = 0;
    await Promise.all(Array.from({ length: 20 }, () => instances.wake(record)));
    expect(fly.calls).toEqual([`get ${record.machineId}`, `start ${record.machineId}`, `wait ${record.machineId}`]);
  });

  it('lets requests through when Fly refuses for its rate limit, and asks again later', async () => {
    const { fly, instances, tick } = setup();
    const record = await instances.ensure(ME);
    const real = fly.machine.bind(fly);
    let refuse = true;
    fly.machine = async (app: string, id: string) => {
      if (refuse) throw new FlyApiError(429, 'resource_exhausted: rate limit exceeded');
      return real(app, id);
    };
    await expect(instances.wake(record)).resolves.toBeUndefined();
    refuse = false;
    fly.calls.length = 0;
    await instances.wake(record);
    expect(fly.calls).toEqual([]);
    tick(6_000);
    await instances.wake(record);
    expect(fly.calls).toEqual([`get ${record.machineId}`]);
  });

  it('still fails on any other error from Fly', async () => {
    const { fly, instances } = setup();
    const record = await instances.ensure(ME);
    fly.machine = async () => {
      throw new FlyApiError(500, 'boom');
    };
    await expect(instances.wake(record)).rejects.toThrow('boom');
  });
});

describe('Instances disks', () => {
  /** An instance made before 05/10/2026: 1 GB, Fly's default 5 days of snapshots. */
  async function oldDisk() {
    const s = setup();
    const record = await s.instances.ensure(ME);
    Object.assign(s.fly.volumes.get(record.volumeId!)!, { size_gb: 1, snapshot_retention: 5 });
    // A new process: it has checked no disk yet.
    const instances = new Instances({ store: s.store, secret: 'test-secret-0123456789abcdef0123', fly: s.fly, config: CONFIG, now: () => T0 });
    s.fly.calls.length = 0;
    return { ...s, instances, record };
  }

  it('grows a sleeping instance\'s disk and boots it afresh to see it, once', async () => {
    const { fly, instances, record } = await oldDisk();
    fly.machines.get(record.machineId!)!.state = 'suspended';
    await instances.wake(record);
    const m = record.machineId, v = record.volumeId;
    expect(fly.calls).toEqual([`get ${m}`, `get ${v}`, `extend ${v} 10`, `backups ${v} 14`, `update ${m} ${CONFIG.image}`, `wait ${m}`]);
    expect(fly.volumes.get(v!)).toMatchObject({ size_gb: 10, snapshot_retention: 14 });
    // Settled: the next sleep and wake is a plain start.
    fly.machines.get(m!)!.state = 'suspended';
    fly.calls.length = 0;
    await instances.wake({ ...record });
    expect(fly.calls.filter((c) => c.includes(v!))).toEqual([]);
  });

  it('never touches the disk of a running instance', async () => {
    const { fly, instances, record } = await oldDisk();
    await instances.wake(record);
    expect(fly.calls).toEqual([`get ${record.machineId}`]);
  });

  it('grows the disk when a device connects and the machine is updated anyway', async () => {
    const { store, fly, instances, record } = await oldDisk();
    await store.saveInstance({ ...record, image: 'registry.fly.io/baarali-instances:v1' });
    await instances.ensure(ME);
    expect(fly.calls).toEqual([`get ${record.volumeId}`, `extend ${record.volumeId} 10`, `backups ${record.volumeId} 14`, `update ${record.machineId} ${CONFIG.image}`]);
  });

  it('still starts the instance when Fly will not describe the disk', async () => {
    const { fly, instances, record } = await oldDisk();
    fly.machines.get(record.machineId!)!.state = 'suspended';
    fly.failVolume = true;
    await instances.wake(record);
    expect(fly.calls).toEqual([`get ${record.machineId}`, `get ${record.volumeId}`, `start ${record.machineId}`, `wait ${record.machineId}`]);
  });
});

describe("the owner's hand-deployed instance", () => {
  it('is reached while configured, then forgotten so a managed one comes', async () => {
    const { store, instances, fly } = setup();
    expect(await settleOwnerInstance(store, ME.id, 'warell-owner')).toBe('reached');
    expect((await store.instance(ME.id))?.app).toBe('warell-owner');
    expect(await settleOwnerInstance(store, ME.id, undefined)).toBe('retired');
    expect(await store.instance(ME.id)).toBeNull();
    // At the next sign-in, the owner gets a managed instance like everyone.
    const record = await instances.ensure(ME);
    expect(record.managed).toBe(true);
    expect(fly.calls.some((c) => c.startsWith('create '))).toBe(true);
  });

  it('leaves a managed instance alone', async () => {
    const { store, instances } = setup();
    await instances.ensure(ME);
    expect(await settleOwnerInstance(store, ME.id, undefined)).toBe('none');
    expect((await store.instance(ME.id))?.managed).toBe(true);
  });
});
