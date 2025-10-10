import { BadRequestError, NotFoundError } from '@/src/entities/errors/common';
import { z } from "zod";
import { IUsageQuotaPolicy } from '../../policies/usage-quota.policy.interface';
import { IProjectActionAuthorizationPolicy } from '../../policies/project-action-authorization.policy';
import { IRecurringJobRulesRepository } from '../../repositories/recurring-job-rules.repository.interface';
import { RecurringJobRule } from '@/src/entities/models/recurring-job-rule';
import { Message } from '@/app/lib/types/types';
import { isValidCronExpression } from '@/src/application/lib/utils/is-valid-cron-expression';

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    ruleId: z.string(),
    input: z.object({
        messages: z.array(Message),
    }),
    cron: z.string(),
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
        if (!isValidCronExpression(request.cron)) {
            throw new BadRequestError('Invalid cron expression. Expected format: minute hour day month dayOfWeek');
        }

        await this.projectActionAuthorizationPolicy.authorize({
            caller: request.caller,
            userId: request.userId,
            apiKey: request.apiKey,
            projectId: request.projectId,
        });

        await this.usageQuotaPolicy.assertAndConsumeProjectAction(request.projectId);

        const rule = await this.recurringJobRulesRepository.fetch(request.ruleId);
        if (!rule || rule.projectId !== request.projectId) {
            throw new NotFoundError('Recurring job rule not found');
        }

        return await this.recurringJobRulesRepository.update(request.ruleId, {
            input: request.input,
            cron: request.cron,
        });
    }
}
