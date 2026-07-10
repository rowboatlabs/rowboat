import path from "node:path";
import { asClass, asFunction, asValue, createContainer, InjectionMode } from "awilix";
import { WorkDir } from "../config/config.js";
import { FSModelConfigRepo, IModelConfigRepo } from "../models/repo.js";
import { FSMcpConfigRepo, IMcpConfigRepo } from "../mcp/repo.js";
import { FSAgentsRepo, IAgentsRepo } from "../runtime/assembly/repo.js";
import { FSRunsRepo, IRunsRepo } from "../runtime/legacy/repo.js";
import { IMonotonicallyIncreasingIdGenerator, IdGen } from "../application/lib/id-gen.js";
import { IMessageQueue, InMemoryMessageQueue } from "../application/lib/message-queue.js";
import { IBus, InMemoryBus } from "../application/lib/bus.js";
import { IRunsLock, InMemoryRunsLock } from "../runtime/legacy/lock.js";
import { IAgentRuntime, AgentRuntime } from "../runtime/legacy/engine.js";
import { FSOAuthRepo, IOAuthRepo } from "../auth/repo.js";
import { FSClientRegistrationRepo, IClientRegistrationRepo } from "../auth/client-repo.js";
import { FSGranolaConfigRepo, IGranolaConfigRepo } from "../knowledge/granola/repo.js";
import { FSCodeModeConfigRepo, ICodeModeConfigRepo } from "../code-mode/repo.js";
import { IAbortRegistry, InMemoryAbortRegistry } from "../runtime/turns/abort-registry.js";
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
import { SystemClock, type IClock } from "../runtime/turns/clock.js";
import { FSTurnRepo } from "../runtime/turns/fs-repo.js";
import type { ITurnRepo } from "../runtime/turns/repo.js";
import type { IContextResolver } from "../runtime/turns/context-resolver.js";
import { createContextResolver } from "../runtime/turns/context-elision.js";
import { EmitterTurnLifecycleBus, type ITurnLifecycleBus } from "../runtime/turns/bus.js";
import { TurnEventHub, type ITurnEventBus } from "../runtime/turns/event-hub.js";
import { RealUsageReporter } from "../runtime/turns/bridges/real-usage-reporter.js";
import type { IUsageReporter } from "../runtime/turns/usage-reporter.js";
import { TurnRuntime } from "../runtime/turns/runtime.js";
import type { ITurnRuntime } from "../runtime/turns/api.js";
import type { IAgentResolver } from "../runtime/turns/agent-resolver.js";
import type { IModelRegistry } from "../runtime/turns/model-registry.js";
import type { IToolRegistry } from "../runtime/turns/tool-registry.js";
import type { IPermissionChecker, IPermissionClassifier } from "../runtime/turns/permission.js";
import { RealAgentResolver } from "../runtime/turns/bridges/real-agent-resolver.js";
import { InlineAgentResolver } from "../runtime/turns/bridges/inline-agent-resolver.js";
import { DispatchingAgentResolver } from "../runtime/turns/bridges/agent-resolver-dispatch.js";
import { RealModelRegistry } from "../runtime/turns/bridges/real-model-registry.js";
import { RealToolRegistry } from "../runtime/turns/bridges/real-tool-registry.js";
import { RealPermissionChecker } from "../runtime/turns/bridges/real-permission-checker.js";
import { RealPermissionClassifier } from "../runtime/turns/bridges/real-permission-classifier.js";
import { FSSessionRepo } from "../runtime/sessions/fs-repo.js";
import type { ISessionRepo } from "../runtime/sessions/repo.js";
import { EmitterSessionBus, type ISessionBus } from "../runtime/sessions/bus.js";
import { SessionsImpl } from "../runtime/sessions/sessions.js";
import type { ISessions } from "../runtime/sessions/api.js";
import {
    DefaultModelResolver,
    type IDefaultModelResolver,
} from "../models/default-model-resolver.js";
import {
    HeadlessAgentRunner,
    type IHeadlessAgentRunner,
} from "../runtime/assembly/headless.js";

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
    contextResolver: asFunction<IContextResolver>(({ turnRepo }) =>
        createContextResolver({ turnRepo }),
    ).singleton(),
    lifecycleBus: asClass<ITurnLifecycleBus>(EmitterTurnLifecycleBus).singleton(),
    // Process-wide turn event spine: every turn's events, tagged with
    // sessionId and durable file offsets, regardless of who started the turn.
    turnEventBus: asClass<ITurnEventBus>(TurnEventHub).singleton(),
    usageReporter: asClass<IUsageReporter>(RealUsageReporter).singleton(),
    agentResolver: asFunction<IAgentResolver>(
        () =>
            new DispatchingAgentResolver(
                new RealAgentResolver(),
                new InlineAgentResolver(),
            ),
    ).singleton(),
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
