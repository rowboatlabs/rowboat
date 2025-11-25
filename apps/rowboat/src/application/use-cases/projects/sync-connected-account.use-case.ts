import { z } from "zod";
import { IProjectsRepository } from "../../repositories/projects.repository.interface";
import { IProjectActionAuthorizationPolicy } from "../../policies/project-action-authorization.policy";
import { IUsageQuotaPolicy } from "../../policies/usage-quota.policy.interface";
import { ComposioConnectedAccount } from "@/src/entities/models/project";
import { getConnectedAccount } from "@/src/application/lib/composio/composio";
import { ZConnectedAccount } from "../../lib/composio/types";

export const InputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    toolkitSlug: z.string(),
    connectedAccountId: z.string(),
});

export interface ISyncConnectedAccountUseCase {
    execute(request: z.infer<typeof InputSchema>): Promise<z.infer<typeof ComposioConnectedAccount>>;
}

export class SyncConnectedAccountUseCase implements ISyncConnectedAccountUseCase {
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

    async execute(request: z.infer<typeof InputSchema>): Promise<z.infer<typeof ComposioConnectedAccount>> {
        const { caller, userId, apiKey, projectId, toolkitSlug, connectedAccountId } = request;

        await this.projectActionAuthorizationPolicy.authorize({ caller, userId, apiKey, projectId });
        await this.usageQuotaPolicy.assertAndConsumeProjectAction(projectId);

        // fetch project & account to verify
        const project = await this.projectsRepository.fetch(projectId);
        if (!project) {
            throw new Error('Project not found');
        }
        const account = project.composioConnectedAccounts?.[toolkitSlug];
        if (!account || account.id !== connectedAccountId) {
            // Log detailed mismatch context to aid debugging
            try {
                // Avoid crashing on logging itself
                // Include both expected and stored IDs, toolkit slug, and available toolkits
                // so we can quickly spot wrong slug or race conditions.
                // Note: This is server-side logging only.
                console.error('[Composio] Connected account mismatch', {
                    projectId,
                    toolkitSlug,
                    expectedConnectedAccountId: connectedAccountId,
                    storedAccountId: account?.id ?? null,
                    storedStatus: account?.status ?? null,
                    availableToolkits: Object.keys(project.composioConnectedAccounts || {}),
                });
            } catch {}

            throw new Error(`Connected account ${connectedAccountId} not found in project ${projectId} (toolkit: ${toolkitSlug})`);
        }

        if (account.status === 'ACTIVE') {
            return account;
        }

        // get latest status from Composio
        const response = await getConnectedAccount(connectedAccountId);

        const updated: z.infer<typeof ComposioConnectedAccount> = {
            ...account,
            status: (() => {
                switch (response.status) {
                    case 'INITIALIZING':
                    case 'INITIATED':
                        return 'INITIATED' as const;
                    case 'ACTIVE':
                        return 'ACTIVE' as const;
                    default:
                        return 'FAILED' as const;
                }
            })(),
            lastUpdatedAt: new Date().toISOString(),
        };

        await this.projectsRepository.addComposioConnectedAccount(projectId, {
            toolkitSlug,
            data: updated,
        });

        return updated;
    }
}

