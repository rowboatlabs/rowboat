'use server';
import {
    CopilotAPIRequest,
    CopilotChatContext, CopilotMessage,
    DataSourceSchemaForCopilot,
} from "../../src/entities/models/copilot";
import { 
    Workflow} from "../lib/types/workflow_types";
import { z } from 'zod';
import { projectAuthCheck } from "./project.actions";
import { authorizeUserAction, logUsage } from "./billing.actions";
import { USE_BILLING } from "../lib/feature_flags";
import { getEditAgentInstructionsResponse } from "../../src/application/lib/copilot/copilot";
import { container } from "@/di/container";
import { IUsageQuotaPolicy } from "@/src/application/policies/usage-quota.policy.interface";
import { UsageTracker } from "../lib/billing";
import { authCheck } from "./auth.actions";
import { ICreateCopilotCachedTurnController } from "@/src/interface-adapters/controllers/copilot/create-copilot-cached-turn.controller";
import { BillingError } from "@/src/entities/errors/common";

const usageQuotaPolicy = container.resolve<IUsageQuotaPolicy>('usageQuotaPolicy');
const createCopilotCachedTurnController = container.resolve<ICreateCopilotCachedTurnController>('createCopilotCachedTurnController');

export async function getCopilotResponseStream(
    projectId: string,
    messages: z.infer<typeof CopilotMessage>[],
    current_workflow_config: z.infer<typeof Workflow>,
    context: z.infer<typeof CopilotChatContext> | null,
    dataSources?: z.infer<typeof DataSourceSchemaForCopilot>[]
): Promise<{
    streamId: string;
} | { billingError: string }> {
    const user = await authCheck();

    try {
        const { key } = await createCopilotCachedTurnController.execute({
            caller: 'user',
            userId: user.id,
            data: {
                projectId,
                messages,
                workflow: current_workflow_config,
                context,
                dataSources,
            }
        });
        return {
            streamId: key,
        };
    } catch (err) {
        if (err instanceof BillingError) {
            return { billingError: err.message };
        }
        throw err;
    }
}

export async function getCopilotAgentInstructions(
    projectId: string,
    messages: z.infer<typeof CopilotMessage>[],
    current_workflow_config: z.infer<typeof Workflow>,
    agentName: string,
): Promise<string | { billingError: string }> {
    await projectAuthCheck(projectId);
    await usageQuotaPolicy.assertAndConsumeProjectAction(projectId);

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