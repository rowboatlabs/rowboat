import { Reason, Turn, TurnEvent } from "@/src/entities/models/turn";
import { USE_BILLING } from "@/app/lib/feature_flags";
import { authorize, getCustomerIdForProject, logUsage } from "@/app/lib/billing";
import { NotFoundError } from '@/src/entities/errors/common';
import { IConversationsRepository } from "@/src/application/repositories/conversations.repository.interface";
import { streamResponse } from "@/app/lib/agents";
import { z } from "zod";
import { Message } from "@/app/lib/types/types";
import { IUsageQuotaPolicy } from '../../policies/usage-quota.policy.interface';
import { IProjectActionAuthorizationPolicy } from '../../policies/project-action-authorization.policy';

const inputSchema = z.object({
    caller: z.enum(["user", "api", "job_worker"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    conversationId: z.string(),
    reason: Reason,
    input: Turn.shape.input,
});

export interface IRunConversationTurnUseCase {
    execute(data: z.infer<typeof inputSchema>): AsyncGenerator<z.infer<typeof TurnEvent>, void, unknown>;
}

export class RunConversationTurnUseCase implements IRunConversationTurnUseCase {
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

    async *execute(data: z.infer<typeof inputSchema>): AsyncGenerator<z.infer<typeof TurnEvent>, void, unknown> {
        // fetch conversation
        const conversation = await this.conversationsRepository.fetch(data.conversationId);
        if (!conversation) {
            throw new NotFoundError('Conversation not found');
        }

        // extract projectid from conversation
        const { id: conversationId, projectId } = conversation;

        // authz check
        if (data.caller !== "job_worker") {
            await this.projectActionAuthorizationPolicy.authorize({
                caller: data.caller,
                userId: data.userId,
                apiKey: data.apiKey,
                projectId,
            });
        }

        // assert and consume quota
        await this.usageQuotaPolicy.assertAndConsume(projectId);

        // Check billing auth
        let billingCustomerId: string | null = null;
        if (USE_BILLING) {
            // get billing customer id for project
            billingCustomerId = await getCustomerIdForProject(projectId);
            const agentModels = conversation.workflow.agents.reduce((acc, agent) => {
                acc.push(agent.model);
                return acc;
            }, [] as string[]);
            const response = await authorize(billingCustomerId, {
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
                    reason: data.reason,
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

        // Log billing usage
        if (USE_BILLING && billingCustomerId) {
            await logUsage(billingCustomerId, {
                type: "agent_messages",
                amount: outputMessages.length,
            });
        }
    }
}