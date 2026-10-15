import { BUILT_IN_CONNECTION, HARBOR_RUN_CONNECTIONS, type Member, type ServerFrame } from '@rowboat/spaces-protocol';
import type { ActorCtx } from '../core/kernel.js';
import type { CredentialTarget } from '../core/agents.js';
import type { HarborService } from '../service.js';
import { agent37Platform } from './agent37/index.js';
import { calPlatform } from './cal/index.js';
import { conductorPlatform } from './conductor/index.js';
import { jevPlatform } from './jev/index.js';
import { posthogPlatform } from './posthog/index.js';
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
  /** A space's frames, as a live connection subscribed to it gets them: Jev reads every message (spec §8 Jev). */
  subscribeSpace(spaceId: string, fn: (frame: ServerFrame) => void): () => void;
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
   * Check a credential with the platform before Harbor saves it: that it is
   * accepted and, for an instance connection, that it reaches the agent's
   * instance and the instance runs the agent's kind. Throws a
   * HarborError('invalid_request') carrying the reason on refusal.
   */
  verify(secret: string, target: CredentialTarget): Promise<void>;
  /** Run the connector for one agent until stopped. */
  start(env: ConnectorEnv): RunningConnector;
  /**
   * What the agent says about an alert its platform sent to its hook (spec §8
   * Alerts, 2026-10-03): the message to post, or undefined for an event it
   * leaves unsaid. Absent = the platform sends none.
   */
  alert?(payload: unknown): string | undefined;
}

/** One entry per connection in HARBOR_RUN_CONNECTIONS, and Jev's, the one built in (2026-10-07). */
export const PLATFORMS: Record<string, ConnectorPlatform> = {
  replicas: replicasPlatform(),
  agent37: agent37Platform(),
  conductor: conductorPlatform(),
  posthog: posthogPlatform(),
  cal: calPlatform(),
  [BUILT_IN_CONNECTION]: jevPlatform(),
};

/** Every connection whose connector Harbor runs: the platforms it calls, and the agent it is. */
export const HOSTED_CONNECTIONS: readonly string[] = [...HARBOR_RUN_CONNECTIONS, BUILT_IN_CONNECTION];
