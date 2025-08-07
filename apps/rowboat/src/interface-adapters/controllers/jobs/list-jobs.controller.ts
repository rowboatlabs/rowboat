import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IListJobsUseCase } from "@/src/application/use-cases/jobs/list-jobs.use-case";
import { Job } from "@/src/entities/models/job";
import { PaginatedList } from "@/src/entities/common/paginated-list";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    cursor: z.string().optional(),
    limit: z.number().optional(),
});

export interface IListJobsController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof Job>>>>;
}

export class ListJobsController implements IListJobsController {
    private readonly listJobsUseCase: IListJobsUseCase;
    
    constructor({
        listJobsUseCase,
    }: {
        listJobsUseCase: IListJobsUseCase,
    }) {
        this.listJobsUseCase = listJobsUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof Job>>>> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, projectId, cursor, limit } = result.data;

        // execute use case
        return await this.listJobsUseCase.execute({
            caller,
            userId,
            apiKey,
            projectId,
            cursor,
            limit,
        });
    }
}
