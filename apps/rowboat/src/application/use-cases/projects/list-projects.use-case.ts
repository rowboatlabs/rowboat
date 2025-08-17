import { z } from "zod";
import { IProjectsRepository } from "../../repositories/projects.repository.interface";
import { Project } from "@/src/entities/models/project";
import { PaginatedList } from "@/src/entities/common/paginated-list";

export const InputSchema = z.object({
    userId: z.string(),
    cursor: z.string().optional(),
    limit: z.number().optional(),
});

export interface IListProjectsUseCase {
    execute(request: z.infer<typeof InputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof Project>>>>;
}

export class ListProjectsUseCase implements IListProjectsUseCase {
    private readonly projectsRepository: IProjectsRepository;

    constructor({
        projectsRepository,
    }: {
        projectsRepository: IProjectsRepository,
    }) {
        this.projectsRepository = projectsRepository;
    }

    async execute(request: z.infer<typeof InputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof Project>>>> {
        const { userId, cursor, limit } = request;

        // fetch projects for user
        return await this.projectsRepository.listProjects(userId, cursor, limit);
    }
}
