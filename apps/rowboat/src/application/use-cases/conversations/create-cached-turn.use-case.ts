import { BadRequestError, NotAuthorizedError, NotFoundError } from '@/src/entities/errors/common';
import { apiKeysCollection, projectMembersCollection } from "@/app/lib/mongodb";
import { IConversationsRepository } from "@/src/application/repositories/conversations.repository.interface";
import { z } from "zod";
import { nanoid } from 'nanoid';
import { ICacheService } from '@/src/application/services/cache.service.interface';
import { CachedTurnRequest, Turn } from '@/src/entities/models/turn';
import { IUsageQuotaPolicyService } from '../../services/usage-quota-policy.service.interface';

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
    private readonly usageQuotaPolicyService: IUsageQuotaPolicyService;

    constructor({
        cacheService,
        conversationsRepository,
        usageQuotaPolicyService,
    }: {
        cacheService: ICacheService,
        conversationsRepository: IConversationsRepository,
        usageQuotaPolicyService: IUsageQuotaPolicyService,
    }) {
        this.cacheService = cacheService;
        this.conversationsRepository = conversationsRepository;
        this.usageQuotaPolicyService = usageQuotaPolicyService;
    }

    async execute(data: z.infer<typeof inputSchema>): Promise<{ key: string }> {
        // fetch conversation
        const conversation = await this.conversationsRepository.getConversation(data.conversationId);
        if (!conversation) {
            throw new NotFoundError('Conversation not found');
        }

        // extract projectid from conversation
        const { projectId } = conversation;

        // assert and consume quota
        await this.usageQuotaPolicyService.assertAndConsume(projectId);

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