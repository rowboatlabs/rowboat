import { NextRequest } from "next/server";
import { agentWorkflowsCollection, db, projectsCollection, testProfilesCollection } from "../../../../lib/mongodb";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { authCheck } from "../../utils";
import { ApiRequest, ApiResponse } from "../../../../lib/types/types";
import { AgenticAPIChatRequest, convertFromAgenticApiToApiMessages, convertFromApiToAgenticApiMessages, convertWorkflowToAgenticAPI } from "../../../../lib/types/agents_api_types";
import { getAgenticApiResponse } from "../../../../lib/utils";
import { check_query_limit } from "../../../../lib/rate_limiting";
import { PrefixLogger } from "../../../../lib/utils";
import { TestProfile } from "@/app/lib/types/testing_types";
import { fetchProjectMcpTools } from "@/app/lib/project_tools";

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

        // fetch project tools
        const projectTools = await fetchProjectMcpTools(projectId);

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

        let currentState: unknown = reqState ?? { last_agent_name: workflow.agents[0].name };

        // get assistant response
        const { agents, tools, prompts, startAgent } = convertWorkflowToAgenticAPI(workflow, projectTools);
        const request: z.infer<typeof AgenticAPIChatRequest> = {
            projectId,
            messages: convertFromApiToAgenticApiMessages(reqMessages),
            state: currentState,
            agents,
            tools,
            prompts,
            startAgent,
            testProfile: testProfile ?? undefined,
            mcpServers: (project.mcpServers ?? []).map(server => ({
                name: server.name,
                serverUrl: server.serverUrl ?? '',
                isReady: server.isReady ?? false
            })),
            toolWebhookUrl: project.webhookUrl ?? '',
        };

        const { messages: agenticMessages, state } = await getAgenticApiResponse(request);
        const newMessages = convertFromAgenticApiToApiMessages(agenticMessages);
        const newState = state;

        const responseBody: z.infer<typeof ApiResponse> = {
            messages: newMessages,
            state: newState,
        };
        return Response.json(responseBody);
    });
}
