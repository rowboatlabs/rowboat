import { z } from "zod";
import { ICacheService } from '@/src/application/services/cache.service.interface';
import { IUsageQuotaPolicy } from '@/src/application/policies/usage-quota.policy.interface';
import { IProjectActionAuthorizationPolicy } from '@/src/application/policies/project-action-authorization.policy';
import { CopilotAPIRequest, CopilotStreamEvent } from '@/src/entities/models/copilot';
import { USE_BILLING } from "@/app/lib/feature_flags";
import { authorize, getCustomerIdForProject, logUsage, UsageTracker } from "@/app/lib/billing";
import { BillingError, NotFoundError } from "@/src/entities/errors/common";
import { streamMultiAgentResponse } from "@/src/application/lib/copilot/copilot";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    key: z.string(),
});

export interface IRunCopilotCachedTurnUseCase {
    execute(data: z.infer<typeof inputSchema>): AsyncGenerator<z.infer<typeof CopilotStreamEvent>, void, unknown>;
}

export class RunCopilotCachedTurnUseCase implements IRunCopilotCachedTurnUseCase {
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

    async *execute(data: z.infer<typeof inputSchema>): AsyncGenerator<z.infer<typeof CopilotStreamEvent>, void, unknown> {
        // fetch cached turn
        const lookupKey = `copilot-stream-${data.key}`;
        const payload = await this.cacheService.get(lookupKey);
        if (!payload) {
            throw new NotFoundError('Cached turn not found');
        }

        // delete from cache
        await this.cacheService.delete(lookupKey);

        // parse cached turn
        const cachedTurn = CopilotAPIRequest.parse(JSON.parse(payload));

        const { projectId } = cachedTurn;

        // check auth
        await this.projectActionAuthorizationPolicy.authorize({
            projectId,
            caller: data.caller,
            userId: data.userId,
            apiKey: data.apiKey,
        });

        await this.usageQuotaPolicy.assertAndConsumeProjectAction(projectId);

        // check billing authorization
        let billingCustomerId: string | null = null;
        if (USE_BILLING) {
            // get billing customer id for this project
            billingCustomerId = await getCustomerIdForProject(projectId);

            // validate enough credits
            const result = await authorize(billingCustomerId, {
                type: "use_credits"
            });
            if (!result.success) {
                throw new BillingError(result.error || 'Billing error');
            }
        }

        // init usage tracking
        const usageTracker = new UsageTracker();

        try {
            for await (const event of streamMultiAgentResponse(
                usageTracker,
                projectId,
                cachedTurn.context,
                cachedTurn.messages,
                cachedTurn.workflow,
                cachedTurn.dataSources || [],
            )) {
                yield event;
            }
        } finally {
            if (USE_BILLING && billingCustomerId) {
                await logUsage(billingCustomerId, {
                    items: usageTracker.flush(),
                });
            }
        }
    }
}