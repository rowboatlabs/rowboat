import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IAddDocsToDataSourceUseCase } from "@/src/application/use-cases/data-sources/add-docs-to-data-source.use-case";
import { CreateSchema as DocCreateSchema } from "@/src/application/repositories/data-source-docs.repository.interface";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    sourceId: z.string(),
    docs: z.array(DocCreateSchema),
});

export interface IAddDocsToDataSourceController {
    execute(request: z.infer<typeof inputSchema>): Promise<void>;
}

export class AddDocsToDataSourceController implements IAddDocsToDataSourceController {
    private readonly addDocsToDataSourceUseCase: IAddDocsToDataSourceUseCase;

    constructor({ addDocsToDataSourceUseCase }: { addDocsToDataSourceUseCase: IAddDocsToDataSourceUseCase }) {
        this.addDocsToDataSourceUseCase = addDocsToDataSourceUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<void> {
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, projectId, sourceId, docs } = result.data;
        return await this.addDocsToDataSourceUseCase.execute({ caller, userId, apiKey, projectId, sourceId, docs });
    }
}