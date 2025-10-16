import { NotFoundError } from '@/src/entities/errors/common';
import { z } from "zod";
import { IUsageQuotaPolicy } from '../../policies/usage-quota.policy.interface';
import { IProjectActionAuthorizationPolicy } from '../../policies/project-action-authorization.policy';
import { IScheduledJobRulesRepository } from '../../repositories/scheduled-job-rules.repository.interface';
import { ScheduledJobRule } from '@/src/entities/models/scheduled-job-rule';
import { Message } from '@/app/lib/types/types';

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    ruleId: z.string(),
    input: z.object({
        messages: z.array(Message),
    }),
    scheduledTime: z.string().datetime(),
});

export interface IUpdateScheduledJobRuleUseCase {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof ScheduledJobRule>>;
}

export class UpdateScheduledJobRuleUseCase implements IUpdateScheduledJobRuleUseCase {
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
        await this.projectActionAuthorizationPolicy.authorize({
            caller: request.caller,
            userId: request.userId,
            apiKey: request.apiKey,
            projectId: request.projectId,
        });

        await this.usageQuotaPolicy.assertAndConsumeProjectAction(request.projectId);

        const rule = await this.scheduledJobRulesRepository.fetch(request.ruleId);
        if (!rule || rule.projectId !== request.projectId) {
            throw new NotFoundError('Scheduled job rule not found');
        }

        return await this.scheduledJobRulesRepository.updateRule(request.ruleId, {
            input: request.input,
            scheduledTime: request.scheduledTime,
        });
    }
}
