import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { DataSource } from "@/src/entities/models/data-source";
import { IToggleDataSourceUseCase } from "@/src/application/use-cases/data-sources/toggle-data-source.use-case";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    sourceId: z.string(),
    active: z.boolean(),
});

export interface IToggleDataSourceController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof DataSource>>;
}

export class ToggleDataSourceController implements IToggleDataSourceController {
    private readonly toggleDataSourceUseCase: IToggleDataSourceUseCase;

    constructor({ toggleDataSourceUseCase }: { toggleDataSourceUseCase: IToggleDataSourceUseCase }) {
        this.toggleDataSourceUseCase = toggleDataSourceUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof DataSource>> {
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, sourceId, active } = result.data;
        return await this.toggleDataSourceUseCase.execute({ caller, userId, apiKey, sourceId, active });
    }
}