import { z } from "zod";
import { IProjectActionAuthorizationPolicy } from "../../policies/project-action-authorization.policy";
import { IUsageQuotaPolicy } from "../../policies/usage-quota.policy.interface";
import { ZToolkit, ZListResponse, listToolkits } from "@/app/lib/composio/composio";

export const InputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    cursor: z.string().nullable().optional(),
});

export interface IListComposioToolkitsUseCase {
    execute(request: z.infer<typeof InputSchema>): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZToolkit>>>>;
}

export class ListComposioToolkitsUseCase implements IListComposioToolkitsUseCase {
    private readonly projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy;
    private readonly usageQuotaPolicy: IUsageQuotaPolicy;

    constructor({ projectActionAuthorizationPolicy, usageQuotaPolicy }: { projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy, usageQuotaPolicy: IUsageQuotaPolicy }) {
        this.projectActionAuthorizationPolicy = projectActionAuthorizationPolicy;
        this.usageQuotaPolicy = usageQuotaPolicy;
    }

    async execute(request: z.infer<typeof InputSchema>): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZToolkit>>>> {
        const { caller, userId, apiKey, projectId, cursor } = request;
        await this.projectActionAuthorizationPolicy.authorize({ caller, userId, apiKey, projectId });
        await this.usageQuotaPolicy.assertAndConsume(projectId);
        return await listToolkits(cursor ?? null);
    }
}


