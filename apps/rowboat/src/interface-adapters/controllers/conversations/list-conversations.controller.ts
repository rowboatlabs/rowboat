import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";
import { IListConversationsUseCase } from "@/src/application/use-cases/conversations/list-conversations.use-case";
import { Conversation } from "@/src/entities/models/conversation";
import { PaginatedList } from "@/src/entities/common/paginated-list";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
    cursor: z.string().optional(),
    limit: z.number().optional(),
});

export interface IListConversationsController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof Conversation>>>>;
}

export class ListConversationsController implements IListConversationsController {
    private readonly listConversationsUseCase: IListConversationsUseCase;
    
    constructor({
        listConversationsUseCase,
    }: {
        listConversationsUseCase: IListConversationsUseCase,
    }) {
        this.listConversationsUseCase = listConversationsUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<ReturnType<typeof PaginatedList<typeof Conversation>>>> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }
        const { caller, userId, apiKey, projectId, cursor, limit } = result.data;

        // execute use case
        return await this.listConversationsUseCase.execute({
            caller,
            userId,
            apiKey,
            projectId,
            cursor,
            limit,
        });
    }
}
