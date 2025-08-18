import { BadRequestError, NotFoundError } from '@/src/entities/errors/common';
import { IConversationsRepository } from "@/src/application/repositories/conversations.repository.interface";
import { z } from "zod";
import { Conversation } from "@/src/entities/models/conversation";
import { Workflow } from "@/app/lib/types/workflow_types";
import { IUsageQuotaPolicy } from '../../policies/usage-quota.policy.interface';
import { IProjectActionAuthorizationPolicy } from '../../policies/project-action-authorization.policy';
import { Reason } from '@/src/entities/models/turn';
import { IProjectsRepository } from '../../repositories/projects.repository.interface';

const inputSchema = z.object({
    caller: z.enum(["user", "api", "job_worker"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    reason: Reason,
    workflow: Workflow.optional(),
    isLiveWorkflow: z.boolean().optional(),
});

export interface ICreateConversationUseCase {
    execute(data: z.infer<typeof inputSchema>): Promise<z.infer<typeof Conversation>>;
}

export class CreateConversationUseCase implements ICreateConversationUseCase {
    private readonly conversationsRepository: IConversationsRepository;
    private readonly usageQuotaPolicy: IUsageQuotaPolicy;
    private readonly projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy;
    private readonly projectsRepository: IProjectsRepository;

    constructor({
        conversationsRepository,
        usageQuotaPolicy,
        projectActionAuthorizationPolicy,
        projectsRepository,
    }: {
        conversationsRepository: IConversationsRepository,
        usageQuotaPolicy: IUsageQuotaPolicy,
        projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy,
        projectsRepository: IProjectsRepository,
    }) {
        this.conversationsRepository = conversationsRepository;
        this.usageQuotaPolicy = usageQuotaPolicy;
        this.projectActionAuthorizationPolicy = projectActionAuthorizationPolicy;
        this.projectsRepository = projectsRepository;
    }

    async execute(data: z.infer<typeof inputSchema>): Promise<z.infer<typeof Conversation>> {
        const { caller, userId, apiKey, projectId, reason } = data;
        let isLiveWorkflow = Boolean(data.isLiveWorkflow);
        let workflow = data.workflow;

        // authz check
        if (caller !== "job_worker") {
            await this.projectActionAuthorizationPolicy.authorize({
                caller,
                userId,
                apiKey,
                projectId,
            });
        }

        // assert and consume quota
        await this.usageQuotaPolicy.assertAndConsume(projectId);

        // if workflow is not provided, fetch workflow
        if (!workflow) {
            const project = await this.projectsRepository.fetch(projectId);
            if (!project) {
                throw new NotFoundError('Project not found');
            }
            if (!project.liveWorkflow) {
                throw new BadRequestError('Project does not have a live workflow');
            }
            workflow = project.liveWorkflow;
            isLiveWorkflow = true;
        }

        // create conversation
        return await this.conversationsRepository.create({
            projectId,
            reason,
            workflow,
            isLiveWorkflow,
        });
    }
}