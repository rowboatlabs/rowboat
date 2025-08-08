import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IFetchConversationUseCase } from "@/src/application/use-cases/conversations/fetch-conversation.use-case";
import { Conversation } from "@/src/entities/models/conversation";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    conversationId: z.string(),
});

export interface IFetchConversationController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof Conversation>>;
}

export class FetchConversationController implements IFetchConversationController {
    private readonly fetchConversationUseCase: IFetchConversationUseCase;
    
    constructor({
        fetchConversationUseCase,
    }: {
        fetchConversationUseCase: IFetchConversationUseCase,
    }) {
        this.fetchConversationUseCase = fetchConversationUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof Conversation>> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, conversationId } = result.data;

        // execute use case
        return await this.fetchConversationUseCase.execute({
            caller,
            userId,
            apiKey,
            conversationId,
        });
    }
}
