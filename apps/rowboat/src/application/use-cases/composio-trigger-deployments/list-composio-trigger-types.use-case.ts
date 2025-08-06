import { BadRequestError, NotFoundError } from '@/src/entities/errors/common';
import { z } from "zod";
import { IUsageQuotaPolicy } from '../../policies/usage-quota.policy.interface';
import { IProjectActionAuthorizationPolicy } from '../../policies/project-action-authorization.policy';
import { listTriggerTypes } from '../../../../app/lib/composio/composio';
import { PaginatedList } from '@/src/entities/common/paginated-list';
import { ComposioTriggerType } from '@/src/entities/models/composio-trigger-type';

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    toolkitSlug: z.string(),
    cursor: z.string().optional(),
});

export interface IListComposioTriggerTypesUseCase {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof ComposioTriggerType>>>>;
}

export class ListComposioTriggerTypesUseCase implements IListComposioTriggerTypesUseCase {
    private readonly usageQuotaPolicy: IUsageQuotaPolicy;
    private readonly projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy;

    constructor({
        usageQuotaPolicy,
        projectActionAuthorizationPolicy,
    }: {
        usageQuotaPolicy: IUsageQuotaPolicy,
        projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy,
    }) {
        this.usageQuotaPolicy = usageQuotaPolicy;
        this.projectActionAuthorizationPolicy = projectActionAuthorizationPolicy;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof ComposioTriggerType>>>> {
        // extract projectid from conversation
        const { projectId } = request;

        // authz check
        await this.projectActionAuthorizationPolicy.authorize({
            caller: request.caller,
            userId: request.userId,
            apiKey: request.apiKey,
            projectId,
        });

        // assert and consume quota
        await this.usageQuotaPolicy.assertAndConsume(projectId);

        // call composio api to fetch trigger types
        const result = await listTriggerTypes(request.toolkitSlug, request.cursor);

        // return paginated list of trigger types
        return {
            items: result.items,
            nextCursor: result.next_cursor,
        };
    }
}