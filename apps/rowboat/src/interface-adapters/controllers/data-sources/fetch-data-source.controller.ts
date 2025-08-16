import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { DataSource } from "@/src/entities/models/data-source";
import { IFetchDataSourceUseCase } from "@/src/application/use-cases/data-sources/fetch-data-source.use-case";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    sourceId: z.string(),
});

export interface IFetchDataSourceController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof DataSource>>;
}

export class FetchDataSourceController implements IFetchDataSourceController {
    private readonly fetchDataSourceUseCase: IFetchDataSourceUseCase;

    constructor({ fetchDataSourceUseCase }: { fetchDataSourceUseCase: IFetchDataSourceUseCase }) {
        this.fetchDataSourceUseCase = fetchDataSourceUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof DataSource>> {
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }

        const { caller, userId, apiKey, sourceId } = result.data;
        return await this.fetchDataSourceUseCase.execute({ caller, userId, apiKey, sourceId });
    }
}