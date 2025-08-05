import { NotFoundError } from '@/src/entities/errors/common';
import { IConversationsRepository } from "@/src/application/repositories/conversations.repository.interface";
import { z } from "zod";
import { ICacheService } from '@/src/application/services/cache.service.interface';
import { CachedTurnRequest, Turn } from '@/src/entities/models/turn';
import { IUsageQuotaPolicy } from '../../policies/usage-quota.policy.interface';
import { IProjectActionAuthorizationPolicy } from '../../policies/project-action-authorization.policy';

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    key: z.string(),
});

export interface IFetchCachedTurnUseCase {
    execute(data: z.infer<typeof inputSchema>): Promise<z.infer<typeof CachedTurnRequest>>;
}

export class FetchCachedTurnUseCase implements IFetchCachedTurnUseCase {
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

    async execute(data: z.infer<typeof inputSchema>): Promise<z.infer<typeof CachedTurnRequest>> {
        // fetch cached turn
        const payload = await this.cacheService.get(`turn-${data.key}`);
        if (!payload) {
            throw new NotFoundError('Cached turn not found');
        }

        // parse cached turn
        const cachedTurn = CachedTurnRequest.parse(JSON.parse(payload));

        // fetch conversation
        const conversation = await this.conversationsRepository.getConversation(cachedTurn.conversationId);
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

        // delete from cache
        await this.cacheService.delete(`turn-${data.key}`);

        // return cached turn
        return cachedTurn;
    }
}