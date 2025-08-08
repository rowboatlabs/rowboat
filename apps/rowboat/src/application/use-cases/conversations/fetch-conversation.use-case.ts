import { BadRequestError, NotFoundError } from '@/src/entities/errors/common';
import { z } from "zod";
import { IUsageQuotaPolicy } from '../../policies/usage-quota.policy.interface';
import { IProjectActionAuthorizationPolicy } from '../../policies/project-action-authorization.policy';
import { IConversationsRepository } from '../../repositories/conversations.repository.interface';
import { Conversation } from '@/src/entities/models/conversation';

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    conversationId: z.string(),
});

export interface IFetchConversationUseCase {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof Conversation>>;
}

export class FetchConversationUseCase implements IFetchConversationUseCase {
    private readonly conversationsRepository: IConversationsRepository;   
    private readonly usageQuotaPolicy: IUsageQuotaPolicy;
    private readonly projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy;

    constructor({
        conversationsRepository,
        usageQuotaPolicy,
        projectActionAuthorizationPolicy,
    }: {
        conversationsRepository: IConversationsRepository,
        usageQuotaPolicy: IUsageQuotaPolicy,
        projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy,
    }) {
        this.conversationsRepository = conversationsRepository;
        this.usageQuotaPolicy = usageQuotaPolicy;
        this.projectActionAuthorizationPolicy = projectActionAuthorizationPolicy;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof Conversation>> {
        // fetch conversation first to get projectId
        const conversation = await this.conversationsRepository.fetch(request.conversationId);
        if (!conversation) {
            throw new NotFoundError(`Conversation ${request.conversationId} not found`);
        }

        // extract projectid from conversation
        const { projectId } = conversation;

        // authz check
        await this.projectActionAuthorizationPolicy.authorize({
            caller: request.caller,
            userId: request.userId,
            apiKey: request.apiKey,
            projectId,
        });

        // assert and consume quota
        await this.usageQuotaPolicy.assertAndConsume(projectId);

        // return the conversation
        return conversation;
    }
}
