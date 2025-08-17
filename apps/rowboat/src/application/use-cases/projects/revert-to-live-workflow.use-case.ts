import { z } from "zod";
import { IProjectsRepository } from "../../repositories/projects.repository.interface";
import { IProjectActionAuthorizationPolicy } from "../../policies/project-action-authorization.policy";
import { IUsageQuotaPolicy } from "../../policies/usage-quota.policy.interface";
import { NotFoundError, BadRequestError } from "@/src/entities/errors/common";

export const InputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
});

export interface IRevertToLiveWorkflowUseCase {
    execute(request: z.infer<typeof InputSchema>): Promise<void>;
}

export class RevertToLiveWorkflowUseCase implements IRevertToLiveWorkflowUseCase {
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

    async execute(request: z.infer<typeof InputSchema>): Promise<void> {
        const { projectId } = request;
        await this.projectActionAuthorizationPolicy.authorize({
            caller: request.caller,
            userId: request.userId,
            apiKey: request.apiKey,
            projectId,
        });
        await this.usageQuotaPolicy.assertAndConsume(projectId);

        const project = await this.projectsRepository.fetch(projectId);
        if (!project) {
            throw new NotFoundError("Project not found");
        }
        const live = project.liveWorkflow;
        if (!live) {
            throw new BadRequestError("No live workflow found");
        }
        const draft = { ...live, lastUpdatedAt: new Date().toISOString() };
        await this.projectsRepository.updateDraftWorkflow(projectId, draft);
    }
}
