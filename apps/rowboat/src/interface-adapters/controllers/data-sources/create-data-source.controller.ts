import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { DataSource } from "@/src/entities/models/data-source";
import { ICreateDataSourceUseCase } from "@/src/application/use-cases/data-sources/create-data-source.use-case";
import { CreateSchema } from "@/src/application/repositories/data-sources.repository.interface";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    data: CreateSchema,
});

export interface ICreateDataSourceController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof DataSource>>;
}

export class CreateDataSourceController implements ICreateDataSourceController {
    private readonly createDataSourceUseCase: ICreateDataSourceUseCase;

    constructor({ createDataSourceUseCase }: { createDataSourceUseCase: ICreateDataSourceUseCase }) {
        this.createDataSourceUseCase = createDataSourceUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof DataSource>> {
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, data } = result.data;
        return await this.createDataSourceUseCase.execute({ caller, userId, apiKey, data });
    }
}