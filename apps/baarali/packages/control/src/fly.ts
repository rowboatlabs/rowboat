// The few Fly Machines API calls the control plane needs to run one instance
// per account (architecture §3.5 « Instances », decided 01/10/2026). Plain
// fetch on the public API: https://fly.io/docs/machines/api/

export interface MachineConfig {
  image: string;
  env: Record<string, string>;
  guest: { cpu_kind: 'shared'; cpus: number; memory_mb: number };
  mounts: Array<{ volume: string; path: string }>;
  services: Array<{
    protocol: 'tcp';
    internal_port: number;
    autostop: 'suspend' | 'stop' | 'off';
    autostart: boolean;
    min_machines_running: number;
    ports: Array<{ port: number; handlers: string[] }>;
  }>;
  checks: Record<string, { type: 'http'; port: number; path: string; interval: string; timeout: string; grace_period: string }>;
  restart: { policy: 'on-failure' | 'always' | 'no' };
  metadata: Record<string, string>;
}

export interface Machine {
  id: string;
  /** created, started, stopped, suspended, … : https://fly.io/docs/machines/machine-states/ */
  state: string;
  config: { image: string };
}

/** https://fly.io/docs/machines/api/volumes-resource/ ; the block counts only while attached. */
export interface Volume {
  id: string;
  size_gb: number;
  block_size?: number;
  blocks?: number;
  blocks_free?: number;
  /** Days a daily snapshot is kept (Fly: 5 by default, 60 at most). */
  snapshot_retention?: number;
  auto_backup_enabled?: boolean;
}

export interface VolumeOpts {
  name: string;
  region: string;
  sizeGb: number;
  /** Days each daily snapshot is kept. */
  backupDays: number;
}

export interface FlyApi {
  createVolume(app: string, opts: VolumeOpts): Promise<{ id: string }>;
  volume(app: string, id: string): Promise<Volume>;
  /** Grows only. `needs_restart`: the machine sees the new size at its next boot. */
  extendVolume(app: string, id: string, sizeGb: number): Promise<{ needs_restart: boolean }>;
  setBackups(app: string, id: string, days: number): Promise<void>;
  /** Newest first is not promised: sort by `created_at`. */
  snapshots(app: string, id: string): Promise<Array<{ id: string; created_at: string }>>;
  createMachine(app: string, opts: { region: string; config: MachineConfig }): Promise<Machine>;
  machine(app: string, id: string): Promise<Machine>;
  updateMachine(app: string, id: string, config: MachineConfig): Promise<Machine>;
  start(app: string, id: string): Promise<void>;
  /** Stops and starts it again: what is in memory is gone, the volume stays. */
  restart(app: string, id: string): Promise<void>;
  /** Resolves once the machine is started, or throws after `timeoutS` (60 at most). */
  waitStarted(app: string, id: string, timeoutS: number): Promise<void>;
}

export class FlyApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class FlyMachines implements FlyApi {
  constructor(
    private readonly token: string,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly base = 'https://api.machines.dev/v1',
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchFn(`${this.base}${path}`, {
      method,
      // `fly tokens create` gives macaroons that carry their own scheme ("FlyV1 …").
      headers: { authorization: this.token.startsWith('FlyV1 ') ? this.token : `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    const text = await res.text();
    // The body is Fly's error message, never our token: safe to keep.
    if (!res.ok) throw new FlyApiError(res.status, `fly ${method} ${path}: ${res.status} ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  createVolume(app: string, { name, region, sizeGb, backupDays }: VolumeOpts) {
    return this.call<{ id: string }>('POST', `/apps/${app}/volumes`, {
      name,
      region,
      size_gb: sizeGb,
      encrypted: true,
      auto_backup_enabled: true,
      snapshot_retention: backupDays,
    });
  }

  volume(app: string, id: string) {
    return this.call<Volume>('GET', `/apps/${app}/volumes/${id}`);
  }

  extendVolume(app: string, id: string, sizeGb: number) {
    return this.call<{ needs_restart: boolean }>('PUT', `/apps/${app}/volumes/${id}/extend`, { size_gb: sizeGb });
  }

  async setBackups(app: string, id: string, days: number) {
    await this.call('PUT', `/apps/${app}/volumes/${id}`, { auto_backup_enabled: true, snapshot_retention: days });
  }

  snapshots(app: string, id: string) {
    return this.call<Array<{ id: string; created_at: string }>>('GET', `/apps/${app}/volumes/${id}/snapshots`);
  }

  createMachine(app: string, { region, config }: { region: string; config: MachineConfig }) {
    return this.call<Machine>('POST', `/apps/${app}/machines`, { region, config });
  }

  machine(app: string, id: string) {
    return this.call<Machine>('GET', `/apps/${app}/machines/${id}`);
  }

  updateMachine(app: string, id: string, config: MachineConfig) {
    return this.call<Machine>('POST', `/apps/${app}/machines/${id}`, { config });
  }

  async start(app: string, id: string) {
    await this.call('POST', `/apps/${app}/machines/${id}/start`);
  }

  async restart(app: string, id: string) {
    await this.call('POST', `/apps/${app}/machines/${id}/restart`);
  }

  async waitStarted(app: string, id: string, timeoutS: number) {
    await this.call('GET', `/apps/${app}/machines/${id}/wait?state=started&timeout=${Math.min(60, timeoutS)}`);
  }
}
