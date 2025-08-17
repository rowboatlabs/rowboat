import { z } from "zod";
import { IProjectsRepository } from "../../repositories/projects.repository.interface";
import { IProjectActionAuthorizationPolicy } from "../../policies/project-action-authorization.policy";
import { IUsageQuotaPolicy } from "../../policies/usage-quota.policy.interface";

export const InputSchema = z.object({
    projectId: z.string(),
    userId: z.string(),
    caller: z.enum(["user", "api"]),
    apiKey: z.string().optional(),
    name: z.string(),
});

export interface IUpdateProjectNameUseCase {
    execute(request: z.infer<typeof InputSchema>): Promise<void>;
}

export class UpdateProjectNameUseCase implements IUpdateProjectNameUseCase {
    private readonly projectsRepository: IProjectsRepository;
    private readonly projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy;
    private readonly usageQuotaPolicy: IUsageQuotaPolicy;

    constructor({ projectsRepository, projectActionAuthorizationPolicy, usageQuotaPolicy }: { projectsRepository: IProjectsRepository, projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy, usageQuotaPolicy: IUsageQuotaPolicy }) {
        this.projectsRepository = projectsRepository;
        this.projectActionAuthorizationPolicy = projectActionAuthorizationPolicy;
        this.usageQuotaPolicy = usageQuotaPolicy;
    }

    async execute(request: z.infer<typeof InputSchema>): Promise<void> {
        const { projectId, userId, caller, apiKey, name } = request;
        await this.projectActionAuthorizationPolicy.authorize({
            caller,
            userId,
            apiKey,
            projectId,
        });

        // assert and consume quota
        await this.usageQuotaPolicy.assertAndConsume(projectId);

        await this.projectsRepository.updateName(projectId, name);
    }
}
