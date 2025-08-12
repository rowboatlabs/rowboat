import { BadRequestError, NotFoundError } from '@/src/entities/errors/common';
import { z } from "zod";
import { IUsageQuotaPolicy } from '../../policies/usage-quota.policy.interface';
import { IProjectActionAuthorizationPolicy } from '../../policies/project-action-authorization.policy';
import { IRecurringJobRulesRepository } from '../../repositories/recurring-job-rules.repository.interface';

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    ruleId: z.string(),
});

export interface IDeleteRecurringJobRuleUseCase {
    execute(request: z.infer<typeof inputSchema>): Promise<boolean>;
}

export class DeleteRecurringJobRuleUseCase implements IDeleteRecurringJobRuleUseCase {
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

    async execute(request: z.infer<typeof inputSchema>): Promise<boolean> {
        // authz check
        await this.projectActionAuthorizationPolicy.authorize({
            caller: request.caller,
            userId: request.userId,
            apiKey: request.apiKey,
            projectId: request.projectId,
        });

        // assert and consume quota
        await this.usageQuotaPolicy.assertAndConsume(request.projectId);

        // ensure rule belongs to this project
        const rule = await this.recurringJobRulesRepository.fetch(request.ruleId);
        if (!rule || rule.projectId !== request.projectId) {
            throw new NotFoundError('Recurring job rule not found');
        }

        // delete the rule
        return await this.recurringJobRulesRepository.delete(request.ruleId);
    }
}
