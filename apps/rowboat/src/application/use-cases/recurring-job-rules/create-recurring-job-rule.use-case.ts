import { BadRequestError } from '@/src/entities/errors/common';
import { z } from "zod";
import { IUsageQuotaPolicy } from '../../policies/usage-quota.policy.interface';
import { IProjectActionAuthorizationPolicy } from '../../policies/project-action-authorization.policy';
import { IRecurringJobRulesRepository } from '../../repositories/recurring-job-rules.repository.interface';
import { RecurringJobRule } from '@/src/entities/models/recurring-job-rule';
import { Message } from '@/app/lib/types/types';
import { CronExpressionParser } from 'cron-parser';

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
        if (!this.isValidCronExpression(request.cron)) {
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
        await this.usageQuotaPolicy.assertAndConsume(request.projectId);

        // parse cron to get next run time
        const interval = CronExpressionParser.parse(request.cron, {
            tz: "UTC",
        });
        const nextRunAt = interval.next().toDate().toISOString();

        // create the recurring job rule
        const rule = await this.recurringJobRulesRepository.create({
            projectId: request.projectId,
            input: request.input,
            cron: request.cron,
            nextRunAt,
        });

        return rule;
    }

    private isValidCronExpression(cron: string): boolean {
        const parts = cron.split(' ');
        if (parts.length !== 5) {
            return false;
        }

        // Basic validation - in production you'd want more sophisticated validation
        const [minute, hour, day, month, dayOfWeek] = parts;
        
        // Check if parts are valid
        const isValidPart = (part: string) => {
            if (part === '*') return true;
            if (part.includes('/')) {
                const [range, step] = part.split('/');
                if (range === '*' || (parseInt(step) > 0 && parseInt(step) <= 59)) return true;
                return false;
            }
            if (part.includes('-')) {
                const [start, end] = part.split('-');
                return !isNaN(parseInt(start)) && !isNaN(parseInt(end)) && parseInt(start) <= parseInt(end);
            }
            return !isNaN(parseInt(part));
        };

        return isValidPart(minute) && isValidPart(hour) && isValidPart(day) && isValidPart(month) && isValidPart(dayOfWeek);
    }
}
