import { z } from "zod";
import { IProjectsRepository } from "../../repositories/projects.repository.interface";
import { IProjectActionAuthorizationPolicy } from "../../policies/project-action-authorization.policy";
import { IUsageQuotaPolicy } from "../../policies/usage-quota.policy.interface";
import { ComposioConnectedAccount } from "@/src/entities/models/project";
import { ZAuthScheme, ZCreateAuthConfigResponse, ZCreateConnectedAccountResponse, listAuthConfigs, createAuthConfig, createConnectedAccount } from "@/app/lib/composio/composio";

export const InputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    toolkitSlug: z.string(),
    callbackUrl: z.string(),
});

export interface ICreateComposioManagedConnectedAccountUseCase {
    execute(request: z.infer<typeof InputSchema>): Promise<z.infer<typeof ZCreateConnectedAccountResponse>>;
}

export class CreateComposioManagedConnectedAccountUseCase implements ICreateComposioManagedConnectedAccountUseCase {
    private readonly projectsRepository: IProjectsRepository;
    private readonly projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy;
    private readonly usageQuotaPolicy: IUsageQuotaPolicy;

    constructor({
        projectsRepository,
        projectActionAuthorizationPolicy,
        usageQuotaPolicy,
    }: {
        projectsRepository: IProjectsRepository,
        projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy,
        usageQuotaPolicy: IUsageQuotaPolicy,
    }) {
        this.projectsRepository = projectsRepository;
        this.projectActionAuthorizationPolicy = projectActionAuthorizationPolicy;
        this.usageQuotaPolicy = usageQuotaPolicy;
    }

    async execute(request: z.infer<typeof InputSchema>): Promise<z.infer<typeof ZCreateConnectedAccountResponse>> {
        const { caller, userId, apiKey, projectId, toolkitSlug, callbackUrl } = request;

        await this.projectActionAuthorizationPolicy.authorize({ caller, userId, apiKey, projectId });
        await this.usageQuotaPolicy.assertAndConsume(projectId);

        // fetch managed auth configs
        const configs = await listAuthConfigs(toolkitSlug, null, true);

        // check if managed oauth2 config exists or create one
        let authConfigId: string | undefined = undefined;
        const managedOauth2 = configs.items.find(cfg => cfg.auth_scheme === 'OAUTH2' && cfg.is_composio_managed);
        if (managedOauth2) {
            authConfigId = managedOauth2.id;
        } else {
            const created: z.infer<typeof ZCreateAuthConfigResponse> = await createAuthConfig({
                toolkit: { slug: toolkitSlug },
                auth_config: {
                    type: 'use_composio_managed_auth',
                    name: 'composio-managed-oauth2',
                },
            });
            authConfigId = created.auth_config.id;
        }

        if (!authConfigId) {
            throw new Error(`No managed oauth2 auth config found for toolkit ${toolkitSlug}`);
        }

        // create connected account
        const response = await createConnectedAccount({
            auth_config: { id: authConfigId },
            connection: { user_id: projectId, callback_url: callbackUrl },
        });

        // persist to project
        const now = new Date().toISOString();
        const account: z.infer<typeof ComposioConnectedAccount> = {
            id: response.id,
            authConfigId,
            status: 'INITIATED',
            createdAt: now,
            lastUpdatedAt: now,
        };

        await this.projectsRepository.addComposioConnectedAccount(projectId, {
            toolkitSlug,
            data: account,
        });

        return response;
    }
}


