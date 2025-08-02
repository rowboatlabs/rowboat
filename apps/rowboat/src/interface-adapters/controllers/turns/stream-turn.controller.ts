import { TurnEvent } from "@/src/entities/models/turn";
import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IStreamTurnUseCase } from "@/src/application/use-cases/turns/stream-turn.use-case";

const inputSchema = z.object({
    turnId: z.string(),
    lastEventIndex: z.number().optional(),
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
});

export interface IStreamTurnController {
    execute(request: z.infer<typeof inputSchema>): AsyncGenerator<z.infer<typeof TurnEvent>, void, unknown>;
}

export class StreamTurnController implements IStreamTurnController {
    private readonly streamTurnUseCase: IStreamTurnUseCase;
    
    constructor({
        streamTurnUseCase,
    }: {
        streamTurnUseCase: IStreamTurnUseCase,
    }) {
        this.streamTurnUseCase = streamTurnUseCase;
    }

    async *execute(request: z.infer<typeof inputSchema>): AsyncGenerator<z.infer<typeof TurnEvent>, void, unknown> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }

        // execute use case
        yield *this.streamTurnUseCase.execute({
            turnId: result.data.turnId,
            lastEventIndex: result.data.lastEventIndex,
            caller: result.data.caller,
            userId: result.data.userId,
            apiKey: result.data.apiKey,
        });
    }
}