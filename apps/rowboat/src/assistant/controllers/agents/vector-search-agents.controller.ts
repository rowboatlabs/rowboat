import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IFetchJobUseCase } from "@/src/application/use-cases/jobs/fetch-job.use-case";
import { AgentVersion } from "../../entities/agent-version";

const inputSchema = z.object({
    userId: z.string().optional(),
    query: z.string(),
});

export interface IVectorSearchAgentsController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof AgentVersion>[]>;
}

export class VectorSearchAgentsController implements IVectorSearchAgentsController {
    private readonly vectorSearchAgentsUseCase: IVectorSearchAgentsUseCase;
    
    constructor({
        vectorSearchAgentsUseCase,
    }: {
        vectorSearchAgentsUseCase: IVectorSearchAgentsUseCase,
    }) {
        this.vectorSearchAgentsUseCase = vectorSearchAgentsUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof Job>> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, jobId } = result.data;

        // execute use case
        return await this.fetchJobUseCase.execute({
            caller,
            userId,
            apiKey,
            jobId,
        });
    }
}
