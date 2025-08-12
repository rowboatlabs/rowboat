import { NotFoundError } from '@/src/entities/errors/common';
import { z } from "zod";
import { IUsageQuotaPolicy } from '../../policies/usage-quota.policy.interface';
import { IProjectActionAuthorizationPolicy } from '../../policies/project-action-authorization.policy';
import { IRecurringJobRulesRepository } from '../../repositories/recurring-job-rules.repository.interface';
import { RecurringJobRule } from '@/src/entities/models/recurring-job-rule';
import { UpdateRecurringRuleSchema } from '../../repositories/recurring-job-rules.repository.interface';

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    ruleId: z.string(),
    data: UpdateRecurringRuleSchema,
});

export interface IUpdateRecurringJobRuleUseCase {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof RecurringJobRule>>;
}

export class UpdateRecurringJobRuleUseCase implements IUpdateRecurringJobRuleUseCase {
    private readonly recurringJobRulesRepository: IRecurringJobRulesRepository;   
    private readonly usageQuotaPolicy: IUsageQuotaPolicy;
    private readonly projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy;

    constructor({
        recurringJobRulesRepository,
        usageQuotaPolicy,
        projectActionAuthorizationPolicy,
    }: {
        recurringJobRulesRepository: IRecurringJobRulesRepository,
        usageQuotaPolicy: IUsageQuotaPolicy,
        projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy,
    }) {
        this.recurringJobRulesRepository = recurringJobRulesRepository;
        this.usageQuotaPolicy = usageQuotaPolicy;
        this.projectActionAuthorizationPolicy = projectActionAuthorizationPolicy;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof RecurringJobRule>> {
        // fetch rule first to get projectId
        const rule = await this.recurringJobRulesRepository.fetch(request.ruleId);
        if (!rule) {
            throw new NotFoundError(`Recurring job rule ${request.ruleId} not found`);
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

        // update the rule
        return await this.recurringJobRulesRepository.update(request.ruleId, request.data);
    }
}
