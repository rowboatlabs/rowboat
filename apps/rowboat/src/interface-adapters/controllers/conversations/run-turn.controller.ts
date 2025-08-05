import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { ICreateConversationUseCase } from "@/src/application/use-cases/conversations/create-conversation.use-case";
import { Turn, TurnEvent } from "@/src/entities/models/turn";
import { IRunConversationTurnUseCase } from "@/src/application/use-cases/conversations/run-conversation-turn.use-case";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    conversationId: z.string().optional(),
    input: Turn.shape.input,
    stream: z.boolean(),
});

type outputSchema = {
    conversationId: string;
} & ({
    turn: z.infer<typeof Turn>;
} | {
    stream: AsyncGenerator<z.infer<typeof TurnEvent>, void, unknown>;
});

export interface IRunTurnController {
    execute(request: z.infer<typeof inputSchema>): Promise<outputSchema>;
}

export class RunTurnController implements IRunTurnController {
    private readonly createConversationUseCase: ICreateConversationUseCase;
    private readonly runConversationTurnUseCase: IRunConversationTurnUseCase;

    constructor({
        createConversationUseCase,
        runConversationTurnUseCase,
    }: {
        createConversationUseCase: ICreateConversationUseCase,
        runConversationTurnUseCase: IRunConversationTurnUseCase,
    }) {
        this.createConversationUseCase = createConversationUseCase;
        this.runConversationTurnUseCase = runConversationTurnUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<outputSchema> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, projectId, input } = result.data;
        let conversationId = result.data.conversationId;

        // if conversationId is not provided, create conversation
        if (!conversationId) {
            const conversation = await this.createConversationUseCase.execute({
                caller,
                userId,
                apiKey,
                projectId,
            });
            conversationId = conversation.id;
        }

        // setup stream
        const stream = this.runConversationTurnUseCase.execute({
            caller,
            userId,
            apiKey,
            conversationId,
            trigger: caller === "user" ? "chat" : "api",
            input,
        });

        // if streaming output request, return stream
        if (result.data.stream) {
            return {
                conversationId,
                stream,
            };
        }

        // otherwise, return turn data
        for await (const event of stream) {
            if (event.type === "done") {
                return {
                    conversationId,
                    turn: event.turn,
                };
            }
        }
        throw new Error('No turn data found');
    }
}