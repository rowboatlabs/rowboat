import { Turn } from "@/src/entities/models/turn";
import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { ICreateCachedTurnUseCase } from "@/src/application/use-cases/conversations/create-cached-turn.use-case";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    conversationId: z.string(),
    input: Turn.shape.input,
});

export interface ICreateCachedTurnController {
    execute(request: z.infer<typeof inputSchema>): Promise<{ key: string }>;
}

export class CreateCachedTurnController implements ICreateCachedTurnController {
    private readonly createCachedTurnUseCase: ICreateCachedTurnUseCase;

    constructor({
        createCachedTurnUseCase,
    }: {
        createCachedTurnUseCase: ICreateCachedTurnUseCase,
    }) {
        this.createCachedTurnUseCase = createCachedTurnUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<{ key: string }> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }

        return await this.createCachedTurnUseCase.execute(result.data);
    }
}