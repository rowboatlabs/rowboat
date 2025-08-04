import { BadRequestError, NotAuthorizedError } from '@/src/entities/errors/common';
import { check_query_limit } from "@/app/lib/rate_limiting";
import { QueryLimitError } from "@/src/entities/errors/common";
import { apiKeysCollection, projectMembersCollection } from "@/app/lib/mongodb";
import { IConversationsRepository } from "@/src/application/repositories/conversations.repository.interface";
import { z } from "zod";
import { Conversation } from "@/src/entities/models/conversation";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
});

export interface ICreateConversationUseCase {
    execute(data: z.infer<typeof inputSchema>): Promise<z.infer<typeof Conversation>>;
}

export class CreateConversationUseCase implements ICreateConversationUseCase {
    private readonly conversationsRepository: IConversationsRepository;

    constructor({
        conversationsRepository,
    }: {
        conversationsRepository: IConversationsRepository,
    }) {
        this.conversationsRepository = conversationsRepository;
    }

    async execute(data: z.infer<typeof inputSchema>): Promise<z.infer<typeof Conversation>> {
        const { projectId } = data;

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

        // create conversation
        return await this.conversationsRepository.createConversation({
            projectId,
        });
    }
}