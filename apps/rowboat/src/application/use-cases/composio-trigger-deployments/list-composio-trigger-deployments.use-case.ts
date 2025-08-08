import { BadRequestError, NotFoundError } from '@/src/entities/errors/common';
import { z } from "zod";
import { IUsageQuotaPolicy } from '../../policies/usage-quota.policy.interface';
import { IProjectActionAuthorizationPolicy } from '../../policies/project-action-authorization.policy';
import { IComposioTriggerDeploymentsRepository } from '../../repositories/composio-trigger-deployments.repository.interface';
import { ComposioTriggerDeployment } from '@/src/entities/models/composio-trigger-deployment';
import { PaginatedList } from '@/src/entities/common/paginated-list';

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    cursor: z.string().optional(),
    limit: z.number().optional(),
});

export interface IListComposioTriggerDeploymentsUseCase {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof ComposioTriggerDeployment>>>>;
}

export class ListComposioTriggerDeploymentsUseCase implements IListComposioTriggerDeploymentsUseCase {
    private readonly composioTriggerDeploymentsRepository: IComposioTriggerDeploymentsRepository;   
    private readonly usageQuotaPolicy: IUsageQuotaPolicy;
    private readonly projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy;

    constructor({
        composioTriggerDeploymentsRepository,
        usageQuotaPolicy,
        projectActionAuthorizationPolicy,
    }: {
        composioTriggerDeploymentsRepository: IComposioTriggerDeploymentsRepository,
        usageQuotaPolicy: IUsageQuotaPolicy,
        projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy,
    }) {
        this.composioTriggerDeploymentsRepository = composioTriggerDeploymentsRepository;
        this.usageQuotaPolicy = usageQuotaPolicy;
        this.projectActionAuthorizationPolicy = projectActionAuthorizationPolicy;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof ComposioTriggerDeployment>>>> {
        // extract projectid from conversation
        const { projectId, limit } = request;

        // authz check
        await this.projectActionAuthorizationPolicy.authorize({
            caller: request.caller,
            userId: request.userId,
            apiKey: request.apiKey,
            projectId,
        });

        // assert and consume quota
        await this.usageQuotaPolicy.assertAndConsume(projectId);

        // fetch deployments for project
        return await this.composioTriggerDeploymentsRepository.listByProjectId(projectId, request.cursor, limit);
    }
}