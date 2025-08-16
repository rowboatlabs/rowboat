import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IRecrawlWebDataSourceUseCase } from "@/src/application/use-cases/data-sources/recrawl-web-data-source.use-case";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    sourceId: z.string(),
});

export interface IRecrawlWebDataSourceController {
    execute(request: z.infer<typeof inputSchema>): Promise<void>;
}

export class RecrawlWebDataSourceController implements IRecrawlWebDataSourceController {
    private readonly recrawlWebDataSourceUseCase: IRecrawlWebDataSourceUseCase;

    constructor({ recrawlWebDataSourceUseCase }: { recrawlWebDataSourceUseCase: IRecrawlWebDataSourceUseCase }) {
        this.recrawlWebDataSourceUseCase = recrawlWebDataSourceUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<void> {
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, sourceId } = result.data;
        return await this.recrawlWebDataSourceUseCase.execute({ caller, userId, apiKey, sourceId });
    }
}