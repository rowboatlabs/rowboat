import { BadRequestError, NotFoundError } from '@/src/entities/errors/common';
import { z } from "zod";
import { IUsageQuotaPolicy } from '../../policies/usage-quota.policy.interface';
import { IProjectActionAuthorizationPolicy } from '../../policies/project-action-authorization.policy';
import { IScheduledJobRulesRepository } from '../../repositories/scheduled-job-rules.repository.interface';
import { ScheduledJobRule } from '@/src/entities/models/scheduled-job-rule';

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    ruleId: z.string(),
});

export interface IEnableScheduledJobRuleUseCase {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof ScheduledJobRule>>;
}

export class EnableScheduledJobRuleUseCase implements IEnableScheduledJobRuleUseCase {
    private readonly scheduledJobRulesRepository: IScheduledJobRulesRepository;   
    private readonly usageQuotaPolicy: IUsageQuotaPolicy;
    private readonly projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy;

    constructor({
        scheduledJobRulesRepository,
        usageQuotaPolicy,
        projectActionAuthorizationPolicy,
    }: {
        scheduledJobRulesRepository: IScheduledJobRulesRepository,
        usageQuotaPolicy: IUsageQuotaPolicy,
        projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy,
    }) {
        this.scheduledJobRulesRepository = scheduledJobRulesRepository;
        this.usageQuotaPolicy = usageQuotaPolicy;
        this.projectActionAuthorizationPolicy = projectActionAuthorizationPolicy;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof ScheduledJobRule>> {
        // fetch scheduled job rule first to get projectId
        const rule = await this.scheduledJobRulesRepository.fetch(request.ruleId);
        if (!rule) {
            throw new NotFoundError(`Scheduled job rule ${request.ruleId} not found`);
        }

        // extract projectid from rule
        const { projectId } = rule;

        // authz check
        await this.projectActionAuthorizationPolicy.authorize({
            caller: request.caller,
            userId: request.userId,
            apiKey: request.apiKey,
            projectId,
        });

        // assert and consume quota
        await this.usageQuotaPolicy.assertAndConsume(projectId);

        // enable the scheduled job rule
        const enabledRule = await this.scheduledJobRulesRepository.enable(request.ruleId);

        return enabledRule;
    }
}
