import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IFetchProjectUseCase } from "@/src/application/use-cases/projects/fetch-project.use-case";
import { Project } from "@/src/entities/models/project";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
});

export interface IFetchProjectController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof Project> | null>;
}

export class FetchProjectController implements IFetchProjectController {
    private readonly fetchProjectUseCase: IFetchProjectUseCase;
    
    constructor({
        fetchProjectUseCase,
    }: {
        fetchProjectUseCase: IFetchProjectUseCase,
    }) {
        this.fetchProjectUseCase = fetchProjectUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof Project> | null> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, projectId } = result.data;

        // execute use case
        return await this.fetchProjectUseCase.execute({
            caller,
            userId,
            apiKey,
            projectId,
        });
    }
}
