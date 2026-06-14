import { asClass, asValue, createContainer, InjectionMode } from "awilix";
import { FSModelConfigRepo, IModelConfigRepo } from "../models/repo.js";
import { FSMcpConfigRepo, IMcpConfigRepo } from "../mcp/repo.js";
import { FSAgentsRepo, IAgentsRepo } from "../agents/repo.js";
import { IMonotonicallyIncreasingIdGenerator, IdGen } from "../application/lib/id-gen.js";
import { IBus, InMemoryBus } from "../application/lib/bus.js";
import { IRunsLock, InMemoryRunsLock } from "../runs/lock.js";
import { FSOAuthRepo, IOAuthRepo } from "../auth/repo.js";
import { FSClientRegistrationRepo, IClientRegistrationRepo } from "../auth/client-repo.js";
import { FSGranolaConfigRepo, IGranolaConfigRepo } from "../knowledge/granola/repo.js";
import { FSCodeModeConfigRepo, ICodeModeConfigRepo } from "../code-mode/repo.js";
import { IAbortRegistry, InMemoryAbortRegistry } from "../runs/abort-registry.js";
import { FSAgentScheduleRepo, IAgentScheduleRepo } from "../agent-schedule/repo.js";
import { FSAgentScheduleStateRepo, IAgentScheduleStateRepo } from "../agent-schedule/state-repo.js";
import { FSSlackConfigRepo, ISlackConfigRepo } from "../slack/repo.js";
import { CodeModeManager } from "../code-mode/acp/manager.js";
import { CodePermissionRegistry } from "../code-mode/acp/permission-registry.js";
import { FSCodeProjectsRepo, ICodeProjectsRepo } from "../code-mode/projects/repo.js";
import { FSCodeSessionsRepo, ICodeSessionsRepo } from "../code-mode/sessions/repo.js";
import { CodeSessionService } from "../code-mode/sessions/service.js";
import { CodeSessionStatusTracker } from "../code-mode/sessions/status-tracker.js";
import type { IBrowserControlService } from "../application/browser-control/service.js";
import type { INotificationService } from "../application/notification/service.js";

const container = createContainer({
    injectionMode: InjectionMode.PROXY,
    strict: true,
});

container.register({
    idGenerator: asClass<IMonotonicallyIncreasingIdGenerator>(IdGen).singleton(),
    bus: asClass<IBus>(InMemoryBus).singleton(),
    runsLock: asClass<IRunsLock>(InMemoryRunsLock).singleton(),
    abortRegistry: asClass<IAbortRegistry>(InMemoryAbortRegistry).singleton(),

    mcpConfigRepo: asClass<IMcpConfigRepo>(FSMcpConfigRepo).singleton(),
    modelConfigRepo: asClass<IModelConfigRepo>(FSModelConfigRepo).singleton(),
    agentsRepo: asClass<IAgentsRepo>(FSAgentsRepo).singleton(),
    oauthRepo: asClass<IOAuthRepo>(FSOAuthRepo).singleton(),
    clientRegistrationRepo: asClass<IClientRegistrationRepo>(FSClientRegistrationRepo).singleton(),
    granolaConfigRepo: asClass<IGranolaConfigRepo>(FSGranolaConfigRepo).singleton(),
    codeModeConfigRepo: asClass<ICodeModeConfigRepo>(FSCodeModeConfigRepo).singleton(),
    agentScheduleRepo: asClass<IAgentScheduleRepo>(FSAgentScheduleRepo).singleton(),
    agentScheduleStateRepo: asClass<IAgentScheduleStateRepo>(FSAgentScheduleStateRepo).singleton(),
    slackConfigRepo: asClass<ISlackConfigRepo>(FSSlackConfigRepo).singleton(),

    // ACP code-mode engine: the manager holds a live agent connection per chat only
    // around an active turn (torn down after a short idle grace; resumed via
    // session/load); the registry brokers mid-run approvals.
    codeModeManager: asClass(CodeModeManager).singleton(),
    codePermissionRegistry: asClass(CodePermissionRegistry).singleton(),

    // Code section: project registry, session metadata, the direct-drive
    // session service, and the live status tracker.
    codeProjectsRepo: asClass<ICodeProjectsRepo>(FSCodeProjectsRepo).singleton(),
    codeSessionsRepo: asClass<ICodeSessionsRepo>(FSCodeSessionsRepo).singleton(),
    codeSessionService: asClass(CodeSessionService).singleton(),
    codeSessionStatusTracker: asClass(CodeSessionStatusTracker).singleton(),
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
