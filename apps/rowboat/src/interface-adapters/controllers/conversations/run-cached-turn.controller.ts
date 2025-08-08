import { TurnEvent } from "@/src/entities/models/turn";
import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IRunConversationTurnUseCase } from "@/src/application/use-cases/conversations/run-conversation-turn.use-case";
import { IFetchCachedTurnUseCase } from "@/src/application/use-cases/conversations/fetch-cached-turn.use-case";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    cachedTurnKey: z.string(),
});

export interface IRunCachedTurnController {
    execute(request: z.infer<typeof inputSchema>): AsyncGenerator<z.infer<typeof TurnEvent>, void, unknown>;
}

export class RunCachedTurnController implements IRunCachedTurnController {
    private readonly fetchCachedTurnUseCase: IFetchCachedTurnUseCase;
    private readonly runConversationTurnUseCase: IRunConversationTurnUseCase;
    
    constructor({
        fetchCachedTurnUseCase,
        runConversationTurnUseCase,
    }: {
        fetchCachedTurnUseCase: IFetchCachedTurnUseCase,
        runConversationTurnUseCase: IRunConversationTurnUseCase,
    }) {
        this.fetchCachedTurnUseCase = fetchCachedTurnUseCase;
        this.runConversationTurnUseCase = runConversationTurnUseCase;
    }

    async *execute(request: z.infer<typeof inputSchema>): AsyncGenerator<z.infer<typeof TurnEvent>, void, unknown> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }

        // fetch the turn
        const cachedTurn = await this.fetchCachedTurnUseCase.execute({
            ...result.data,
            key: result.data.cachedTurnKey,
        });

        // run the turn
        yield *this.runConversationTurnUseCase.execute({
            caller: result.data.caller,
            userId: result.data.userId,
            conversationId: cachedTurn.conversationId,
            reason: result.data.caller === "user" ? { type: "chat" } : { type: "api" },
            input: cachedTurn.input,
        });
    }
}