import { NextRequest } from "next/server";
import { apiV1 } from "rowboat-shared";
import { agentWorkflowsCollection, projectsCollection, chatsCollection, chatMessagesCollection } from "../../../../../../lib/mongodb";
import { z } from "zod";
import { ObjectId, WithId } from "mongodb";
import { authCheck } from "../../../utils";
import { convertFromAgenticAPIChatMessages } from "../../../../../../lib/types/agents_api_types";
import { convertToAgenticAPIChatMessages } from "../../../../../../lib/types/agents_api_types";
import { convertWorkflowToAgenticAPI } from "../../../../../../lib/types/agents_api_types";
import { AgenticAPIChatRequest } from "../../../../../../lib/types/agents_api_types";
import { callClientToolWebhook, getAgenticApiResponse, runRAGToolCall, mockToolResponse, callMcpTool } from "../../../../../../lib/utils";
import { check_query_limit } from "../../../../../../lib/rate_limiting";
import { PrefixLogger } from "../../../../../../lib/utils";

// Add max turns constant at the top with other constants
const MAX_TURNS = 3;

// get next turn / agent response
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
    return await authCheck(req, async (session) => {
        const { chatId } = await params;
        const logger = new PrefixLogger(`widget-chat:${chatId}`);
        
        logger.log(`Processing turn request for chat ${chatId}`);

        // check query limit
        if (!await check_query_limit(session.projectId)) {
            logger.log(`Query limit exceeded for project ${session.projectId}`);
            return Response.json({ error: "Query limit exceeded" }, { status: 429 });
        }

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
        const workflow = await agentWorkflowsCollection.findOne({
            projectId: session.projectId,
            _id: new ObjectId(projectSettings.publishedWorkflowId),
        });
        if (!workflow) {
            throw new Error("Workflow not found");
        }

        // get assistant response
        const { agents, tools, prompts, startAgent } = convertWorkflowToAgenticAPI(workflow);
        const unsavedMessages: z.infer<typeof apiV1.ChatMessage>[] = [userMessage];
        let resolvingToolCalls = true;
        let state: unknown = chat.agenticState ?? {last_agent_name: startAgent};
        let turns = 0;  // Add turns counter

        while (resolvingToolCalls) {
            if (turns >= MAX_TURNS) {
                logger.log(`Max turns (${MAX_TURNS}) reached for chat ${chatId}`);
                throw new Error("Max turns reached");
            }
            turns++;

            const request: z.infer<typeof AgenticAPIChatRequest> = {
                messages: convertToAgenticAPIChatMessages([systemMessage, ...messages, ...unsavedMessages]),
                state,
                agents,
                tools,
                prompts,
                startAgent,
            };
            logger.log(`Turn ${turns}: sending agentic request`);
            const response = await getAgenticApiResponse(request);
            state = response.state;
            if (response.messages.length === 0) {
                throw new Error("No messages returned from assistant");
            }
            const convertedMessages = convertFromAgenticAPIChatMessages(response.messages);
            unsavedMessages.push(...convertedMessages.map(m => ({
                ...m,
                version: 'v1' as const,
                chatId,
                createdAt: new Date().toISOString(),
            })));

            // if the last messages is tool call, execute them
            const lastMessage = convertedMessages[convertedMessages.length - 1];
            if (lastMessage.role === 'assistant' && 'tool_calls' in lastMessage) {
                logger.log(`Processing ${lastMessage.tool_calls.length} tool calls`);
                const toolCallResults = await Promise.all(lastMessage.tool_calls.map(async toolCall => {
                    logger.log(`Executing tool call: ${toolCall.function.name}`);
                    try {
                        if (toolCall.function.name === "getArticleInfo") {
                            logger.log(`Processing RAG tool call for agent ${lastMessage.agenticSender}`);
                            const agent = workflow.agents.find(a => a.name === lastMessage.agenticSender);
                            if (!agent || !agent.ragDataSources) {
                                throw new Error("Agent not found or has no data sources");
                            }
                            return await runRAGToolCall(
                                session.projectId,
                                toolCall.function.arguments,
                                agent.ragDataSources,
                                agent.ragReturnType,
                                agent.ragK
                            );
                        }

                        const workflowTool = workflow.tools.find(t => t.name === toolCall.function.name);
                        if (workflowTool?.mockTool) {
                            logger.log(`Using mock response for tool: ${toolCall.function.name}`);
                            return await mockToolResponse(
                                toolCall.id,
                                [...messages, ...unsavedMessages],
                                workflowTool.mockInstructions || ''
                            );
                        } else if (workflowTool?.isMcp) {
                            logger.log(`Calling MCP tool: ${toolCall.function.name}`);
                            return await callMcpTool(
                                session.projectId,
                                workflowTool.mcpServerName ?? 'default',
                                toolCall.function.name,
                                JSON.parse(toolCall.function.arguments)
                            );
                        } else {
                            logger.log(`Calling webhook for tool: ${toolCall.function.name}`);
                            return await callClientToolWebhook(
                                toolCall,
                                [...messages, ...unsavedMessages],
                                session.projectId,
                            );
                        }
                    } catch (error) {
                        logger.log(`Error executing tool call ${toolCall.id}: ${error}`);
                        return { error: "Tool execution failed" };
                    }
                }));
                unsavedMessages.push(...toolCallResults.map((result, index) => ({
                    version: 'v1' as const,
                    chatId,
                    createdAt: new Date().toISOString(),
                    role: 'tool' as const,
                    tool_call_id: lastMessage.tool_calls[index].id,
                    tool_name: lastMessage.tool_calls[index].function.name,
                    content: JSON.stringify(result),
                })));
            } else {
                // ensure that the last message is from an assistant
                // and is of an external type
                if (lastMessage.role !== 'assistant' || lastMessage.agenticResponseType !== 'external') {
                    throw new Error("Last message is not from an assistant and is not of an external type");
                }
                resolvingToolCalls = false;
                break;
            }
        }

        logger.log(`Saving ${unsavedMessages.length} new messages and updating chat state`);
        await chatMessagesCollection.insertMany(unsavedMessages);
        await chatsCollection.updateOne({ _id: new ObjectId(chatId) }, { $set: { agenticState: state } });

        logger.log(`Turn processing completed successfully`);
        const lastMessage = unsavedMessages[unsavedMessages.length - 1] as WithId<z.infer<typeof apiV1.ChatMessage>>;
        return Response.json({
            ...lastMessage,
            id: lastMessage._id.toString(),
            _id: undefined,
        });
    });
}
