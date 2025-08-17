import { z } from "zod";
import { IProjectsRepository } from "../../repositories/projects.repository.interface";
import { IProjectMembersRepository } from "../../repositories/project-members.repository.interface";
import { IProjectActionAuthorizationPolicy } from "../../policies/project-action-authorization.policy";
import { IApiKeysRepository } from "../../repositories/api-keys.repository.interface";
import { IDataSourceDocsRepository } from "../../repositories/data-source-docs.repository.interface";
import { IDataSourcesRepository } from "../../repositories/data-sources.repository.interface";
import { qdrantClient } from "@/app/lib/qdrant";

export const InputSchema = z.object({
    projectId: z.string(),
    userId: z.string(),
    caller: z.enum(["user", "api"]),
    apiKey: z.string().optional(),
});

export interface IDeleteProjectUseCase {
    execute(request: z.infer<typeof InputSchema>): Promise<void>;
}

export class DeleteProjectUseCase implements IDeleteProjectUseCase {
    private readonly projectsRepository: IProjectsRepository;
    private readonly projectMembersRepository: IProjectMembersRepository;
    private readonly projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy;
    private readonly apiKeysRepository: IApiKeysRepository;
    private readonly dataSourceDocsRepository: IDataSourceDocsRepository;
    private readonly dataSourcesRepository: IDataSourcesRepository;

    constructor({ projectsRepository, projectMembersRepository, projectActionAuthorizationPolicy, apiKeysRepository, dataSourceDocsRepository, dataSourcesRepository, qdrantClient }: {
        projectsRepository: IProjectsRepository,
        projectMembersRepository: IProjectMembersRepository,
        projectActionAuthorizationPolicy: IProjectActionAuthorizationPolicy,
        apiKeysRepository: IApiKeysRepository,
        dataSourceDocsRepository: IDataSourceDocsRepository,
        dataSourcesRepository: IDataSourcesRepository,
    }) {
        this.projectsRepository = projectsRepository;
        this.projectMembersRepository = projectMembersRepository;
        this.projectActionAuthorizationPolicy = projectActionAuthorizationPolicy;
        this.apiKeysRepository = apiKeysRepository;
        this.dataSourceDocsRepository = dataSourceDocsRepository;
        this.dataSourcesRepository = dataSourcesRepository;
    }

    async execute(request: z.infer<typeof InputSchema>): Promise<void> {
        const { projectId, userId, caller, apiKey } = request;
        await this.projectActionAuthorizationPolicy.authorize({
            caller,
            userId,
            apiKey,
            projectId,
        });

        // delete memberships
        await this.projectMembersRepository.deleteByProjectId(projectId);

        // delete api keys
        await this.apiKeysRepository.deleteAll(projectId);

        // delete data sources data
        await this.dataSourceDocsRepository.deleteByProjectId(projectId);
        await this.dataSourcesRepository.deleteByProjectId(projectId);
        await qdrantClient.delete("embeddings", {
            filter: {
                must: [
                    { key: "projectId", match: { value: projectId } },
                ],
            },
        });

        // delete project members
        await this.projectMembersRepository.deleteByProjectId(projectId);

        // delete project
        await this.projectsRepository.delete(projectId);
    }
}
