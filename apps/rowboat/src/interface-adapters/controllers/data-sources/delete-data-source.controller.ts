import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IDeleteDataSourceUseCase } from "@/src/application/use-cases/data-sources/delete-data-source.use-case";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    sourceId: z.string(),
});

export interface IDeleteDataSourceController {
    execute(request: z.infer<typeof inputSchema>): Promise<void>;
}

export class DeleteDataSourceController implements IDeleteDataSourceController {
    private readonly deleteDataSourceUseCase: IDeleteDataSourceUseCase;

    constructor({ deleteDataSourceUseCase }: { deleteDataSourceUseCase: IDeleteDataSourceUseCase }) {
        this.deleteDataSourceUseCase = deleteDataSourceUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<void> {
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, sourceId } = result.data;
        return await this.deleteDataSourceUseCase.execute({ caller, userId, apiKey, sourceId });
    }
}