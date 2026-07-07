import path from "node:path";
import { asClass, asFunction, asValue, createContainer, InjectionMode } from "awilix";
import { WorkDir } from "../config/config.js";
import { FSModelConfigRepo, IModelConfigRepo } from "../models/repo.js";
import { FSMcpConfigRepo, IMcpConfigRepo } from "../mcp/repo.js";
import { FSAgentsRepo, IAgentsRepo } from "../agents/repo.js";
import { FSRunsRepo, IRunsRepo } from "../runs/repo.js";
import { IMonotonicallyIncreasingIdGenerator, IdGen } from "../application/lib/id-gen.js";
import { IMessageQueue, InMemoryMessageQueue } from "../application/lib/message-queue.js";
import { IBus, InMemoryBus } from "../application/lib/bus.js";
import { IRunsLock, InMemoryRunsLock } from "../runs/lock.js";
import { IAgentRuntime, AgentRuntime } from "../agents/runtime.js";
import { FSOAuthRepo, IOAuthRepo } from "../auth/repo.js";
import { FSClientRegistrationRepo, IClientRegistrationRepo } from "../auth/client-repo.js";
import { FSGranolaConfigRepo, IGranolaConfigRepo } from "../knowledge/granola/repo.js";
import { FSCodeModeConfigRepo, ICodeModeConfigRepo } from "../code-mode/repo.js";
import { IAbortRegistry, InMemoryAbortRegistry } from "../runs/abort-registry.js";
import { FSAgentScheduleRepo, IAgentScheduleRepo } from "../agent-schedule/repo.js";
import { FSAgentScheduleStateRepo, IAgentScheduleStateRepo } from "../agent-schedule/state-repo.js";
import { FSSlackConfigRepo, ISlackConfigRepo } from "../slack/repo.js";
import { FSChannelsConfigRepo, IChannelsConfigRepo } from "../channels/repo.js";
import { CodeModeManager } from "../code-mode/acp/manager.js";
import { CodePermissionRegistry } from "../code-mode/acp/permission-registry.js";
import { CodeRunFeed } from "../code-mode/feed.js";
import { FSCodeProjectsRepo, ICodeProjectsRepo } from "../code-mode/projects/repo.js";
import { FSCodeSessionsRepo, ICodeSessionsRepo } from "../code-mode/sessions/repo.js";
import { CodeSessionService } from "../code-mode/sessions/service.js";
import { CodeSessionStatusTracker } from "../code-mode/sessions/status-tracker.js";
import type { IBrowserControlService } from "../application/browser-control/service.js";
import type { INotificationService } from "../application/notification/service.js";
import { SystemClock, type IClock } from "../turns/clock.js";
import { FSTurnRepo } from "../turns/fs-repo.js";
import type { ITurnRepo } from "../turns/repo.js";
import { TurnRepoContextResolver, type IContextResolver } from "../turns/context-resolver.js";
import { EmitterTurnLifecycleBus, type ITurnLifecycleBus } from "../turns/bus.js";
import { RealUsageReporter } from "../turns/bridges/real-usage-reporter.js";
import type { IUsageReporter } from "../turns/usage-reporter.js";
import { TurnRuntime } from "../turns/runtime.js";
import type { ITurnRuntime } from "../turns/api.js";
import type { IAgentResolver } from "../turns/agent-resolver.js";
import type { IModelRegistry } from "../turns/model-registry.js";
import type { IToolRegistry } from "../turns/tool-registry.js";
import type { IPermissionChecker, IPermissionClassifier } from "../turns/permission.js";
import { RealAgentResolver } from "../turns/bridges/real-agent-resolver.js";
import { RealModelRegistry } from "../turns/bridges/real-model-registry.js";
import { RealToolRegistry } from "../turns/bridges/real-tool-registry.js";
import { RealPermissionChecker } from "../turns/bridges/real-permission-checker.js";
import { RealPermissionClassifier } from "../turns/bridges/real-permission-classifier.js";
import { FSSessionRepo } from "../sessions/fs-repo.js";
import type { ISessionRepo } from "../sessions/repo.js";
import { EmitterSessionBus, type ISessionBus } from "../sessions/bus.js";
import { SessionsImpl } from "../sessions/sessions.js";
import type { ISessions } from "../sessions/api.js";
import {
    DefaultModelResolver,
    type IDefaultModelResolver,
} from "../models/default-model-resolver.js";
import {
    HeadlessAgentRunner,
    type IHeadlessAgentRunner,
} from "../agents/headless.js";

const container = createContainer({
    injectionMode: InjectionMode.PROXY,
    strict: true,
});

container.register({
    idGenerator: asClass<IMonotonicallyIncreasingIdGenerator>(IdGen).singleton(),
    messageQueue: asClass<IMessageQueue>(InMemoryMessageQueue).singleton(),
    bus: asClass<IBus>(InMemoryBus).singleton(),
    runsLock: asClass<IRunsLock>(InMemoryRunsLock).singleton(),
    abortRegistry: asClass<IAbortRegistry>(InMemoryAbortRegistry).singleton(),
    // Lazy: agents/runtime.js participates in an import cycle with this
    // module (and is now also reachable via the turn-runtime bridges), so the
    // class binding may not be initialized yet when this body runs.
    agentRuntime: asFunction<IAgentRuntime>(
        (cradle) =>
            new AgentRuntime(
                cradle as unknown as ConstructorParameters<typeof AgentRuntime>[0],
            ),
    ).singleton(),

    mcpConfigRepo: asClass<IMcpConfigRepo>(FSMcpConfigRepo).singleton(),
    modelConfigRepo: asClass<IModelConfigRepo>(FSModelConfigRepo).singleton(),
    agentsRepo: asClass<IAgentsRepo>(FSAgentsRepo).singleton(),
    runsRepo: asClass<IRunsRepo>(FSRunsRepo).singleton(),
    oauthRepo: asClass<IOAuthRepo>(FSOAuthRepo).singleton(),
    clientRegistrationRepo: asClass<IClientRegistrationRepo>(FSClientRegistrationRepo).singleton(),
    granolaConfigRepo: asClass<IGranolaConfigRepo>(FSGranolaConfigRepo).singleton(),
    codeModeConfigRepo: asClass<ICodeModeConfigRepo>(FSCodeModeConfigRepo).singleton(),
    agentScheduleRepo: asClass<IAgentScheduleRepo>(FSAgentScheduleRepo).singleton(),
    agentScheduleStateRepo: asClass<IAgentScheduleStateRepo>(FSAgentScheduleStateRepo).singleton(),
    slackConfigRepo: asClass<ISlackConfigRepo>(FSSlackConfigRepo).singleton(),
    channelsConfigRepo: asClass<IChannelsConfigRepo>(FSChannelsConfigRepo).singleton(),

    // ACP code-mode engine: the manager holds a live agent connection per chat only
    // around an active turn (torn down after a short idle grace; resumed via
    // session/load); the registry brokers mid-run approvals.
    codeModeManager: asClass(CodeModeManager).singleton(),
    codePermissionRegistry: asClass(CodePermissionRegistry).singleton(),
    // Ephemeral live stream for code_agent_run (renderer side-channel; the
    // durable record is the settle-time code-run-events-batch).
    codeRunFeed: asClass(CodeRunFeed).singleton(),

    // Code section: project registry, session metadata, the direct-drive
    // session service, and the live status tracker.
    codeProjectsRepo: asClass<ICodeProjectsRepo>(FSCodeProjectsRepo).singleton(),
    codeSessionsRepo: asClass<ICodeSessionsRepo>(FSCodeSessionsRepo).singleton(),
    codeSessionService: asClass(CodeSessionService).singleton(),
    codeSessionStatusTracker: asClass(CodeSessionStatusTracker).singleton(),

    // New turn/session runtime (turn-runtime-design.md / session-design.md).
    // Bridges are constructed via asFunction so their optional test seams
    // don't collide with strict PROXY cradle resolution.
    clock: asClass<IClock>(SystemClock).singleton(),
    turnsRootDir: asValue(path.join(WorkDir, "storage", "turns")),
    sessionsRootDir: asValue(path.join(WorkDir, "storage", "sessions")),
    turnRepo: asClass<ITurnRepo>(FSTurnRepo).singleton(),
    contextResolver: asClass<IContextResolver>(TurnRepoContextResolver).singleton(),
    lifecycleBus: asClass<ITurnLifecycleBus>(EmitterTurnLifecycleBus).singleton(),
    usageReporter: asClass<IUsageReporter>(RealUsageReporter).singleton(),
    agentResolver: asFunction<IAgentResolver>(() => new RealAgentResolver()).singleton(),
    modelRegistry: asFunction<IModelRegistry>(() => new RealModelRegistry()).singleton(),
    toolRegistry: asFunction<IToolRegistry>(() => new RealToolRegistry()).singleton(),
    permissionChecker: asFunction<IPermissionChecker>(() => new RealPermissionChecker()).singleton(),
    permissionClassifier: asFunction<IPermissionClassifier>(() => new RealPermissionClassifier()).singleton(),
    turnRuntime: asClass<ITurnRuntime>(TurnRuntime).singleton(),
    sessionRepo: asClass<ISessionRepo>(FSSessionRepo).singleton(),
    sessionBus: asClass<ISessionBus>(EmitterSessionBus).singleton(),
    sessions: asClass<ISessions>(SessionsImpl).singleton(),
    defaultModelResolver:
        asClass<IDefaultModelResolver>(DefaultModelResolver).singleton(),
    headlessAgentRunner:
        asClass<IHeadlessAgentRunner>(HeadlessAgentRunner).singleton(),
});

export default container;

export function registerBrowserControlService(service: IBrowserControlService): void {
    container.register({
        browserControlService: asValue(service),
    });
}

export function registerNotificationService(service: INotificationService): void {
    container.register({
        notificationService: asValue(service),
    });
}
