import { NotFoundError } from '@/src/entities/errors/common';
import { IConversationsRepository } from "@/src/application/repositories/conversations.repository.interface";
import { z } from "zod";
import { nanoid } from 'nanoid';
import { ICacheService } from '@/src/application/services/cache.service.interface';
import { CachedTurnRequest, Turn } from '@/src/entities/models/turn';
import { IUsageQuotaPolicy } from '../../policies/usage-quota.policy.interface';
import { IProjectActionAuthorizationPolicy } from '../../policies/project-action-authorization.policy';

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    conversationId: z.string(),
    input: Turn.shape.input,
});

export interface ICreateCachedTurnUseCase {
    execute(data: z.infer<typeof inputSchema>): Promise<{ key: string }>;
}

export class CreateCachedTurnUseCase implements ICreateCachedTurnUseCase {
    private readonly cacheService: ICacheService;
    private readonly conversationsRepository: IConversationsRepository;
    private readonly usageQuotaPolicy: IUsageQuotaPolicy;
    private readonly projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy;

    constructor({
        cacheService,
        conversationsRepository,
        usageQuotaPolicy,
        projectActionAuthorizationPolicy,
    }: {
        cacheService: ICacheService,
        conversationsRepository: IConversationsRepository,
        usageQuotaPolicy: IUsageQuotaPolicy,
        projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy,
    }) {
        this.cacheService = cacheService;
        this.conversationsRepository = conversationsRepository;
        this.usageQuotaPolicy = usageQuotaPolicy;
        this.projectActionAuthorizationPolicy = projectActionAuthorizationPolicy;
    }

    async execute(data: z.infer<typeof inputSchema>): Promise<{ key: string }> {
        // fetch conversation
        const conversation = await this.conversationsRepository.getConversation(data.conversationId);
        if (!conversation) {
            throw new NotFoundError('Conversation not found');
        }

        // extract projectid from conversation
        const { projectId } = conversation;

        // authz check
        await this.projectActionAuthorizationPolicy.authorize({
            caller: data.caller,
            userId: data.userId,
            apiKey: data.apiKey,
            projectId,
        });

        // assert and consume quota
        await this.usageQuotaPolicy.assertAndConsume(projectId);

        // create cache entry
        const key = nanoid();
        const payload: z.infer<typeof CachedTurnRequest> = {
            conversationId: data.conversationId,
            input: data.input,
        };

        // store payload in cache
        await this.cacheService.set(`turn-${key}`, JSON.stringify(payload), 60 * 10); // expire in 10 minutes

        return {
            key,
        }
    }
}