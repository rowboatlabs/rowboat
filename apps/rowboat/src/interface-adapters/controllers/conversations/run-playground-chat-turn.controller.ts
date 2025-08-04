import { TurnEvent } from "@/src/entities/models/turn";
import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IRunConversationTurnUseCase } from "@/src/application/use-cases/conversations/run-conversation-turn.use-case";
import { Workflow } from "@/app/lib/types/workflow_types";

const inputSchema = z.object({
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    conversationId: z.string(),
    workflow: Workflow,
});

export interface IRunPlaygroundChatTurnController {
    execute(request: z.infer<typeof inputSchema>): AsyncGenerator<z.infer<typeof TurnEvent>, void, unknown>;
}

export class RunPlaygroundChatTurnController implements IRunPlaygroundChatTurnController {
    private readonly runConversationTurnUseCase: IRunConversationTurnUseCase;
    
    constructor({
        runConversationTurnUseCase,
    }: {
        runConversationTurnUseCase: IRunConversationTurnUseCase,
    }) {
        this.runConversationTurnUseCase = runConversationTurnUseCase;
    }

    async *execute(request: z.infer<typeof inputSchema>): AsyncGenerator<z.infer<typeof TurnEvent>, void, unknown> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }

        // execute use case
        yield *this.runConversationTurnUseCase.execute({
            caller: "user",
            userId: result.data.userId,
            conversationId: result.data.conversationId,
            trigger: "chat",
            input: {
                messages: [],
                workflow: result.data.workflow,
            },
        });
    }
}