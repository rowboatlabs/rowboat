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
import { HandleCompsioWebhookRequestUseCase } from "@/src/application/use-cases/composio/webhook/handle-composio-webhook-request.use-case";
import { MongoDBJobsRepository } from "@/src/infrastructure/repositories/mongodb.jobs.repository";
import { CreateComposioTriggerDeploymentController } from "@/src/interface-adapters/controllers/composio-trigger-deployments/create-composio-trigger-deployment.controller";
import { DeleteComposioTriggerDeploymentController } from "@/src/interface-adapters/controllers/composio-trigger-deployments/delete-composio-trigger-deployment.controller";
import { ListComposioTriggerDeploymentsController } from "@/src/interface-adapters/controllers/composio-trigger-deployments/list-composio-trigger-deployments.controller";
import { ListComposioTriggerTypesController } from "@/src/interface-adapters/controllers/composio-trigger-deployments/list-composio-trigger-types.controller";
import { DeleteComposioConnectedAccountController } from "@/src/interface-adapters/controllers/composio/delete-composio-connected-account.controller";
import { HandleComposioWebhookRequestController } from "@/src/interface-adapters/controllers/composio/webhook/handle-composio-webhook-request.controller";
import { RedisPubSubService } from "@/src/infrastructure/services/redis.pub-sub.service";
import { JobsWorker } from "@/src/application/workers/jobs.worker";
import { ScheduledJobRulesWorker } from "@/src/application/workers/scheduled-job-rules.worker";
import { ListJobsUseCase } from "@/src/application/use-cases/jobs/list-jobs.use-case";
import { ListJobsController } from "@/src/interface-adapters/controllers/jobs/list-jobs.controller";
import { ListConversationsUseCase } from "@/src/application/use-cases/conversations/list-conversations.use-case";
import { ListConversationsController } from "@/src/interface-adapters/controllers/conversations/list-conversations.controller";
import { FetchJobUseCase } from "@/src/application/use-cases/jobs/fetch-job.use-case";
import { FetchJobController } from "@/src/interface-adapters/controllers/jobs/fetch-job.controller";
import { FetchConversationUseCase } from "@/src/application/use-cases/conversations/fetch-conversation.use-case";
import { FetchConversationController } from "@/src/interface-adapters/controllers/conversations/fetch-conversation.controller";

// Scheduled Job Rules
import { MongoDBScheduledJobRulesRepository } from "@/src/infrastructure/repositories/mongodb.scheduled-job-rules.repository";
import { CreateScheduledJobRuleUseCase } from "@/src/application/use-cases/scheduled-job-rules/create-scheduled-job-rule.use-case";
import { FetchScheduledJobRuleUseCase } from "@/src/application/use-cases/scheduled-job-rules/fetch-scheduled-job-rule.use-case";
import { ListScheduledJobRulesUseCase } from "@/src/application/use-cases/scheduled-job-rules/list-scheduled-job-rules.use-case";
import { CreateScheduledJobRuleController } from "@/src/interface-adapters/controllers/scheduled-job-rules/create-scheduled-job-rule.controller";
import { FetchScheduledJobRuleController } from "@/src/interface-adapters/controllers/scheduled-job-rules/fetch-scheduled-job-rule.controller";
import { ListScheduledJobRulesController } from "@/src/interface-adapters/controllers/scheduled-job-rules/list-scheduled-job-rules.controller";

// Recurring Job Rules
import { MongoDBRecurringJobRulesRepository } from "@/src/infrastructure/repositories/mongodb.recurring-job-rules.repository";
import { CreateRecurringJobRuleUseCase } from "@/src/application/use-cases/recurring-job-rules/create-recurring-job-rule.use-case";
import { FetchRecurringJobRuleUseCase } from "@/src/application/use-cases/recurring-job-rules/fetch-recurring-job-rule.use-case";
import { ListRecurringJobRulesUseCase } from "@/src/application/use-cases/recurring-job-rules/list-recurring-job-rules.use-case";
import { ToggleRecurringJobRuleUseCase } from "@/src/application/use-cases/recurring-job-rules/toggle-recurring-job-rule.use-case";
import { CreateRecurringJobRuleController } from "@/src/interface-adapters/controllers/recurring-job-rules/create-recurring-job-rule.controller";
import { FetchRecurringJobRuleController } from "@/src/interface-adapters/controllers/recurring-job-rules/fetch-recurring-job-rule.controller";
import { ListRecurringJobRulesController } from "@/src/interface-adapters/controllers/recurring-job-rules/list-recurring-job-rules.controller";
import { ToggleRecurringJobRuleController } from "@/src/interface-adapters/controllers/recurring-job-rules/toggle-recurring-job-rule.controller";
import { RecurringJobRulesWorker } from "@/src/application/workers/recurring-job-rules.worker";

export const container = createContainer({
    injectionMode: InjectionMode.PROXY,
    strict: true,
});

container.register({
    // workers
    // ---
    jobsWorker: asClass(JobsWorker).singleton(),
    scheduledJobRulesWorker: asClass(ScheduledJobRulesWorker).singleton(),
    recurringJobRulesWorker: asClass(RecurringJobRulesWorker).singleton(),

    // services
    // ---
    cacheService: asClass(RedisCacheService).singleton(),
    pubSubService: asClass(RedisPubSubService).singleton(),

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

    // jobs
    // ---
    jobsRepository: asClass(MongoDBJobsRepository).singleton(),
    listJobsUseCase: asClass(ListJobsUseCase).singleton(),
    listJobsController: asClass(ListJobsController).singleton(),
    fetchJobUseCase: asClass(FetchJobUseCase).singleton(),
    fetchJobController: asClass(FetchJobController).singleton(),

    // scheduled job rules
    // ---
    scheduledJobRulesRepository: asClass(MongoDBScheduledJobRulesRepository).singleton(),
    createScheduledJobRuleUseCase: asClass(CreateScheduledJobRuleUseCase).singleton(),
    fetchScheduledJobRuleUseCase: asClass(FetchScheduledJobRuleUseCase).singleton(),
    listScheduledJobRulesUseCase: asClass(ListScheduledJobRulesUseCase).singleton(),
    createScheduledJobRuleController: asClass(CreateScheduledJobRuleController).singleton(),
    fetchScheduledJobRuleController: asClass(FetchScheduledJobRuleController).singleton(),
    listScheduledJobRulesController: asClass(ListScheduledJobRulesController).singleton(),

    // recurring job rules
    // ---
    recurringJobRulesRepository: asClass(MongoDBRecurringJobRulesRepository).singleton(),
    createRecurringJobRuleUseCase: asClass(CreateRecurringJobRuleUseCase).singleton(),
    fetchRecurringJobRuleUseCase: asClass(FetchRecurringJobRuleUseCase).singleton(),
    listRecurringJobRulesUseCase: asClass(ListRecurringJobRulesUseCase).singleton(),
    toggleRecurringJobRuleUseCase: asClass(ToggleRecurringJobRuleUseCase).singleton(),
    createRecurringJobRuleController: asClass(CreateRecurringJobRuleController).singleton(),
    fetchRecurringJobRuleController: asClass(FetchRecurringJobRuleController).singleton(),
    listRecurringJobRulesController: asClass(ListRecurringJobRulesController).singleton(),
    toggleRecurringJobRuleController: asClass(ToggleRecurringJobRuleController).singleton(),

    // composio
    // ---
    deleteComposioConnectedAccountUseCase: asClass(DeleteComposioConnectedAccountUseCase).singleton(),
    handleCompsioWebhookRequestUseCase: asClass(HandleCompsioWebhookRequestUseCase).singleton(),
    deleteComposioConnectedAccountController: asClass(DeleteComposioConnectedAccountController).singleton(),
    handleComposioWebhookRequestController: asClass(HandleComposioWebhookRequestController).singleton(),

    // composio trigger deployments
    // ---
    composioTriggerDeploymentsRepository: asClass(MongodbComposioTriggerDeploymentsRepository).singleton(),
    listComposioTriggerTypesUseCase: asClass(ListComposioTriggerTypesUseCase).singleton(),
    createComposioTriggerDeploymentUseCase: asClass(CreateComposioTriggerDeploymentUseCase).singleton(),
    listComposioTriggerDeploymentsUseCase: asClass(ListComposioTriggerDeploymentsUseCase).singleton(),
    deleteComposioTriggerDeploymentUseCase: asClass(DeleteComposioTriggerDeploymentUseCase).singleton(),
    createComposioTriggerDeploymentController: asClass(CreateComposioTriggerDeploymentController).singleton(),
    deleteComposioTriggerDeploymentController: asClass(DeleteComposioTriggerDeploymentController).singleton(),
    listComposioTriggerDeploymentsController: asClass(ListComposioTriggerDeploymentsController).singleton(),
    listComposioTriggerTypesController: asClass(ListComposioTriggerTypesController).singleton(),

    // conversations
    // ---
    conversationsRepository: asClass(MongoDBConversationsRepository).singleton(),
    createConversationUseCase: asClass(CreateConversationUseCase).singleton(),
    createCachedTurnUseCase: asClass(CreateCachedTurnUseCase).singleton(),
    fetchCachedTurnUseCase: asClass(FetchCachedTurnUseCase).singleton(),
    runConversationTurnUseCase: asClass(RunConversationTurnUseCase).singleton(),
    listConversationsUseCase: asClass(ListConversationsUseCase).singleton(),
    fetchConversationUseCase: asClass(FetchConversationUseCase).singleton(),
    createPlaygroundConversationController: asClass(CreatePlaygroundConversationController).singleton(),
    createCachedTurnController: asClass(CreateCachedTurnController).singleton(),
    runCachedTurnController: asClass(RunCachedTurnController).singleton(),
    runTurnController: asClass(RunTurnController).singleton(),
    listConversationsController: asClass(ListConversationsController).singleton(),
    fetchConversationController: asClass(FetchConversationController).singleton(),
});