import { BadRequestError, NotFoundError } from '@/src/entities/errors/common';
import { z } from "zod";
import { IUsageQuotaPolicy } from '../../policies/usage-quota.policy.interface';
import { IProjectActionAuthorizationPolicy } from '../../policies/project-action-authorization.policy';
import { IComposioTriggerDeploymentsRepository } from '../../repositories/composio-trigger-deployments.repository.interface';
import { IProjectsRepository } from '../../repositories/projects.repository.interface';
import { composio } from '../../../../app/lib/composio/composio';

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    deploymentId: z.string(),
});

export interface IDeleteComposioTriggerDeploymentUseCase {
    execute(request: z.infer<typeof inputSchema>): Promise<boolean>;
}

export class DeleteComposioTriggerDeploymentUseCase implements IDeleteComposioTriggerDeploymentUseCase {
    private readonly composioTriggerDeploymentsRepository: IComposioTriggerDeploymentsRepository;   
    private readonly projectsRepository: IProjectsRepository;
    private readonly usageQuotaPolicy: IUsageQuotaPolicy;
    private readonly projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy;

    constructor({
        composioTriggerDeploymentsRepository,
        projectsRepository,
        usageQuotaPolicy,
        projectActionAuthorizationPolicy,
    }: {
        composioTriggerDeploymentsRepository: IComposioTriggerDeploymentsRepository,
        projectsRepository: IProjectsRepository,
        usageQuotaPolicy: IUsageQuotaPolicy,
        projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy,
    }) {
        this.composioTriggerDeploymentsRepository = composioTriggerDeploymentsRepository;
        this.projectsRepository = projectsRepository;
        this.usageQuotaPolicy = usageQuotaPolicy;
        this.projectActionAuthorizationPolicy = projectActionAuthorizationPolicy;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<boolean> {
        // extract projectid from conversation
        const { projectId } = request;

        // authz check
        await this.projectActionAuthorizationPolicy.authorize({
            caller: request.caller,
            userId: request.userId,
            apiKey: request.apiKey,
            projectId,
        });

        // assert and consume quota
        await this.usageQuotaPolicy.assertAndConsume(projectId);

        // ensure deployment belongs to this project
        const deployment = await this.composioTriggerDeploymentsRepository.fetch(request.deploymentId);
        if (!deployment || deployment.projectId !== projectId) {
            throw new NotFoundError('Deployment not found');
        }

        // delete trigger from composio
        await composio.triggers.delete(deployment.triggerId);

        // delete deployment
        return await this.composioTriggerDeploymentsRepository.delete(request.deploymentId);
    }
}