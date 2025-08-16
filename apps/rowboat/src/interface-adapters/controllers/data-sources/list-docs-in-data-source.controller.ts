import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IListDocsInDataSourceUseCase } from "@/src/application/use-cases/data-sources/list-docs-in-data-source.use-case";
import { DataSourceDoc } from "@/src/entities/models/data-source-doc";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    sourceId: z.string(),
});

export interface IListDocsInDataSourceController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof DataSourceDoc>[]>;
}

export class ListDocsInDataSourceController implements IListDocsInDataSourceController {
    private readonly listDocsInDataSourceUseCase: IListDocsInDataSourceUseCase;

    constructor({ listDocsInDataSourceUseCase }: { listDocsInDataSourceUseCase: IListDocsInDataSourceUseCase }) {
        this.listDocsInDataSourceUseCase = listDocsInDataSourceUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof DataSourceDoc>[]> {
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, sourceId } = result.data;
        return await this.listDocsInDataSourceUseCase.execute({ caller, userId, apiKey, sourceId });
    }
}