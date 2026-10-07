import type { Member, ServerFrame } from '@rowboat/spaces-protocol';
import type { ActorCtx } from '../core/kernel.js';
import type { HarborService } from '../service.js';
import { conductorPlatform } from './conductor/index.js';
import { replicasPlatform } from './replicas/index.js';

// Connectors Harbor runs (spec §8 Connectors, 2026-09-30): for an agent whose
// connection names a platform Harbor calls on its behalf (HARBOR_RUN_CONNECTIONS
// in the protocol), Harbor starts that platform's connector. Each connector is
// a client of the agent contract in-process: it acts as its agent through the
// same service operations a connector outside Harbor calls over HTTP, and wakes
// on the agent's own frames and the one-minute list. Each platform lives in its
// own module beside this file, with its own tests.

/** What Harbor hands a running connector: its agent, the contract, and the connector's own storage. */
export interface ConnectorEnv {
  agent: Member;
  /** The org's public address, with its scheme: links in prompts, and what an agent's tools call. */
  orgUrl: string;
  service: HarborService;
  /** The agent itself: `{ memberId: agent.id, agent: true }`, as its key would resolve. */
  ctx: ActorCtx;
  /** The agent's own frames (invocation, invocation_stop), as its live connection would get them. */
  subscribe(fn: (frame: ServerFrame) => void): () => void;
  /** The platform's credential, unsealed for this call. Never kept, logged, or put in a message. */
  credential(): Promise<string>;
  /** The platform refused the credential: marks it rejected; true only the first time, until it is replaced. */
  rejectCredential(reason: string): Promise<boolean>;
  /**
   * A key of the agent's own for the platform's workspaces to call Spaces
   * with (an `rbk_` key; minted again if its owner revoked it). Only for
   * platforms that let the connector set a workspace's variables (Conductor).
   */
  agentKey(): Promise<string>;
  /** The connector's own record for one thread (spec §8: its platform session and what is in flight). */
  thread: {
    get(spaceId: string, threadRootId: string): Promise<unknown | undefined>;
    put(spaceId: string, threadRootId: string, data: unknown): Promise<void>;
  };
  log(message: string, detail?: unknown): void;
}

export interface RunningConnector {
  stop(): Promise<void>;
}

export interface ConnectorPlatform {
  /**
   * Check a credential with the platform before Harbor saves it. Throws a
   * HarborError('invalid_request') carrying the platform's reason on refusal.
   */
  verify(secret: string): Promise<void>;
  /** Run the connector for one agent until stopped. */
  start(env: ConnectorEnv): RunningConnector;
}

/** One entry per connection in HARBOR_RUN_CONNECTIONS. */
export const PLATFORMS: Record<string, ConnectorPlatform> = {
  replicas: replicasPlatform(),
  conductor: conductorPlatform(),
};
