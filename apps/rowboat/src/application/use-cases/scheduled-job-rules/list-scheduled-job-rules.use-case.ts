import { z } from "zod";
import { IUsageQuotaPolicy } from '../../policies/usage-quota.policy.interface';
import { IProjectActionAuthorizationPolicy } from '../../policies/project-action-authorization.policy';
import { IScheduledJobRulesRepository, ListedRuleItem } from '../../repositories/scheduled-job-rules.repository.interface';
import { PaginatedList } from '@/src/entities/common/paginated-list';

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    cursor: z.string().optional(),
    limit: z.number().optional(),
});

export interface IListScheduledJobRulesUseCase {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof ListedRuleItem>>>>;
}

export class ListScheduledJobRulesUseCase implements IListScheduledJobRulesUseCase {
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

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof ListedRuleItem>>>> {
        // extract projectid from request
        const { projectId, limit } = request;

        // authz check
        await this.projectActionAuthorizationPolicy.authorize({
            caller: request.caller,
            userId: request.userId,
            apiKey: request.apiKey,
            projectId,
        });

        // assert and consume quota
        await this.usageQuotaPolicy.assertAndConsume(projectId);

        // fetch scheduled job rules for project
        return await this.scheduledJobRulesRepository.list(projectId, request.cursor, limit);
    }
}
