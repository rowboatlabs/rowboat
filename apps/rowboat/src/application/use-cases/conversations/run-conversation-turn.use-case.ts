import { Turn, TurnEvent } from "@/src/entities/models/turn";
import { USE_BILLING } from "@/app/lib/feature_flags";
import { authorize, getCustomerIdForProject } from "@/app/lib/billing";
import { BadRequestError, BillingError, NotAuthorizedError, NotFoundError } from '@/src/entities/errors/common';
import { check_query_limit } from "@/app/lib/rate_limiting";
import { QueryLimitError } from "@/src/entities/errors/common";
import { apiKeysCollection, projectMembersCollection } from "@/app/lib/mongodb";
import { IConversationsRepository } from "@/src/application/repositories/conversations.repository.interface";
import { streamResponse } from "@/app/lib/agents";
import { z } from "zod";
import { Message } from "@/app/lib/types/types";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    conversationId: z.string(),
    trigger: Turn.shape.trigger,
    input: Turn.shape.input,
});

export interface IRunConversationTurnUseCase {
    execute(data: z.infer<typeof inputSchema>): AsyncGenerator<z.infer<typeof TurnEvent>, void, unknown>;
}

export class RunConversationTurnUseCase implements IRunConversationTurnUseCase {
    private readonly conversationsRepository: IConversationsRepository;

    constructor({
        conversationsRepository,
    }: {
        conversationsRepository: IConversationsRepository,
    }) {
        this.conversationsRepository = conversationsRepository;
    }

    async *execute(data: z.infer<typeof inputSchema>): AsyncGenerator<z.infer<typeof TurnEvent>, void, unknown> {
        // fetch conversation
        const conversation = await this.conversationsRepository.getConversation(data.conversationId);
        if (!conversation) {
            throw new NotFoundError('Conversation not found');
        }

        // extract projectid from conversation
        const { id: conversationId, projectId } = conversation;

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

        // Check billing auth
        if (USE_BILLING) {
            // get billing customer id for project
            const customerId = await getCustomerIdForProject(projectId);
            const agentModels = conversation.workflow.agents.reduce((acc, agent) => {
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
                yield {
                    type: "error",
                    error: response.error || 'Billing error',
                    isBillingError: true,
                };
                return;
            }
        }

        // set timestamps where missing
        data.input.messages.forEach(msg => {
            if (!msg.timestamp) {
                msg.timestamp = new Date().toISOString();
            }
        });

        // fetch previous conversation turns and pull message history
        const previousMessages = conversation.turns?.flatMap(t => [
            ...t.input.messages,
            ...t.output,
        ]);
        const inputMessages = [
            ...previousMessages || [],
            ...data.input.messages,
        ]

        // override mock tools if requested
        if (data.input.mockTools) {
            conversation.workflow.mockTools = data.input.mockTools;
        }

        // call agents runtime and handle generated messages
        const outputMessages: z.infer<typeof Message>[] = [];
        for await (const event of streamResponse(projectId, conversation.workflow, inputMessages)) {
            // handle msg events
            if ("role" in event) {
                // collect generated message
                const msg = {
                    ...event,
                    timestamp: new Date().toISOString(),
                };
                outputMessages.push(msg);

                // yield event
                yield {
                    type: "message",
                    data: msg,
                };
            } else {
                // save turn data
                const turn = await this.conversationsRepository.addTurn(data.conversationId, {
                    trigger: data.trigger,
                    input: data.input,
                    output: outputMessages, 
                });

                // yield event
                yield {
                    type: "done",
                    turn,
                    conversationId,
                }
            }
        }
    }
}