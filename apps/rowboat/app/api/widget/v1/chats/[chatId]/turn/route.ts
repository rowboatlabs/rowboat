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
import { getAgenticApiResponse } from "../../../../../../lib/utils";
import { check_query_limit } from "../../../../../../lib/rate_limiting";
import { PrefixLogger } from "../../../../../../lib/utils";
import { fetchProjectMcpTools } from "@/app/lib/project_tools";

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

        // fetch project tools
        const projectTools = await fetchProjectMcpTools(session.projectId);

        // fetch workflow
        const workflow = await agentWorkflowsCollection.findOne({
            projectId: session.projectId,
            _id: new ObjectId(projectSettings.publishedWorkflowId),
        });
        if (!workflow) {
            throw new Error("Workflow not found");
        }

        // get assistant response
        const { agents, tools, prompts, startAgent } = convertWorkflowToAgenticAPI(workflow, projectTools);
        const unsavedMessages: z.infer<typeof apiV1.ChatMessage>[] = [userMessage];
        let state: unknown = chat.agenticState ?? { last_agent_name: startAgent };

        const request: z.infer<typeof AgenticAPIChatRequest> = {
            projectId: session.projectId,
            messages: convertToAgenticAPIChatMessages([systemMessage, ...messages, ...unsavedMessages]),
            state,
            agents,
            tools,
            prompts,
            startAgent,
            mcpServers: (projectSettings.mcpServers ?? []).map(server => ({
                name: server.name,
                serverUrl: server.serverUrl || '',
                isReady: server.isReady
            })),
            toolWebhookUrl: projectSettings.webhookUrl ?? '',
            testProfile: undefined,
        };
        logger.log(`Sending agentic request`);
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
