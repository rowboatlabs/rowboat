import z from "zod";
import { Project } from "@/src/entities/models/project";
import { IProjectsRepository } from "../../repositories/projects.repository.interface";
import { IProjectMembersRepository } from "../../repositories/project-members.repository.interface";
import { IProjectActionAuthorizationPolicy } from "../../policies/project-action-authorization.policy";
import { IUsageQuotaPolicy } from "../../policies/usage-quota.policy.interface";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
});

export interface IFetchProjectUseCase {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof Project> | null>;
}

export class FetchProjectUseCase implements IFetchProjectUseCase {
    private readonly projectsRepository: IProjectsRepository;
    private readonly projectMembersRepository: IProjectMembersRepository;
    private readonly projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy;
    private readonly usageQuotaPolicy: IUsageQuotaPolicy;

    constructor({
        projectsRepository,
        projectMembersRepository,
        projectActionAuthorizationPolicy,
        usageQuotaPolicy,
    }: {
        projectsRepository: IProjectsRepository,
        projectMembersRepository: IProjectMembersRepository,
        projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy,
        usageQuotaPolicy: IUsageQuotaPolicy,
    }) {
        this.projectsRepository = projectsRepository;
        this.projectMembersRepository = projectMembersRepository;
        this.projectActionAuthorizationPolicy = projectActionAuthorizationPolicy;
        this.usageQuotaPolicy = usageQuotaPolicy;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof Project> | null> {
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

        return await this.projectsRepository.fetch(projectId);
    }
}
