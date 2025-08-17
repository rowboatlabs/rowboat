import { asClass, createContainer, InjectionMode } from "awilix";

// Services
import { RedisPubSubService } from "@/src/infrastructure/services/redis.pub-sub.service";
import { S3UploadsStorageService } from "@/src/infrastructure/services/s3.uploads-storage.service";
import { LocalUploadsStorageService } from "@/src/infrastructure/services/local.uploads-storage.service";

import { RunConversationTurnUseCase } from "@/src/application/use-cases/conversations/run-conversation-turn.use-case";
import { MongoDBConversationsRepository } from "@/src/infrastructure/repositories/mongodb.conversations.repository";
import { RunCachedTurnController } from "@/src/interface-adapters/controllers/conversations/run-cached-turn.controller";
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
import { JobsWorker } from "@/src/application/workers/jobs.worker";
import { JobRulesWorker } from "@/src/application/workers/job-rules.worker";
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
import { DeleteScheduledJobRuleUseCase } from "@/src/application/use-cases/scheduled-job-rules/delete-scheduled-job-rule.use-case";
import { CreateScheduledJobRuleController } from "@/src/interface-adapters/controllers/scheduled-job-rules/create-scheduled-job-rule.controller";
import { FetchScheduledJobRuleController } from "@/src/interface-adapters/controllers/scheduled-job-rules/fetch-scheduled-job-rule.controller";
import { ListScheduledJobRulesController } from "@/src/interface-adapters/controllers/scheduled-job-rules/list-scheduled-job-rules.controller";
import { DeleteScheduledJobRuleController } from "@/src/interface-adapters/controllers/scheduled-job-rules/delete-scheduled-job-rule.controller";

// Recurring Job Rules
import { MongoDBRecurringJobRulesRepository } from "@/src/infrastructure/repositories/mongodb.recurring-job-rules.repository";
import { CreateRecurringJobRuleUseCase } from "@/src/application/use-cases/recurring-job-rules/create-recurring-job-rule.use-case";
import { FetchRecurringJobRuleUseCase } from "@/src/application/use-cases/recurring-job-rules/fetch-recurring-job-rule.use-case";
import { ListRecurringJobRulesUseCase } from "@/src/application/use-cases/recurring-job-rules/list-recurring-job-rules.use-case";
import { ToggleRecurringJobRuleUseCase } from "@/src/application/use-cases/recurring-job-rules/toggle-recurring-job-rule.use-case";
import { DeleteRecurringJobRuleUseCase } from "@/src/application/use-cases/recurring-job-rules/delete-recurring-job-rule.use-case";
import { CreateRecurringJobRuleController } from "@/src/interface-adapters/controllers/recurring-job-rules/create-recurring-job-rule.controller";
import { FetchRecurringJobRuleController } from "@/src/interface-adapters/controllers/recurring-job-rules/fetch-recurring-job-rule.controller";
import { ListRecurringJobRulesController } from "@/src/interface-adapters/controllers/recurring-job-rules/list-recurring-job-rules.controller";
import { ToggleRecurringJobRuleController } from "@/src/interface-adapters/controllers/recurring-job-rules/toggle-recurring-job-rule.controller";
import { DeleteRecurringJobRuleController } from "@/src/interface-adapters/controllers/recurring-job-rules/delete-recurring-job-rule.controller";

// API Keys
import { CreateApiKeyUseCase } from "@/src/application/use-cases/api-keys/create-api-key.use-case";
import { ListApiKeysUseCase } from "@/src/application/use-cases/api-keys/list-api-keys.use-case";
import { DeleteApiKeyUseCase } from "@/src/application/use-cases/api-keys/delete-api-key.use-case";
import { CreateApiKeyController } from "@/src/interface-adapters/controllers/api-keys/create-api-key.controller";
import { ListApiKeysController } from "@/src/interface-adapters/controllers/api-keys/list-api-keys.controller";
import { DeleteApiKeyController } from "@/src/interface-adapters/controllers/api-keys/delete-api-key.controller";

// Data sources
import { MongoDBDataSourcesRepository } from "@/src/infrastructure/repositories/mongodb.data-sources.repository";
import { MongoDBDataSourceDocsRepository } from "@/src/infrastructure/repositories/mongodb.data-source-docs.repository";
import { CreateDataSourceUseCase } from "@/src/application/use-cases/data-sources/create-data-source.use-case";
import { FetchDataSourceUseCase } from "@/src/application/use-cases/data-sources/fetch-data-source.use-case";
import { ListDataSourcesUseCase } from "@/src/application/use-cases/data-sources/list-data-sources.use-case";
import { UpdateDataSourceUseCase } from "@/src/application/use-cases/data-sources/update-data-source.use-case";
import { DeleteDataSourceUseCase } from "@/src/application/use-cases/data-sources/delete-data-source.use-case";
import { ToggleDataSourceUseCase } from "@/src/application/use-cases/data-sources/toggle-data-source.use-case";
import { CreateDataSourceController } from "@/src/interface-adapters/controllers/data-sources/create-data-source.controller";
import { FetchDataSourceController } from "@/src/interface-adapters/controllers/data-sources/fetch-data-source.controller";
import { ListDataSourcesController } from "@/src/interface-adapters/controllers/data-sources/list-data-sources.controller";
import { UpdateDataSourceController } from "@/src/interface-adapters/controllers/data-sources/update-data-source.controller";
import { DeleteDataSourceController } from "@/src/interface-adapters/controllers/data-sources/delete-data-source.controller";
import { ToggleDataSourceController } from "@/src/interface-adapters/controllers/data-sources/toggle-data-source.controller";
import { AddDocsToDataSourceUseCase } from "@/src/application/use-cases/data-sources/add-docs-to-data-source.use-case";
import { ListDocsInDataSourceUseCase } from "@/src/application/use-cases/data-sources/list-docs-in-data-source.use-case";
import { DeleteDocFromDataSourceUseCase } from "@/src/application/use-cases/data-sources/delete-doc-from-data-source.use-case";
import { RecrawlWebDataSourceUseCase } from "@/src/application/use-cases/data-sources/recrawl-web-data-source.use-case";
import { GetUploadUrlsForFilesUseCase } from "@/src/application/use-cases/data-sources/get-upload-urls-for-files.use-case";
import { GetDownloadUrlForFileUseCase } from "@/src/application/use-cases/data-sources/get-download-url-for-file.use-case";
import { AddDocsToDataSourceController } from "@/src/interface-adapters/controllers/data-sources/add-docs-to-data-source.controller";
import { ListDocsInDataSourceController } from "@/src/interface-adapters/controllers/data-sources/list-docs-in-data-source.controller";
import { DeleteDocFromDataSourceController } from "@/src/interface-adapters/controllers/data-sources/delete-doc-from-data-source.controller";
import { RecrawlWebDataSourceController } from "@/src/interface-adapters/controllers/data-sources/recrawl-web-data-source.controller";
import { GetUploadUrlsForFilesController } from "@/src/interface-adapters/controllers/data-sources/get-upload-urls-for-files.controller";
import { GetDownloadUrlForFileController } from "@/src/interface-adapters/controllers/data-sources/get-download-url-for-file.controller";

export const container = createContainer({
    injectionMode: InjectionMode.PROXY,
    strict: true,
});

container.register({
    // workers
    // ---
    jobsWorker: asClass(JobsWorker).singleton(),
    jobRulesWorker: asClass(JobRulesWorker).singleton(),

    // services
    // ---
    cacheService: asClass(RedisCacheService).singleton(),
    pubSubService: asClass(RedisPubSubService).singleton(),
    s3UploadsStorageService: asClass(S3UploadsStorageService).singleton(),
    localUploadsStorageService: asClass(LocalUploadsStorageService).singleton(),

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
    createApiKeyUseCase: asClass(CreateApiKeyUseCase).singleton(),
    listApiKeysUseCase: asClass(ListApiKeysUseCase).singleton(),
    deleteApiKeyUseCase: asClass(DeleteApiKeyUseCase).singleton(),
    createApiKeyController: asClass(CreateApiKeyController).singleton(),
    listApiKeysController: asClass(ListApiKeysController).singleton(),
    deleteApiKeyController: asClass(DeleteApiKeyController).singleton(),

    // data sources
    // ---
    dataSourcesRepository: asClass(MongoDBDataSourcesRepository).singleton(),
    dataSourceDocsRepository: asClass(MongoDBDataSourceDocsRepository).singleton(),
    createDataSourceUseCase: asClass(CreateDataSourceUseCase).singleton(),
    fetchDataSourceUseCase: asClass(FetchDataSourceUseCase).singleton(),
    listDataSourcesUseCase: asClass(ListDataSourcesUseCase).singleton(),
    updateDataSourceUseCase: asClass(UpdateDataSourceUseCase).singleton(),
    deleteDataSourceUseCase: asClass(DeleteDataSourceUseCase).singleton(),
    toggleDataSourceUseCase: asClass(ToggleDataSourceUseCase).singleton(),
    createDataSourceController: asClass(CreateDataSourceController).singleton(),
    fetchDataSourceController: asClass(FetchDataSourceController).singleton(),
    listDataSourcesController: asClass(ListDataSourcesController).singleton(),
    updateDataSourceController: asClass(UpdateDataSourceController).singleton(),
    deleteDataSourceController: asClass(DeleteDataSourceController).singleton(),
    toggleDataSourceController: asClass(ToggleDataSourceController).singleton(),
    addDocsToDataSourceUseCase: asClass(AddDocsToDataSourceUseCase).singleton(),
    listDocsInDataSourceUseCase: asClass(ListDocsInDataSourceUseCase).singleton(),
    deleteDocFromDataSourceUseCase: asClass(DeleteDocFromDataSourceUseCase).singleton(),
    recrawlWebDataSourceUseCase: asClass(RecrawlWebDataSourceUseCase).singleton(),
    getUploadUrlsForFilesUseCase: asClass(GetUploadUrlsForFilesUseCase).singleton(),
    getDownloadUrlForFileUseCase: asClass(GetDownloadUrlForFileUseCase).singleton(),
    addDocsToDataSourceController: asClass(AddDocsToDataSourceController).singleton(),
    listDocsInDataSourceController: asClass(ListDocsInDataSourceController).singleton(),
    deleteDocFromDataSourceController: asClass(DeleteDocFromDataSourceController).singleton(),
    recrawlWebDataSourceController: asClass(RecrawlWebDataSourceController).singleton(),
    getUploadUrlsForFilesController: asClass(GetUploadUrlsForFilesController).singleton(),
    getDownloadUrlForFileController: asClass(GetDownloadUrlForFileController).singleton(),

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
    deleteScheduledJobRuleUseCase: asClass(DeleteScheduledJobRuleUseCase).singleton(),
    createScheduledJobRuleController: asClass(CreateScheduledJobRuleController).singleton(),
    fetchScheduledJobRuleController: asClass(FetchScheduledJobRuleController).singleton(),
    listScheduledJobRulesController: asClass(ListScheduledJobRulesController).singleton(),
    deleteScheduledJobRuleController: asClass(DeleteScheduledJobRuleController).singleton(),

    // recurring job rules
    // ---
    recurringJobRulesRepository: asClass(MongoDBRecurringJobRulesRepository).singleton(),
    createRecurringJobRuleUseCase: asClass(CreateRecurringJobRuleUseCase).singleton(),
    fetchRecurringJobRuleUseCase: asClass(FetchRecurringJobRuleUseCase).singleton(),
    listRecurringJobRulesUseCase: asClass(ListRecurringJobRulesUseCase).singleton(),
    toggleRecurringJobRuleUseCase: asClass(ToggleRecurringJobRuleUseCase).singleton(),
    deleteRecurringJobRuleUseCase: asClass(DeleteRecurringJobRuleUseCase).singleton(),
    createRecurringJobRuleController: asClass(CreateRecurringJobRuleController).singleton(),
    fetchRecurringJobRuleController: asClass(FetchRecurringJobRuleController).singleton(),
    listRecurringJobRulesController: asClass(ListRecurringJobRulesController).singleton(),
    toggleRecurringJobRuleController: asClass(ToggleRecurringJobRuleController).singleton(),
    deleteRecurringJobRuleController: asClass(DeleteRecurringJobRuleController).singleton(),

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