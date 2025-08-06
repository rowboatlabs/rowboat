import { RunConversationTurnUseCase } from "@/src/application/use-cases/conversations/run-conversation-turn.use-case";
import { MongoDBConversationsRepository } from "@/src/infrastructure/repositories/mongodb.conversations.repository";
import { RunCachedTurnController } from "@/src/interface-adapters/controllers/conversations/run-cached-turn.controller";
import { asClass, createContainer, InjectionMode } from "awilix";
import { CreatePlaygroundConversationController } from "@/src/interface-adapters/controllers/conversations/create-playground-conversation.controller";
import { CreateConversationUseCase } from "@/src/application/use-cases/conversations/create-conversation.use-case";
import { RedisCacheService } from "@/src/infrastructure/services/redis.cache.service";
import { CreateCachedTurnUseCase } from "@/src/application/use-cases/conversations/create-cached-turn.use-case";
import { FetchCachedTurnUseCase } from "@/src/application/use-cases/conversations/fetch-cached-turn.use-case";
import { CreateCachedTurnController } from "@/src/interface-adapters/controllers/conversations/create-cached-turn.controller";
import { RunTurnController } from "@/src/interface-adapters/controllers/conversations/run-turn.controller";
import { RedisUsageQuotaPolicy } from "@/src/infrastructure/policies/redis.usage-quota.policy";
import { ProjectActionAuthorizationPolicy } from "@/src/application/policies/project-action-authorization.policy";
import { MongoDBProjectMembersRepository } from "@/src/infrastructure/repositories/mongodb.project-members.repository";
import { MongoDBApiKeysRepository } from "@/src/infrastructure/repositories/mongodb.api-keys.repository";
import { MongodbProjectsRepository } from "@/src/infrastructure/repositories/mongodb.projects.repository";
import { MongodbComposioTriggerDeploymentsRepository } from "@/src/infrastructure/repositories/mongodb.composio-trigger-deployments.repository";
import { CreateComposioTriggerDeploymentUseCase } from "@/src/application/use-cases/composio-trigger-deployments/create-composio-trigger-deployment.use-case";
import { ListComposioTriggerDeploymentsUseCase } from "@/src/application/use-cases/composio-trigger-deployments/list-composio-trigger-deployments.use-case";
import { DeleteComposioTriggerDeploymentUseCase } from "@/src/application/use-cases/composio-trigger-deployments/delete-composio-trigger-deployment.use-case";
import { ListComposioTriggerTypesUseCase } from "@/src/application/use-cases/composio-trigger-deployments/list-composio-trigger-types.use-case";
import { DeleteComposioConnectedAccountUseCase } from "@/src/application/use-cases/composio/delete-composio-connected-account.use-case";

export const container = createContainer({
    injectionMode: InjectionMode.PROXY,
    strict: true,
});

container.register({
    // services
    // ---
    cacheService: asClass(RedisCacheService).singleton(),

    // policies
    // ---
    usageQuotaPolicy: asClass(RedisUsageQuotaPolicy).singleton(),
    projectActionAuthorizationPolicy: asClass(ProjectActionAuthorizationPolicy).singleton(),

    // projects
    // ---
    projectsRepository: asClass(MongodbProjectsRepository).singleton(),

    // project members
    // ---
    projectMembersRepository: asClass(MongoDBProjectMembersRepository).singleton(),

    // api keys
    // ---
    apiKeysRepository: asClass(MongoDBApiKeysRepository).singleton(),

    // composio
    // ---
    deleteComposioConnectedAccountUseCase: asClass(DeleteComposioConnectedAccountUseCase).singleton(),

    // composio trigger deployments
    // ---
    composioTriggerDeploymentsRepository: asClass(MongodbComposioTriggerDeploymentsRepository).singleton(),

    listComposioTriggerTypesUseCase: asClass(ListComposioTriggerTypesUseCase).singleton(),
    createComposioTriggerDeploymentUseCase: asClass(CreateComposioTriggerDeploymentUseCase).singleton(),
    listComposioTriggerDeploymentsUseCase: asClass(ListComposioTriggerDeploymentsUseCase).singleton(),
    deleteComposioTriggerDeploymentUseCase: asClass(DeleteComposioTriggerDeploymentUseCase).singleton(),

    // conversations
    // ---
    conversationsRepository: asClass(MongoDBConversationsRepository).singleton(),

    createConversationUseCase: asClass(CreateConversationUseCase).singleton(),
    createCachedTurnUseCase: asClass(CreateCachedTurnUseCase).singleton(),
    fetchCachedTurnUseCase: asClass(FetchCachedTurnUseCase).singleton(),
    runConversationTurnUseCase: asClass(RunConversationTurnUseCase).singleton(),

    createPlaygroundConversationController: asClass(CreatePlaygroundConversationController).singleton(),
    createCachedTurnController: asClass(CreateCachedTurnController).singleton(),
    runCachedTurnController: asClass(RunCachedTurnController).singleton(),
    runTurnController: asClass(RunTurnController).singleton(),
});