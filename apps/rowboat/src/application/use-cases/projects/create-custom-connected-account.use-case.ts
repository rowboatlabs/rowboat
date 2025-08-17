import { z } from "zod";
import { IProjectsRepository } from "../../repositories/projects.repository.interface";
import { IProjectActionAuthorizationPolicy } from "../../policies/project-action-authorization.policy";
import { IUsageQuotaPolicy } from "../../policies/usage-quota.policy.interface";
import { ComposioConnectedAccount } from "@/src/entities/models/project";
import { ZAuthScheme, ZCredentials, ZCreateAuthConfigResponse, ZCreateConnectedAccountResponse, ZCreateConnectedAccountRequest, createAuthConfig, createConnectedAccount } from "@/app/lib/composio/composio";

export const InputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    toolkitSlug: z.string(),
    authConfig: z.object({
        authScheme: ZAuthScheme,
        credentials: ZCredentials,
    }),
    callbackUrl: z.string(),
});

export interface ICreateCustomConnectedAccountUseCase {
    execute(request: z.infer<typeof InputSchema>): Promise<z.infer<typeof ZCreateConnectedAccountResponse>>;
}

export class CreateCustomConnectedAccountUseCase implements ICreateCustomConnectedAccountUseCase {
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
        const { caller, userId, apiKey, projectId, toolkitSlug, authConfig, callbackUrl } = request;

        await this.projectActionAuthorizationPolicy.authorize({ caller, userId, apiKey, projectId });
        await this.usageQuotaPolicy.assertAndConsume(projectId);

        // create custom auth config
        const created: z.infer<typeof ZCreateAuthConfigResponse> = await createAuthConfig({
            toolkit: { slug: toolkitSlug },
            auth_config: {
                type: 'use_custom_auth',
                authScheme: authConfig.authScheme,
                credentials: authConfig.credentials,
                name: `pid-${projectId}-${Date.now()}`,
            },
        });

        // initiate connected account
        let state: z.infer<typeof ZCreateConnectedAccountRequest>["connection"]["state"] = undefined;
        if (authConfig.authScheme !== 'OAUTH2') {
            state = {
                authScheme: authConfig.authScheme,
                val: { status: 'ACTIVE', ...authConfig.credentials },
            } as any;
        }

        const response = await createConnectedAccount({
            auth_config: { id: created.auth_config.id },
            connection: {
                state,
                user_id: projectId,
                callback_url: callbackUrl,
            },
        });

        // persist to project
        const now = new Date().toISOString();
        const account: z.infer<typeof ComposioConnectedAccount> = {
            id: response.id,
            authConfigId: created.auth_config.id,
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


