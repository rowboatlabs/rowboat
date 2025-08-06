import { BadRequestError, NotFoundError } from '@/src/entities/errors/common';
import { z } from "zod";
import { IUsageQuotaPolicy } from '../../policies/usage-quota.policy.interface';
import { IProjectActionAuthorizationPolicy } from '../../policies/project-action-authorization.policy';
import { CreateDeploymentSchema, IComposioTriggerDeploymentsRepository } from '../../repositories/composio-trigger-deployments.repository.interface';
import { IProjectsRepository } from '../../repositories/projects.repository.interface';
import { composio } from '../../../../app/lib/composio/composio';
import { ComposioTriggerDeployment } from '@/src/entities/models/composio-trigger-deployment';

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    data: CreateDeploymentSchema,
});

export interface ICreateComposioTriggerDeploymentUseCase {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof ComposioTriggerDeployment>>;
}

export class CreateComposioTriggerDeploymentUseCase implements ICreateComposioTriggerDeploymentUseCase {
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

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof ComposioTriggerDeployment>> {
        // extract projectid from conversation
        const { projectId } = request.data;

        // authz check
        await this.projectActionAuthorizationPolicy.authorize({
            caller: request.caller,
            userId: request.userId,
            apiKey: request.apiKey,
            projectId,
        });

        // assert and consume quota
        await this.usageQuotaPolicy.assertAndConsume(projectId);

        // ensure that connected account exists on project
        const project = await this.projectsRepository.fetch(projectId);
        if (!project) {
            throw new NotFoundError('Project not found');
        }

        // ensure connected account exists
        const account = project.composioConnectedAccounts?.[request.data.triggerTypeSlug];
        if (!account || account.id !== request.data.connectedAccountId) {
            throw new BadRequestError('Invalid connected account');
        }

        // ensure that a trigger deployment does not exist for this trigger type and connected account
        const existingDeployment = await this.composioTriggerDeploymentsRepository.fetchBySlugAndConnectedAccountId(request.data.triggerTypeSlug, request.data.connectedAccountId);
        if (existingDeployment) {
            throw new BadRequestError('Trigger deployment already exists');
        }

        // create trigger on composio
        const result = await composio.triggers.create(request.data.triggerTypeSlug, request.data.projectId, {
            connectedAccountId: request.data.connectedAccountId,
            triggerConfig: request.data.triggerConfig,
        });

        // create trigger deployment in db
        return await this.composioTriggerDeploymentsRepository.create({
            projectId,
            triggerId: result.triggerId,
            connectedAccountId: request.data.connectedAccountId,
            triggerTypeSlug: request.data.triggerTypeSlug,
            triggerConfig: request.data.triggerConfig,
        });
    }
}