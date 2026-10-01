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

export interface FlyApi {
  createVolume(app: string, opts: { name: string; region: string; sizeGb: number }): Promise<{ id: string }>;
  createMachine(app: string, opts: { region: string; config: MachineConfig }): Promise<Machine>;
  machine(app: string, id: string): Promise<Machine>;
  updateMachine(app: string, id: string, config: MachineConfig): Promise<Machine>;
  start(app: string, id: string): Promise<void>;
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
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    const text = await res.text();
    // The body is Fly's error message, never our token: safe to keep.
    if (!res.ok) throw new FlyApiError(res.status, `fly ${method} ${path}: ${res.status} ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  createVolume(app: string, { name, region, sizeGb }: { name: string; region: string; sizeGb: number }) {
    return this.call<{ id: string }>('POST', `/apps/${app}/volumes`, { name, region, size_gb: sizeGb, encrypted: true });
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

  async waitStarted(app: string, id: string, timeoutS: number) {
    await this.call('GET', `/apps/${app}/machines/${id}/wait?state=started&timeout=${Math.min(60, timeoutS)}`);
  }
}
