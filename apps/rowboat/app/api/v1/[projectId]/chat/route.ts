import { NextRequest } from "next/server";
import { agentWorkflowsCollection, db, projectsCollection, testProfilesCollection } from "../../../../lib/mongodb";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { authCheck } from "../../utils";
import { ApiRequest, ApiResponse } from "../../../../lib/types/types";
import { AgenticAPIChatRequest, AgenticAPIChatMessage, convertFromAgenticApiToApiMessages, convertFromApiToAgenticApiMessages, convertWorkflowToAgenticAPI } from "../../../../lib/types/agents_api_types";
import { getAgenticApiResponse, callClientToolWebhook, runRAGToolCall, mockToolResponse, callMcpTool } from "../../../../lib/utils";
import { check_query_limit } from "../../../../lib/rate_limiting";
import { apiV1 } from "rowboat-shared";
import { PrefixLogger } from "../../../../lib/utils";
import { TestProfile } from "@/app/lib/types/testing_types";

// get next turn / agent response
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string }> }
): Promise<Response> {
    const { projectId } = await params;
    const requestId = crypto.randomUUID();
    const logger = new PrefixLogger(`${requestId}`);

    logger.log(`Got chat request for project ${projectId}`);

    // check query limit
    if (!await check_query_limit(projectId)) {
        logger.log(`Query limit exceeded for project ${projectId}`);
        return Response.json({ error: "Query limit exceeded" }, { status: 429 });
    }

    return await authCheck(projectId, req, async () => {
        // parse and validate the request body
        let body;
        try {
            body = await req.json();
        } catch (e) {
            logger.log(`Invalid JSON in request body: ${e}`);
            return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
        }
        logger.log(`Request json: ${JSON.stringify(body, null, 2)}`);
        const result = ApiRequest.safeParse(body);
        if (!result.success) {
            logger.log(`Invalid request body: ${result.error.message}`);
            return Response.json({ error: `Invalid request body: ${result.error.message}` }, { status: 400 });
        }
        const reqMessages = result.data.messages;
        const reqState = result.data.state;

        // fetch published workflow id
        const project = await projectsCollection.findOne({
            _id: projectId,
        });
        if (!project) {
            logger.log(`Project ${projectId} not found`);
            return Response.json({ error: "Project not found" }, { status: 404 });
        }

        // if workflow id is provided in the request, use it, else use the published workflow id
        let workflowId = result.data.workflowId ?? project.publishedWorkflowId;
        if (!workflowId) {
            logger.log(`No workflow id provided in request or project has no published workflow`);
            return Response.json({ error: "No workflow id provided in request or project has no published workflow" }, { status: 404 });
        }
        // fetch workflow
        const workflow = await agentWorkflowsCollection.findOne({
            projectId: projectId,
            _id: new ObjectId(workflowId),
        });
        if (!workflow) {
            logger.log(`Workflow ${workflowId} not found for project ${projectId}`);
            return Response.json({ error: "Workflow not found" }, { status: 404 });
        }
        
        // if test profile is provided in the request, use it
        let testProfile: z.infer<typeof TestProfile> | null = null;
        if (result.data.testProfileId) {
            testProfile = await testProfilesCollection.findOne({
                projectId: projectId,
                _id: new ObjectId(result.data.testProfileId),
            });
            if (!testProfile) {
                logger.log(`Test profile ${result.data.testProfileId} not found for project ${projectId}`);
                return Response.json({ error: "Test profile not found" }, { status: 404 });
            }
        }

        // if profile has a context available, overwrite the system message in the request (if there is one)
        let currentMessages = reqMessages;
        if (testProfile?.context) {
            // if there is a system message, overwrite it
            const systemMessageIndex = reqMessages.findIndex(m => m.role === "system");
            if (systemMessageIndex !== -1) {
                currentMessages[systemMessageIndex].content = testProfile.context;
            } else {
                // if there is no system message, add one
                currentMessages.unshift({ role: "system", content: testProfile.context });
            }
        }

        const MAX_TURNS = result.data.maxTurns ?? 3;
        let currentState: unknown = reqState ?? { last_agent_name: workflow.agents[0].name };
        let turns = 0;
        let hasToolCalls = false;

        do {
            hasToolCalls = false;
            // get assistant response
            const { agents, tools, prompts, startAgent } = convertWorkflowToAgenticAPI(workflow);
            const request: z.infer<typeof AgenticAPIChatRequest> = {
                messages: convertFromApiToAgenticApiMessages(currentMessages),
                state: currentState,
                agents,
                tools,
                prompts,
                startAgent,
            };

            console.log(`turn ${turns}: sending agentic request from /chat api`, JSON.stringify(request, null, 2));
            logger.log(`Processing turn ${turns} for conversation`);
            const { messages: agenticMessages, state } = await getAgenticApiResponse(request);

            const newMessages = convertFromAgenticApiToApiMessages(agenticMessages);
            currentState = state;

            // if tool calls are to be skipped, return immediately
            if (result.data.skipToolCalls) {
                logger.log('Skipping tool calls as requested');
                const responseBody: z.infer<typeof ApiResponse> = {
                    messages: newMessages,
                    state: currentState,
                };
                return Response.json(responseBody);
            }

            // get last message to check for tool calls
            const lastMessage = newMessages[newMessages.length - 1];
            if (lastMessage?.role === "assistant" &&
                'tool_calls' in lastMessage &&
                lastMessage.tool_calls?.length > 0) {
                hasToolCalls = true;
                const toolCallResultMessages: z.infer<typeof apiV1.ToolMessage>[] = [];

                // Process tool calls
                for (const toolCall of lastMessage.tool_calls) {
                    let result: unknown;
                    if (toolCall.function.name === "getArticleInfo") {
                        logger.log(`Running RAG tool call for agent ${lastMessage.agenticSender}`);
                        // find the source ids attached to this agent in the workflow
                        const agent = workflow.agents.find(a => a.name === lastMessage.agenticSender);
                        if (!agent) {
                            return Response.json({ error: "Agent not found" }, { status: 404 });
                        }
                        const sourceIds = agent.ragDataSources;
                        if (!sourceIds) {
                            return Response.json({ error: "Agent has no data sources" }, { status: 404 });
                        }
                        try {
                            result = await runRAGToolCall(projectId, toolCall.function.arguments, sourceIds, agent.ragReturnType, agent.ragK);
                            logger.log(`RAG tool call completed for agent ${lastMessage.agenticSender}`);
                        } catch (e) {
                            logger.log(`Error running RAG tool call: ${e}`);
                            return Response.json({ error: "Error running RAG tool call" }, { status: 500 });
                        }
                    } else {
                        logger.log(`Processing tool call ${toolCall.function.name}`);

                        try {
                            // if tool is supposed to be mocked, mock it
                            const workflowTool = workflow.tools.find(t => t.name === toolCall.function.name);
                            if (testProfile?.mockTools || workflowTool?.mockTool) {
                                logger.log(`Mocking tool call ${toolCall.function.name}`);
                                result = await mockToolResponse(toolCall.id, currentMessages, testProfile?.mockPrompt || workflowTool?.mockInstructions || '');
                            } else if (workflowTool?.isMcp) {
                                // else run the tool call by calling the MCP tool
                                logger.log(`Calling MCP tool: ${toolCall.function.name}`);
                                result = await callMcpTool(projectId, workflowTool.mcpServerName ?? 'default', toolCall.function.name, JSON.parse(toolCall.function.arguments));
                            } else {
                                // else run the tool call by calling the client tool webhook
                                logger.log(`Running client tool webhook for tool ${toolCall.function.name}`);
                                result = await callClientToolWebhook(
                                    toolCall,
                                    currentMessages,
                                    projectId,
                                );
                            }
                        } catch (e) {
                            logger.log(`Error in tool call ${toolCall.function.name}: ${e}`);
                            return Response.json({ error: `Error in tool call ${toolCall.function.name}` }, { status: 500 });
                        }
                        logger.log(`Tool call ${toolCall.function.name} completed`);
                    }

                    toolCallResultMessages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: JSON.stringify(result),
                        tool_name: toolCall.function.name,
                    });
                }

                // Add new messages to the conversation
                currentMessages = [...currentMessages, ...newMessages, ...toolCallResultMessages];
            } else {
                // No tool calls, just add the new messages
                currentMessages = [...currentMessages, ...newMessages];
            }

            turns++;
            if (turns >= MAX_TURNS && hasToolCalls) {
                logger.log(`Max turns (${MAX_TURNS}) reached for conversation`);
                return Response.json({ error: "Max turns reached" }, { status: 429 });
            }

        } while (hasToolCalls);

        const responseBody: z.infer<typeof ApiResponse> = {
            messages: currentMessages.slice(reqMessages.length),
            state: currentState,
        };
        return Response.json(responseBody);
    });
}
