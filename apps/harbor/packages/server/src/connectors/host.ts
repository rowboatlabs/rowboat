import { type AgentCredential, type Member } from '@rowboat/spaces-protocol';
import { ulid } from 'ulid';
import { hashAgentKey, mintAgentKeySecret } from '../agent-keys.js';
import { HarborError } from '../errors.js';
import type { SpaceHub } from '../hub.js';
import { assertSealingConfigured, credentialHint, seal, unseal } from '../sealing.js';
import type { HarborService } from '../service.js';
import type { Store } from '../store.js';
import type { CredentialTarget } from '../core/agents.js';
import { HOSTED_CONNECTIONS, PLATFORMS, type ConnectorEnv, type RunningConnector } from './platforms.js';

// Runs one org's connectors (spec §8 Connectors, 2026-09-30): one per agent
// whose connection is a platform Harbor calls. Started at boot for every such
// agent, and when one is added. One instance only for now: two Harbor
// instances would both start each connector and could act on the same
// invocation; the ownership lease that fixes it is on the list in SPEC.md §4
// "Running more than one instance".

export class HostedConnectors {
  private readonly running = new Map<string, RunningConnector>();
  /** One mint at a time per agent: two turns starting together share one key. */
  private readonly minting = new Map<string, Promise<string>>();

  constructor(
    private readonly deps: { store: Store; hub: SpaceHub; service: HarborService; orgId: string },
  ) {}

  /** Check a platform credential before anything is saved: that this Harbor can seal it, then with the platform. */
  async verify(connection: string, secret: string, target: CredentialTarget): Promise<void> {
    const platform = PLATFORMS[connection];
    if (!platform) throw new HarborError('invalid_request', `this Harbor has no connector for ${connection}`);
    assertSealingConfigured();
    await platform.verify(secret, target);
  }

  /** Seal and store an agent's credential for this org (a replacement clears a rejection). */
  async save(agentId: string, secret: string, setBy: string): Promise<AgentCredential> {
    const credential = { hint: credentialHint(secret), setBy, setAt: this.deps.service.now() };
    await this.deps.store.putAgentCredential({ agentId, sealed: seal(secret, this.deps.orgId, agentId), ...credential });
    return credential;
  }

  /** The agent's platform's words for an alert, or undefined when it says nothing (spec §8 Alerts). */
  alert(connection: string, payload: unknown): string | undefined {
    return PLATFORMS[connection]?.alert?.(payload);
  }

  async startAll(): Promise<void> {
    for (const agent of await this.deps.store.listAgentsByConnection(HOSTED_CONNECTIONS)) this.ensure(agent);
  }

  /** Start the agent's connector if Harbor runs one for its connection and it isn't running yet. */
  ensure(agent: Member): void {
    if (this.running.has(agent.id) || !agent.agentConnection) return;
    const platform = PLATFORMS[agent.agentConnection];
    if (!platform) return;
    this.running.set(agent.id, platform.start(this.env(agent)));
  }

  async stopAll(): Promise<void> {
    const running = [...this.running.values()];
    this.running.clear();
    await Promise.allSettled(running.map((connector) => connector.stop()));
  }

  private env(agent: Member): ConnectorEnv {
    const { store, hub, service, orgId } = this.deps;
    const tag = `[harbor] connector ${agent.agentConnection} ${agent.id}:`;
    return {
      agent,
      orgUrl: orgUrl(service.org.address),
      service,
      ctx: { memberId: agent.id, agent: true },
      subscribe: (fn) => hub.subscribeMember(agent.id, fn),
      subscribeSpace: (spaceId, fn) => hub.subscribe(spaceId, fn),
      credential: async () => {
        const stored = await store.getAgentCredential(agent.id);
        if (!stored) throw new HarborError('invalid_request', 'this agent has no platform key');
        return unseal(stored.sealed, orgId, agent.id);
      },
      rejectCredential: (reason) => store.rejectAgentCredential(agent.id, service.now(), reason),
      agentKey: () => this.agentKey(agent.id),
      thread: {
        get: (spaceId, threadRootId) => store.getConnectionThread(agent.id, spaceId, threadRootId),
        put: (spaceId, threadRootId, data) => store.putConnectionThread(agent.id, spaceId, threadRootId, data, service.now()),
      },
      log: (message, detail) => (detail === undefined ? console.log(tag, message) : console.log(tag, message, detail)),
    };
  }

  /**
   * The key the agent's workspaces call Spaces with (spec §8 Connectors,
   * 2026-10-06): the one kept for it, or a new one when there is none or its
   * owner revoked it. Created by the agent itself, so the agent page lists it
   * beside the owner's keys.
   */
  private agentKey(agentId: string): Promise<string> {
    const inFlight = this.minting.get(agentId);
    if (inFlight) return inFlight;
    const work = (async () => {
      const { store, service, orgId } = this.deps;
      const kept = await store.getConnectorKey(agentId);
      if (kept) {
        const key = await store.getAgentKey(kept.keyId);
        if (key && !key.revokedAt) return unseal(kept.sealed, orgId, connectorKeyBinding(agentId));
      }
      assertSealingConfigured();
      const secret = mintAgentKeySecret();
      const keyId = ulid();
      const at = service.now();
      await store.putAgentKey({ id: keyId, agentId, hash: hashAgentKey(secret), createdBy: agentId, createdAt: at });
      await store.putConnectorKey(agentId, keyId, seal(secret, orgId, connectorKeyBinding(agentId)), at);
      return secret;
    })().finally(() => this.minting.delete(agentId));
    this.minting.set(agentId, work);
    return work;
  }
}

/** Sealed under a binding of its own, so it can never be swapped for the agent's platform credential. */
const connectorKeyBinding = (agentId: string) => `${agentId}#workspace-key`;

/** `host[:port]` → a URL: plain http only on this machine. */
export function orgUrl(address: string): string {
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(address) ? `http://${address}` : `https://${address}`;
}
