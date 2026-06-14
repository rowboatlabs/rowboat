import { AgentLoopImpl, type AgentLoop } from "../agent-loop/agent-loop.js";
import { VercelModelAdapter } from "../agent-loop/model-adapter.js";
import { SqliteTurnStore } from "../agent-loop/sqlite-turn-store.js";
import { getDb, initStorage } from "../storage/database.js";
import { SessionsImpl, type Sessions } from "../sessions/sessions.js";
import { SqliteSessionStore } from "../sessions/sqlite-session-store.js";
import { AgentTools } from "./agent-tools.js";
import { CopilotSystemComposer } from "./copilot-system-composer.js";
import { CopilotUserMessageContextComposer } from "./copilot-user-message-context.js";
import { RealPermissionGate, type SessionGrants } from "./real-permission-gate.js";
import { RealToolRunner } from "./real-tool-runner.js";
import { TurnEventBus } from "./turn-event-bus.js";

export * from "./agent-tools.js";
export * from "./real-tool-runner.js";
export * from "./real-permission-gate.js";
export * from "./copilot-system-composer.js";
export * from "./copilot-user-message-context.js";
export * from "./turn-event-bus.js";
export * from "./headless.js";

export type AgentRuntime = {
    sessions: Sessions;
    agentLoop: AgentLoop;
    // The session/turn event feed (live deltas + state snapshots). The main
    // process subscribes and forwards it to renderer windows.
    bus: TurnEventBus;
};

// The single assembly point for the new runtime. Wires the SQLite stores, the
// Vercel model adapter, and the two real bridges (tool runner + permission
// gate) into an AgentLoop, and layers Sessions on top. This is what the main
// process will instantiate once and hand to the IPC layer.
export async function createAgentRuntime(deps: {
    sessionGrants?: SessionGrants;
} = {}): Promise<AgentRuntime> {
    await initStorage();
    const db = getDb();

    const turnStore = new SqliteTurnStore(db);
    const sessionStore = new SqliteSessionStore(db);

    // One AgentTools instance shared by both bridges so an agent's config is
    // loaded and cached once, not once per bridge.
    const agentTools = new AgentTools();

    const bus = new TurnEventBus();
    const agentLoop = new AgentLoopImpl({
        store: turnStore,
        modelAdapter: new VercelModelAdapter(),
        toolRunner: new RealToolRunner({ agentTools }),
        permissionGate: new RealPermissionGate({
            agentTools,
            ...(deps.sessionGrants ? { sessionGrants: deps.sessionGrants } : {}),
        }),
        systemComposer: new CopilotSystemComposer(agentTools),
        observer: bus,
    });

    const sessions = new SessionsImpl({
        sessionStore,
        turnStore,
        agentLoop,
        userMessageContext: new CopilotUserMessageContextComposer(),
    });
    return { sessions, agentLoop, bus };
}

// The process-wide runtime singleton. The main process creates it once at
// startup (passing any deps), and headless callers (schedulers, knowledge
// pipelines, live-note / background-task runners) reach the SAME instance — so
// their turns share the one agent loop, store, and event bus.
let runtimeSingleton: Promise<AgentRuntime> | null = null;

export function getAgentRuntime(deps: { sessionGrants?: SessionGrants } = {}): Promise<AgentRuntime> {
    if (!runtimeSingleton) {
        runtimeSingleton = createAgentRuntime(deps);
    }
    return runtimeSingleton;
}
