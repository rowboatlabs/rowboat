import { BadRequestError } from '@/src/entities/errors/common';
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
    input: z.object({
        messages: z.array(Message),
    }),
    cron: z.string(),
});

export interface ICreateRecurringJobRuleUseCase {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof RecurringJobRule>>;
}

export class CreateRecurringJobRuleUseCase implements ICreateRecurringJobRuleUseCase {
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
        // Validate cron expression
        if (!isValidCronExpression(request.cron)) {
            throw new BadRequestError('Invalid cron expression. Expected format: minute hour day month dayOfWeek');
        }

        // authz check
        await this.projectActionAuthorizationPolicy.authorize({
            caller: request.caller,
            userId: request.userId,
            apiKey: request.apiKey,
            projectId: request.projectId,
        });

        // assert and consume quota
        await this.usageQuotaPolicy.assertAndConsumeProjectAction(request.projectId);

        // create the recurring job rule
        const rule = await this.recurringJobRulesRepository.create({
            projectId: request.projectId,
            input: request.input,
            cron: request.cron,
        });

        return rule;
    }
}
