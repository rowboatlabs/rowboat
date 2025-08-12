import { BadRequestError, NotFoundError } from '@/src/entities/errors/common';
import { z } from "zod";
import { IUsageQuotaPolicy } from '../../policies/usage-quota.policy.interface';
import { IProjectActionAuthorizationPolicy } from '../../policies/project-action-authorization.policy';
import { IScheduledJobRulesRepository } from '../../repositories/scheduled-job-rules.repository.interface';

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    ruleId: z.string(),
});

export interface IDeleteScheduledJobRuleUseCase {
    execute(request: z.infer<typeof inputSchema>): Promise<boolean>;
}

export class DeleteScheduledJobRuleUseCase implements IDeleteScheduledJobRuleUseCase {
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
        const rule = await this.scheduledJobRulesRepository.fetch(request.ruleId);
        if (!rule || rule.projectId !== request.projectId) {
            throw new NotFoundError('Scheduled job rule not found');
        }

        // delete the rule
        return await this.scheduledJobRulesRepository.delete(request.ruleId);
    }
}
