import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IDeleteDocFromDataSourceUseCase } from "@/src/application/use-cases/data-sources/delete-doc-from-data-source.use-case";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    docId: z.string(),
});

export interface IDeleteDocFromDataSourceController {
    execute(request: z.infer<typeof inputSchema>): Promise<void>;
}

export class DeleteDocFromDataSourceController implements IDeleteDocFromDataSourceController {
    private readonly deleteDocFromDataSourceUseCase: IDeleteDocFromDataSourceUseCase;

    constructor({ deleteDocFromDataSourceUseCase }: { deleteDocFromDataSourceUseCase: IDeleteDocFromDataSourceUseCase }) {
        this.deleteDocFromDataSourceUseCase = deleteDocFromDataSourceUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<void> {
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, docId } = result.data;
        return await this.deleteDocFromDataSourceUseCase.execute({ caller, userId, apiKey, docId });
    }
}