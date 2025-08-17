import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { DataSource } from "@/src/entities/models/data-source";
import { IUpdateDataSourceUseCase } from "@/src/application/use-cases/data-sources/update-data-source.use-case";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    sourceId: z.string(),
    data: DataSource
        .pick({
            description: true,
        })
        .partial(),
});

export interface IUpdateDataSourceController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof DataSource>>;
}

export class UpdateDataSourceController implements IUpdateDataSourceController {
    private readonly updateDataSourceUseCase: IUpdateDataSourceUseCase;

    constructor({ updateDataSourceUseCase }: { updateDataSourceUseCase: IUpdateDataSourceUseCase }) {
        this.updateDataSourceUseCase = updateDataSourceUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof DataSource>> {
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }

        const { caller, userId, apiKey, sourceId, data } = result.data;
        return await this.updateDataSourceUseCase.execute({ caller, userId, apiKey, sourceId, data });
    }
}