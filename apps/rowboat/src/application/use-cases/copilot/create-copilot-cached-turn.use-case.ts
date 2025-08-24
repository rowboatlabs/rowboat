import { z } from "zod";
import { nanoid } from 'nanoid';
import { ICacheService } from '@/src/application/services/cache.service.interface';
import { IUsageQuotaPolicy } from '@/src/application/policies/usage-quota.policy.interface';
import { IProjectActionAuthorizationPolicy } from '@/src/application/policies/project-action-authorization.policy';
import { CopilotChatContext, CopilotMessage, DataSourceSchemaForCopilot } from '@/src/entities/models/copilot';
import { Workflow } from '@/app/lib/types/workflow_types';
import { USE_BILLING } from "@/app/lib/feature_flags";
import { authorize, getCustomerIdForProject } from "@/app/lib/billing";
import { BillingError } from "@/src/entities/errors/common";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),    
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    data: z.object({
        projectId: z.string(),
        messages: z.array(CopilotMessage),
        workflow: Workflow,
        context: CopilotChatContext.nullable(),
        dataSources: z.array(DataSourceSchemaForCopilot).optional(),
    }),
});

export interface ICreateCopilotCachedTurnUseCase {
    execute(data: z.infer<typeof inputSchema>): Promise<{ key: string }>;
}

export class CreateCopilotCachedTurnUseCase implements ICreateCopilotCachedTurnUseCase {
    private readonly cacheService: ICacheService;
    private readonly usageQuotaPolicy: IUsageQuotaPolicy;
    private readonly projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy;

    constructor({
        cacheService,
        usageQuotaPolicy,
        projectActionAuthorizationPolicy,
    }: {
        cacheService: ICacheService,
        usageQuotaPolicy: IUsageQuotaPolicy,
        projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy,
    }) {
        this.cacheService = cacheService;
        this.usageQuotaPolicy = usageQuotaPolicy;
        this.projectActionAuthorizationPolicy = projectActionAuthorizationPolicy;
    }

    async execute(data: z.infer<typeof inputSchema>): Promise<{ key: string }> {
        const { projectId } = data.data;

        // check auth
        await this.projectActionAuthorizationPolicy.authorize({
            projectId,
            caller: data.caller,
            userId: data.userId,
            apiKey: data.apiKey,
        });
        await this.usageQuotaPolicy.assertAndConsumeProjectAction(projectId);

        // check billing authorization
        if (USE_BILLING) {
            // get billing customer id for this project
            const billingCustomerId = await getCustomerIdForProject(projectId);

            // validate enough credits
            const result = await authorize(billingCustomerId, {
                type: "use_credits"
            });
            if (!result.success) {
                throw new BillingError(result.error || 'Billing error');
            }
        }

        // serialize request
        const payload = JSON.stringify(data.data);

        // create unique id for stream
        const key = nanoid();

        // store in cache
        await this.cacheService.set(`copilot-stream-${key}`, payload, 60 * 10); // expire in 10 minutes

        return {
            key,
        }
    }
}