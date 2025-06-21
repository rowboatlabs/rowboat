import { NextRequest } from "next/server";
import { agentWorkflowsCollection, db, projectsCollection, testProfilesCollection } from "../../../../lib/mongodb";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { authCheck } from "../../utils";
import { ApiRequest, ApiResponse } from "../../../../lib/types/types";
import { check_query_limit } from "../../../../lib/rate_limiting";
import { PrefixLogger } from "../../../../lib/utils";
import { TestProfile } from "@/app/lib/types/testing_types";
import { fetchProjectMcpTools } from "@/app/lib/project_tools";
import { authorize, getCustomerIdForProject, logUsage } from "@/app/lib/billing";
import { USE_BILLING } from "@/app/lib/feature_flags";
import { Message } from "@/app/lib/types/types";
import { generateAgenticResponse } from "@/app/lib/agents";

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
        // fetch billing customer id
        let billingCustomerId: string | null = null;
        if (USE_BILLING) {
            billingCustomerId = await getCustomerIdForProject(projectId);
        }

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

        // get assistant response
        const responseMessages: z.infer<typeof Message>[] = [...reqMessages];
        for await (const event of generateAgenticResponse(workflow, projectTools, responseMessages)) {
            if ('role' in event) {
                responseMessages.push(event);
            }
        }

        // log billing usage
        if (USE_BILLING && billingCustomerId) {
            const agentMessageCount = responseMessages.filter(m => m.role === 'assistant').length;
            await logUsage(billingCustomerId, {
                type: 'agent_messages',
                amount: agentMessageCount,
            });
        }

        const responseBody: z.infer<typeof ApiResponse> = {
            messages: responseMessages,
        };
        return Response.json(responseBody);
    });
}
