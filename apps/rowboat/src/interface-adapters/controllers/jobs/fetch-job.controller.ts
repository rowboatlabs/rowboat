import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IFetchJobUseCase } from "@/src/application/use-cases/jobs/fetch-job.use-case";
import { Job } from "@/src/entities/models/job";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    jobId: z.string(),
});

export interface IFetchJobController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof Job>>;
}

export class FetchJobController implements IFetchJobController {
    private readonly fetchJobUseCase: IFetchJobUseCase;
    
    constructor({
        fetchJobUseCase,
    }: {
        fetchJobUseCase: IFetchJobUseCase,
    }) {
        this.fetchJobUseCase = fetchJobUseCase;
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
