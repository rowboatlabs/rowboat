import { z } from "zod";
import { IProjectActionAuthorizationPolicy } from "../../policies/project-action-authorization.policy";
import { IUsageQuotaPolicy } from "../../policies/usage-quota.policy.interface";
import { ZTool, ZListResponse, listTools } from "@/app/lib/composio/composio";

export const InputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    toolkitSlug: z.string(),
    searchQuery: z.string().nullable().optional(),
    cursor: z.string().nullable().optional(),
});

export interface IListComposioToolsUseCase {
    execute(request: z.infer<typeof InputSchema>): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZTool>>>>;
}

export class ListComposioToolsUseCase implements IListComposioToolsUseCase {
    private readonly projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy;
    private readonly usageQuotaPolicy: IUsageQuotaPolicy;

    constructor({ projectActionAuthorizationPolicy, usageQuotaPolicy }: { projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy, usageQuotaPolicy: IUsageQuotaPolicy }) {
        this.projectActionAuthorizationPolicy = projectActionAuthorizationPolicy;
        this.usageQuotaPolicy = usageQuotaPolicy;
    }

    async execute(request: z.infer<typeof InputSchema>): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZTool>>>> {
        const { caller, userId, apiKey, projectId, toolkitSlug, searchQuery, cursor } = request;
        await this.projectActionAuthorizationPolicy.authorize({ caller, userId, apiKey, projectId });
        await this.usageQuotaPolicy.assertAndConsume(projectId);
        return await listTools(toolkitSlug, searchQuery ?? null, cursor ?? null);
    }
}


