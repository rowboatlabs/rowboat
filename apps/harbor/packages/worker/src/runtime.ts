// The runtime adapter: what the worker asks of a harness, and all a harness
// has to answer. Codex is the first (codex/runtime.ts); Claude Code and
// Hermes fit the same five calls. A harness that cannot steer says so, and
// Harbor keeps queueing for it.

export interface ModelChoice {
  id: string;
  label: string;
}

export type TurnEvent =
  /** What the harness is doing now, in the words the thread shows ("is running `npm test`"). */
  | { type: 'activity'; activity: string }
  /** A message from the harness to the person; the last one is the answer. */
  | { type: 'answer'; text: string };

export interface TurnResult {
  status: 'completed' | 'interrupted' | 'failed';
  /** The harness's final message, when it said anything. */
  answer?: string;
  error?: string;
}

/** A turn in flight: resolve `done`, or steer and interrupt it meanwhile. */
export interface TurnHandle {
  readonly id: string;
  readonly done: Promise<TurnResult>;
  /** Add input to the running turn. Throws TurnOverError once the turn has ended, so the caller runs the input as a turn of its own. */
  steer(text: string): Promise<void>;
  interrupt(): Promise<void>;
}

export class TurnOverError extends Error {}

export interface OpenSessionInput {
  /** The harness's session for the conversation from a previous turn; none starts one. */
  sessionId?: string;
  cwd: string;
}

export interface TurnInput {
  sessionId: string;
  prompt: string;
  model?: string;
  effort?: string;
  onEvent: (event: TurnEvent) => void;
}

export interface Runtime {
  readonly name: string;
  /** How the thread names it ("Codex"). */
  readonly label: string;
  readonly capabilities: { steer: boolean };
  /** Start the harness; a harness that is already up answers at once. */
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Start or resume the harness's session for a conversation; returns the id the next turn resumes. */
  openSession(input: OpenSessionInput): Promise<{ sessionId: string }>;
  turn(input: TurnInput): Promise<TurnHandle>;
  /** The models the composer may offer; empty when the harness lists none. */
  models(): Promise<ModelChoice[]>;
  efforts(): ModelChoice[];
}
