import { Message } from "@/app/lib/types/types";
import { Workflow } from "@/app/lib/types/workflow_types";
import { ICreateTurnUseCase } from "@/src/application/use-cases/turns/create-turn.use-case";
import { Turn } from "@/src/entities/models/turn";
import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";

const inputSchema = z.object({
    userId: z.string(),
    projectId: z.string(),
    conversationId: z.string().optional(),
    messages: z.array(Message),
    workflow: Workflow,
});

export interface ICreatePlaygroundChatTurnController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof Turn>>;
}

export class CreatePlaygroundChatTurnController implements ICreatePlaygroundChatTurnController {
    constructor(private readonly createTurnUseCase: ICreateTurnUseCase) {}

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof Turn>> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }

        // execute use case
        return this.createTurnUseCase.execute({
            caller: "user",
            userId: result.data.userId,
            turnData: {
                trigger: "chat",
                conversationId: result.data.conversationId,
                triggerData: {
                    messages: result.data.messages,
                    workflow: result.data.workflow,
                },
                projectId: result.data.projectId,
            },
        });
    }
}