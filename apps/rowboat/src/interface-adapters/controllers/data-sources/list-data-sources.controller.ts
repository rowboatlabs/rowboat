import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { DataSource } from "@/src/entities/models/data-source";
import { IListDataSourcesUseCase } from "@/src/application/use-cases/data-sources/list-data-sources.use-case";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
});

export interface IListDataSourcesController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof DataSource>[]>;
}

export class ListDataSourcesController implements IListDataSourcesController {
    private readonly listDataSourcesUseCase: IListDataSourcesUseCase;

    constructor({ listDataSourcesUseCase }: { listDataSourcesUseCase: IListDataSourcesUseCase }) {
        this.listDataSourcesUseCase = listDataSourcesUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof DataSource>[]> {
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, projectId} = result.data;
        return await this.listDataSourcesUseCase.execute({ caller, userId, apiKey, projectId });
    }
}