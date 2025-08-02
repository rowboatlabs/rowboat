import { ITurnsRepository } from "@/src/application/repositories/turns.repository.interface";
import { Turn } from "@/src/entities/models/turn";
import { CreateTurnData } from "../../repositories/turns.repository.interface";
import { USE_BILLING } from "@/app/lib/feature_flags";
import { authorize, getCustomerIdForProject } from "@/app/lib/billing";
import { BadRequestError, BillingError, NotAuthorizedError, NotFoundError } from '@/src/entities/errors/common';
import { check_query_limit } from "@/app/lib/rate_limiting";
import { QueryLimitError } from "@/src/entities/errors/common";
import { apiKeysCollection, projectMembersCollection } from "@/app/lib/mongodb";
import { z } from "zod";
import { IConversationsRepository } from "@/src/application/repositories/conversations.repository.interface";

const inputSchema = z.object({
    turnData: CreateTurnData
        .omit({
            conversationId: true,
        })
        .extend({
            conversationId: z.string().optional(),
        }),
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
});

export interface ICreateTurnUseCase {
    execute(data: z.infer<typeof inputSchema>): Promise<z.infer<typeof Turn>>;
}

export class CreateTurnUseCase implements ICreateTurnUseCase {
    constructor(
        private readonly turnsRepository: ITurnsRepository,
        private readonly conversationsRepository: IConversationsRepository,
    ) {}

    async execute(data: z.infer<typeof inputSchema>): Promise<z.infer<typeof Turn>> {
        const { projectId } = data.turnData;

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

        // if conversation id is provided, fetch conversation
        if (data.turnData.conversationId) {
            const conversation = await this.conversationsRepository.getConversation(data.turnData.conversationId);
            if (!conversation) {
                throw new NotFoundError('Conversation not found');
            }

            // ensure conversation belongs to project
            if (conversation.projectId !== projectId) {
                throw new NotAuthorizedError('Conversation does not belong to project');
            }
        }

        // check query limit for project
        if (!await check_query_limit(projectId)) {
            throw new QueryLimitError('Query limit exceeded');
        }

        // Check billing auth
        if (USE_BILLING) {
            // get billing customer id for project
            const customerId = await getCustomerIdForProject(projectId);
            const agentModels = data.turnData.triggerData.workflow.agents.reduce((acc, agent) => {
                acc.push(agent.model);
                return acc;
            }, [] as string[]);
            const response = await authorize(customerId, {
                type: 'agent_response',
                data: {
                    agentModels,
                },
            });
            if (!response.success) {
                throw new BillingError(response.error || 'Billing error');
            }
        }

        // set timestamps where missing
        data.turnData.messages.forEach(msg => {
            if (!msg.timestamp) {
                msg.timestamp = new Date().toISOString();
            }
        });

        // if conversation id is not provided, create a new conversation
        let conversationId = data.turnData.conversationId;
        if (!conversationId) {
            const { id } = await this.conversationsRepository.createConversation({
                projectId,
            });
            conversationId = id;
        }

        // create run
        return await this.turnsRepository.createTurn({
            ...data.turnData,
            conversationId,
        });
    }
}