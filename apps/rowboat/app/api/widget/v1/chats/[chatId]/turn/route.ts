import { NextRequest } from "next/server";
import { apiV1 } from "rowboat-shared";
import { chatsCollection, chatMessagesCollection } from "../../../../../../lib/mongodb";
import { z } from "zod";
import { ObjectId, WithId } from "mongodb";
import { authCheck } from "../../../utils";
import { PrefixLogger } from "../../../../../../lib/utils";
import { authorize, getCustomerIdForProject, logUsage } from "@/app/lib/billing";
import { USE_BILLING } from "@/app/lib/feature_flags";
import { getResponse } from "@/app/lib/agents";
import { Message, AssistantMessage, AssistantMessageWithToolCalls, ToolMessage } from "@/app/lib/types/types";
import { IUsageQuotaPolicy } from "@/src/application/policies/usage-quota.policy.interface";
import { container } from "@/di/container";

function convert(messages: z.infer<typeof apiV1.ChatMessage>[]): z.infer<typeof Message>[] {
    const result: z.infer<typeof Message>[] = [];
    for (const m of messages) {
        if (m.role === 'assistant') {
            if ('tool_calls' in m) {
                result.push({
                    role: 'assistant',
                    content: null,
                    agentName: m.agenticSender ?? '',
                    toolCalls: m.tool_calls.map((t: any) => ({
                        function: {
                            name: t.function.name,
                            arguments: t.function.arguments,
                        },
                        type: 'function',
                        id: t.id,
                    })),
                });
            } else {
                result.push({
                    role: 'assistant',
                    content: m.content,
                    agentName: m.agenticSender ?? '',
                    responseType: m.agenticResponseType,
                });
            }
        } else if (m.role === 'tool') {
            result.push({
                role: 'tool',
                content: m.content,
                toolCallId: m.tool_call_id,
                toolName: m.tool_name,
            });
        } else if (m.role === 'system') {
            result.push({
                role: 'system',
                content: m.content,
            });
        } else if (m.role === 'user') {
            result.push({
                role: 'user',
                content: m.content,
            });
        }
    }
    return result;
}

function convertBack(messages: z.infer<typeof AssistantMessage | typeof AssistantMessageWithToolCalls | typeof ToolMessage>[]): z.infer<typeof apiV1.ChatMessage>[] {
    const result: z.infer<typeof apiV1.ChatMessage>[] = [];
    for (const m of messages) {
        if (m.role === 'assistant') {
            if ('toolCalls' in m) {
                result.push({
                    version: 'v1',
                    chatId: '',
                    createdAt: new Date().toISOString(),
                    role: 'assistant',
                    agenticSender: m.agentName,
                    agenticResponseType: 'external',
                    tool_calls: m.toolCalls.map((t: any) => ({
                        function: {
                            name: t.function.name,
                            arguments: t.function.arguments,
                        },
                        type: 'function',
                        id: t.id,
                    })),
                });
            } else {
                result.push({
                    version: 'v1',
                    chatId: '',
                    createdAt: new Date().toISOString(),
                    role: 'assistant',
                    content: m.content,
                    agenticSender: m.agentName,
                    agenticResponseType: m.responseType,
                });
            }
        } else if (m.role === 'tool') {
            result.push({
                version: 'v1',
                chatId: '',
                createdAt: new Date().toISOString(),
                role: 'tool',
                content: m.content,
                tool_call_id: m.toolCallId,
                tool_name: m.toolName,
            });
        }
    }
    return result;
}

// get next turn / agent response
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
    return new Response('Not implemented', { status: 501 });
    /*
    return await authCheck(req, async (session) => {
        const { chatId } = await params;
        const logger = new PrefixLogger(`widget-chat:${chatId}`);

        logger.log(`Processing turn request for chat ${chatId}`);

        // fetch billing customer id
        let billingCustomerId: string | null = null;
        if (USE_BILLING) {
            billingCustomerId = await getCustomerIdForProject(session.projectId);
        }

        // assert and consume quota
        const usageQuotaPolicy = container.resolve<IUsageQuotaPolicy>('usageQuotaPolicy');
        await usageQuotaPolicy.assertAndConsume(session.projectId);

        // parse and validate the request body
        let body;
        try {
            body = await req.json();
        } catch (e) {
            logger.log(`Invalid JSON in request body: ${e}`);
            return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
        }
        const result = apiV1.ApiChatTurnRequest.safeParse(body);
        if (!result.success) {
            logger.log(`Invalid request body: ${result.error.message}`);
            return Response.json({ error: `Invalid request body: ${result.error.message}` }, { status: 400 });
        }
        const userMessage: z.infer<typeof apiV1.ChatMessage> = {
            version: 'v1',
            createdAt: new Date().toISOString(),
            chatId,
            role: 'user',
            content: result.data.message,
        };

        // ensure chat exists
        const chat = await chatsCollection.findOne({
            projectId: session.projectId,
            userId: session.userId,
            _id: new ObjectId(chatId)
        });
        if (!chat) {
            return Response.json({ error: "Chat not found" }, { status: 404 });
        }

        // prepare system message which will contain user data
        const systemMessage: z.infer<typeof apiV1.ChatMessage> = {
            version: 'v1',
            createdAt: new Date().toISOString(),
            chatId,
            role: 'system',
            content: `The following user data is available to you: ${JSON.stringify(chat.userData)}`,
        };

        // fetch existing chat messages
        const messages = await chatMessagesCollection.find({ chatId: chatId }).toArray();

        // fetch project settings
        const projectSettings = await projectsCollection.findOne({
            "_id": session.projectId,
        });
        if (!projectSettings) {
            throw new Error("Project settings not found");
        }

        // fetch workflow
        const workflow = projectSettings.liveWorkflow;
        if (!workflow) {
            throw new Error("Workflow not found");
        }

        // check billing authorization
        if (USE_BILLING && billingCustomerId) {
            const agentModels = workflow.agents.reduce((acc, agent) => {
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
                return Response.json({ error: response.error || 'Billing error' }, { status: 402 });
            }
        }

        // get assistant response
        const inMessages: z.infer<typeof Message>[] = convert(messages);
        inMessages.push(userMessage);

        const { messages: responseMessages } = await getResponse(session.projectId, workflow, [systemMessage, ...inMessages]);
        const convertedResponseMessages = convertBack(responseMessages);
        const unsavedMessages = [
            userMessage,
            ...convertedResponseMessages,
        ];

        logger.log(`Saving ${unsavedMessages.length} new messages and updating chat state`);
        await chatMessagesCollection.insertMany(unsavedMessages);
        await chatsCollection.updateOne({ _id: new ObjectId(chatId) }, { $set: { agenticState: chat.agenticState } });

        // log billing usage
        if (USE_BILLING && billingCustomerId) {
            const agentMessageCount = convertedResponseMessages.filter(m => m.role === 'assistant').length;
            // await logUsage(billingCustomerId, {
            //     type: 'agent_messages',
            //     amount: agentMessageCount,
            // });
        }

        logger.log(`Turn processing completed successfully`);
        const lastMessage = unsavedMessages[unsavedMessages.length - 1] as WithId<z.infer<typeof apiV1.ChatMessage>>;
        return Response.json({
            ...lastMessage,
            id: lastMessage._id.toString(),
            _id: undefined,
        });
    });
    */
}
