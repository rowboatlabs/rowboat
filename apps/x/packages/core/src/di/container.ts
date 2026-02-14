import { asClass, createContainer, InjectionMode } from "awilix";
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
import { IAbortRegistry, InMemoryAbortRegistry } from "../runs/abort-registry.js";
import { FSAgentScheduleRepo, IAgentScheduleRepo } from "../agent-schedule/repo.js";
import { FSAgentScheduleStateRepo, IAgentScheduleStateRepo } from "../agent-schedule/state-repo.js";
import { FSConfigRepo, IConfigRepo } from "../config/repo.js";
import type { ILlmService } from "../execution/llm-service.js";
import type { IGmailService } from "../execution/gmail-service.js";
import type { ISttService } from "../execution/stt-service.js";
import type { IComposioService } from "../execution/composio-service.js";
import { LocalLlmService } from "../execution/local/local-llm-service.js";
import { LocalGmailService } from "../execution/local/local-gmail-service.js";
import { LocalSttService } from "../execution/local/local-stt-service.js";
import { LocalComposioService } from "../execution/local/local-composio-service.js";

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
    agentRuntime: asClass<IAgentRuntime>(AgentRuntime).singleton(),

    mcpConfigRepo: asClass<IMcpConfigRepo>(FSMcpConfigRepo).singleton(),
    modelConfigRepo: asClass<IModelConfigRepo>(FSModelConfigRepo).singleton(),
    agentsRepo: asClass<IAgentsRepo>(FSAgentsRepo).singleton(),
    runsRepo: asClass<IRunsRepo>(FSRunsRepo).singleton(),
    oauthRepo: asClass<IOAuthRepo>(FSOAuthRepo).singleton(),
    clientRegistrationRepo: asClass<IClientRegistrationRepo>(FSClientRegistrationRepo).singleton(),
    granolaConfigRepo: asClass<IGranolaConfigRepo>(FSGranolaConfigRepo).singleton(),
    agentScheduleRepo: asClass<IAgentScheduleRepo>(FSAgentScheduleRepo).singleton(),
    agentScheduleStateRepo: asClass<IAgentScheduleStateRepo>(FSAgentScheduleStateRepo).singleton(),

    configRepo: asClass<IConfigRepo>(FSConfigRepo).singleton(),
});

const appConfig = container.resolve<IConfigRepo>("configRepo").getConfigSync();

switch (appConfig.executionProfile.mode) {
    case "local":
        container.register({
            llmService: asClass<ILlmService>(LocalLlmService).singleton(),
            gmailService: asClass<IGmailService>(LocalGmailService).singleton(),
            sttService: asClass<ISttService>(LocalSttService).singleton(),
            composioService: asClass<IComposioService>(LocalComposioService).singleton(),
        });
        break;
    case "cloud":
        throw new Error("Cloud execution profile not supported yet. Configure {\"executionProfile\":{\"mode\":\"local\"}}.");
    default:
        throw new Error(`Unsupported execution profile mode: ${(appConfig.executionProfile as { mode: string }).mode}`);
}

export default container;
