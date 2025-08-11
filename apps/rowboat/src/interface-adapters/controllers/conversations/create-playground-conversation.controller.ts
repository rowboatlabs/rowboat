import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { ICreateConversationUseCase } from "@/src/application/use-cases/conversations/create-conversation.use-case";
import { Conversation } from "@/src/entities/models/conversation";
import { Workflow } from "@/app/lib/types/workflow_types";

const inputSchema = z.object({
    userId: z.string(),
    projectId: z.string(),
    workflow: Workflow,
    isLiveWorkflow: z.boolean(),
});

export interface ICreatePlaygroundConversationController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof Conversation>>;
}

export class CreatePlaygroundConversationController implements ICreatePlaygroundConversationController {
    private readonly createConversationUseCase: ICreateConversationUseCase;
    
    constructor({
        createConversationUseCase,
    }: {
        createConversationUseCase: ICreateConversationUseCase,
    }) {
        this.createConversationUseCase = createConversationUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof Conversation>> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { userId, projectId, workflow, isLiveWorkflow } = result.data;

        // execute use case
        return await this.createConversationUseCase.execute({
            caller: "user",
            userId,
            reason: {
                type: "chat",
            },
            projectId,
            workflow,
            isLiveWorkflow,
        });
    }
}