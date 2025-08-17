import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IListProjectsUseCase } from "@/src/application/use-cases/projects/list-projects.use-case";
import { Project } from "@/src/entities/models/project";
import { PaginatedList } from "@/src/entities/common/paginated-list";
import { InputSchema } from "@/src/application/use-cases/projects/list-projects.use-case";

export interface IListProjectsController {
    execute(request: z.infer<typeof InputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof Project>>> >;
}

export class ListProjectsController implements IListProjectsController {
    private readonly listProjectsUseCase: IListProjectsUseCase;
    
    constructor({
        listProjectsUseCase,
    }: {
        listProjectsUseCase: IListProjectsUseCase,
    }) {
        this.listProjectsUseCase = listProjectsUseCase;
    }

    async execute(request: z.infer<typeof InputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof Project>>>> {
        // parse input
        const result = InputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        // execute use case
        return await this.listProjectsUseCase.execute(result.data);
    }
}
