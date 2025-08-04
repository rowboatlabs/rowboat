import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { ICreateConversationUseCase } from "@/src/application/use-cases/conversations/create-conversation.use-case";
import { Conversation } from "@/src/entities/models/conversation";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
});

export interface ICreateConversationController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof Conversation>>;
}

export class CreateConversationController implements ICreateConversationController {
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

        // execute use case
        return await this.createConversationUseCase.execute({
            caller: result.data.caller,
            userId: result.data.userId,
            apiKey: result.data.apiKey,
            projectId: result.data.projectId,
        });
    }
}