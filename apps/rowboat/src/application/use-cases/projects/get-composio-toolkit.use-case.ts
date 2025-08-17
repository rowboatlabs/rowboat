import { z } from "zod";
import { IProjectActionAuthorizationPolicy } from "../../policies/project-action-authorization.policy";
import { IUsageQuotaPolicy } from "../../policies/usage-quota.policy.interface";
import { ZGetToolkitResponse, getToolkit } from "@/app/lib/composio/composio";

export const InputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    toolkitSlug: z.string(),
});

export interface IGetComposioToolkitUseCase {
    execute(request: z.infer<typeof InputSchema>): Promise<z.infer<typeof ZGetToolkitResponse>>;
}

export class GetComposioToolkitUseCase implements IGetComposioToolkitUseCase {
    private readonly projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy;
    private readonly usageQuotaPolicy: IUsageQuotaPolicy;

    constructor({ projectActionAuthorizationPolicy, usageQuotaPolicy }: { projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy, usageQuotaPolicy: IUsageQuotaPolicy }) {
        this.projectActionAuthorizationPolicy = projectActionAuthorizationPolicy;
        this.usageQuotaPolicy = usageQuotaPolicy;
    }

    async execute(request: z.infer<typeof InputSchema>): Promise<z.infer<typeof ZGetToolkitResponse>> {
        const { caller, userId, apiKey, projectId, toolkitSlug } = request;
        await this.projectActionAuthorizationPolicy.authorize({ caller, userId, apiKey, projectId });
        await this.usageQuotaPolicy.assertAndConsume(projectId);
        return await getToolkit(toolkitSlug);
    }
}


