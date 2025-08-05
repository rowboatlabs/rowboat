import { BadRequestError, NotAuthorizedError, NotFoundError } from '@/src/entities/errors/common';
import { apiKeysCollection, projectMembersCollection, projectsCollection } from "@/app/lib/mongodb";
import { IConversationsRepository } from "@/src/application/repositories/conversations.repository.interface";
import { z } from "zod";
import { Conversation } from "@/src/entities/models/conversation";
import { Workflow } from "@/app/lib/types/workflow_types";
import { IUsageQuotaPolicyService } from '../../services/usage-quota-policy.service.interface';

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    workflow: Workflow.optional(),
    isLiveWorkflow: z.boolean().optional(),
});

export interface ICreateConversationUseCase {
    execute(data: z.infer<typeof inputSchema>): Promise<z.infer<typeof Conversation>>;
}

export class CreateConversationUseCase implements ICreateConversationUseCase {
    private readonly conversationsRepository: IConversationsRepository;
    private readonly usageQuotaPolicyService: IUsageQuotaPolicyService;

    constructor({
        conversationsRepository,
        usageQuotaPolicyService,
    }: {
        conversationsRepository: IConversationsRepository,
        usageQuotaPolicyService: IUsageQuotaPolicyService,
    }) {
        this.conversationsRepository = conversationsRepository;
        this.usageQuotaPolicyService = usageQuotaPolicyService;
    }

    async execute(data: z.infer<typeof inputSchema>): Promise<z.infer<typeof Conversation>> {
        const { caller, userId, apiKey, projectId } = data;
        let isLiveWorkflow = Boolean(data.isLiveWorkflow);
        let workflow = data.workflow;

        // assert and consume quota
        await this.usageQuotaPolicyService.assertAndConsume(projectId);

        // if caller is a user, ensure they are a member of project
        if (caller === "user") {
            if (!userId) {
                throw new BadRequestError('User ID is required');
            }
            const membership = await projectMembersCollection.findOne({
                projectId,
                userId,
            });
            if (!membership) {
                throw new NotAuthorizedError('User not a member of project');
            }
        } else {
            if (!apiKey) {
                throw new BadRequestError('API key is required');
            }
            // check if api key is valid
            // while also updating last used timestamp
            const result = await apiKeysCollection.findOneAndUpdate(
                {
                    projectId,
                    key: apiKey,
                },
                { $set: { lastUsedAt: new Date().toISOString() } }
            );
            if (!result) {
                throw new NotAuthorizedError('Invalid API key');
            }
        }

        // if workflow is not provided, fetch workflow
        if (!workflow) {
            const project = await projectsCollection.findOne({
                _id: projectId,
            });
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
        return await this.conversationsRepository.createConversation({
            projectId,
            workflow,
            isLiveWorkflow,
        });
    }
}