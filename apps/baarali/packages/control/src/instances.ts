import { createHmac } from 'node:crypto';
import { FlyApiError, type FlyApi, type MachineConfig } from './fly.js';
import type { Account, ControlStore, InstanceRecord } from './store.js';

// One instance per account (architecture §3.5 « Instances », decided
// 01/10/2026): a Fly machine and its volume, in one app, created the first
// time one of the account's devices connects. The control plane is its only
// door (security §2): it wakes the machine and relays to it with its key.

export interface InstancesConfig {
  /** The Fly app that holds every managed instance. */
  app: string;
  region: string;
  /** The instance image; a machine on an older one is updated when a device connects. */
  image: string;
  /** The instance's API_URL: this control plane. */
  apiUrl: string;
  /** Early access: no new instance beyond this many. */
  maxInstances: number;
}

export type InstanceProblem = 'off' | 'full';

export class InstanceUnavailable extends Error {
  constructor(readonly problem: InstanceProblem) {
    super(`instance unavailable: ${problem}`);
  }
}

/** Where the gateway sends an account's traffic. */
export interface InstanceTarget {
  host: string;
  port: number;
  /** Added to every relayed request. */
  headers: Record<string, string>;
  /** The instance's bearer key (rowboat-server's server-key), never given to a device. */
  key: string;
}

export interface InstancesDeps {
  store: ControlStore;
  /** Derives each instance's keys, so none is stored. 32 random bytes or more. */
  secret: string;
  /** Unset with `config`: no instance is created, only the owner's is reached. */
  fly?: FlyApi;
  config?: InstancesConfig;
  now: () => number;
}

/** A suspended machine needs the time of its first request; a new one, its first boot. */
const WAKE_TIMEOUT_S = 60;
/** Autostop needs minutes of silence: a machine seen started this recently is still up. */
const AWAKE_MS = 30_000;
/** After a refusal of Fly's API, how long before asking it again. */
const RATE_LIMITED_MS = 5_000;

export class Instances {
  private readonly building = new Map<string, Promise<InstanceRecord>>();
  private readonly awakeUntil = new Map<string, number>();
  /** The check under way per machine: a burst of requests shares one. */
  private readonly waking = new Map<string, Promise<void>>();

  constructor(private readonly deps: InstancesDeps) {}

  private derive(purpose: string, accountId: string): string {
    return createHmac('sha256', this.deps.secret).update(`${purpose}:v1:${accountId}`).digest('base64url');
  }

  /** The bearer the instance's rowboat-server expects (BAARALI_SERVER_KEY). */
  serverKey(accountId: string): string {
    return this.derive('server-key', accountId);
  }

  /** The bearer the instance presents to /v1 (BAARALI_INSTANCE_TOKEN). */
  instanceToken(accountId: string): string {
    return this.derive('instance-token', accountId);
  }

  /**
   * The account's instance, created if it has none, updated if its image is
   * old. One build at a time per account: two devices connecting together
   * get the same machine. The control plane runs on one machine (fly.toml).
   */
  async ensure(account: Account): Promise<InstanceRecord> {
    const existing = await this.deps.store.instance(account.id);
    // The owner's instance of phase 0 is deployed by hand: only reached.
    if (existing && !existing.managed) return existing;
    if (existing?.machineId && existing.image === this.deps.config?.image) return existing;
    const running = this.building.get(account.id);
    if (running) return running;
    const build = this.build(account, existing).finally(() => this.building.delete(account.id));
    this.building.set(account.id, build);
    return build;
  }

  private async build(account: Account, existing: InstanceRecord | null): Promise<InstanceRecord> {
    const { fly, config, store } = this.deps;
    if (!fly || !config) throw new InstanceUnavailable('off');
    if (!existing && (await store.countInstances()) >= config.maxInstances) throw new InstanceUnavailable('full');

    let record: InstanceRecord = existing ?? {
      accountId: account.id,
      app: config.app,
      machineId: null,
      volumeId: null,
      image: null,
      managed: true,
    };
    // Saved after each step: a creation cut short resumes, it does not leak a volume.
    await store.saveInstance(record);
    await store.grantToken(this.instanceToken(account.id), account.id);
    if (!record.volumeId) {
      const volume = await fly.createVolume(record.app, { name: 'data', region: config.region, sizeGb: 1 });
      record = { ...record, volumeId: volume.id };
      await store.saveInstance(record);
    }
    const machineConfig = this.machineConfig(account.id, record.volumeId!, config);
    if (!record.machineId) {
      const machine = await fly.createMachine(record.app, { region: config.region, config: machineConfig });
      record = { ...record, machineId: machine.id, image: config.image };
    } else {
      await fly.updateMachine(record.app, record.machineId, machineConfig);
      record = { ...record, image: config.image };
    }
    await store.saveInstance(record);
    return record;
  }

  // The owner's instance of phase 0, as code: same size, same suspension,
  // same check (packages/instance/fly.toml).
  private machineConfig(accountId: string, volumeId: string, config: InstancesConfig): MachineConfig {
    return {
      image: config.image,
      env: {
        API_URL: config.apiUrl,
        BAARALI_INSTANCE_TOKEN: this.instanceToken(accountId),
        BAARALI_SERVER_KEY: this.serverKey(accountId),
      },
      // Suspension needs 2 GB or less (architecture §6).
      guest: { cpu_kind: 'shared', cpus: 1, memory_mb: 2048 },
      mounts: [{ volume: volumeId, path: '/data' }],
      services: [
        {
          protocol: 'tcp',
          internal_port: 8080,
          autostop: 'suspend',
          autostart: true,
          min_machines_running: 0,
          ports: [{ port: 80, handlers: ['http'] }],
        },
      ],
      checks: { health: { type: 'http', port: 8080, path: '/health', interval: '30s', timeout: '5s', grace_period: '60s' } },
      restart: { policy: 'on-failure' },
      metadata: { baarali_account: accountId },
    };
  }

  /**
   * Fly's proxy wakes a machine on its own; asking first makes a new
   * machine's first boot, and a failure to start, an answer rather than a
   * hung request. The owner's instance is left to the proxy alone.
   */
  async wake(record: InstanceRecord): Promise<void> {
    const { fly } = this.deps;
    if (!record.managed || !record.machineId || !fly) return;
    const id = record.machineId;
    if ((this.awakeUntil.get(id) ?? 0) > this.deps.now()) return;
    // An app opening sends dozens of requests at once: one look at Fly for
    // all of them, or Fly's rate limit (429) turns them all into errors.
    let pending = this.waking.get(id);
    if (!pending) {
      pending = this.check(record, id, fly).finally(() => this.waking.delete(id));
      this.waking.set(id, pending);
    }
    return pending;
  }

  private async check(record: InstanceRecord, id: string, fly: FlyApi): Promise<void> {
    const app = record.app;
    try {
      const machine = await fly.machine(app, id);
      if (machine.state !== 'started') {
        if (machine.state !== 'starting') {
          // Asleep on an old image (02/10/2026): wake it on the new one. Only
          // now, while nobody is using it — a running machine is never
          // restarted under its person; it waits for its next sleep, or for
          // a device to connect (ensure). Fly launches it with the update.
          let moved = false;
          if (await this.outdated(record)) {
            // A refused update must not keep the person out: start it as it
            // is, and the next wake tries the new image again.
            moved = await this.moveToImage(record).then(
              () => true,
              (err) => {
                if (err instanceof FlyApiError && err.status === 429) throw err;
                console.error(`[instances] image update of ${id} failed; starting it as it is`, err);
                return false;
              },
            );
          }
          if (!moved) await fly.start(app, id);
        }
        await fly.waitStarted(app, id, WAKE_TIMEOUT_S);
      }
    } catch (err) {
      // Fly's API refuses for now: its private network still starts the
      // machine on the request itself (autostart), so let it through, and
      // ask again a little later rather than at once.
      if (!(err instanceof FlyApiError && err.status === 429)) throw err;
      console.warn(`[instances] Fly rate limit while waking ${id}; relying on autostart`);
      this.awakeUntil.set(id, this.deps.now() + RATE_LIMITED_MS);
      return;
    }
    this.awakeUntil.set(id, this.deps.now() + AWAKE_MS);
  }

  /** The stored record, not the caller's copy: another wake may have moved it already. */
  private async outdated(record: InstanceRecord): Promise<boolean> {
    const { config, store } = this.deps;
    if (!config || !record.managed) return false;
    const current = await store.instance(record.accountId);
    return Boolean(current?.machineId && current.volumeId && current.image !== config.image);
  }

  private async moveToImage(record: InstanceRecord): Promise<void> {
    const { fly, config, store } = this.deps;
    const current = await store.instance(record.accountId);
    if (!fly || !config || !current?.machineId || !current.volumeId) return;
    await fly.updateMachine(current.app, current.machineId, this.machineConfig(current.accountId, current.volumeId, config));
    await store.saveInstance({ ...current, image: config.image });
  }

  /** Over Flycast (private): an instance has no public address. */
  target(record: InstanceRecord): InstanceTarget {
    return {
      host: `${record.app}.flycast`,
      port: 80,
      // Pins the request to this account's machine among all of the app's.
      headers: record.managed && record.machineId ? { 'fly-force-instance-id': record.machineId } : {},
      key: this.serverKey(record.accountId),
    };
  }
}

/**
 * The owner's hand-deployed instance of phase 0 (BAARALI_OWNER_INSTANCE_APP):
 * reached while it is configured; once unset, its record is forgotten, and
 * the owner gets a managed instance like everyone at the next sign-in of a
 * device (POST /v1/devices). The machine itself is left to whoever removes it.
 */
export async function settleOwnerInstance(
  store: ControlStore,
  ownerId: string,
  ownerApp: string | undefined,
): Promise<'reached' | 'retired' | 'none'> {
  if (ownerApp) {
    await store.saveInstance({ accountId: ownerId, app: ownerApp, machineId: null, volumeId: null, image: null, managed: false });
    return 'reached';
  }
  if ((await store.instance(ownerId))?.managed !== false) return 'none';
  await store.removeInstance(ownerId);
  return 'retired';
}
