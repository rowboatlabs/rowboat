import { z } from "zod";
import crypto from "crypto";
import { IProjectsRepository } from "../../repositories/projects.repository.interface";
import { IProjectActionAuthorizationPolicy } from "../../policies/project-action-authorization.policy";
import { IUsageQuotaPolicy } from "../../policies/usage-quota.policy.interface";

export const InputSchema = z.object({
    projectId: z.string(),
    userId: z.string(),
    caller: z.enum(["user", "api"]),
    apiKey: z.string().optional(),
});

export interface IRotateSecretUseCase {
    execute(request: z.infer<typeof InputSchema>): Promise<string>;
}

export class RotateSecretUseCase implements IRotateSecretUseCase {
    private readonly projectsRepository: IProjectsRepository;
    private readonly projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy;
    private readonly usageQuotaPolicy: IUsageQuotaPolicy;

    constructor({ projectsRepository, projectActionAuthorizationPolicy, usageQuotaPolicy }: { projectsRepository: IProjectsRepository, projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy, usageQuotaPolicy: IUsageQuotaPolicy }) {
        this.projectsRepository = projectsRepository;
        this.projectActionAuthorizationPolicy = projectActionAuthorizationPolicy;
        this.usageQuotaPolicy = usageQuotaPolicy;
    }

    async execute(request: z.infer<typeof InputSchema>): Promise<string> {
        const { projectId, userId, caller, apiKey } = request;
        // project-level authz check
        await this.projectActionAuthorizationPolicy.authorize({
            caller,
            userId,
            apiKey,
            projectId,
        });

        // assert and consume quota
        await this.usageQuotaPolicy.assertAndConsume(projectId);

        const secret = crypto.randomBytes(32).toString("hex");
        await this.projectsRepository.updateSecret(projectId, secret);
        return secret;
    }
}