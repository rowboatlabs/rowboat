'use server';
import { 
    CopilotAPIRequest,
    CopilotChatContext, CopilotMessage,
} from "../lib/types/copilot_types";
import { 
    Workflow} from "../lib/types/workflow_types";
import { DataSource } from "../lib/types/datasource_types";
import { z } from 'zod';
import { projectAuthCheck } from "./project_actions";
import { redisClient } from "../lib/redis";
import { authorizeUserAction, logUsage } from "./billing_actions";
import { USE_BILLING } from "../lib/feature_flags";
import { WithStringId } from "../lib/types/types";
import { getEditAgentInstructionsResponse } from "../lib/copilot/copilot";
import { container } from "@/di/container";
import { IUsageQuotaPolicy } from "@/src/application/policies/usage-quota.policy.interface";
import { UsageTracker } from "../lib/billing";

const usageQuotaPolicy = container.resolve<IUsageQuotaPolicy>('usageQuotaPolicy');

export async function getCopilotResponseStream(
    projectId: string,
    messages: z.infer<typeof CopilotMessage>[],
    current_workflow_config: z.infer<typeof Workflow>,
    context: z.infer<typeof CopilotChatContext> | null,
    dataSources?: WithStringId<z.infer<typeof DataSource>>[]
): Promise<{
    streamId: string;
} | { billingError: string }> {
    await projectAuthCheck(projectId);
    await usageQuotaPolicy.assertAndConsume(projectId);

    // Check billing authorization
    const authResponse = await authorizeUserAction({
        type: 'use_credits',
    });
    if (!authResponse.success) {
        return { billingError: authResponse.error || 'Billing error' };
    }

    await usageQuotaPolicy.assertAndConsume(projectId);
    
    // prepare request
    const request: z.infer<typeof CopilotAPIRequest> = {
        projectId,
        messages,
        workflow: current_workflow_config,
        context,
        dataSources: dataSources,
    };

    // serialize the request
    const payload = JSON.stringify(request);

    // create a uuid for the stream
    const streamId = crypto.randomUUID();

    // store payload in redis
    await redisClient.set(`copilot-stream-${streamId}`, payload, 'EX', 60 * 10); // expire in 10 minutes

    return {
        streamId,
    };
}

export async function getCopilotAgentInstructions(
    projectId: string,
    messages: z.infer<typeof CopilotMessage>[],
    current_workflow_config: z.infer<typeof Workflow>,
    agentName: string,
): Promise<string | { billingError: string }> {
    await projectAuthCheck(projectId);
    await usageQuotaPolicy.assertAndConsume(projectId);

    // Check billing authorization
    const authResponse = await authorizeUserAction({
        type: 'use_credits',
    });
    if (!authResponse.success) {
        return { billingError: authResponse.error || 'Billing error' };
    }

    // prepare request
    const request: z.infer<typeof CopilotAPIRequest> = {
        projectId,
        messages,
        workflow: current_workflow_config,
        context: {
            type: 'agent',
            name: agentName,
        }
    };

    const usageTracker = new UsageTracker();

    // call copilot api
    const agent_instructions = await getEditAgentInstructionsResponse(
        usageTracker,
        projectId,
        request.context,
        request.messages,
        request.workflow,
    );

    // log the billing usage
    if (USE_BILLING) {
        await logUsage({
            items: usageTracker.flush(),
        });
    }

    // return response
    return agent_instructions;
}