import { BadRequestError, NotAuthorizedError, NotFoundError } from '@/src/entities/errors/common';
import { check_query_limit } from "@/app/lib/rate_limiting";
import { QueryLimitError } from "@/src/entities/errors/common";
import { apiKeysCollection, projectMembersCollection } from "@/app/lib/mongodb";
import { IConversationsRepository } from "@/src/application/repositories/conversations.repository.interface";
import { z } from "zod";
import { ICacheService } from '@/src/application/services/cache.service.interface';
import { CachedTurnRequest, Turn } from '@/src/entities/models/turn';

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    key: z.string(),
});

export interface IFetchCachedTurnUseCase {
    execute(data: z.infer<typeof inputSchema>): Promise<z.infer<typeof CachedTurnRequest>;
}

export class FetchCachedTurnUseCase implements IFetchCachedTurnUseCase {
    private readonly cacheService: ICacheService;
    private readonly conversationsRepository: IConversationsRepository;

    constructor({
        cacheService,
        conversationsRepository,
    }: {
        cacheService: ICacheService,
        conversationsRepository: IConversationsRepository,
    }) {
        this.cacheService = cacheService;
        this.conversationsRepository = conversationsRepository;
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

        // check query limit for project
        if (!await check_query_limit(projectId)) {
            throw new QueryLimitError('Query limit exceeded');
        }

        // if caller is a user, ensure they are a member of project
        if (data.caller === "user") {
            if (!data.userId) {
                throw new BadRequestError('User ID is required');
            }
            const membership = await projectMembersCollection.findOne({
                projectId,
                userId: data.userId,
            });
            if (!membership) {
                throw new NotAuthorizedError('User not a member of project');
            }
        } else {
            if (!data.apiKey) {
                throw new BadRequestError('API key is required');
            }
            // check if api key is valid
            // while also updating last used timestamp
            const result = await apiKeysCollection.findOneAndUpdate(
                {
                    projectId,
                    key: data.apiKey,
                },
                { $set: { lastUsedAt: new Date().toISOString() } }
            );
            if (!result) {
                throw new NotAuthorizedError('Invalid API key');
            }
        }

        // delete from cache
        await this.cacheService.delete(`turn-${data.key}`);

        // return cached turn
        return cachedTurn;
    }
}