import { BadRequestError } from '@/src/entities/errors/common';
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
    input: z.object({
        messages: z.array(Message),
    }),
    scheduledTime: z.string().datetime(),
});

export interface ICreateScheduledJobRuleUseCase {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof ScheduledJobRule>>;
}

export class CreateScheduledJobRuleUseCase implements ICreateScheduledJobRuleUseCase {
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
        // authz check
        await this.projectActionAuthorizationPolicy.authorize({
            caller: request.caller,
            userId: request.userId,
            apiKey: request.apiKey,
            projectId: request.projectId,
        });

        // assert and consume quota
        await this.usageQuotaPolicy.assertAndConsume(request.projectId);

        // create the scheduled job rule with UTC time
        const rule = await this.scheduledJobRulesRepository.create({
            projectId: request.projectId,
            input: request.input,
            scheduledTime: request.scheduledTime,
        });

        return rule;
    }
}
